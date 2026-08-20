import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyAuthoringOperations,
  RevisionConflictError,
  renderCompositionFrameSvg,
  type AuthoringOperation,
} from '@ograf-editor/authoring-core';
import {
  buildExportArtifactsWithRuntime,
  validatePackageLayout,
  type ExportArtifacts,
} from '@ograf-editor/codegen';
import {
  ANIMATABLE_LAYER_PROPERTIES,
  computeKeyframeFrames,
  createId,
  createProject,
  getLayerPropertyValueAtFrame,
  getLoopPropertyValueAtElapsed,
  getLayerAnimatableProperties,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
  intersectConvexPolygons,
  polygonBounds,
  transformBoundsPolygon,
  TRANSFORM_ANIMATION_PROPERTIES,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import JSZip from 'jszip';
import * as z from 'zod/v4';
import type { EditorBridge } from './editorBridge';
import {
  authoringOperationSchema,
  EASING_PRESETS,
  gradientPaintSchema,
  propertySchema,
} from './schemas';
import type { AuthoringWorkspace } from './workspace';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const mutation = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const captureMatteSchema = z
  .string()
  .refine(
    (value) => value === 'transparent' || value === 'checker' || /^#[0-9a-f]{6}$/i.test(value),
    'matte must be "transparent", "checker", or a #RRGGBB colour.',
  )
  .default('checker');

const textResult = (value: Record<string, unknown>, summary?: string) => ({
  content: [{ type: 'text' as const, text: summary ?? JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

function mainComposition(project: Project): Composition {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
  if (!composition)
    throw new Error('mainCompositionId does not reference an existing composition.');
  return composition;
}

let runtimeSourcePromise: Promise<string> | null = null;
function runtimeSource(): Promise<string> {
  runtimeSourcePromise ??= readFile(
    fileURLToPath(
      new URL('../../../packages/ograf-runtime/dist/graphic-runtime.js', import.meta.url),
    ),
    'utf8',
  ).catch((error: unknown) => {
    runtimeSourcePromise = null;
    throw new Error(
      `OGraf runtime build is unavailable. Run npm run build --workspace @ograf-editor/ograf-runtime. ${String(error)}`,
    );
  });
  return runtimeSourcePromise;
}

async function artifactsFor(
  workspace: AuthoringWorkspace,
  sessionId: string,
): Promise<ExportArtifacts> {
  const project = workspace.get(sessionId).snapshot().project;
  return buildExportArtifactsWithRuntime(project, mainComposition(project), await runtimeSource());
}

async function certifiedArtifacts(
  workspace: AuthoringWorkspace,
  bridge: EditorBridge,
  sessionId: string,
): Promise<{
  artifacts: ExportArtifacts;
  certification: Awaited<ReturnType<EditorBridge['certify']>>;
}> {
  const artifacts = await artifactsFor(workspace, sessionId);
  const staticErrors = [...artifacts.errors, ...validatePackageLayout(artifacts)];
  if (staticErrors.length > 0) {
    throw new Error(`OGraf certification failed:\n${staticErrors.join('\n')}`);
  }
  const certification = await bridge.certify(artifacts);
  if (!certification.valid) {
    throw new Error(`OGraf certification failed:\n${certification.errors.join('\n')}`);
  }
  return { artifacts, certification };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(
  path: string,
  data: string | Uint8Array,
  overwrite: boolean,
): Promise<void> {
  if (!overwrite && (await exists(path))) {
    throw new Error('Target already exists. Set overwrite=true only after confirming replacement.');
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  try {
    await rename(temporary, path);
  } catch (error) {
    if (!overwrite) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    await unlink(path).catch(() => undefined);
    await rename(temporary, path);
  }
}

function inspectComposition(composition: Composition) {
  return {
    id: composition.id,
    name: composition.name,
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    totalFrames: getTotalFrames(composition),
    layers: composition.layers.map((layer, index) => ({
      index,
      id: layer.id,
      name: layer.name,
      type: layer.element.type,
      visible: layer.isVisible,
      guide: layer.isGuide,
      locked: layer.isLocked,
      groupId: layer.groupId,
      parentId: layer.parentId,
      clipChildren: layer.clipChildren,
      constraints: layer.constraints,
      binding: layer.binding,
      animatedProperties: getLayerAnimatableProperties(layer).filter((property) =>
        isAnimatedTrack(getResolvedLayerAnimationTracks(layer)[property] ?? []),
      ),
      loop: layer.loop,
    })),
    lifecycle: composition.keyframes.map((keyframe) => ({ ...keyframe })),
    transitions: composition.transitions.map((transition) => ({ ...transition })),
    dataFields: composition.dataFields.map((field) => ({ ...field })),
    layout: {
      ...composition.layout,
      timelineGroups: composition.layout.timelineFolders,
      timelineFoldersDeprecated:
        'Deprecated storage name retained for project compatibility; use timelineGroups and the timeline-group operations.',
      safeAreas: safeAreaBounds(composition),
    },
  };
}

function safeAreaBounds(composition: Pick<Composition, 'width' | 'height'>) {
  const bounds = (margin: number) => ({
    x: composition.width * margin,
    y: composition.height * margin,
    width: composition.width * (1 - margin * 2),
    height: composition.height * (1 - margin * 2),
  });
  return { actionSafe: bounds(0.05), titleSafe: bounds(0.1) };
}

function defaultStripFrames(composition: Composition): number[] {
  const lifecycle = computeKeyframeFrames(composition);
  const frameById = new Map(lifecycle.map((item) => [item.keyframeId, item.frame]));
  const frames = lifecycle.map((item) => item.frame);
  for (const transition of composition.transitions) {
    const from = frameById.get(transition.fromKeyframeId);
    const to = frameById.get(transition.toKeyframeId);
    if (from !== undefined && to !== undefined && from !== to) {
      frames.push(Math.round((from + to) / 2));
    }
  }
  return [...new Set(frames)].sort((a, b) => a - b).slice(0, 12);
}

function firstStepFrame(composition: Composition): number {
  const stepIds = new Set(
    composition.keyframes
      .filter((keyframe) => keyframe.role === 'step')
      .map((keyframe) => keyframe.id),
  );
  return (
    computeKeyframeFrames(composition).find((item) => stepIds.has(item.keyframeId))?.frame ?? 0
  );
}

const PROJECT_INCLUDE_SECTIONS = [
  'metadata',
  'layers',
  'elements',
  'tracks',
  'dataFields',
  'transitions',
  'layout',
] as const;
type ProjectIncludeSection = (typeof PROJECT_INCLUDE_SECTIONS)[number];
type ProjectTracksMode = 'none' | 'animated-only' | 'full';

function isAnimatedTrack(track: Array<{ value: number }>): boolean {
  return track.length > 1 && track.some((key) => !Object.is(key.value, track[0]?.value));
}

function projectSnapshotProjection(
  snapshot: ReturnType<ReturnType<AuthoringWorkspace['get']>['snapshot']>,
  include: ProjectIncludeSection[] | undefined,
  tracksMode: ProjectTracksMode,
): Record<string, unknown> {
  if (!include && tracksMode === 'full') {
    return snapshot as unknown as Record<string, unknown>;
  }

  const sections = new Set<ProjectIncludeSection>(include ?? PROJECT_INCLUDE_SECTIONS);
  const project = snapshot.project;
  const projectedProject: Record<string, unknown> = {
    id: project.id,
    mainCompositionId: project.mainCompositionId,
    compositions: project.compositions.map((composition) => {
      const projectedComposition: Record<string, unknown> = {
        id: composition.id,
        name: composition.name,
        width: composition.width,
        height: composition.height,
        backgroundColor: composition.backgroundColor,
        frameRate: composition.frameRate,
      };
      if (sections.has('layers') || sections.has('elements') || sections.has('tracks')) {
        projectedComposition.layers = composition.layers.map((layer) => {
          const projectedLayer: Record<string, unknown> = { id: layer.id, name: layer.name };
          if (sections.has('layers')) {
            projectedLayer.isVisible = layer.isVisible;
            projectedLayer.isGuide = layer.isGuide;
            projectedLayer.isLocked = layer.isLocked;
            projectedLayer.groupId = layer.groupId;
            projectedLayer.parentId = layer.parentId;
            projectedLayer.clipChildren = layer.clipChildren;
            projectedLayer.constraints = layer.constraints;
            projectedLayer.binding = layer.binding;
          }
          if (sections.has('elements')) {
            projectedLayer.element = layer.element;
            projectedLayer.effects = layer.effects;
          }
          if (sections.has('tracks') && tracksMode !== 'none') {
            if (tracksMode === 'full') {
              projectedLayer.keyframes = layer.keyframes;
              projectedLayer.animationTracks = layer.animationTracks;
              projectedLayer.loop = layer.loop;
            } else {
              projectedLayer.animationTracks = Object.fromEntries(
                Object.entries(getResolvedLayerAnimationTracks(layer)).filter(([, track]) =>
                  isAnimatedTrack(track ?? []),
                ),
              );
              projectedLayer.loop = layer.loop
                ? {
                    ...layer.loop,
                    tracks: Object.fromEntries(
                      Object.entries(layer.loop.tracks).filter(([, track]) =>
                        isAnimatedTrack(track ?? []),
                      ),
                    ),
                  }
                : null;
            }
          }
          return projectedLayer;
        });
      }
      if (sections.has('dataFields')) projectedComposition.dataFields = composition.dataFields;
      if (sections.has('transitions')) {
        projectedComposition.keyframes = composition.keyframes;
        projectedComposition.transitions = composition.transitions;
      }
      if (sections.has('layout')) {
        projectedComposition.layout = {
          ...composition.layout,
          timelineGroups: composition.layout.timelineFolders,
          timelineFoldersDeprecated:
            'Deprecated storage name retained for project compatibility; use timelineGroups and the timeline-group operations.',
          safeAreas: safeAreaBounds(composition),
        };
      }
      if (sections.has('metadata')) {
        projectedComposition.customActions = composition.customActions;
        projectedComposition.assets = composition.assets;
      }
      return projectedComposition;
    }),
  };
  if (sections.has('metadata')) {
    projectedProject.documentVersion = project.documentVersion;
    projectedProject.name = project.name;
    projectedProject.description = project.description;
    projectedProject.version = project.version;
    projectedProject.author = project.author;
  }

  return {
    sessionId: snapshot.sessionId,
    revision: snapshot.revision,
    project: projectedProject,
    validation: snapshot.validation,
    projection: {
      include: [...sections],
      tracks: sections.has('tracks') ? tracksMode : 'none',
      compatibilityLayerKeyframesIncluded: sections.has('tracks') && tracksMode === 'full',
    },
  };
}

function generatedOperationResults(
  operations: AuthoringOperation[],
  generatedIds: Array<{ operationIndex: number; kind: string; id: string }>,
  project: Project,
) {
  return generatedIds.flatMap((generated) => {
    if (!['layer', 'field', 'guide', 'asset', 'timeline-group', 'loop'].includes(generated.kind)) {
      return [];
    }
    const operation = operations[generated.operationIndex];
    const base = {
      index: generated.operationIndex,
      type: operation?.type ?? generated.kind,
      id: generated.id,
    };
    if (generated.kind === 'layer') {
      const layer = project.compositions
        .flatMap((composition) => composition.layers)
        .find((candidate) => candidate.id === generated.id);
      return [{ ...base, ...(layer ? { name: layer.name } : {}) }];
    }
    if (generated.kind === 'field') {
      const field = project.compositions
        .flatMap((composition) => composition.dataFields)
        .find((candidate) => candidate.id === generated.id);
      return [{ ...base, ...(field ? { key: field.key } : {}) }];
    }
    if (generated.kind === 'asset') {
      const asset = project.compositions
        .flatMap((composition) => composition.assets)
        .find((candidate) => candidate.id === generated.id);
      return [{ ...base, ...(asset ? { name: asset.name, mimeType: asset.mimeType } : {}) }];
    }
    if (generated.kind === 'timeline-group') {
      const group = project.compositions
        .flatMap((composition) => composition.layout.timelineFolders)
        .find((candidate) => candidate.id === generated.id);
      return [
        {
          ...base,
          ...(group ? { name: group.name, color: group.color, layerIds: [...group.layerIds] } : {}),
        },
      ];
    }
    if (generated.kind === 'loop') {
      const layer = project.compositions
        .flatMap((composition) => composition.layers)
        .find((candidate) => candidate.loop?.id === generated.id);
      return [
        {
          ...base,
          ...(layer?.loop
            ? {
                layerId: layer.id,
                name: layer.loop.name,
                durationFrames: layer.loop.durationFrames,
              }
            : {}),
        },
      ];
    }
    const guide = project.compositions
      .flatMap((composition) => composition.layout.guides)
      .find((candidate) => candidate.id === generated.id);
    return [{ ...base, ...(guide ? { axis: guide.axis, position: guide.position } : {}) }];
  });
}

function wildcardNameMatcher(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function normalizeOperationSelectors(
  project: Project,
  operations: unknown[],
): AuthoringOperation[] {
  let projected = structuredClone(project);
  const normalized: AuthoringOperation[] = [];
  for (const [index, source] of operations.entries()) {
    const operation = structuredClone(source) as Record<string, unknown>;
    const compositionId =
      typeof operation.compositionId === 'string'
        ? operation.compositionId
        : projected.mainCompositionId;
    const composition = projected.compositions.find((candidate) => candidate.id === compositionId);
    if (!composition)
      throw new Error(`Operation ${index}: composition not found: ${compositionId}`);

    if (operation.type === 'add_layer') operation.id = createId('layer');
    if (operation.type === 'add_data_field') operation.id = createId('field');
    if (operation.type === 'create_timeline_group') operation.id = createId('timeline-group');
    if (operation.type === 'set_layer_loop') operation.id = createId('layer-loop');

    if ('layerName' in operation || 'layerId' in operation) {
      const id = typeof operation.layerId === 'string' ? operation.layerId : undefined;
      const name = typeof operation.layerName === 'string' ? operation.layerName : undefined;
      if (id && name) {
        throw new Error(`Operation ${index}: pass layerId or layerName, not both.`);
      }
      if (!id && !name) {
        throw new Error(`Operation ${index}: layerId or layerName is required.`);
      }
      if (name) {
        const matches = composition.layers.filter((layer) => layer.name === name);
        if (matches.length !== 1) {
          const detail = matches.length
            ? matches.map((layer) => `${layer.name} (${layer.id})`).join(', ')
            : 'no matches';
          throw new Error(
            `Operation ${index}: layerName ${JSON.stringify(name)} is ${matches.length ? 'ambiguous' : 'unknown'}; ${detail}.`,
          );
        }
        operation.layerId = matches[0]!.id;
      }
      delete operation.layerName;
    }

    if (operation.type === 'stagger_property_track') {
      const ids = Array.isArray(operation.layerIds) ? operation.layerIds : undefined;
      const pattern =
        typeof operation.layerNamePattern === 'string' ? operation.layerNamePattern : undefined;
      if (ids && pattern) {
        throw new Error(`Operation ${index}: pass layerIds or layerNamePattern, not both.`);
      }
      if (!ids && !pattern) {
        throw new Error(`Operation ${index}: layerIds or layerNamePattern is required.`);
      }
      if (pattern) {
        const matcher = wildcardNameMatcher(pattern);
        operation.layerIds = composition.layers
          .filter((layer) => matcher.test(layer.name))
          .map((layer) => layer.id);
        if ((operation.layerIds as string[]).length === 0) {
          throw new Error(
            `Operation ${index}: layerNamePattern ${JSON.stringify(pattern)} matched no layers.`,
          );
        }
      }
      delete operation.layerNamePattern;
    }

    if (operation.type === 'set_layer_binding' && operation.binding) {
      const binding = operation.binding as Record<string, unknown>;
      const fieldId = typeof binding.fieldId === 'string' ? binding.fieldId : undefined;
      const fieldKey = typeof binding.fieldKey === 'string' ? binding.fieldKey : undefined;
      if (fieldId && fieldKey) {
        throw new Error(`Operation ${index}: binding accepts fieldId or fieldKey, not both.`);
      }
      if (!fieldId && !fieldKey) {
        throw new Error(`Operation ${index}: binding fieldId or fieldKey is required.`);
      }
      if (fieldKey) {
        const field = composition.dataFields.find((candidate) => candidate.key === fieldKey);
        if (!field) throw new Error(`Operation ${index}: data field key not found: ${fieldKey}`);
        binding.fieldId = field.id;
      }
      delete binding.fieldKey;
    }

    if (operation.type === 'update_data_field') {
      const fieldId = typeof operation.fieldId === 'string' ? operation.fieldId : undefined;
      const fieldKey = typeof operation.fieldKey === 'string' ? operation.fieldKey : undefined;
      if (fieldId && fieldKey) {
        throw new Error(`Operation ${index}: pass fieldId or fieldKey, not both.`);
      }
      if (!fieldId && !fieldKey) {
        throw new Error(`Operation ${index}: fieldId or fieldKey is required.`);
      }
      if (fieldKey) {
        const matches = composition.dataFields.filter((field) => field.key === fieldKey);
        if (matches.length !== 1) {
          throw new Error(
            `Operation ${index}: fieldKey ${JSON.stringify(fieldKey)} is ${matches.length ? 'ambiguous' : 'unknown'}.`,
          );
        }
        operation.fieldId = matches[0]!.id;
      }
      delete operation.fieldKey;
    }

    const typedOperation = operation as unknown as AuthoringOperation;
    normalized.push(typedOperation);
    // Preallocated IDs make ordinary create-then-target sequences deterministic in this projection
    // and in the final atomic apply. Duplicate-group outputs deliberately remain follow-up targets
    // through their returned mappings because each copy creates a variable number of IDs.
    if (typedOperation.type !== 'duplicate_group') {
      try {
        projected = applyAuthoringOperations(projected, [typedOperation]).project;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Operation ${index}: ${detail}`);
      }
    }
  }
  return normalized;
}

function rgb(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function contrastRatio(foreground: string, background: string): number | null {
  const first = rgb(foreground);
  const second = rgb(background);
  if (!first || !second) return null;
  const luminance = ([red, green, blue]: [number, number, number]) => {
    const channels = [red, green, blue].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersection(first: Rect, second: Rect): Rect | null {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Bounds that can actually paint after applying every clipping ancestor. */
function visibleLayerBounds(
  composition: Composition,
  layer: Composition['layers'][number],
  frame: number,
): ReturnType<typeof getLayerTransformAtFrame> | null {
  const source = getLayerTransformAtFrame(layer, frame);
  let polygon = transformBoundsPolygon(source);
  let parentId = layer.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = composition.layers.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    if (parent.clipChildren) {
      polygon = intersectConvexPolygons(
        polygon,
        transformBoundsPolygon(getLayerTransformAtFrame(parent, frame)),
      );
      if (polygon.length === 0) return null;
    }
    parentId = parent.parentId;
  }
  return polygonBounds(polygon, source);
}

function unionArea(rects: Rect[]): number {
  const xs = [...new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort(
    (a, b) => a - b,
  );
  let area = 0;
  for (let index = 0; index < xs.length - 1; index++) {
    const left = xs[index]!;
    const right = xs[index + 1]!;
    const intervals = rects
      .filter((rect) => rect.x < right && rect.x + rect.width > left)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let coveredY = 0;
    let start: number | null = null;
    let end = 0;
    for (const [top, bottom] of intervals) {
      if (start === null) {
        start = top;
        end = bottom;
      } else if (top <= end) end = Math.max(end, bottom);
      else {
        coveredY += end - start;
        start = top;
        end = bottom;
      }
    }
    if (start !== null) coveredY += end - start;
    area += (right - left) * coveredY;
  }
  return area;
}

function broadcastLintWarnings(project: Project, interlacedOutput: boolean): string[] {
  const warnings: string[] = [];
  for (const composition of project.compositions) {
    const stepIds = new Set(
      composition.keyframes
        .filter((keyframe) => keyframe.role === 'step')
        .map((keyframe) => keyframe.id),
    );
    const lifecycleFrames = computeKeyframeFrames(composition);
    const stepFrames = lifecycleFrames
      .filter((item) => stepIds.has(item.keyframeId))
      .map((item) => item.frame);
    const frames = stepFrames.length > 0 ? stepFrames : lifecycleFrames.map((item) => item.frame);
    const actionMarginX = composition.width * 0.05;
    const actionMarginY = composition.height * 0.05;
    const titleMarginX = composition.width * 0.1;
    const titleMarginY = composition.height * 0.1;
    const minimumFontSize = 24 * (composition.height / 1080);
    const minimumInterlacedHeight = 3 * (composition.height / 1080);
    for (const [index, layer] of composition.layers.entries()) {
      if (!layer.isVisible || layer.isGuide) continue;
      for (const frame of frames) {
        const pose = visibleLayerBounds(composition, layer, frame);
        if (!pose) continue;
        const spansWidth = pose.x <= 0 && pose.x + pose.width >= composition.width;
        const spansHeight = pose.y <= 0 && pose.y + pose.height >= composition.height;
        const actionAxes = [
          ...(!spansWidth &&
          (pose.x < actionMarginX || pose.x + pose.width > composition.width - actionMarginX)
            ? ['horizontal']
            : []),
          ...(!spansHeight &&
          (pose.y < actionMarginY || pose.y + pose.height > composition.height - actionMarginY)
            ? ['vertical']
            : []),
        ];
        const titleAxes = [
          ...(!spansWidth &&
          (pose.x < titleMarginX || pose.x + pose.width > composition.width - titleMarginX)
            ? ['horizontal']
            : []),
          ...(!spansHeight &&
          (pose.y < titleMarginY || pose.y + pose.height > composition.height - titleMarginY)
            ? ['vertical']
            : []),
        ];
        if (actionAxes.length > 0) {
          warnings.push(
            `Broadcast lint: composition "${composition.name}" layer "${layer.name}" is outside 5% action-safe bounds on the ${actionAxes.join(' and ')} axis at frame ${frame}.`,
          );
        } else if (titleAxes.length > 0) {
          warnings.push(
            `Broadcast lint: composition "${composition.name}" layer "${layer.name}" is inside action-safe but outside 10% title-safe bounds on the ${titleAxes.join(' and ')} axis at frame ${frame}.`,
          );
        }
      }
      if (layer.element.type === 'text') {
        if (layer.element.fontSize < minimumFontSize) {
          warnings.push(
            `Broadcast lint: text layer "${layer.name}" font size ${layer.element.fontSize}px is below the ${minimumFontSize.toFixed(1)}px minimum scaled for ${composition.height} lines.`,
          );
        }
        for (const frame of frames) {
          const textPose = visibleLayerBounds(composition, layer, frame);
          if (!textPose) continue;
          if (textPose.opacity <= 0 || textPose.width <= 0 || textPose.height <= 0) continue;
          const textBounds: Rect = textPose;
          const backings = composition.layers
            .slice(0, index)
            .reverse()
            .flatMap((candidate) => {
              if (
                !candidate.isVisible ||
                candidate.isGuide ||
                candidate.element.type !== 'rectangle'
              ) {
                return [];
              }
              const pose = getLayerTransformAtFrame(candidate, frame);
              if (
                pose.opacity < 0.999 ||
                pose.rotation !== 0 ||
                typeof candidate.element.fill !== 'string' ||
                !rgb(candidate.element.fill)
              ) {
                return [];
              }
              const overlap = intersection(textBounds, pose);
              return overlap
                ? [{ layer: candidate, fill: candidate.element.fill, pose, overlap }]
                : [];
            });
          const fullBacking = backings.find(
            ({ pose }) =>
              pose.x <= textBounds.x &&
              pose.y <= textBounds.y &&
              pose.x + pose.width >= textBounds.x + textBounds.width &&
              pose.y + pose.height >= textBounds.y + textBounds.height,
          );
          if (fullBacking) {
            const ownContrast = contrastRatio(layer.element.color, fullBacking.fill);
            if (ownContrast !== null && ownContrast < 4.5) {
              warnings.push(
                `Broadcast lint: text layer "${layer.name}" contrast against backing layer "${fullBacking.layer.name}" at frame ${frame} is ${ownContrast.toFixed(2)}:1 (recommended minimum 4.5:1).`,
              );
            }
            continue;
          }
          const textArea = textBounds.width * textBounds.height;
          const coveredArea = unionArea(backings.map(({ overlap }) => overlap));
          const unbackedPercent = Math.max(0, Math.min(100, 100 - (coveredArea / textArea) * 100));
          const midGreyContrast = contrastRatio(layer.element.color, '#808080');
          if (midGreyContrast !== null && midGreyContrast < 4.5) {
            warnings.push(
              unbackedPercent < 99.5
                ? `Broadcast lint: text layer "${layer.name}" is ${unbackedPercent.toFixed(0)}% unbacked at frame ${frame}; unbacked-region contrast against a mid-grey matte is ${midGreyContrast.toFixed(2)}:1 (recommended minimum 4.5:1).`
                : `Broadcast lint: text layer "${layer.name}" has no opaque backing at frame ${frame}; contrast against a mid-grey matte is ${midGreyContrast.toFixed(2)}:1 (recommended minimum 4.5:1).`,
            );
          }
        }
      }
      if (interlacedOutput && ['rectangle', 'path'].includes(layer.element.type)) {
        const pose = getLayerTransformAtFrame(layer, frames[0] ?? 0);
        if (pose.width > pose.height * 4 && pose.height < minimumInterlacedHeight) {
          warnings.push(
            `Broadcast lint: horizontal layer "${layer.name}" is ${pose.height}px high; use at least ${minimumInterlacedHeight.toFixed(1)}px for the declared interlaced output.`,
          );
        }
      }
    }
  }
  return [...new Set(warnings)];
}

export function createOGrafMcpServer(
  workspace: AuthoringWorkspace,
  bridge: EditorBridge,
): McpServer {
  const server = new McpServer({ name: 'ograf-editor', version: '0.1.0' });

  server.registerTool(
    'ograf_get_capabilities',
    {
      title: 'Get OGraf authoring capabilities',
      description:
        'Returns complete element schemas/defaults, binding targets, animation/easing semantics, safe authoring rules, the browser-dependent tool list, and live editor connection/responsiveness/latency. Important semantics: higher layer indexes paint later/on top, and a property key easing/curve governs the segment ending at that key (incoming). liveEditorConnected is a deprecated combined alias; use editor.connected and editor.responsive.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const editor = bridge.health;
      return textResult({
        protocolVersion: 1,
        defaultSessionId: 'editor',
        editor,
        liveEditorConnected: editor.connected && editor.responsive,
        liveEditorConnectedDeprecated:
          'Deprecated alias for editor.connected && editor.responsive. Use the editor object.',
        requiresBrowser: [
          'ograf_capture',
          'ograf_render_strip',
          'ograf_measure_text',
          'ograf_certify_project',
          'ograf_save_project',
          'ograf_export_package',
          'ograf_validate_project when browserTextOverflow=true',
        ],
        elementTypes: ['rectangle', 'ellipse', 'text', 'image', 'path', 'image-sequence'],
        elementSchemas: {
          rectangle: {
            fill: {
              type: 'paint',
              values: [
                'solid-color-string',
                'linear-gradient',
                'radial-gradient',
                'conic-gradient',
              ],
              default: '#3b3f4a',
              gradientShape: {
                type: 'linear | radial | conic',
                angle: 'finite degrees',
                stops: '[{ offset: 0..1, color: string, opacity: 0..1 }], minimum 2',
              },
            },
            strokeColor: { type: 'color', default: 'transparent' },
            strokeWidth: { type: 'number', default: 0, minimum: 0 },
            borderRadius: { type: 'number', default: 0, minimum: 0 },
          },
          ellipse: {
            fill: {
              type: 'paint',
              values: [
                'solid-color-string',
                'linear-gradient',
                'radial-gradient',
                'conic-gradient',
              ],
              default: '#3b3f4a',
              gradientShape: {
                type: 'linear | radial | conic',
                angle: 'finite degrees',
                stops: '[{ offset: 0..1, color: string, opacity: 0..1 }], minimum 2',
              },
            },
            strokeColor: { type: 'color', default: 'transparent' },
            strokeWidth: { type: 'number', default: 0, minimum: 0 },
          },
          text: {
            content: { type: 'string', default: 'Text' },
            color: { type: 'color', default: '#ffffff' },
            fontFamily: { type: 'string', default: 'system-ui, sans-serif' },
            fontSize: { type: 'number', default: 48, exclusiveMinimum: 0 },
            fontWeight: { type: 'number', default: 600 },
            textAlign: {
              type: 'enum',
              values: ['left', 'center', 'right'],
              default: 'left',
            },
            autoFit: {
              type: 'enum',
              values: ['auto-size', 'shrink-to-fit', 'fixed'],
              default: 'auto-size',
            },
          },
          image: {
            src: {
              type: 'string-or-null',
              default: null,
              description:
                'Image URL, data URI, or asset:<id> reference returned by add_asset; null renders no image.',
            },
          },
          path: {
            d: { type: 'string', default: 'M50,0 L100,100 L0,100 Z' },
            fill: { type: 'color', default: '#3b3f4a' },
            strokeColor: { type: 'color', default: 'transparent' },
            strokeWidth: { type: 'number', default: 0, minimum: 0 },
            viewBoxWidth: { type: 'number', default: 100, exclusiveMinimum: 0 },
            viewBoxHeight: { type: 'number', default: 100, exclusiveMinimum: 0 },
          },
          'image-sequence': {
            frames: {
              type: 'string-array',
              default: [],
              description: 'Ordered image URLs, data URIs, or asset:<id> references.',
            },
            fps: { type: 'number', default: 12, exclusiveMinimum: 0 },
            loop: { type: 'boolean', default: true },
          },
        },
        animatableProperties: [...ANIMATABLE_LAYER_PROPERTIES],
        animatablePropertyPatterns: {
          'fill.stops[N].offset':
            'Normalized 0..1 position of gradient stop N (zero-based) on rectangle/ellipse layers. Each stop owns an independent numeric track with incoming easing.',
        },
        easingPresets: [...EASING_PRESETS],
        semantics: {
          layerPaintOrder: 'ascending-index-paints-later',
          layerPaintOrderDetail:
            'composition.layers[0] is the bottom layer; each higher index paints later and appears above lower indexes.',
          easingApplies: 'incoming',
          easingAppliesDetail:
            'A property key easing and optional cubic-bezier curve control interpolation from the previous key into that key.',
          textOrigin: 'top-left',
          rectOrigin: 'top-left',
          transformOrigin:
            'Rotation origin uses normalized transformOriginX/transformOriginY within top-left-positioned layer bounds.',
          childClipping:
            'set_layer_layout clipChildren=true makes that layer an animated, rotation-aware rectangular mask for direct children whose parentId points to it. Rectangle borderRadius rounds the transformed mask. Children keep their own world-space rotation; rotate the parent mask to create a diagonal wipe. Clipping is deterministic and compiled; ordinary parent translation remains baked.',
          localLoops:
            'A layer may own one local loop clip with independent numeric property tracks on a 0..durationFrames ruler. set_layer_loop configures lifecycle or Step activation; set_loop_property_track authors incoming-eased keys without creating composition keys or OGraf Steps. Null repeatCount means infinite. All loop phase is sampled from the shared OGraf timestamp/action schedule; loops never invoke lifecycle actions.',
        },
        loopAnimation: {
          operations: ['set_layer_loop', 'set_loop_property_track', 'remove_layer_loop'],
          activations: ['lifecycle', 'step'],
          repeatCount: 'null means infinite; positive integers play a finite number of cycles',
          clock:
            'Layer-local editing timelines share the deterministic composition/OGraf clock; they are not autonomous timers.',
          easing:
            'Each loop property key owns its incoming easing and optional cubic-bezier curve independently.',
        },
        bindings: {
          fieldTypes: ['text', 'textarea', 'number', 'boolean', 'color', 'gradient', 'image-url'],
          gradient:
            'A gradient field binds the complete rectangle/ellipse fill object. Per-stop paths are not supported.',
          targetProperties: {
            rectangle: ['fill'],
            ellipse: ['fill'],
            text: ['content', 'color'],
            image: ['src'],
            path: ['fill'],
            'image-sequence': [],
          },
        },
        canvasLayout: {
          safeAreas: ['action-safe-5-percent', 'title-safe-10-percent'],
          guides: ['vertical', 'horizontal'],
          snappingTargets: ['grid', 'guides', 'layers', 'composition-edges-and-centres'],
          horizontalConstraints: ['left', 'right', 'left-right', 'center', 'scale'],
          verticalConstraints: ['top', 'bottom', 'top-bottom', 'center', 'scale'],
          boundsModes: ['allow', 'contain'],
          overflowPreview: ['visible', 'clip'],
          timelineGroups: {
            operations: [
              'create_timeline_group',
              'rename_timeline_group',
              'set_timeline_group_color',
              'ungroup_timeline_group',
            ],
            semantics:
              'Timeline-only organization for independent layer rows. It does not change paint order, animation tracks, canvas object groups, stable layer IDs, or compiled OGraf output. Prefer grouping related multi-layer components and repeated forecast/day cells.',
            persistedCompatibilityField: 'composition.layout.timelineFolders',
          },
          childClipping:
            'Set clipChildren on a parent and parentId on each child. Animated translation, size, rotation, origin, and rectangle radius define the deterministic clip; rotating the parent creates diagonal wipes. Duplicate/group operations preserve and remap the relationship.',
          compilation:
            'Layout metadata is authoring-only. Responsive resize and parent translation operations bake ordinary deterministic layer tracks before OGraf compilation.',
        },
        safety: {
          optimisticConcurrency: 'Mutations require expectedRevision.',
          atomicBatches: true,
          dryRun: true,
          outputGate: 'Save/export requires exact-artifact browser OGraf certification.',
          fileScope: workspace.root,
        },
        assets: {
          operation: 'add_asset',
          referenceSyntax: 'asset:<id>',
          semantics:
            'Assets persist once in composition.assets; editor/capture resolve references and certified package export writes each registry entry once.',
        },
      });
    },
  );

  server.registerTool(
    'ograf_list_sessions',
    {
      title: 'List OGraf authoring sessions',
      description: 'Lists open authoring sessions and their current revisions.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => textResult({ sessions: workspace.list() }),
  );

  server.registerTool(
    'ograf_get_changes',
    {
      title: 'Get OGraf revision changes',
      description:
        'Returns bounded revision history after sinceRevision, including whether each change came from an agent, the browser editor, undo, or redo and a compact affected-layer summary. Read-only and does not change revision. History retains the latest 100 revisions.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        sinceRevision: z.number().int().nonnegative(),
      },
      annotations: readOnly,
    },
    async ({ sessionId, sinceRevision }) => {
      const session = workspace.get(sessionId);
      return textResult({
        sessionId,
        currentRevision: session.revision,
        sinceRevision,
        changes: session.getChanges(sinceRevision),
        historyLimit: 100,
      });
    },
  );

  server.registerTool(
    'ograf_get_project',
    {
      title: 'Get editable OGraf project',
      description:
        'Returns the editable project, current revision, and validation state. Read before every mutation. With no filters, the response is exactly the existing complete snapshot (backward compatible). Use include to select metadata, layers, elements, tracks, dataFields, transitions, and/or layout. tracks=full preserves both compatibility layer keyframes and canonical animationTracks; animated-only returns only canonical property tracks whose values actually change and omits redundant compatibility layer keyframes; none omits both. The default is full to preserve existing clients.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        include: z.array(z.enum(PROJECT_INCLUDE_SECTIONS)).min(1).optional(),
        tracks: z.enum(['none', 'animated-only', 'full']).default('full'),
      },
      annotations: readOnly,
    },
    async ({ sessionId, include, tracks }) =>
      textResult(projectSnapshotProjection(workspace.get(sessionId).snapshot(), include, tracks)),
  );

  server.registerTool(
    'ograf_inspect_scene',
    {
      title: 'Inspect OGraf scene',
      description:
        'Returns a compact composition/layer outline with IDs and animated-property indicators.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
      },
      annotations: readOnly,
    },
    async ({ sessionId, compositionId }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const compositions = compositionId
        ? snapshot.project.compositions.filter((item) => item.id === compositionId)
        : snapshot.project.compositions;
      if (compositionId && compositions.length === 0)
        throw new Error(`Composition not found: ${compositionId}`);
      return textResult({
        sessionId,
        revision: snapshot.revision,
        compositions: compositions.map(inspectComposition),
      });
    },
  );

  server.registerTool(
    'ograf_get_timeline',
    {
      title: 'Get OGraf property timeline',
      description:
        'Returns independent lifecycle property tracks plus any layer-local loop clip for selected layers. Loop tracks use local frames 0..durationFrames, never create OGraf Steps, and every key easing/curve applies to its incoming segment.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
        layerIds: z.array(z.string()).optional(),
      },
      annotations: readOnly,
    },
    async ({ sessionId, compositionId, layerIds }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const composition = snapshot.project.compositions.find(
        (item) => item.id === (compositionId ?? snapshot.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found.');
      const selected = layerIds?.length
        ? composition.layers.filter((layer) => layerIds.includes(layer.id))
        : composition.layers;
      return textResult({
        sessionId,
        revision: snapshot.revision,
        compositionId: composition.id,
        totalFrames: getTotalFrames(composition),
        layers: selected.map((layer) => ({
          id: layer.id,
          name: layer.name,
          tracks: getResolvedLayerAnimationTracks(layer),
          loop: layer.loop,
        })),
      });
    },
  );

  server.registerTool(
    'ograf_sample_tracks',
    {
      title: 'Sample resolved OGraf layer geometry',
      description:
        'Browser-free deterministic sampling of canonical animation tracks. Returns resolved values and derived right/bottom bounds at requested integer frames, so geometric invariants can be verified even when the live editor is disconnected or unresponsive. Pass loopElapsedFrame to overlay every selected layer local loop at that absolute elapsed clip frame without mutating state. Omit layerIds for all layers. Omit properties to return properties animated by the finite or loop tracks; derived x/y/width/height/right/bottom/opacity are always included.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
        frames: z.array(z.number().int().nonnegative()).min(1).max(120),
        layerIds: z.array(z.string()).min(1).optional(),
        properties: z.array(propertySchema).min(1).optional(),
        loopElapsedFrame: z.number().nonnegative().optional(),
      },
      annotations: readOnly,
    },
    async ({ sessionId, compositionId, frames, layerIds, properties, loopElapsedFrame }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const composition = snapshot.project.compositions.find(
        (item) => item.id === (compositionId ?? snapshot.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found.');
      const totalFrames = getTotalFrames(composition);
      const resolvedFrames = [...new Set(frames)].sort((a, b) => a - b);
      const invalid = resolvedFrames.find((frame) => frame > totalFrames);
      if (invalid !== undefined) {
        throw new Error(`Frame ${invalid} is beyond the composition total frame ${totalFrames}.`);
      }
      const selected = layerIds
        ? layerIds.map((id) => {
            const layer = composition.layers.find((candidate) => candidate.id === id);
            if (!layer) throw new Error(`Layer not found: ${id}`);
            return layer;
          })
        : composition.layers;
      return textResult({
        sessionId,
        revision: snapshot.revision,
        compositionId: composition.id,
        totalFrames,
        frames: resolvedFrames.map((frame) => ({
          frame,
          layers: selected.map((layer) => {
            const pose = { ...getLayerTransformAtFrame(layer, frame) };
            const valueAt = (property: Parameters<typeof getLayerPropertyValueAtFrame>[1]) => {
              const base = getLayerPropertyValueAtFrame(layer, property, frame);
              return layer.loop && loopElapsedFrame !== undefined
                ? getLoopPropertyValueAtElapsed(layer.loop, property, loopElapsedFrame, base)
                : base;
            };
            if (layer.loop && loopElapsedFrame !== undefined) {
              for (const property of TRANSFORM_ANIMATION_PROPERTIES) {
                if ((layer.loop.tracks[property]?.length ?? 0) > 0)
                  pose[property] = valueAt(property);
              }
            }
            const resolvedProperties =
              properties ??
              getLayerAnimatableProperties(layer).filter(
                (property) =>
                  isAnimatedTrack(getResolvedLayerAnimationTracks(layer)[property] ?? []) ||
                  isAnimatedTrack(layer.loop?.tracks[property] ?? []),
              );
            return {
              layerId: layer.id,
              name: layer.name,
              bounds: {
                x: pose.x,
                y: pose.y,
                width: pose.width,
                height: pose.height,
                right: pose.x + pose.width,
                bottom: pose.y + pose.height,
              },
              opacity: pose.opacity,
              properties: Object.fromEntries(
                resolvedProperties.map((property) => [property, valueAt(property)]),
              ),
            };
          }),
        })),
      });
    },
  );

  server.registerTool(
    'ograf_render_frame',
    {
      title: 'Render OGraf frame',
      description:
        'Renders a deterministic SVG snapshot for visual inspection without changing the project.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
        frame: z.number().int().nonnegative().default(0),
      },
      annotations: readOnly,
    },
    async ({ sessionId, compositionId, frame }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const rendered = renderCompositionFrameSvg(snapshot.project, compositionId, frame);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Rendered ${rendered.composition.name}, frame ${rendered.frame}, revision ${snapshot.revision}.`,
          },
          {
            type: 'image' as const,
            data: Buffer.from(rendered.svg).toString('base64'),
            mimeType: 'image/svg+xml',
          },
        ],
        structuredContent: {
          sessionId,
          revision: snapshot.revision,
          compositionId: rendered.composition.id,
          frame: rendered.frame,
          width: rendered.composition.width,
          height: rendered.composition.height,
          svg: rendered.svg,
        },
      };
    },
  );

  server.registerTool(
    'ograf_capture',
    {
      title: 'Capture browser-rendered OGraf PNG',
      description:
        'Requires a connected and responsive live browser editor. Rasterizes the authoritative browser DOM renderer to PNG without mutating the project or revision. target=composition renders one deterministic graphic frame; omit frame to capture the first Step/on-air frame, and use dataOverrides keyed by data-field key for temporary values. target=viewport captures visible editor chrome and ignores frame/matte/dataOverrides. matte=transparent preserves PNG alpha, checker provides a diagnostic grid, and #RRGGBB supplies a solid backing. The primary result is a private five-minute localhost URL; request inline base64 only when needed. resolvedFonts is best-effort/inferred.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        target: z.enum(['composition', 'viewport']).default('composition'),
        frame: z.number().int().nonnegative().optional(),
        compositionId: z.string().optional(),
        maxDimension: z.number().int().min(64).max(4096).default(900),
        matte: captureMatteSchema,
        dataOverrides: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), gradientPaintSchema]))
          .optional(),
        enableBase64Response: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({
      sessionId,
      target,
      frame,
      compositionId,
      maxDimension,
      matte,
      dataOverrides,
      enableBase64Response,
    }) => {
      if (target === 'viewport' && sessionId !== 'editor') {
        throw new Error('target=viewport is available only for sessionId=editor.');
      }
      if (target === 'viewport' && dataOverrides) {
        throw new Error('dataOverrides is available only for target=composition.');
      }
      const snapshot = workspace.get(sessionId).snapshot();
      const composition = snapshot.project.compositions.find(
        (item) => item.id === (compositionId ?? snapshot.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found.');
      const resolvedFrame = frame ?? firstStepFrame(composition);
      if (target === 'composition' && resolvedFrame > getTotalFrames(composition)) {
        throw new Error(
          `Frame ${resolvedFrame} is beyond the composition's total frame ${getTotalFrames(composition)}.`,
        );
      }

      const capture = await bridge.capture({
        target,
        project: snapshot.project,
        compositionId: composition.id,
        frame: resolvedFrame,
        maxDimension,
        matte,
        ...(dataOverrides ? { dataOverrides } : {}),
      });
      const { data, ...metadata } = capture;
      const structuredContent = {
        sessionId,
        revision: snapshot.revision,
        target,
        compositionId: composition.id,
        ...(target === 'composition' ? { frame: resolvedFrame } : {}),
        ...metadata,
        fetchCommand: `curl --fail --output ograf-capture.png "${capture.url}"`,
      };
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }
      > = [
        {
          type: 'text',
          text: `PNG capture ready (${capture.width}×${capture.height}, natural ${capture.originalWidth}×${capture.originalHeight}). Fetch within five minutes: ${capture.url}\n${structuredContent.fetchCommand}`,
        },
      ];
      if (enableBase64Response) content.push({ type: 'image', data, mimeType: 'image/png' });
      return { content, structuredContent };
    },
  );

  server.registerTool(
    'ograf_render_strip',
    {
      title: 'Render OGraf PNG frame strip',
      description:
        'Requires a connected and responsive live browser editor. Renders up to 12 composition frames through the authoritative browser DOM renderer and composites one PNG contact sheet without mutating project state or revision. Omit frames to sample every lifecycle Start/Step/End frame plus each transition midpoint. Each requested frame is rendered independently by the real interpolation engine, so the strip reveals bad holds, pops, staggering, easing, and paint order without reimplementing animation client-side. maxDimension limits each tile’s long edge; labelFrames burns frame numbers into the sheet. matte accepts transparent, checker, or #RRGGBB. The primary result is a private five-minute localhost URL; set enableBase64Response=true only when the client cannot fetch it.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
        frames: z.array(z.number().int().nonnegative()).min(1).max(12).optional(),
        columns: z.number().int().min(1).max(12).default(3),
        maxDimension: z.number().int().min(64).max(1024).default(320),
        labelFrames: z.boolean().default(true),
        matte: captureMatteSchema,
        enableBase64Response: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({
      sessionId,
      compositionId,
      frames,
      columns,
      maxDimension,
      labelFrames,
      matte,
      enableBase64Response,
    }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const composition = snapshot.project.compositions.find(
        (item) => item.id === (compositionId ?? snapshot.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found.');
      const resolvedFrames = frames
        ? [...new Set(frames)].sort((a, b) => a - b)
        : defaultStripFrames(composition);
      const totalFrames = getTotalFrames(composition);
      const invalidFrame = resolvedFrames.find((frame) => frame > totalFrames);
      if (invalidFrame !== undefined) {
        throw new Error(
          `Frame ${invalidFrame} is beyond the composition's total frame ${totalFrames}.`,
        );
      }

      const strip = await bridge.renderStrip({
        project: snapshot.project,
        compositionId: composition.id,
        frames: resolvedFrames,
        columns,
        maxDimension,
        labelFrames,
        matte,
      });
      const { data, ...metadata } = strip;
      const structuredContent = {
        sessionId,
        revision: snapshot.revision,
        compositionId: composition.id,
        ...metadata,
        fetchCommand: `curl --fail --output ograf-strip.png "${strip.url}"`,
      };
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }
      > = [
        {
          type: 'text',
          text: `PNG frame strip ready (${strip.frames.join(', ')}; ${strip.width}×${strip.height}). Fetch within five minutes: ${strip.url}\n${structuredContent.fetchCommand}`,
        },
      ];
      if (enableBase64Response) content.push({ type: 'image', data, mimeType: 'image/png' });
      return { content, structuredContent };
    },
  );

  server.registerTool(
    'ograf_validate_project',
    {
      title: 'Validate editable OGraf project',
      description:
        'Runs semantic project validation but never replaces final browser certification. detail="summary" (default) returns overflow counts plus only failing, clipped, or degenerate checks; detail="full" preserves every per-value browser measurement. browserTextOverflow=true measures text at first Step-frame bounds using stress values. broadcastLint=true adds non-gating Step-frame safe-area, font-size, backing-aware contrast, and optional interlaced thin-rule warnings. A layer spanning the full composition width is exempt from horizontal safe-area checks; full height independently exempts vertical checks. These checks never affect certification validity or revision.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        browserTextOverflow: z.boolean().default(false),
        broadcastLint: z.boolean().default(false),
        interlacedOutput: z.boolean().default(false),
        detail: z.enum(['summary', 'full']).default('summary'),
        testValues: z
          .record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.union([z.string(), z.number(), z.boolean()])),
            ]),
          )
          .optional(),
      },
      annotations: readOnly,
    },
    async ({
      sessionId,
      browserTextOverflow,
      broadcastLint,
      interlacedOutput,
      detail,
      testValues,
    }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      if (!browserTextOverflow && !broadcastLint) {
        return textResult({
          sessionId,
          revision: snapshot.revision,
          validation: snapshot.validation,
          availableChecks: {
            hint: 'Broadcast lint was not run. Set broadcastLint=true for non-gating safe-area, font-size, contrast, and optional interlaced-stroke checks; set browserTextOverflow=true for live-font overflow checks.',
            broadcastLint: false,
            browserTextOverflow: false,
          },
        });
      }
      const warnings = [...snapshot.validation.warnings];
      const lintWarnings = broadcastLint
        ? broadcastLintWarnings(snapshot.project, interlacedOutput)
        : [];
      warnings.push(...lintWarnings);
      const overflowChecks: Array<Record<string, unknown>> = [];
      if (browserTextOverflow) {
        for (const composition of snapshot.project.compositions) {
          const measurementFrame = firstStepFrame(composition);
          for (const layer of composition.layers) {
            if (layer.element.type !== 'text' || !layer.isVisible || layer.isGuide) continue;
            const field = layer.binding
              ? composition.dataFields.find((candidate) => candidate.id === layer.binding?.fieldId)
              : undefined;
            const supplied = field ? testValues?.[field.key] : undefined;
            const values = [
              field?.defaultValue ?? layer.element.content,
              ...(Array.isArray(supplied) ? supplied : supplied !== undefined ? [supplied] : []),
            ];
            const uniqueValues = [...new Set(values.map((value) => String(value)))];
            const pose = visibleLayerBounds(composition, layer, measurementFrame);
            const outsideComposition =
              !!pose &&
              (pose.x < 0 ||
                pose.y < 0 ||
                pose.x + pose.width > composition.width ||
                pose.y + pose.height > composition.height);
            if (outsideComposition) {
              warnings.push(
                `Composition "${composition.name}": text layer "${layer.name}" frame-${measurementFrame} bounds extend outside the composition.`,
              );
            }
            for (const value of uniqueValues) {
              const measurement = await bridge.measureText({
                project: snapshot.project,
                compositionId: composition.id,
                layerId: layer.id,
                text: value,
                frame: measurementFrame,
              });
              overflowChecks.push({
                compositionId: composition.id,
                fieldKey: field?.key ?? null,
                outsideComposition,
                ...measurement,
              });
              if (measurement.overflowsParent) {
                warnings.push(
                  `Composition "${composition.name}": text layer "${layer.name}" overflows its ${measurement.boxWidth}×${measurement.boxHeight} box for ${field ? `field "${field.key}" value` : 'authored text'} ${JSON.stringify(value)}.`,
                );
              }
              if (measurement.degenerate) {
                warnings.push(
                  `Composition "${composition.name}": text layer "${layer.name}" reached the 50% shrink-to-fit floor for ${field ? `field "${field.key}" value` : 'authored text'} ${JSON.stringify(value)} and remains degenerate.`,
                );
              }
            }
          }
        }
      }
      const failingOverflowChecks = overflowChecks.filter(
        (check) => check.overflowsParent || check.outsideComposition || check.degenerate,
      );
      return textResult({
        sessionId,
        revision: snapshot.revision,
        validation: { ...snapshot.validation, warnings },
        overflowChecks: detail === 'full' ? overflowChecks : failingOverflowChecks,
        overflowSummary: {
          detail,
          checked: overflowChecks.length,
          reported: detail === 'full' ? overflowChecks.length : failingOverflowChecks.length,
          overflowing: overflowChecks.filter((check) => check.overflowsParent).length,
          outsideComposition: overflowChecks.filter((check) => check.outsideComposition).length,
          degenerate: overflowChecks.filter((check) => check.degenerate).length,
        },
        broadcastLint: { enabled: broadcastLint, interlacedOutput, warnings: lintWarnings },
      });
    },
  );

  server.registerTool(
    'ograf_measure_text',
    {
      title: 'Measure OGraf text in the browser',
      description:
        'Requires a connected and responsive live browser editor. Measures one text layer with the authoritative browser runtime without mutating project state or revision. Omit frame to measure the first Step/on-air frame; pass frame explicitly for another pose. Omit text to use the bound field defaultValue when present, otherwise authored content. appliedShrinkRatio is the rendered/authored font-size ratio; degenerate=true means shrink-to-fit reached its 50% legibility floor and still could not fit. overflowsParent and clippedAt describe the real DOM box. resolvedFont.resolution="inferred" is advisory because this bridge does not use platform-font inspection.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
        layerId: z.string(),
        text: z.string().optional(),
        frame: z.number().int().nonnegative().optional(),
      },
      annotations: readOnly,
    },
    async ({ sessionId, compositionId, layerId, text, frame }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const composition = snapshot.project.compositions.find(
        (item) => item.id === (compositionId ?? snapshot.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found.');
      const layer = composition.layers.find((candidate) => candidate.id === layerId);
      if (!layer) throw new Error(`Layer not found: ${layerId}`);
      if (layer.element.type !== 'text') throw new Error(`Layer ${layerId} is not a text layer.`);
      const resolvedFrame = frame ?? firstStepFrame(composition);
      if (resolvedFrame > getTotalFrames(composition)) {
        throw new Error(
          `Frame ${resolvedFrame} is beyond the composition's total frame ${getTotalFrames(composition)}.`,
        );
      }
      const measurement = await bridge.measureText({
        project: snapshot.project,
        compositionId: composition.id,
        layerId,
        ...(text !== undefined ? { text } : {}),
        frame: resolvedFrame,
      });
      return textResult({
        sessionId,
        revision: snapshot.revision,
        compositionId: composition.id,
        ...measurement,
      });
    },
  );

  server.registerTool(
    'ograf_create_project',
    {
      title: 'Create OGraf project session',
      description:
        'Creates a new in-memory editable OGraf project session. Use sessionId=editor only for the live browser project.',
      inputSchema: { sessionId: z.string(), name: z.string().optional() },
      annotations: mutation,
    },
    async ({ sessionId, name }) => {
      const session = workspace.create(sessionId);
      if (name)
        session.apply({
          expectedRevision: 0,
          operations: [{ type: 'set_project_metadata', name }],
        });
      return textResult(session.snapshot() as unknown as Record<string, unknown>);
    },
  );

  server.registerTool(
    'ograf_reset_project',
    {
      title: 'Reset an OGraf project session',
      description:
        'Replaces an existing session with a fresh editable project. Requires confirm=true and the current expectedRevision. The reset is one agent transaction and can be reversed with ograf_undo. keepDataFields=true copies existing main-composition field definitions into the fresh project; it does not preserve layers or bindings.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        confirm: z.literal(true),
        keepDataFields: z.boolean().default(false),
      },
      annotations: mutation,
    },
    async ({ sessionId, expectedRevision, keepDataFields }) => {
      const session = workspace.get(sessionId);
      const previous = session.snapshot().project;
      const next = createProject();
      if (keepDataFields) {
        const previousComposition = mainComposition(previous);
        mainComposition(next).dataFields = structuredClone(previousComposition.dataFields);
      }
      return textResult(
        session.reset(next, expectedRevision, 'Agent confirmed project reset') as unknown as Record<
          string,
          unknown
        >,
        `Reset session "${sessionId}" to a fresh project at revision ${expectedRevision + 1}. The reset is undoable.`,
      );
    },
  );

  server.registerTool(
    'ograf_delete_session',
    {
      title: 'Delete temporary OGraf authoring session',
      description:
        'Permanently removes one non-editor in-memory authoring session and its undo/change history. Requires explicit confirmation. It cannot delete the live "editor" session and does not remove any saved files.',
      inputSchema: {
        sessionId: z.string(),
        confirm: z.literal(true),
      },
      annotations: mutation,
    },
    async ({ sessionId }) => {
      workspace.delete(sessionId);
      return textResult({ sessionId, deleted: true }, `Deleted temporary session "${sessionId}".`);
    },
  );

  server.registerTool(
    'ograf_open_project',
    {
      title: 'Open OGraf editable project',
      description:
        'Opens a .ogeproj file inside the configured workspace into a new authoring session.',
      inputSchema: { sessionId: z.string(), path: z.string() },
      annotations: mutation,
    },
    async ({ sessionId, path }) =>
      textResult(
        (await workspace.open(sessionId, path)).snapshot() as unknown as Record<string, unknown>,
      ),
  );

  server.registerTool(
    'ograf_apply_operations',
    {
      title: 'Apply atomic OGraf authoring operations',
      description:
        'Atomically applies scene, timeline, loop, data, lifecycle, asset, duplication, and canvas-layout operations using expectedRevision. Creation returns stable IDs. set_layer_loop creates/updates one layer-local deterministic clip; activation type lifecycle runs while the graphic is on-air, while type step requires a pausable stepKeyframeId. set_loop_property_track writes local 0..durationFrames numeric keys with independent incoming easing/curves; these keys never become composition keys or OGraf Steps, null repeatCount is infinite, and remove_layer_loop removes the complete clip. create_timeline_group organizes at least two independent layer rows for editor/MCP readability and returns a stable timeline-group ID; rename_timeline_group, set_timeline_group_color, and ungroup_timeline_group edit only that UI organization and never alter paint order, layer tracks, canvas object groups, or compiled OGraf output. add_asset accepts base64 (without a data-URI prefix) and returns an asset ID usable as asset:<id>. Operations with one layer accept layerId or exact layerName (ambiguity is rejected); exact layerName and fieldKey selectors resolve entities created earlier in the same batch. set_layer_binding accepts fieldId or unique fieldKey, and update_data_field accepts fieldId or unique fieldKey. set_layer_layout clipChildren=true makes that layer an animated rotation-aware mask for direct children whose parentId points to it; rectangle borderRadius rounds the transformed mask, and duplicate_group preserves/remaps this relation. rectangle/ellipse fill accepts either a solid color string or {type:"linear"|"radial"|"conic",angle,stops:[{offset,color,opacity}]}; animate a stop with numeric property fill.stops[N].offset (zero-based, values 0..1). stagger_property_track accepts layerIds or a * wildcard layerNamePattern resolved in document order. update_transform/update_effects default scope="authored" and write every lifecycle frame; scope="frame" requires frame for animation edits. duplicate_group creates independent grouped copies and complete layer/field mappings; frameOffset shifts only non-lifecycle authored keys, keeps lifecycle compatibility keys anchored, and rejects genuine authored keys moved outside the duration. dryRun is revision-neutral and atomic. Higher indexes paint later/on top; property easing is incoming. Every authoring warning is returned verbatim in the primary text response with its operation index and affected layer.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        operations: z.array(authoringOperationSchema).min(1),
        dryRun: z.boolean().default(false),
        broadcastLint: z.boolean().default(false),
        interlacedOutput: z.boolean().default(false),
        reason: z.string().optional(),
      },
      annotations: mutation,
    },
    async ({
      sessionId,
      expectedRevision,
      operations,
      dryRun,
      broadcastLint,
      interlacedOutput,
      reason,
    }) => {
      try {
        const session = workspace.get(sessionId);
        const typedOperations = normalizeOperationSelectors(
          session.snapshot().project,
          operations as unknown[],
        );
        const result = session.apply({
          expectedRevision,
          operations: typedOperations,
          dryRun,
          ...(reason ? { reason } : {}),
        });
        const generatedResults = generatedOperationResults(
          typedOperations,
          result.summary.generatedIds,
          result.project,
        );
        const duplicateResults = result.summary.duplicateGroups.map((group) => ({
          index: group.operationIndex,
          type: 'duplicate_group',
          copies: group.copies,
        }));
        const results = [...generatedResults, ...duplicateResults];
        const runLint = dryRun && (broadcastLint || interlacedOutput);
        const lintWarnings = runLint ? broadcastLintWarnings(result.project, interlacedOutput) : [];
        const response = {
          ...result,
          results,
          operationSummaries: typedOperations.map((operation, index) => ({
            index,
            type: operation.type,
            generated: results.filter((entry) => entry.index === index),
          })),
          ...(dryRun
            ? {
                projectedDiagnostics: {
                  validation: result.validation,
                  broadcastLint: {
                    enabled: runLint,
                    interlacedOutput,
                    warnings: lintWarnings,
                  },
                },
              }
            : {}),
        };
        const createdText = generatedResults.length
          ? ` Generated: ${generatedResults.map((entry) => `${entry.type}[${entry.index}]=${entry.id}`).join(', ')}.`
          : '';
        const duplicatedText = duplicateResults.length
          ? ` Duplicated ${duplicateResults.reduce((total, entry) => total + entry.copies.length, 0)} group copy/copies with complete layer/field mappings in results.`
          : '';
        const warningCount = result.summary.warnings.length + lintWarnings.length;
        const warningText = [...result.summary.warnings, ...lintWarnings]
          .map((warning) => `- ${warning}`)
          .join('\n');
        return textResult(
          response as unknown as Record<string, unknown>,
          `${dryRun ? 'Dry-run accepted' : 'Applied'} ${result.summary.operationCount} operation(s); revision ${result.revision}; valid=${result.validation.valid}; warnings=${warningCount}.${createdText}${duplicatedText}${warningText ? `\nWarnings:\n${warningText}` : ''}`,
        );
      } catch (error) {
        if (error instanceof RevisionConflictError) {
          throw new Error(`${error.message} Re-read ograf_get_project and retry intentionally.`);
        }
        throw error;
      }
    },
  );

  for (const [name, action] of [
    ['ograf_undo', 'undo'],
    ['ograf_redo', 'redo'],
  ] as const) {
    server.registerTool(
      name,
      {
        title: action === 'undo' ? 'Undo agent change' : 'Redo agent change',
        description: `${action === 'undo' ? 'Undoes' : 'Redoes'} the latest agent-authored transaction in a session.`,
        inputSchema: {
          sessionId: z.string().default('editor'),
          expectedRevision: z.number().int().nonnegative(),
        },
        annotations: mutation,
      },
      async ({ sessionId, expectedRevision }) =>
        textResult(
          workspace.get(sessionId)[action](expectedRevision) as unknown as Record<string, unknown>,
        ),
    );
  }

  server.registerTool(
    'ograf_certify_project',
    {
      title: 'Certify exact OGraf output artifacts',
      description:
        'Requires a connected and responsive live browser editor. Compiles the exact output artifacts and runs the mandatory project, manifest, package, module, and lifecycle checks in that browser.',
      inputSchema: { sessionId: z.string().default('editor') },
      annotations: readOnly,
    },
    async ({ sessionId }) => {
      const { certification } = await certifiedArtifacts(workspace, bridge, sessionId);
      return textResult({ sessionId, certification });
    },
  );

  server.registerTool(
    'ograf_save_project',
    {
      title: 'Certify and save editable OGraf project',
      description:
        'Requires a connected and responsive live browser editor. Saves .ogeproj source inside the workspace only after exact output artifacts pass all OGraf certification checks.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        path: z.string(),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
      },
      annotations: mutation,
    },
    async ({ sessionId, path, overwrite }) => {
      if (extname(path).toLowerCase() !== '.ogeproj')
        throw new Error('Project path must end in .ogeproj.');
      const { certification } = await certifiedArtifacts(workspace, bridge, sessionId);
      const target = workspace.resolveAllowedPath(path);
      const project = workspace.get(sessionId).snapshot().project;
      await atomicWrite(target, `${JSON.stringify(project, null, 2)}\n`, overwrite);
      return textResult(
        { sessionId, path: target, certification },
        `Certified and saved ${target}`,
      );
    },
  );

  server.registerTool(
    'ograf_export_package',
    {
      title: 'Certify and export OGraf package',
      description:
        'Requires a connected and responsive live browser editor. Writes an OGraf playout .ograf.zip inside the workspace only after certifying the exact files that will be written.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        path: z.string(),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
      },
      annotations: mutation,
    },
    async ({ sessionId, path, overwrite }) => {
      if (!path.toLowerCase().endsWith('.ograf.zip'))
        throw new Error('Package path must end in .ograf.zip.');
      const { artifacts, certification } = await certifiedArtifacts(workspace, bridge, sessionId);
      const zip = new JSZip();
      zip.file(artifacts.manifestFileName, JSON.stringify(artifacts.manifest, null, 2));
      zip.file('main.js', artifacts.mainJs);
      for (const resource of artifacts.resources) {
        zip.file(resource.path, resource.data, { base64: resource.base64 });
      }
      const output = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      const target = workspace.resolveAllowedPath(path);
      await atomicWrite(target, output, overwrite);
      return textResult(
        { sessionId, path: target, certification },
        `Certified and exported ${target}`,
      );
    },
  );

  return server;
}
