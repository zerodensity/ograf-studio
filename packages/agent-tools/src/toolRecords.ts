import { parseEditablePath, pathConversionError } from '@ograf-editor/scene-model';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  applyAuthoringOperations,
  RevisionConflictError,
  renderCompositionFrameSvg,
  type AuthoringOperation,
} from '@ograf-editor/authoring-core';
import {
  buildExportArtifactsWithRuntime,
  getExportProfile,
  validatePackageLayout,
  type ExportProfileMode,
  type ExportArtifacts,
} from '@ograf-editor/codegen';
import {
  ANIMATABLE_LAYER_PROPERTIES,
  EFFECT_CATALOG,
  getEffectStack,
  effectProperty,
  effectEnabled,
  effectParams,
  patternRows,
  patternRowOffset,
  BLEND_MODES,
  buildSvgBundle,
  computeKeyframeFrames,
  createId,
  createProject,
  fieldDefinitionAtPath,
  getLayerPropertyValueAtFrame,
  getLayerPropertyWithLighting,
  patternLightLoopFrame,
  getLayerAnimatableProperties,
  getEbuR95SafeAreas,
  getStylePack,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
  intersectConvexPolygons,
  inspectLottieAnimationData,
  LOTTIE_READY_TIMEOUT_MS,
  PROJECT_SOURCE_EXTENSION,
  MOTION_PRESET_NAMES,
  STYLE_PACKS,
  polygonBounds,
  reviewCompositionDesign,
  transformBoundsPolygon,
  TRANSFORM_ANIMATION_PROPERTIES,
  valueAtSourcePath,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import JSZip from 'jszip';
import * as z from 'zod/v4';
import {
  authoringOperationSchema,
  EASING_PRESETS,
  fieldValueSchema,
  propertySchema,
  semanticLayerRoleSchema,
} from './schemas';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';

export interface AgentToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface AgentToolConfig {
  title?: string;
  description?: string;
  inputSchema: z.ZodRawShape;
  annotations?: AgentToolAnnotations;
  _meta?: Record<string, unknown>;
}

export type AgentToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export interface AgentToolRecord {
  name: string;
  config: AgentToolConfig;
  handler: AgentToolHandler;
}

interface ToolRegistrar {
  registerTool<Input extends z.ZodRawShape>(
    name: string,
    config: Omit<AgentToolConfig, 'inputSchema'> & { inputSchema: Input },
    handler: (args: z.output<z.ZodObject<Input>>) => unknown | Promise<unknown>,
  ): void;
}

const CAPABILITY_SECTIONS = [
  'elements',
  'easing',
  'semantics',
  'designSystem',
  'loops',
  'bindings',
  'editor',
] as const;

type CapabilitySection = (typeof CAPABILITY_SECTIONS)[number];

const CAPABILITY_SECTION_KEYS: Record<CapabilitySection, readonly string[]> = {
  elements: [
    'elementTypes',
    'elementSchemas',
    'animatableProperties',
    'animatablePropertyPatterns',
    'blendModes',
    'masking',
    'tiling',
    'composableEffects',
  ],
  easing: ['easingPresets'],
  semantics: ['semantics', 'semanticAuthoring'],
  designSystem: ['designSystem', 'assets', 'reusableComponents'],
  loops: ['loopAnimation', 'composableEffects'],
  bindings: ['bindings'],
  editor: [
    'editor',
    'liveEditorConnected',
    'liveEditorConnectedDeprecated',
    'requiresBrowser',
    'editorParity',
    'canvasLayout',
    'safety',
    'aiReview',
  ],
};

function projectCapabilities(
  capabilities: Record<string, unknown>,
  sections: CapabilitySection[] | undefined,
): Record<string, unknown> {
  if (!sections) return capabilities;
  const included = new Set<string>(['protocolVersion', 'defaultSessionId']);
  for (const section of sections) {
    for (const key of CAPABILITY_SECTION_KEYS[section]) included.add(key);
  }
  return Object.fromEntries(Object.entries(capabilities).filter(([key]) => included.has(key)));
}

const consolidatedOperationInputSchema = {
  mode: z.enum(['apply', 'dry-run', 'preview', 'propose']).default('apply'),
  sessionId: z.string().default('editor'),
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(authoringOperationSchema).min(1),
  reason: z.string().optional(),
  includeReview: z.boolean().default(false),
  broadcastLint: z.boolean().default(false),
  interlacedOutput: z.boolean().default(false),
  render: z.enum(['frame', 'strip']).optional(),
  compositionId: z.string().optional(),
  frame: z.number().int().nonnegative().optional(),
  frames: z.array(z.number().int().nonnegative()).min(1).max(12).optional(),
  columns: z.number().int().min(1).max(12).default(3),
  maxDimension: z.number().int().min(64).max(4096).optional(),
  labelFrames: z.boolean().default(true),
  matte: z
    .string()
    .refine(
      (value) => value === 'transparent' || value === 'checker' || /^#[0-9a-f]{6}$/i.test(value),
      'matte must be "transparent", "checker", or a #RRGGBB colour.',
    )
    .default('checker'),
  dataOverrides: z.record(z.string(), fieldValueSchema).optional(),
  enableBase64Response: z.boolean().default(false),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).default(''),
} satisfies z.ZodRawShape;

type ConsolidatedOperationInput = z.output<z.ZodObject<typeof consolidatedOperationInputSchema>>;

function consolidateOperationTools(
  records: AgentToolRecord[],
  workspace: AuthoringWorkspacePort,
  bridge: EditorBridgePort,
): AgentToolRecord[] {
  const names = [
    'ograf_apply_operations',
    'ograf_preview_operations',
    'ograf_propose_operations',
  ] as const;
  const indexed = names.map((name) => ({
    name,
    index: records.findIndex((record) => record.name === name),
    record: records.find((record) => record.name === name),
  }));
  if (indexed.some((entry) => entry.index < 0 || !entry.record)) {
    throw new Error('Cannot consolidate OGraf operation tools because a source record is missing.');
  }
  const apply = indexed[0]!.record!;
  const preview = indexed[1]!.record!;
  const propose = indexed[2]!.record!;
  const consolidated: AgentToolRecord = {
    name: 'ograf_apply_operations',
    config: {
      title: 'Apply, preview, or propose OGraf operations',
      description:
        'Revision-checked atomic operations. apply commits; dry-run validates without changing revision. includeReview adds advisory QA and a capture when available; capture failure does not undo the edit. preview renders a revision-neutral frame/strip in the responsive editor. propose requires sessionId=editor and title, and waits for explicit human Accept/Reject.',
      inputSchema: consolidatedOperationInputSchema,
      annotations: mutation,
    },
    async handler(raw) {
      const input = raw as unknown as ConsolidatedOperationInput;
      const common = {
        sessionId: input.sessionId,
        expectedRevision: input.expectedRevision,
        operations: input.operations,
      };
      if (input.mode === 'apply' || input.mode === 'dry-run') {
        if (input.includeReview && input.compositionId) {
          const before = workspace.get(input.sessionId).snapshot().project;
          if (!before.compositions.some((item) => item.id === input.compositionId)) {
            throw new Error(`Composition not found: ${input.compositionId}`);
          }
        }
        const applied = (await apply.handler({
          ...common,
          dryRun: input.mode === 'dry-run',
          broadcastLint: input.broadcastLint,
          interlacedOutput: input.interlacedOutput,
          ...(input.reason ? { reason: input.reason } : {}),
        })) as {
          content: Array<{ type: string; text?: string }>;
          structuredContent: Record<string, unknown>;
        };
        if (!input.includeReview) return applied;

        const project = applied.structuredContent.project as Project;
        const composition = project.compositions.find(
          (item) => item.id === (input.compositionId ?? project.mainCompositionId),
        )!;
        const review = reviewCompositionDesign(composition);
        const frame = input.frame ?? firstStepFrame(composition);
        let capture: Record<string, unknown> | null = null;
        let captureOmitted: string | null = null;
        const editor = bridge.health;
        if (!editor.connected) {
          captureOmitted =
            'OGraf Studio is not connected; apply and deterministic review completed.';
        } else if (!editor.responsive) {
          captureOmitted =
            'OGraf Studio is connected but unresponsive; apply and deterministic review completed.';
        } else {
          try {
            const published = await bridge.capture({
              target: 'composition',
              project,
              compositionId: composition.id,
              frame,
              maxDimension: input.maxDimension ?? 900,
              matte: input.matte,
              ...(input.dataOverrides ? { dataOverrides: input.dataOverrides } : {}),
            });
            const { data: _data, ...metadata } = published;
            capture = {
              compositionId: composition.id,
              frame,
              ...metadata,
              fetchCommand: `curl --fail --output ograf-apply-review.png "${published.url}"`,
            };
          } catch (error) {
            captureOmitted = `Browser capture failed after the ${input.mode}; the mutation and deterministic review remain valid: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        const summary = applied.content.find((item) => item.type === 'text')?.text ?? '';
        return textResult(
          {
            ...applied.structuredContent,
            review,
            capture,
            captureOmitted,
          },
          `${summary} Design QA ${review.score}/100; capture ${capture ? 'available' : 'omitted'}.`,
        );
      }
      if (input.includeReview) {
        throw new Error('includeReview is available only for mode=apply or mode=dry-run.');
      }
      if (input.mode === 'preview') {
        return preview.handler({
          ...common,
          render: input.render ?? 'frame',
          ...(input.compositionId ? { compositionId: input.compositionId } : {}),
          ...(input.frame !== undefined ? { frame: input.frame } : {}),
          ...(input.frames ? { frames: input.frames } : {}),
          columns: input.columns,
          maxDimension: input.maxDimension ?? 900,
          labelFrames: input.labelFrames,
          matte: input.matte,
          ...(input.dataOverrides ? { dataOverrides: input.dataOverrides } : {}),
          enableBase64Response: input.enableBase64Response,
        });
      }
      if (input.sessionId !== 'editor') {
        throw new Error('mode=propose is available only for sessionId=editor.');
      }
      if (!input.title) throw new Error('mode=propose requires a non-empty title.');
      if (input.dataOverrides) {
        throw new Error('dataOverrides is not supported for mode=propose.');
      }
      return propose.handler({
        ...common,
        title: input.title,
        description: input.description,
        render: input.render ?? 'strip',
        ...(input.compositionId ? { compositionId: input.compositionId } : {}),
        ...(input.frame !== undefined ? { frame: input.frame } : {}),
        ...(input.frames ? { frames: input.frames } : {}),
        columns: input.columns,
        maxDimension: Math.min(input.maxDimension ?? 320, 1024),
        matte: input.matte,
        enableBase64Response: input.enableBase64Response,
      });
    },
  };
  const insertAt = Math.min(...indexed.map((entry) => entry.index));
  const filtered = records.filter(
    (record) => !names.includes(record.name as (typeof names)[number]),
  );
  filtered.splice(insertAt, 0, consolidated);
  return filtered;
}

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

const IMPORT_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
  '.txt': 'text/plain',
};

function importMimeType(path: string): string {
  return IMPORT_MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function dataUriBase64(dataUri: string): string {
  const separator = dataUri.indexOf(',');
  if (separator < 0 || !dataUri.slice(0, separator).endsWith(';base64')) {
    throw new Error('Portable bundle asset was not encoded as base64.');
  }
  return dataUri.slice(separator + 1);
}

function mainComposition(project: Project): Composition {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
  if (!composition)
    throw new Error('mainCompositionId does not reference an existing composition.');
  return composition;
}

let runtimeSourcePromise: Promise<string> | null = null;
function runtimeSource(): Promise<string> {
  const embeddedRuntime = (globalThis as { __OGRAF_STANDALONE_RUNTIME__?: string })
    .__OGRAF_STANDALONE_RUNTIME__;
  runtimeSourcePromise ??= readFile(
    embeddedRuntime ??
      fileURLToPath(new URL('../../ograf-runtime/dist/graphic-runtime.js', import.meta.url)),
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
  workspace: AuthoringWorkspacePort,
  sessionId: string,
  profileId?: ExportProfileMode,
): Promise<ExportArtifacts> {
  const project = workspace.get(sessionId).snapshot().project;
  return buildExportArtifactsWithRuntime(
    project,
    mainComposition(project),
    await runtimeSource(),
    profileId ? getExportProfile(profileId) : undefined,
  );
}

async function certifiedArtifacts(
  workspace: AuthoringWorkspacePort,
  bridge: EditorBridgePort,
  sessionId: string,
  profileId?: ExportProfileMode,
): Promise<{
  artifacts: ExportArtifacts;
  certification: Awaited<ReturnType<EditorBridgePort['certify']>>;
}> {
  const artifacts = await artifactsFor(workspace, sessionId, profileId);
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
    patterns: composition.patterns.map((pattern) => ({
      ...pattern,
      rowsResolved: patternRows(pattern).map((row) => ({
        row: row.row,
        period: row.period,
        direction: row.direction > 0 ? 'right' : 'left',
        cycles: row.cycles,
        phase: row.phase,
        pixelsPerSecond: (row.period * row.cycles * composition.frameRate) / pattern.cycleFrames,
      })),
    })),
    layers: composition.layers.map((layer, index) => ({
      index,
      id: layer.id,
      name: layer.name,
      type: layer.element.type,
      ...(['rectangle', 'ellipse', 'path'].includes(layer.element.type)
        ? {
            pathEditing: {
              conversionError: pathConversionError(layer),
              ...(layer.element.type === 'path'
                ? (() => {
                    try {
                      return { d: layer.element.d, contours: parseEditablePath(layer.element.d) };
                    } catch (e) {
                      return { error: (e as Error).message };
                    }
                  })()
                : {}),
            },
          }
        : {}),
      ...(layer.element.type === 'lottie'
        ? {
            lottieInspection: layer.element.animationData
              ? {
                  ...inspectLottieAnimationData(layer.element.animationData),
                  width: layer.element.animationData.w,
                  height: layer.element.animationData.h,
                  frameRate: layer.element.animationData.fr,
                  inPoint: layer.element.animationData.ip,
                  outPoint: layer.element.animationData.op,
                }
              : null,
          }
        : {}),
      effectStack: getEffectStack(layer.effects).map((e) => ({
        ...e,
        enabled: effectEnabled(e, layer.effects),
        params: effectParams(e, layer.effects),
        properties: Object.fromEntries(
          Object.keys(EFFECT_CATALOG[e.type].params).map((key) => [key, effectProperty(e, key)]),
        ),
      })),
      visible: layer.isVisible,
      guide: layer.isGuide,
      locked: layer.isLocked,
      groupId: layer.groupId,
      parentId: layer.parentId,
      clipChildren: layer.clipChildren,
      isMaskOnly: layer.isMaskOnly,
      mask: layer.mask,
      lighting: layer.lighting ?? null,
      constraints: layer.constraints,
      semantics: layer.semantics,
      designTokenBindings: layer.designTokenBindings,
      componentLink: layer.componentLink,
      runtimeCollectionId:
        composition.runtimeCollections.find((collection) =>
          collection.prototypeLayerIds.includes(layer.id),
        )?.id ?? null,
      bindings: layer.bindings,
      binding: layer.bindings[0] ?? null,
      animatedProperties: getLayerAnimatableProperties(layer).filter((property) =>
        isAnimatedTrack(getResolvedLayerAnimationTracks(layer)[property] ?? []),
      ),
      loop: layer.loop,
    })),
    lifecycle: composition.keyframes.map((keyframe) => ({ ...keyframe })),
    transitions: composition.transitions.map((transition) => ({ ...transition })),
    dataFields: composition.dataFields.map((field) => ({ ...field })),
    runtimeCollections: composition.runtimeCollections.map((collection) => ({
      ...collection,
      fieldKey:
        composition.dataFields.find((field) => field.id === collection.fieldId)?.key ?? null,
    })),
    components: composition.components.map((component) => ({
      id: component.id,
      name: component.name,
      layerCount: component.layers.length,
      fieldCount: component.dataFields.length,
      linkedInstanceCount: new Set(
        composition.layers
          .filter((layer) => layer.componentLink?.componentId === component.id)
          .map((layer) => layer.componentLink!.instanceId),
      ).size,
    })),
    designSystem: composition.designSystem,
    layout: {
      ...composition.layout,
      timelineGroups: composition.layout.timelineFolders,
      timelineFoldersDeprecated:
        'Deprecated storage name retained for project compatibility; use timelineGroups and the timeline-group operations.',
      safeAreas: getEbuR95SafeAreas(composition),
    },
  };
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
  'patterns',
] as const;
type ProjectIncludeSection = (typeof PROJECT_INCLUDE_SECTIONS)[number];
type ProjectTracksMode = 'none' | 'animated-only' | 'full';

function isAnimatedTrack(track: Array<{ value: number }>): boolean {
  return track.length > 1 && track.some((key) => !Object.is(key.value, track[0]?.value));
}

function projectSnapshotProjection(
  snapshot: ReturnType<ReturnType<AuthoringWorkspacePort['get']>['snapshot']>,
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
      if (sections.has('patterns')) projectedComposition.patterns = composition.patterns;
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
            projectedLayer.isMaskOnly = layer.isMaskOnly;
            projectedLayer.mask = layer.mask;
            projectedLayer.constraints = layer.constraints;
            projectedLayer.semantics = layer.semantics;
            projectedLayer.designTokenBindings = layer.designTokenBindings;
            projectedLayer.componentLink = layer.componentLink;
            projectedLayer.bindings = layer.bindings;
            projectedLayer.binding = layer.bindings[0] ?? null;
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
      if (sections.has('dataFields')) {
        projectedComposition.dataFields = composition.dataFields;
        projectedComposition.runtimeCollections = composition.runtimeCollections;
      }
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
          safeAreas: getEbuR95SafeAreas(composition),
        };
      }
      if (sections.has('metadata')) {
        projectedComposition.customActions = composition.customActions;
        projectedComposition.assets = composition.assets;
        projectedComposition.designSystem = composition.designSystem;
        projectedComposition.components = composition.components.map((component) => ({
          id: component.id,
          name: component.name,
          layerCount: component.layers.length,
          fieldCount: component.dataFields.length,
        }));
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
    if (
      ![
        'layer',
        'field',
        'guide',
        'asset',
        'timeline-group',
        'canvas-group',
        'custom-action',
        'component',
        'lifecycle-keyframe',
        'loop',
        'design-token',
        'runtime-collection',
        'pattern',
        'effect',
      ].includes(generated.kind)
    ) {
      return [];
    }
    const operation = operations[generated.operationIndex];
    if (generated.kind === 'design-token' && operation?.type === 'apply_style_pack') return [];
    const base = {
      index: generated.operationIndex,
      type: operation?.type ?? generated.kind,
      id: generated.id,
    };
    if (generated.kind === 'effect') {
      const layer = project.compositions
        .flatMap((c) => c.layers)
        .find((l) => getEffectStack(l.effects).some((e) => e.id === generated.id));
      const effect = layer && getEffectStack(layer.effects).find((e) => e.id === generated.id);
      return [
        {
          ...base,
          layerId: layer?.id,
          name: effect?.name,
          properties: effect
            ? Object.fromEntries(
                Object.keys(EFFECT_CATALOG[effect.type].params).map((key) => [
                  key,
                  effectProperty(effect, key),
                ]),
              )
            : {},
        },
      ];
    }
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
    if (generated.kind === 'canvas-group') return [base];
    if (generated.kind === 'custom-action') {
      const action = project.compositions
        .flatMap((composition) => composition.customActions)
        .find((candidate) => candidate.id === generated.id);
      return [
        {
          ...base,
          ...(action ? { actionId: action.actionId, name: action.name } : {}),
        },
      ];
    }
    if (generated.kind === 'component') {
      const component = project.compositions
        .flatMap((composition) => composition.components)
        .find((candidate) => candidate.id === generated.id);
      return [
        {
          ...base,
          ...(component
            ? {
                name: component.name,
                layerCount: component.layers.length,
                fieldCount: component.dataFields.length,
              }
            : {}),
        },
      ];
    }
    if (generated.kind === 'design-token') {
      const token = project.compositions
        .flatMap((composition) => composition.designSystem.tokens)
        .find((candidate) => candidate.id === generated.id);
      return [
        {
          ...base,
          ...(token
            ? { key: token.key, name: token.name, tokenType: token.type, value: token.value }
            : {}),
        },
      ];
    }
    if (generated.kind === 'runtime-collection') {
      const collection = project.compositions
        .flatMap((composition) => composition.runtimeCollections)
        .find((candidate) => candidate.id === generated.id);
      return [
        {
          ...base,
          ...(collection
            ? {
                name: collection.name,
                fieldId: collection.fieldId,
                prototypeLayerIds: collection.prototypeLayerIds,
                capacity: collection.capacity,
                overflow: collection.overflow,
              }
            : {}),
        },
      ];
    }
    if (generated.kind === 'lifecycle-keyframe') {
      const keyframe = project.compositions
        .flatMap((composition) => composition.keyframes)
        .find((candidate) => candidate.id === generated.id);
      return [
        {
          ...base,
          ...(keyframe ? { name: keyframe.name, role: keyframe.role } : {}),
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

    if (operation.type === 'set_tiling_pattern') {
      if (operation.patternName) {
        if (operation.patternId) throw new Error('Use patternId or patternName, not both.');
        const matches = composition.patterns.filter(
          (pattern) => pattern.name === operation.patternName,
        );
        if (matches.length !== 1) throw new Error('Pattern name is missing or ambiguous.');
        operation.patternId = matches[0]!.id;
        delete operation.patternName;
      }
      if (!operation.patternId) operation.id = createId('pattern');
    }
    if (operation.type === 'set_layer_lighting' && operation.link) {
      operation.link = {
        phaseOffset: 0,
        gain: 1,
        cyclesPerLoop: 1,
        ...(operation.link as Record<string, unknown>),
      };
    }
    if (operation.type === 'add_effect' || operation.type === 'duplicate_effect')
      operation.id = createId('fx');
    if (operation.type === 'add_layer') operation.id = createId('layer');
    if (operation.type === 'add_data_field') operation.id = createId('field');
    if (operation.type === 'create_timeline_group') operation.id = createId('timeline-group');
    if (operation.type === 'group_layers') operation.id = createId('group');
    if (operation.type === 'save_component') operation.id = createId('component');
    if (operation.type === 'add_custom_action') operation.id = createId('action');
    if (operation.type === 'set_layer_loop') operation.id = createId('layer-loop');
    if (operation.type === 'create_runtime_collection')
      operation.id = createId('runtime-collection');
    if (operation.type === 'upsert_design_token' && !operation.tokenId) {
      operation.id = createId('design-token');
    }
    if (operation.type === 'apply_style_pack') {
      const pack = getStylePack(operation.stylePack as Parameters<typeof getStylePack>[0]);
      operation.tokenIds = Object.fromEntries(
        pack.tokens.map((definition) => [
          definition.key,
          composition.designSystem.tokens.find((token) => token.key === definition.key)?.id ??
            createId('design-token'),
        ]),
      );
    }

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

    if (operation.type === 'set_layer_mask') {
      const name =
        typeof operation.sourceLayerName === 'string' ? operation.sourceLayerName : undefined;
      if (name && operation.sourceLayerId !== undefined)
        throw new Error(`Operation ${index}: pass sourceLayerId or sourceLayerName, not both.`);
      if (name) {
        const matches = composition.layers.filter((layer) => layer.name === name);
        if (matches.length !== 1)
          throw new Error(
            `Operation ${index}: mask sourceLayerName ${JSON.stringify(name)} is ${matches.length ? 'ambiguous' : 'unknown'}.`,
          );
        operation.sourceLayerId = matches[0]!.id;
      }
      if (operation.sourceLayerId === undefined)
        throw new Error(
          `Operation ${index}: sourceLayerId or sourceLayerName is required; use sourceLayerId:null to detach.`,
        );
      delete operation.sourceLayerName;
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

    if (operation.type === 'set_layer_binding' || operation.type === 'set_layer_bindings') {
      const bindings = (
        operation.type === 'set_layer_binding'
          ? operation.binding
            ? [operation.binding]
            : []
          : operation.bindings
      ) as unknown[];
      for (const rawBinding of bindings) {
        const binding = rawBinding as Record<string, unknown>;
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

    if (
      operation.type === 'create_runtime_collection' ||
      operation.type === 'update_runtime_collection'
    ) {
      const fieldId = typeof operation.fieldId === 'string' ? operation.fieldId : undefined;
      const fieldKey = typeof operation.fieldKey === 'string' ? operation.fieldKey : undefined;
      if (fieldId && fieldKey) {
        throw new Error(`Operation ${index}: pass fieldId or fieldKey, not both.`);
      }
      if (operation.type === 'create_runtime_collection' && !fieldId && !fieldKey) {
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

      const layerIds = Array.isArray(operation.layerIds)
        ? (operation.layerIds as string[])
        : undefined;
      const layerNames = Array.isArray(operation.layerNames)
        ? (operation.layerNames as string[])
        : undefined;
      const groupId = typeof operation.groupId === 'string' ? operation.groupId : undefined;
      const selectorCount =
        Number(Boolean(layerIds)) + Number(Boolean(layerNames)) + Number(Boolean(groupId));
      if (selectorCount > 1) {
        throw new Error(
          `Operation ${index}: pass layerIds, layerNames, or groupId, not more than one.`,
        );
      }
      if (operation.type === 'create_runtime_collection' && selectorCount === 0) {
        throw new Error(`Operation ${index}: layerIds, layerNames, or groupId is required.`);
      }
      if (groupId) {
        const grouped = composition.layers.filter((layer) => layer.groupId === groupId);
        if (grouped.length === 0) {
          throw new Error(`Operation ${index}: canvas group not found or empty: ${groupId}`);
        }
        operation.prototypeLayerIds = grouped.map((layer) => layer.id);
      } else if (layerNames) {
        operation.prototypeLayerIds = layerNames.map((name) => {
          const matches = composition.layers.filter((layer) => layer.name === name);
          if (matches.length !== 1) {
            throw new Error(
              `Operation ${index}: layer name ${JSON.stringify(name)} is ${matches.length ? 'ambiguous' : 'unknown'}.`,
            );
          }
          return matches[0]!.id;
        });
      } else if (layerIds) {
        operation.prototypeLayerIds = layerIds;
      }
      delete operation.layerIds;
      delete operation.layerNames;
      delete operation.groupId;
    }

    if (operation.type === 'bind_design_token') {
      const tokenId = typeof operation.tokenId === 'string' ? operation.tokenId : undefined;
      const tokenKey = typeof operation.tokenKey === 'string' ? operation.tokenKey : undefined;
      if (tokenId && tokenKey) {
        throw new Error(`Operation ${index}: pass tokenId or tokenKey, not both.`);
      }
      if (!tokenId && !tokenKey) {
        throw new Error(`Operation ${index}: tokenId or tokenKey is required.`);
      }
      if (tokenKey) {
        const token = composition.designSystem.tokens.find(
          (candidate) => candidate.key === tokenKey,
        );
        if (!token) throw new Error(`Operation ${index}: design-token key not found: ${tokenKey}`);
        operation.tokenId = token.id;
      }
      delete operation.tokenKey;
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
    const safeAreas = getEbuR95SafeAreas(composition);
    const actionMarginX = safeAreas.actionSafe.x;
    const actionMarginY = safeAreas.actionSafe.y;
    const titleMarginX = safeAreas.titleSafe.x;
    const titleMarginY = safeAreas.titleSafe.y;
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
            `Broadcast lint: composition "${composition.name}" layer "${layer.name}" is outside EBU R 95 3.5% action-safe bounds on the ${actionAxes.join(' and ')} axis at frame ${frame}.`,
          );
        } else if (titleAxes.length > 0) {
          warnings.push(
            `Broadcast lint: composition "${composition.name}" layer "${layer.name}" is inside action-safe but outside EBU R 95 5% title-safe bounds on the ${titleAxes.join(' and ')} axis at frame ${frame}.`,
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

export function createOGrafToolRecords(
  workspace: AuthoringWorkspacePort,
  bridge: EditorBridgePort,
): AgentToolRecord[] {
  const records: AgentToolRecord[] = [];
  const server: ToolRegistrar = {
    registerTool(name, config, handler) {
      records.push({
        name,
        config: config as AgentToolConfig,
        handler: handler as unknown as AgentToolHandler,
      });
    },
  };

  server.registerTool(
    'ograf_get_capabilities',
    {
      title: 'Get OGraf authoring capabilities',
      description:
        'Discover element/easing/semantic/design/loop/binding contracts by section. Include editor before browser work: connected, responsive and certificationReady are distinct.',
      inputSchema: {
        sections: z.array(z.enum(CAPABILITY_SECTIONS)).min(1).optional(),
      },
      annotations: readOnly,
    },
    async ({ sections }) => {
      const editor = bridge.health;
      const capabilities: Record<string, unknown> = {
        protocolVersion: 1,
        defaultSessionId: 'editor',
        editor,
        liveEditorConnected: editor.connected && editor.responsive,
        liveEditorConnectedDeprecated:
          'Deprecated alias for editor.connected && editor.responsive. Use the editor object.',
        requiresBrowser: [
          'ograf_capture',
          'ograf_render_strip',
          'ograf_apply_operations when mode=preview or mode=propose',
          'ograf_measure_text',
          'ograf_certify_project',
          'ograf_save_project',
          'ograf_export_package',
          'ograf_validate_project when browserTextOverflow=true',
        ],
        elementTypes: [
          'rectangle',
          'ellipse',
          'text',
          'image',
          'path',
          'pattern',
          'image-sequence',
          'lottie',
        ],
        elementSchemas: {
          rectangle: {
            defaultTransform: { width: 200, height: 200, shape: 'square' },
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
            borderRadius: {
              type: 'corner-radii',
              shape: '{ topLeft, topRight, bottomRight, bottomLeft }',
              shorthand: 'A non-negative number applies the same radius to all four corners.',
              default: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
              minimum: 0,
            },
          },
          ellipse: {
            defaultTransform: { width: 200, height: 200, shape: 'circle' },
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
            strokeColor: { type: 'color', default: 'transparent' },
            strokeWidth: { type: 'number', default: 0, minimum: 0, animatable: true },
            fontFamily: { type: 'string', default: 'system-ui, sans-serif' },
            fontSize: { type: 'number', default: 48, exclusiveMinimum: 0 },
            fontWeight: { type: 'number', default: 600 },
            textAlign: {
              type: 'enum',
              values: ['left', 'center', 'right'],
              default: 'left',
            },
            lineHeight: { type: 'number', minimum: 0.5, default: 1.2 },
            letterSpacing: { type: 'number', default: 0 },
            textTransform: {
              type: 'enum',
              values: ['none', 'uppercase', 'lowercase', 'capitalize'],
              default: 'none',
            },
            verticalAlign: {
              type: 'enum',
              values: ['top', 'middle', 'bottom'],
              default: 'top',
            },
            baselineShift: { type: 'number', default: 0 },
            minFontSize: { type: 'number', minimum: 1, default: 24 },
            overflowPolicy: {
              type: 'enum',
              values: ['visible', 'clip', 'ellipsis'],
              default: 'visible',
            },
            autoFit: {
              type: 'enum',
              values: ['auto-size', 'shrink-to-fit', 'fit-to-width', 'squeeze', 'fixed'],
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
          pattern: {
            patternId: {
              type: 'string',
              description: 'Shared tiling definition ID returned by set_tiling_pattern.',
            },
            fill: { type: 'paint', default: '#252b32' },
            strokeColor: { type: 'color', default: 'transparent' },
            strokeWidth: { type: 'number', default: 0 },
          },
          path: {
            editing: {
              operation: 'edit_path',
              inputs:
                'layerId or layerName; optional frame for conversion; edit contains action and action-specific fields.',
              actions: {
                convert:
                  'Rectangle/ellipse to path at frame (default 0); existing path unchanged. Preserves layer identity/tracks. Corner tokens and rounded child clipping must be unlinked first.',
                move: 'expectedD, contour, node, x, y; moves anchor and attached handles.',
                handles:
                  'expectedD, contour, node, incoming/outgoing: {x,y} or null; omitted handles unchanged.',
                insert:
                  'expectedD, contour, node, optional t in (0,1), default .5; splits following segment without changing its curve.',
                remove: 'expectedD, contour, node; keeps at least 3 closed or 2 open anchors.',
                smooth: 'expectedD, contour, node; creates aligned handles.',
                corner: 'expectedD, contour, node; removes handles.',
              },
              coordinates:
                'Local viewBox units. Zero-based contour/node indices come from inspect_scene.pathEditing.contours; re-read after insert/remove. expectedD rejects stale geometry.',
              limits:
                '4096 anchors, 500000 SVG characters. Static geometry only; arcs normalize to cubic approximations. Resize scales path corners/strokes; no point morphing.',
            },
            d: { type: 'string', default: 'M50,0 L100,100 L0,100 Z' },
            fill: {
              type: 'paint',
              default: '#3b3f4a',
              values: [
                'solid-color-string',
                'linear-gradient',
                'radial-gradient',
                'conic-gradient',
              ],
              gradientShape: {
                type: 'linear | radial | conic',
                angle: 'finite degrees',
                stops: '[{offset:0..1,color:string,opacity:0..1}], minimum 2',
              },
            },
            fillRule: { type: 'enum', values: ['nonzero', 'evenodd'], default: 'nonzero' },
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
          lottie: {
            animationData: {
              type: 'object-or-null',
              default: null,
              description:
                'Self-contained Bodymovin/Lottie JSON preserved as imported. External image/font paths, segmented documents, and luma mattes are rejected; alpha mattes are supported; expressions are ignored with a validation warning.',
            },
            speed: { type: 'number', default: 1, minimum: 0 },
            runtimeProfile: {
              renderer: 'lottie-web light Canvas',
              canvas:
                'Positive adapter-owned backing canvas; CSS reframes later layer-size changes, and a DPR/display change rebuilds the backing without calling the player resize API.',
              backingLimits: {
                maximumAxisPixels: 8192,
                maximumTotalPixels: 16777216,
                detail:
                  'Persistent players allocate from the maximum authored layer bounds, then reduce logical size as needed so DPR-adjusted backing stays within both limits.',
              },
              readiness:
                'load() predecodes embedded images and waits for Lottie DOMLoaded, including footage, fonts, item construction, and the initial Canvas frame.',
              readinessBudgetMs: LOTTIE_READY_TIMEOUT_MS,
              sourceInPoint:
                'Elapsed time maps to an absolute source frame; the adapter subtracts animationData.ip before calling the relative player seek API.',
              realtime:
                'Persistent player driven from absolute elapsed time for efficient continuous playback.',
              editor:
                'Timeline playback uses the persistent player; paused scrubbing rebuilds changed frames for settled pixel repeatability.',
              nonRealtime:
                'A changed goToTime target rebuilds and awaits the player so repeated timestamps produce byte-identical Canvas pixels in the regression corpus.',
              verification:
                'Inspect lottieInspection warnings, capture representative frames, test backward seeks, and certify the exported package. Canvas results do not prove SVG, original After Effects, HbbTV, or arbitrary target-renderer parity.',
            },
          },
        },
        animatableProperties: [...ANIMATABLE_LAYER_PROPERTIES],
        animatablePropertyPatterns: {
          'effects.ID.PARAM':
            'Stable per-effect numeric target, independent of stack order; add_effect results and inspect_scene return exact property paths.',
          'fill.stops[N].offset':
            'Normalized 0..1 position of gradient stop N (zero-based) on rectangle/ellipse layers. Each stop owns an independent numeric track with incoming easing.',
        },
        easingPresets: [...EASING_PRESETS],
        blendModes: [...BLEND_MODES],
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
            'set_layer_layout clipChildren=true makes that layer an animated, rotation-aware rectangular mask for direct children whose parentId points to it. Rectangle borderRadius rounds the transformed mask and accepts independent topLeft, topRight, bottomRight, and bottomLeft values; a number applies uniformly. Children keep their own world-space rotation; rotate the parent mask to create a diagonal wipe. Clipping is deterministic and compiled; ordinary parent translation remains baked.',
          layerBlending:
            'blendMode is static and composition-local. Editor, capture, SVG diagnostics, and runtime isolate the composition so layers blend only with earlier OGraf layers, never the external video bed or editor checkerboard.',
          runtimeCollections:
            'A runtime collection expands one contiguous grouped prototype from an object-item GDD array. Capacity is bounded to 1..100, overflow truncates, index offsets are explicit, updates replace snapshots atomically, and realtime/non-realtime sampling never depends on arrival order or item count.',
          localLoops:
            'A layer may own one local loop clip with independent numeric property tracks on a 0..durationFrames ruler. set_layer_loop configures lifecycle or Step activation; set_loop_property_track authors incoming-eased keys without creating composition keys or OGraf Steps. Null repeatCount means infinite. All loop phase is sampled from the shared OGraf timestamp/action schedule; loops never invoke lifecycle actions.',
          semanticAuthoring:
            'Layer roles, tags, and descriptions are authoring-only intent used by recipes, queries, QA, and review. They never enter the compiled OGraf runtime.',
          textStroke:
            'Text strokeColor is static and strokeWidth is an independent numeric track. Browser/runtime rendering and SVG diagnostics paint the outline behind the glyph fill.',
        },
        semanticAuthoring: {
          roles: [
            'none',
            'background',
            'container',
            'accent',
            'headline',
            'subheadline',
            'label',
            'value',
            'logo',
            'image',
            'icon',
            'mask',
            'decorative',
            'ticker',
            'score',
            'custom',
          ],
          operations: [
            'set_layer_semantics',
            'create_lower_third',
            'create_bug',
            'create_ticker',
            'create_scoreboard',
            'create_clock',
            'create_repeater',
          ],
          recipes: {
            lowerThird:
              'Creates a grouped four-layer/two-field lower third with semantic roles. The default wipe uses a deterministic clipChildren mask, cubic-out entrance, and cubic-in exit; stagger, slide, and none remain explicit alternatives. The result remains ordinary editable OGraf layers.',
            repeater:
              'Materializes a horizontal or vertical data collection as grouped ordinary layers with independent field mappings and semantic item/index tags.',
            bug: 'Creates a compact grouped bug/DOG with one editable label and style-pack-aware motion.',
            ticker:
              'Creates a clipped ticker window, editable label/crawl fields, and a deterministic layer-local crawl loop rather than a lifecycle-long translation.',
            scoreboard:
              'Creates a grouped two-team/four-field scoreboard with outlined score values and portable semantic layers.',
            clock:
              'Creates a grouped two-field 24-hour clock with static punctuation and validated hour/minute controls.',
          },
          motionPresets: [...MOTION_PRESET_NAMES],
        },
        designSystem: {
          operations: [
            'apply_style_pack',
            'remove_style_pack',
            'set_design_system_name',
            'upsert_design_token',
            'remove_design_token',
            'bind_design_token',
            'unbind_design_token',
          ],
          targetProperties: [
            'fill',
            'fill.stops[N].color',
            'dropShadowColor',
            'strokeColor',
            'strokeWidth',
            'borderRadius',
            'borderRadiusTopLeft',
            'borderRadiusTopRight',
            'borderRadiusBottomRight',
            'borderRadiusBottomLeft',
            'color',
            'fontFamily',
            'fontSize',
            'fontWeight',
          ],
          portability:
            'Token links are authoring metadata; current values are materialized into normal element properties for standard OGraf output.',
          gradientColors:
            'bind_design_token targetProperty fill.stops[N].color links one existing zero-based gradient stop to a color token, preserving opacity, offsets, angle and motion. Link every stop to the same token for a tinted transparent glint. dropShadowColor links effect color without changing blur or shadow opacity. A whole fill token replaces the gradient with a solid color.',
          effectParameters:
            'New effect params use effects.ID.PARAM targets for color/number tokens. Compatibility blur/shadow slots retain their previous properties. Inspect the stack or use add_effect result properties for exact paths.',
          stylePacks: STYLE_PACKS.map((pack) => ({
            id: pack.id,
            name: pack.name,
            description: pack.description,
            tokens: pack.tokens.map((token) => ({
              key: token.key,
              name: token.name,
              type: token.type,
              valueAt1080: token.value,
              scaleWithComposition: token.scaleWithComposition ?? false,
            })),
            motion: pack.motion,
          })),
          stylePackSemantics:
            'apply_style_pack maps colors through existing Brand Kit tokens and root color-field bindings, including gradients and shared lights. Gradient topology, alpha, tonal ratios and motion survive. Parent palette edits propagate through stylePackColors links. Shared color fields use one consistent palette role, preferring accents over surfaces. remove_style_pack restores recorded fonts, colors, bindings/tokens/defaults and timing; pack switches retain the original baseline. Legacy sources without a baseline can only detach. Runtime data still overrides defaults.',
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
          operations: ['set_layer_bindings', 'set_layer_binding (legacy single-binding replace)'],
          semantics:
            'A layer may bind multiple independent element properties. Bindings are applied in order and a target property may appear only once. sourcePath is a segment array for nested object leaves; array paths are item-relative inside a registered runtime collection prototype.',
          fieldTypes: [
            'text',
            'textarea',
            'number',
            'integer',
            'duration-ms',
            'percentage',
            'boolean',
            'color',
            'gradient',
            'image-url',
            'file-path',
            'select',
            'select-multiple',
            'object',
            'array',
          ],
          gdd: 'Every compiled field emits gddType plus operator description, select labels, file extensions, JSON Schema constraints, recursive object properties, and array item schemas when authored.',
          runtimeCollections: {
            operations: [
              'create_runtime_collection',
              'update_runtime_collection',
              'remove_runtime_collection',
            ],
            itemType: 'array field with object items',
            capacity: '1..100; default 12; emitted as maxItems',
            overflow: ['truncate'],
            identity: 'stable array index; no inferred keyed move animation',
          },
          gradient:
            'Gradient fields bind the complete rectangle/ellipse/path/pattern fill. Color fields bind fill.stops[N].color for existing zero-based stops, preserving transparency and offsets. strokeColor and dropShadowColor accept colors. Runtime updateAction recolors without restarting motion.',
          brandDefaults:
            'Top-level color fields may set defaultTokenId to a color Brand Kit token ID. Token edits materialize the field default; runtime data overrides it. Set defaultTokenId:null to detach; explicitly editing defaultValue also detaches.',
          effectParameters:
            'Color/number fields may bind effects.ID.PARAM from the effect catalog. Live values override the sampled parameter; updating data does not restart an effect loop.',
          targetProperties: {
            rectangle: ['fill', 'fill.stops[N].color', 'strokeColor', 'dropShadowColor'],
            ellipse: ['fill', 'fill.stops[N].color', 'strokeColor', 'dropShadowColor'],
            text: ['content', 'color', 'strokeColor', 'dropShadowColor'],
            image: ['src', 'dropShadowColor'],
            path: ['fill', 'fill.stops[N].color', 'strokeColor', 'dropShadowColor'],
            pattern: ['fill', 'fill.stops[N].color', 'strokeColor', 'dropShadowColor'],
            'image-sequence': ['dropShadowColor'],
            lottie: ['dropShadowColor'],
          },
        },
        editorParity: {
          lifecycle: [
            'add_lifecycle_step',
            'rename_lifecycle_keyframe',
            'move_lifecycle_keyframe',
            'remove_lifecycle_step',
          ],
          canvasGroups: ['group_layers', 'ungroup_layers'],
          reusableComponents: [
            'save_component',
            'instantiate_component',
            'update_component_from_layers',
            'refresh_component_instances',
            'rename_component',
            'remove_component',
          ],
          customActions: ['add_custom_action', 'update_custom_action', 'remove_custom_action'],
          assets: ['add_asset', 'remove_asset', 'ograf_import_asset', 'ograf_import_svg_bundle'],
          detail:
            'Lifecycle retiming shares the browser editor planner and therefore returns the same duration bounds and warnings. Structural canvas groups, reusable-component snapshots, custom actions, and asset removal use the same canonical project mutations as OGraf Studio.',
        },
        composableEffects: {
          operations: [
            'add_effect',
            'update_effect',
            'duplicate_effect',
            'remove_effect',
            'reorder_effects',
          ],
          order:
            'Top to bottom. Repeated types are allowed; each effect has a stable ID. Reorder supplies every ID exactly once. Maximum 16 effects including compatibility slots.',
          editing:
            'update_effect patch accepts name, enabled and params. Numeric params use scope authored (lifecycle frames) or scope frame with frame. Rename/bypass/reorder never retime keys. Duplicate copies only that effect’s tracks and bindings; remove clears only its tracks and links, retaining data fields.',
          compatibility:
            'Old blur and shadow remain reorderable base-blur/base-shadow slots backed by existing numeric tracks and dropShadowColor bindings. inspect_scene resolves virtual slots on old documents. Existing appearance and data keys are preserved.',
          animation:
            'Use effects.ID.PARAM for new numeric tracks/local loops, color/number Brand Kit tokens and OGraf data bindings. Runtime data overrides the sampled parameter. Effect IDs are scoped to a layer and survive reorder. Legacy slots keep their original property names.',
          rendering:
            'One ordered chain powers Studio and export; SVG alpha masks use the equivalent chain. Path masks ignore effects. Glow adds an outer colored halo to the preceding result. Values are bounded by the catalog; eased overshoot is clamped.',
          catalog: EFFECT_CATALOG,
        },
        tiling: {
          operations: [
            'set_tiling_pattern',
            'remove_tiling_pattern',
            'set_layer_lighting',
            'add_layer kind=pattern',
          ],
          lighting: {
            settings:
              'set_tiling_pattern.patch.lighting merges a partial settings object: {enabled,cycleFrames:1..1000000,phase:0..1,intensity:0..4,glow:0..4,softness:0..4}. Independent of row motion; defaults are enabled, one eighth of the row cycle, phase 0, multipliers 1.',
            linking:
              'set_layer_lighting takes layerId or exact layerName and link:{patternId,role:light|glow,phaseOffset:0..1,gain:0..4,cyclesPerLoop:1..64}. link:null detaches. Create the controller first; source layers may be any kind.',
            sampling:
              'Existing infinite lifecycle loop curves are sampled over the shared light cycle without retiming keys. Static light layers are also supported. Intensity multiplies sampled layer opacity; glow multiplies glow-role opacity, softness scales their existing blur/shadow/glow radius. Colors and pattern row clocks remain independent. Disable bypasses the controller. Unlink before removing its pattern.',
          },
          creation:
            'set_tiling_pattern with patch:{} creates an editable O/D pattern and a linked layer by default. Set createLayer:false for a definition only. Returns pattern and layer IDs.',
          editing:
            'Pass patternId or exact patternName to update shared controls; omitted fields stay unchanged. Sources are named vector paths, sequence entries reference symbolKey and scale the shared gap. Seeded spacing repeats identically in every tile.',
          motion:
            'cycleFrames is the common master period; integer row cycles guarantee an exact seamless cycle. Shortening cycleFrames increases all row speeds. phase shifts all rows; rowPhaseStep and rowOverrides provide deterministic variation. Zero cycles pauses a row.',
          sharing:
            'Multiple pattern layers reference the same patternId for fills/outlines/glows/masks. Their geometry uses one lifecycle clock even when numeric effect loops have other durations. Per-step activation is disallowed on pattern layers.',
          limits: { rows: 32, symbols: 32, sequence: 64, sourceTypes: ['SVG path'] },
          symbolShape: {
            required: ['key', 'd', 'viewBoxWidth', 'viewBoxHeight', 'width', 'height', 'fillRule'],
            types: 'key/d: string; dimensions: positive finite numbers; fillRule: nonzero|evenodd',
          },
          sequenceShape: {
            symbolKey: 'existing symbol key',
            gapScale: 'required number 0..100; use 1 for the shared gap',
          },
          rowOverrideShape: {
            row: 'required zero-based integer less than rows',
            direction: 'optional left|right',
            cycles: 'optional integer 0..64; zero pauses',
            phase: 'optional finite number; replaces rowPhaseStep, master phase remains additive',
            widthScale: 'optional number 0.05..20',
            blur: 'optional number 0..100',
            opacity: 'optional number 0..1',
          },
          layout:
            'fitRows:true derives rowHeight from height, rowGap and offsetY. fitRows:false uses explicit rowHeight. Shrinking rows drops inactive overrides unless rowOverrides is explicitly supplied. Clear overrides to restore shared direction/speed/phase defaults.',
          paint:
            'Pattern layers accept solid/linear/radial/conic fill, fill bindings and stop tracks, independent outlines and effects. Each tile repeats its paint for seamless wrapping. Do not author element.definition; compilation resolves it from composition.patterns.',
          deletion:
            'Remove or relink pattern layers and component references before removing a definition.',
        },
        masking: {
          operation: 'set_layer_mask',
          selectors:
            'layerId or exact layerName; sourceLayerId or exact sourceLayerName. Names resolve earlier creations in the same batch. sourceLayerId:null detaches.',
          modes: {
            alpha:
              'Painted source transparency, opacity, blur and shadow; sources: rectangle, ellipse, path, pattern, image.',
            path: 'Filled vector geometry and fillRule only; sources: rectangle, ellipse, path, pattern. Paint, stroke, opacity and effects do not change coverage.',
          },
          inverted: 'true reveals the complement inside the target bounds.',
          sourceVisibility:
            'hideSource defaults true and sets source.isMaskOnly. This suppresses source output without disabling masks; isVisible:false disables the source. set_layer_flags isMaskOnly:false shows the source again. Detaching does not change source visibility.',
          dependencies:
            'Same composition. No self/cycles, guide sources or cross-runtime-collection references. Source tracks/loops are sampled independently. Include sources when saving components; duplication remaps internal references. Detach consumers before deleting a source.',
          unsupportedSources: ['text', 'image-sequence', 'lottie'],
          conicAlpha:
            'SVG alpha masks tessellate conic paint at half-degree intervals; visible path paint uses native CSS gradients.',
        },
        canvasLayout: {
          safeAreas: {
            standard: 'EBU R 95',
            aspectRatio: '16:9',
            actionSafeMarginPerAxis: 0.035,
            titleSafeMarginPerAxis: 0.05,
            pixelRounding: 'nearest-integer',
          },
          guides: ['vertical', 'horizontal'],
          snappingTargets: ['grid', 'guides', 'layers', 'composition-edges-and-centres'],
          horizontalConstraints: ['left', 'right', 'left-right', 'center', 'scale'],
          verticalConstraints: ['top', 'bottom', 'top-bottom', 'center', 'scale'],
          boundsModes: ['allow', 'contain'],
          overflowPreview: ['visible', 'clip'],
          outsideCanvasDimmer: {
            property: 'dimOutsideCanvas',
            color: '#333333',
            opacity: 1,
            grayLevel: 0.2,
            transparent: false,
            authoringOnly: true,
          },
          presentationBackgrounds: {
            values: ['none', 'big-buck-bunny', 'still-image'],
            property: 'presentationBackground',
            stillImage: {
              urlProperty: 'presentationBackgroundImageSource',
              localFileSelection: 'Available in the visible Studio Canvas Layout settings.',
              localFilesAreEmbeddedInProject: true,
            },
            authoringOnly: true,
            exported: false,
          },
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
          dryRun: 'ograf_apply_operations mode=dry-run',
          visualDryRun: 'ograf_apply_operations mode=preview',
          humanReview: 'ograf_apply_operations mode=propose',
          outputGate: 'Save/export requires exact-artifact browser OGraf certification.',
          fileScope: workspace.root,
        },
        assets: {
          operations: ['add_asset', 'remove_asset'],
          importTools: ['ograf_import_asset', 'ograf_import_svg_bundle'],
          referenceSyntax: 'asset:<id>',
          semantics:
            'Assets persist once in composition.assets; editor/capture resolve references and certified package export writes each registry entry once. remove_asset refuses referenced image sources unless force=true, which clears those references; removing an in-use font reports a fallback warning.',
        },
        reusableComponents: {
          operations: [
            'save_component',
            'instantiate_component',
            'update_component_from_layers',
            'refresh_component_instances',
            'rename_component',
            'remove_component',
          ],
          semantics:
            'A saved component snapshots selected layers and their bound fields. Independent instances remain detached; linked instances carry authoring-only source metadata and refresh explicitly with complete replacement mappings. Every instance is still ordinary grouped OGraf layers, and component/link metadata never enters compiled output.',
        },
        aiReview: {
          query: 'ograf_query_scene',
          visualDryRun: 'ograf_apply_operations mode=preview',
          deterministicQa: 'ograf_review_design',
          humanProposal: 'ograf_apply_operations mode=propose',
          semantics:
            'Use semantic query for compact selection, visual dry-run for model inspection, and proposals when a human should approve visually consequential edits.',
        },
      };
      return textResult(projectCapabilities(capabilities, sections));
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
        'Read up to 100 retained revisions after sinceRevision, with source and affected-layer summaries.',
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
        'Read project and revision. Omit filters for full data; include sections and tracks=animated-only reduce output. Preserve IDs.',
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
        'Read layers, bindings, masks, Lottie warnings, path anchors, resolved pattern motion and lifecycle. Preserve IDs and revision.',
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
    'ograf_query_scene',
    {
      title: 'Query OGraf scene by semantic intent',
      description:
        'Find layer IDs by semantics, name, type, bindings, visibility or motion; includes frame geometry, masks and authoring links.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
        roles: z.array(semanticLayerRoleSchema).min(1).optional(),
        tagsAll: z.array(z.string().min(1)).min(1).optional(),
        tagsAny: z.array(z.string().min(1)).min(1).optional(),
        nameContains: z.string().min(1).optional(),
        elementTypes: z
          .array(
            z.enum([
              'rectangle',
              'ellipse',
              'text',
              'image',
              'path',
              'pattern',
              'image-sequence',
              'lottie',
            ]),
          )
          .min(1)
          .optional(),
        boundFieldKeys: z.array(z.string().min(1)).min(1).optional(),
        visible: z.boolean().optional(),
        animated: z.boolean().optional(),
        frame: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: readOnly,
    },
    async ({
      sessionId,
      compositionId,
      roles,
      tagsAll,
      tagsAny,
      nameContains,
      elementTypes,
      boundFieldKeys,
      visible,
      animated,
      frame,
      limit,
    }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const composition = snapshot.project.compositions.find(
        (item) => item.id === (compositionId ?? snapshot.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found.');
      const resolvedFrame = frame ?? firstStepFrame(composition);
      if (resolvedFrame > getTotalFrames(composition)) {
        throw new Error(
          `Frame ${resolvedFrame} is beyond the composition's total frame ${getTotalFrames(composition)}.`,
        );
      }
      const fieldById = new Map(composition.dataFields.map((field) => [field.id, field]));
      const lowerName = nameContains?.toLocaleLowerCase();
      const normalizedTagsAll = tagsAll?.map((tag) => tag.toLocaleLowerCase());
      const normalizedTagsAny = tagsAny?.map((tag) => tag.toLocaleLowerCase());
      const desiredFieldKeys = new Set(boundFieldKeys);
      const matches = composition.layers
        .map((layer, index) => {
          const animatedProperties = getLayerAnimatableProperties(layer).filter((property) =>
            isAnimatedTrack(getResolvedLayerAnimationTracks(layer)[property] ?? []),
          );
          const fieldBindings = layer.bindings.map((binding) => {
            const field = fieldById.get(binding.fieldId);
            return {
              fieldId: binding.fieldId,
              fieldKey: field?.key ?? null,
              fieldLabel: field?.label ?? null,
              fieldType: field?.type ?? null,
              targetProperty: binding.targetProperty,
              sourcePath: binding.sourcePath ?? [],
            };
          });
          const tags = layer.semantics.tags.map((tag) => tag.toLocaleLowerCase());
          if (roles && !roles.includes(layer.semantics.role)) return null;
          if (normalizedTagsAll?.some((tag) => !tags.includes(tag))) return null;
          if (normalizedTagsAny && !normalizedTagsAny.some((tag) => tags.includes(tag)))
            return null;
          if (lowerName && !layer.name.toLocaleLowerCase().includes(lowerName)) return null;
          if (elementTypes && !elementTypes.includes(layer.element.type)) return null;
          if (visible !== undefined && layer.isVisible !== visible) return null;
          if (
            animated !== undefined &&
            (animatedProperties.length > 0 || layer.element.type === 'pattern') !== animated
          )
            return null;
          if (
            desiredFieldKeys.size > 0 &&
            !fieldBindings.some(
              (binding) => binding.fieldKey && desiredFieldKeys.has(binding.fieldKey),
            )
          )
            return null;
          const pose = getLayerTransformAtFrame(layer, resolvedFrame);
          return {
            index,
            id: layer.id,
            name: layer.name,
            type: layer.element.type,
            semantics: layer.semantics,
            visible: layer.isVisible,
            locked: layer.isLocked,
            groupId: layer.groupId,
            parentId: layer.parentId,
            mask: layer.mask,
            lighting: layer.lighting ?? null,
            isMaskOnly: layer.isMaskOnly,
            maskConsumers: composition.layers
              .filter((candidate) => candidate.mask?.sourceLayerId === layer.id)
              .map((candidate) => ({ id: candidate.id, name: candidate.name })),
            childIds: composition.layers
              .filter((candidate) => candidate.parentId === layer.id)
              .map((candidate) => candidate.id),
            bounds: {
              x: pose.x,
              y: pose.y,
              width: pose.width,
              height: pose.height,
              right: pose.x + pose.width,
              bottom: pose.y + pose.height,
              opacity: pose.opacity,
              rotation: pose.rotation,
            },
            bindings: fieldBindings,
            designTokenBindings: layer.designTokenBindings.map((binding) => {
              const token = composition.designSystem.tokens.find(
                (candidate) => candidate.id === binding.tokenId,
              );
              return {
                ...binding,
                tokenKey: token?.key ?? null,
                tokenType: token?.type ?? null,
                value: token?.value ?? null,
              };
            }),
            animatedProperties,
            hasLoop: Boolean(layer.loop) || layer.element.type === 'pattern',
            patternId: layer.element.type === 'pattern' ? layer.element.patternId : null,
            componentLink: layer.componentLink,
            runtimeCollectionId:
              composition.runtimeCollections.find((collection) =>
                collection.prototypeLayerIds.includes(layer.id),
              )?.id ?? null,
          };
        })
        .filter((match): match is NonNullable<typeof match> => Boolean(match));
      const selected = matches.slice(0, limit);
      return textResult({
        sessionId,
        revision: snapshot.revision,
        composition: {
          id: composition.id,
          name: composition.name,
          width: composition.width,
          height: composition.height,
          frameRate: composition.frameRate,
        },
        frame: resolvedFrame,
        matched: matches.length,
        returned: selected.length,
        truncated: matches.length > selected.length,
        layers: selected,
      });
    },
  );

  server.registerTool(
    'ograf_get_timeline',
    {
      title: 'Get OGraf property timeline',
      description:
        'Read property tracks, lifecycle and local loops, optionally filtered by layerIds. Easing applies to the incoming segment.',
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
        'Sample tracks, bounds, shared lighting and pattern rows without a browser. loopElapsedFrame is absolute on-air time.',
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
            const pattern =
              layer.element.type === 'pattern'
                ? composition.patterns.find(
                    (p) => layer.element.type === 'pattern' && p.id === layer.element.patternId,
                  )
                : undefined;
            const pose = { ...getLayerTransformAtFrame(layer, frame) };
            const valueAt = (property: Parameters<typeof getLayerPropertyValueAtFrame>[1]) =>
              getLayerPropertyWithLighting(
                layer,
                composition.patterns,
                property,
                frame,
                loopElapsedFrame,
              );
            for (const property of TRANSFORM_ANIMATION_PROPERTIES)
              pose[property] = valueAt(property);
            const lighting = composition.patterns.find(
              (p) => p.id === layer.lighting?.patternId,
            )?.lighting;
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
              ...(layer.lighting
                ? {
                    lighting: {
                      ...layer.lighting,
                      settings: lighting,
                      sourceLoopFrame:
                        layer.loop && lighting?.enabled && loopElapsedFrame !== undefined
                          ? patternLightLoopFrame(
                              layer.loop,
                              lighting,
                              layer.lighting,
                              loopElapsedFrame,
                            )
                          : null,
                    },
                  }
                : {}),
              ...(pattern
                ? {
                    patternRows: patternRows(pattern).map((row) => ({
                      row: row.row,
                      period: row.period,
                      offset: patternRowOffset(
                        pattern,
                        row,
                        loopElapsedFrame ?? Math.max(0, frame - firstStepFrame(composition)),
                      ),
                      cycles: row.cycles,
                      direction: row.direction > 0 ? 'right' : 'left',
                    })),
                  }
                : {}),
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
        'Capture browser PNG of a composition frame or live viewport; requires a responsive editor. Default frame is first Step. Composition supports matte/dataOverrides; viewport ignores them. Returns a five-minute URL; inline PNG is opt-in. Does not certify export.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        target: z.enum(['composition', 'viewport']).default('composition'),
        frame: z.number().int().nonnegative().optional(),
        compositionId: z.string().optional(),
        maxDimension: z.number().int().min(64).max(4096).default(900),
        matte: captureMatteSchema,
        dataOverrides: z.record(z.string(), fieldValueSchema).optional(),
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
        'Capture up to 12 labelled browser frames; defaults to lifecycle/midpoints. maxDimension is per tile. Five-minute URL; inline PNG opt-in.',
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
    'ograf_preview_operations',
    {
      title: 'Preview OGraf operations without applying them',
      description:
        'Runs an atomic revision-checked dry run, then renders the projected project through the connected OGraf Studio browser without changing the session, undo history, or revision. render=frame returns one PNG at frame (or the first Step); render=strip returns a contact sheet at frames (or lifecycle/transition samples). Use this before committing a visually meaningful operation batch. The response includes the exact authoring summary, validation, generated IDs, and a private five-minute localhost PNG URL.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        operations: z.array(authoringOperationSchema).min(1),
        render: z.enum(['frame', 'strip']).default('frame'),
        compositionId: z.string().optional(),
        frame: z.number().int().nonnegative().optional(),
        frames: z.array(z.number().int().nonnegative()).min(1).max(12).optional(),
        columns: z.number().int().min(1).max(12).default(3),
        maxDimension: z.number().int().min(64).max(4096).default(900),
        labelFrames: z.boolean().default(true),
        matte: captureMatteSchema,
        dataOverrides: z.record(z.string(), fieldValueSchema).optional(),
        enableBase64Response: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({
      sessionId,
      expectedRevision,
      operations,
      render,
      compositionId,
      frame,
      frames,
      columns,
      maxDimension,
      labelFrames,
      matte,
      dataOverrides,
      enableBase64Response,
    }) => {
      if (render === 'strip' && dataOverrides) {
        throw new Error('dataOverrides is currently available only for render=frame.');
      }
      const session = workspace.get(sessionId);
      const snapshot = session.snapshot();
      const typedOperations = normalizeOperationSelectors(
        snapshot.project,
        operations as unknown[],
      );
      const projection = session.apply({
        expectedRevision,
        operations: typedOperations,
        dryRun: true,
      });
      const composition = projection.project.compositions.find(
        (item) => item.id === (compositionId ?? projection.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found in projected project.');
      const results = generatedOperationResults(
        typedOperations,
        projection.summary.generatedIds,
        projection.project,
      );

      let image: Awaited<ReturnType<EditorBridgePort['capture']>>;
      let renderedFrames: number[];
      if (render === 'frame') {
        const resolvedFrame = frame ?? firstStepFrame(composition);
        if (resolvedFrame > getTotalFrames(composition)) {
          throw new Error(
            `Frame ${resolvedFrame} is beyond the projected composition's total frame ${getTotalFrames(composition)}.`,
          );
        }
        image = await bridge.capture({
          target: 'composition',
          project: projection.project,
          compositionId: composition.id,
          frame: resolvedFrame,
          maxDimension,
          matte,
          ...(dataOverrides ? { dataOverrides } : {}),
        });
        renderedFrames = [resolvedFrame];
      } else {
        const resolvedFrames = frames
          ? [...new Set(frames)].sort((a, b) => a - b)
          : defaultStripFrames(composition);
        const totalFrames = getTotalFrames(composition);
        const invalidFrame = resolvedFrames.find((candidate) => candidate > totalFrames);
        if (invalidFrame !== undefined) {
          throw new Error(
            `Frame ${invalidFrame} is beyond the projected composition's total frame ${totalFrames}.`,
          );
        }
        image = await bridge.renderStrip({
          project: projection.project,
          compositionId: composition.id,
          frames: resolvedFrames,
          columns,
          maxDimension: Math.min(maxDimension, 1024),
          labelFrames,
          matte,
        });
        renderedFrames = resolvedFrames;
      }

      const { data, ...metadata } = image;
      const structuredContent = {
        sessionId,
        baseRevision: snapshot.revision,
        revisionUnchanged: session.revision === snapshot.revision,
        dryRun: true,
        render,
        compositionId: composition.id,
        frames: renderedFrames,
        summary: projection.summary,
        validation: projection.validation,
        results,
        ...metadata,
        fetchCommand: `curl --fail --output ograf-proposal.png "${image.url}"`,
      };
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }
      > = [
        {
          type: 'text',
          text: `Projected ${projection.summary.operationCount} operation(s) at unchanged revision ${snapshot.revision}; valid=${projection.validation.valid}. ${render === 'frame' ? 'Frame' : 'Frames'} ${renderedFrames.join(', ')} rendered: ${image.url}`,
        },
      ];
      if (enableBase64Response) content.push({ type: 'image', data, mimeType: 'image/png' });
      return { content, structuredContent };
    },
  );

  server.registerTool(
    'ograf_propose_operations',
    {
      title: 'Propose OGraf operations for human review',
      description:
        'Creates a visual, revision-neutral dry-run and presents it inside OGraf Studio with explicit Accept and Reject controls. Acceptance atomically applies the exact prevalidated operations only if the live revision still equals baseRevision; otherwise the proposal resolves as stale and must be regenerated. This is the preferred boundary for visually consequential AI edits.',
      inputSchema: {
        sessionId: z.literal('editor').default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        title: z.string().min(1).max(120),
        description: z.string().max(1000).default(''),
        operations: z.array(authoringOperationSchema).min(1),
        render: z.enum(['frame', 'strip']).default('strip'),
        compositionId: z.string().optional(),
        frame: z.number().int().nonnegative().optional(),
        frames: z.array(z.number().int().nonnegative()).min(1).max(12).optional(),
        columns: z.number().int().min(1).max(12).default(3),
        maxDimension: z.number().int().min(64).max(1024).default(320),
        matte: captureMatteSchema,
        enableBase64Response: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({
      sessionId,
      expectedRevision,
      title,
      description,
      operations,
      render,
      compositionId,
      frame,
      frames,
      columns,
      maxDimension,
      matte,
      enableBase64Response,
    }) => {
      const session = workspace.get(sessionId);
      const snapshot = session.snapshot();
      const typedOperations = normalizeOperationSelectors(
        snapshot.project,
        operations as unknown[],
      );
      const projection = session.apply({
        expectedRevision,
        operations: typedOperations,
        dryRun: true,
      });
      const composition = projection.project.compositions.find(
        (item) => item.id === (compositionId ?? projection.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found in projected project.');
      let preview: Awaited<ReturnType<EditorBridgePort['capture']>>;
      let renderedFrames: number[];
      if (render === 'frame') {
        const resolvedFrame = frame ?? firstStepFrame(composition);
        if (resolvedFrame > getTotalFrames(composition)) {
          throw new Error(`Frame ${resolvedFrame} is beyond the projected composition's duration.`);
        }
        preview = await bridge.capture({
          target: 'composition',
          project: projection.project,
          compositionId: composition.id,
          frame: resolvedFrame,
          maxDimension,
          matte,
        });
        renderedFrames = [resolvedFrame];
      } else {
        const resolvedFrames = frames
          ? [...new Set(frames)].sort((a, b) => a - b)
          : defaultStripFrames(composition);
        const invalidFrame = resolvedFrames.find(
          (candidate) => candidate > getTotalFrames(composition),
        );
        if (invalidFrame !== undefined) {
          throw new Error(`Frame ${invalidFrame} is beyond the projected composition's duration.`);
        }
        preview = await bridge.renderStrip({
          project: projection.project,
          compositionId: composition.id,
          frames: resolvedFrames,
          columns,
          maxDimension,
          labelFrames: true,
          matte,
        });
        renderedFrames = resolvedFrames;
      }
      const proposalId = randomUUID();
      const proposal = {
        id: proposalId,
        title,
        description,
        sessionId,
        baseRevision: snapshot.revision,
        operationTypes: typedOperations.map((operation) => operation.type),
        operationCount: typedOperations.length,
        previewUrl: preview.url,
        previewExpiresAt: preview.expiresAt,
        render,
        frames: renderedFrames,
        valid: projection.validation.valid,
        warnings: [
          ...projection.summary.warnings,
          ...projection.validation.warnings,
          ...projection.validation.errors,
        ],
      };
      bridge.presentProposal(proposal, async (decision) => {
        if (decision === 'reject') {
          return { status: 'rejected', message: 'Proposal rejected; the project was not changed.' };
        }
        try {
          const applied = session.apply({
            expectedRevision: snapshot.revision,
            operations: typedOperations,
            reason: `Accepted proposal: ${title}`,
          });
          return {
            status: 'accepted',
            message: `Applied ${applied.summary.operationCount} operation(s).`,
            revision: applied.revision,
          };
        } catch (error) {
          if (error instanceof RevisionConflictError) {
            return {
              status: 'stale',
              message: `${error.message} Regenerate the proposal against the current project.`,
              revision: session.revision,
            };
          }
          throw error;
        }
      });
      const { data, ...previewMetadata } = preview;
      const structuredContent = {
        proposalId,
        status: 'pending-human-review',
        baseRevision: snapshot.revision,
        revisionUnchanged: session.revision === snapshot.revision,
        summary: projection.summary,
        validation: projection.validation,
        preview: previewMetadata,
      };
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }
      > = [
        {
          type: 'text',
          text: `Proposal ${proposalId} is waiting for Accept or Reject in OGraf Studio. The project remains at revision ${snapshot.revision}. Preview: ${preview.url}`,
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
        'Validate semantics; optionally measure browser text overflow with stress testValues and broadcast lint. detail=summary shows failures/counts. Does not certify artifacts.',
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
            const contentBinding = layer.bindings.find(
              (binding) => binding.targetProperty === 'content',
            );
            const field = contentBinding
              ? composition.dataFields.find((candidate) => candidate.id === contentBinding.fieldId)
              : undefined;
            const supplied = field ? testValues?.[field.key] : undefined;
            const leaf =
              field && contentBinding
                ? fieldDefinitionAtPath(field, contentBinding.sourcePath ?? [], {
                    fromArrayItem: field.type === 'array',
                  })
                : field;
            const declaredMaximum = leaf?.constraints.maxLength;
            const declaredMaximumStress =
              declaredMaximum !== undefined && declaredMaximum > 0
                ? 'W'.repeat(Math.min(declaredMaximum, 2000))
                : undefined;
            const defaultRoot =
              field?.type === 'array' && Array.isArray(field.defaultValue)
                ? field.defaultValue[0]
                : field?.defaultValue;
            const defaultValue = valueAtSourcePath(defaultRoot, contentBinding?.sourcePath);
            const suppliedValues =
              field?.type === 'array' && Array.isArray(supplied)
                ? supplied.map((item) => valueAtSourcePath(item, contentBinding?.sourcePath))
                : supplied !== undefined
                  ? [valueAtSourcePath(supplied, contentBinding?.sourcePath)]
                  : [];
            const values = [
              defaultValue ?? layer.element.content,
              ...(declaredMaximumStress ? [declaredMaximumStress] : []),
              ...suppliedValues,
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
                const fittingFloor =
                  layer.element.autoFit === 'fit-to-width'
                    ? 'the 0.1px fit-to-width floor'
                    : `its ${layer.element.minFontSize}px shrink-to-fit floor`;
                warnings.push(
                  `Composition "${composition.name}": text layer "${layer.name}" reached ${fittingFloor} for ${field ? `field "${field.key}" value` : 'authored text'} ${JSON.stringify(value)} and remains degenerate.`,
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
    'ograf_review_design',
    {
      title: 'Review OGraf design and motion',
      description:
        'Advisory layout/type/color/motion QA with layer IDs. includeStrip captures browser frames. Does not certify export.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        compositionId: z.string().optional(),
        includeStrip: z.boolean().default(false),
        columns: z.number().int().min(1).max(12).default(3),
        maxDimension: z.number().int().min(64).max(1024).default(320),
        matte: captureMatteSchema,
        enableBase64Response: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({
      sessionId,
      compositionId,
      includeStrip,
      columns,
      maxDimension,
      matte,
      enableBase64Response,
    }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      const composition = snapshot.project.compositions.find(
        (item) => item.id === (compositionId ?? snapshot.project.mainCompositionId),
      );
      if (!composition) throw new Error('Composition not found.');
      const report = reviewCompositionDesign(composition);
      let publishedStrip: Awaited<ReturnType<EditorBridgePort['renderStrip']>> | null = null;
      if (includeStrip) {
        publishedStrip = await bridge.renderStrip({
          project: snapshot.project,
          compositionId: composition.id,
          frames: defaultStripFrames(composition),
          columns,
          maxDimension,
          labelFrames: true,
          matte,
        });
      }
      const stripMetadata = publishedStrip
        ? (() => {
            const { data: _data, ...metadata } = publishedStrip;
            return metadata;
          })()
        : null;
      const structuredContent = {
        sessionId,
        revision: snapshot.revision,
        compositionId: composition.id,
        ...report,
        strip: stripMetadata,
      };
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }
      > = [
        {
          type: 'text',
          text: `Design QA score ${report.score}/100: ${report.summary.error} error(s), ${report.summary.warning} warning(s), ${report.summary.info} info finding(s).${publishedStrip ? ` Contact sheet: ${publishedStrip.url}` : ''}`,
        },
      ];
      if (publishedStrip && enableBase64Response) {
        content.push({ type: 'image', data: publishedStrip.data, mimeType: 'image/png' });
      }
      return { content, structuredContent };
    },
  );

  server.registerTool(
    'ograf_measure_text',
    {
      title: 'Measure OGraf text in the browser',
      description:
        'Browser text fit, lines and overflow at first Step by default. degenerate means failed fitting. Parent clipping may be intentional; font resolution is inferred.',
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
        'Reset an existing session in one undoable transaction; requires confirm=true and expectedRevision. keepDataFields copies main-composition fields, not layers or bindings.',
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
        'Delete one non-editor in-memory session and history with confirm=true. Saved files remain.',
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
        'Opens a .ogs file (or legacy .ogeproj source) inside the configured workspace into a new authoring session.',
      inputSchema: { sessionId: z.string(), path: z.string() },
      annotations: mutation,
    },
    async ({ sessionId, path }) =>
      textResult(
        (await workspace.open(sessionId, path)).snapshot() as unknown as Record<string, unknown>,
      ),
  );

  server.registerTool(
    'ograf_import_asset',
    {
      title: 'Import a workspace asset into OGraf',
      description:
        'Atomically embed one workspace image/font/CSS/text resource (max 32 MiB). Returns asset:<id> for layer sources or field defaults. Paths cannot leave the workspace.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        compositionId: z.string().optional(),
        path: z.string().min(1),
        name: z.string().min(1).optional(),
        mimeType: z
          .enum([
            'image/png',
            'image/jpeg',
            'image/gif',
            'image/webp',
            'image/svg+xml',
            'font/ttf',
            'font/otf',
            'font/woff',
            'font/woff2',
            'text/css',
            'text/plain',
          ])
          .optional(),
        fontFamily: z.string().min(1).optional(),
        fontWeight: z.string().min(1).optional(),
        fontStyle: z.enum(['normal', 'italic', 'oblique']).optional(),
        packagePath: z.string().min(1).optional(),
        licenseName: z.string().optional(),
        licenseUrl: z.string().optional(),
        licenseText: z.string().optional(),
      },
      annotations: mutation,
    },
    async ({
      sessionId,
      expectedRevision,
      compositionId,
      path,
      name,
      mimeType,
      fontFamily,
      fontWeight,
      fontStyle,
      packagePath,
      licenseName,
      licenseUrl,
      licenseText,
    }) => {
      const resolvedPath = workspace.resolveAllowedPath(path);
      const data = await readFile(resolvedPath);
      if (data.byteLength > 32 * 1024 * 1024) {
        throw new Error('Asset exceeds the 32 MiB workspace import limit.');
      }
      const resolvedMime = mimeType ?? importMimeType(resolvedPath);
      if (resolvedMime === 'application/octet-stream') {
        throw new Error('Unknown asset type; provide a supported mimeType explicitly.');
      }
      const operation: AuthoringOperation = {
        type: 'add_asset',
        ...(compositionId ? { compositionId } : {}),
        name: name?.trim() || basename(resolvedPath),
        mimeType: resolvedMime,
        data: data.toString('base64'),
        ...(fontFamily ? { fontFamily } : {}),
        ...(fontWeight ? { fontWeight } : {}),
        ...(fontStyle ? { fontStyle } : {}),
        ...(packagePath ? { packagePath } : {}),
        ...(licenseName !== undefined ? { licenseName } : {}),
        ...(licenseUrl !== undefined ? { licenseUrl } : {}),
        ...(licenseText !== undefined ? { licenseText } : {}),
      };
      const session = workspace.get(sessionId);
      const result = session.apply({ expectedRevision, operations: [operation] });
      const generated = generatedOperationResults(
        [operation],
        result.summary.generatedIds,
        result.project,
      );
      return textResult(
        {
          sessionId,
          revision: result.revision,
          importedFrom: path,
          assets: generated,
          warnings: result.summary.warnings,
          validation: result.validation,
        },
        `Imported ${path} at revision ${result.revision}: ${generated.map((entry) => `asset:${entry.id}`).join(', ')}.`,
      );
    },
  );

  server.registerTool(
    'ograf_import_svg_bundle',
    {
      title: 'Import a portable Photoshop SVG bundle',
      description:
        'Atomically import one workspace SVG with companion CSS/images/fonts. Embeds relative references and registers fonts. Paths cannot leave the workspace; limits are 32 MiB per file and 64 MiB total.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        compositionId: z.string().optional(),
        paths: z.array(z.string().min(1)).min(1).max(64),
      },
      annotations: mutation,
    },
    async ({ sessionId, expectedRevision, compositionId, paths }) => {
      const seenNames = new Set<string>();
      let totalBytes = 0;
      const files = await Promise.all(
        paths.map(async (path) => {
          const resolvedPath = workspace.resolveAllowedPath(path);
          const data = await readFile(resolvedPath);
          if (data.byteLength > 32 * 1024 * 1024) {
            throw new Error(`${path} exceeds the 32 MiB per-file import limit.`);
          }
          totalBytes += data.byteLength;
          const name = basename(resolvedPath);
          const key = name.toLocaleLowerCase();
          if (seenNames.has(key)) {
            throw new Error(`Bundle contains duplicate base filename: ${name}`);
          }
          seenNames.add(key);
          return {
            name,
            type: importMimeType(resolvedPath),
            size: data.byteLength,
            text: async () => data.toString('utf8'),
            arrayBuffer: async () => Uint8Array.from(data).buffer,
          };
        }),
      );
      if (totalBytes > 64 * 1024 * 1024) {
        throw new Error('SVG bundle exceeds the 64 MiB aggregate import limit.');
      }
      const bundle = await buildSvgBundle(files);
      const assets = [bundle.svgAsset, ...bundle.fontAssets];
      const operations: AuthoringOperation[] = assets.map((asset) => ({
        type: 'add_asset',
        ...(compositionId ? { compositionId } : {}),
        name: asset.name,
        mimeType: asset.mimeType,
        data: dataUriBase64(asset.dataUri),
        ...(asset.fontFamily ? { fontFamily: asset.fontFamily } : {}),
        ...(asset.fontWeight ? { fontWeight: asset.fontWeight } : {}),
        ...(asset.fontStyle ? { fontStyle: asset.fontStyle } : {}),
      }));
      const session = workspace.get(sessionId);
      const result = session.apply({ expectedRevision, operations });
      const generated = generatedOperationResults(
        operations,
        result.summary.generatedIds,
        result.project,
      );
      const warnings = [...bundle.warnings, ...result.summary.warnings];
      return textResult(
        {
          sessionId,
          revision: result.revision,
          importedFrom: paths,
          svgAsset: generated[0] ?? null,
          fontAssets: generated.slice(1),
          warnings,
          validation: result.validation,
        },
        `Imported portable SVG bundle with ${generated.length} embedded asset(s) at revision ${result.revision}; warnings=${warnings.length}.`,
      );
    },
  );

  server.registerTool(
    'ograf_apply_operations',
    {
      title: 'Apply atomic OGraf authoring operations',
      description:
        'Apply a revision-checked atomic batch across scene/lifecycle tracks and loops, masks, gradients, effects, shared pattern geometry/lighting, Brand Kits, components, collections, assets and layout. Discover capabilities for domain contracts. Single-layer operations take layerId or exact layerName; creation returns stable IDs. preview renders, propose awaits editor acceptance, dry-run does not commit. Transform/effect updates default to all authored lifecycle frames; scope:frame requires frame. Independent keys are never implicitly retimed. All warnings are returned.',
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
        const componentResults = result.summary.componentInstances.map((instance) => ({
          index: instance.operationIndex,
          type: typedOperations[instance.operationIndex]?.type ?? 'instantiate_component',
          componentId: instance.componentId,
          instanceId: instance.instanceId,
          groupId: instance.groupId,
          linked: instance.linked,
          layers: instance.layers,
          fields: instance.fields,
        }));
        const repeaterResults = result.summary.repeaters.map((repeater) => ({
          index: repeater.operationIndex,
          type: 'create_repeater',
          name: repeater.name,
          direction: repeater.direction,
          gap: repeater.gap,
          items: repeater.items,
        }));
        const recipeResults = result.summary.semanticBlocks.map((block) => ({
          index: block.operationIndex,
          type: typedOperations[block.operationIndex]?.type ?? `create_${block.recipe}`,
          recipe: block.recipe,
          name: block.name,
          groupId: block.groupId,
          timelineGroupId: block.timelineGroupId,
          layers: block.layers,
          fields: block.fields,
          ...(block.stylePack ? { stylePack: block.stylePack } : {}),
        }));
        const stylePackResults = result.summary.stylePacks.map((pack) => ({
          index: pack.operationIndex,
          type: 'apply_style_pack',
          stylePack: pack.packId,
          name: pack.name,
          tokenIds: pack.tokenIds,
          affectedLayerIds: pack.affectedLayerIds,
        }));
        const results = [
          ...generatedResults,
          ...duplicateResults,
          ...componentResults,
          ...repeaterResults,
          ...recipeResults,
          ...stylePackResults,
        ];
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
        'Certify exact compiled project, manifest, package, module and realtime/non-realtime lifecycle in a responsive editor.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        profile: z.enum(['realtime', 'non-realtime', 'dual']).optional(),
      },
      annotations: readOnly,
    },
    async ({ sessionId, profile }) => {
      const { certification } = await certifiedArtifacts(workspace, bridge, sessionId, profile);
      return textResult({ sessionId, profile: profile ?? 'project-declared', certification });
    },
  );

  server.registerTool(
    'ograf_save_project',
    {
      title: 'Certify and save editable OGraf project',
      description:
        'Certify exact output in a responsive editor, then save editable .ogs inside the workspace.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        path: z.string(),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
      },
      annotations: mutation,
    },
    async ({ sessionId, path, overwrite }) => {
      if (extname(path).toLowerCase() !== PROJECT_SOURCE_EXTENSION)
        throw new Error(`Project path must end in ${PROJECT_SOURCE_EXTENSION}.`);
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
        'Certify exact output in a responsive editor, then write a playout .ograf.zip inside the workspace.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        path: z.string(),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
        profile: z.enum(['realtime', 'non-realtime', 'dual']).default('dual'),
      },
      annotations: mutation,
    },
    async ({ sessionId, path, overwrite, profile }) => {
      if (!path.toLowerCase().endsWith('.ograf.zip'))
        throw new Error('Package path must end in .ograf.zip.');
      const { artifacts, certification } = await certifiedArtifacts(
        workspace,
        bridge,
        sessionId,
        profile,
      );
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
        { sessionId, path: target, profile, certification },
        `Certified and exported ${target}`,
      );
    },
  );

  return consolidateOperationTools(records, workspace, bridge);
}
