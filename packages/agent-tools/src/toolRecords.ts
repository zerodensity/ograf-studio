import { coordinatedExportFile } from './coordinatedExportFile';
import {
  registerToolResultPager,
  toolResultPagerForWorkspace,
  ToolResultPagingError,
} from './resultPaging';
import {
  getShaderAnimatableProperties,
  shaderAnimationPropertySpec,
} from '@ograf-editor/scene-model';
import { mcpTemplateSetOperationSchema, templateSetOperationSchema } from './templateSetSchemas';
import { livePlayoutOperationSchema } from './playoutSchemas';
import {
  getElementShaderPaint,
  getElementShaderPaints,
  hasElementShaderPaint,
} from '@ograf-editor/scene-model';
import { parseEditablePath, pathConversionError } from '@ograf-editor/scene-model';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
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
  buildOfflinePreviewHtml,
  getExportProfile,
  validatePackageLayout,
  withExportThumbnail,
  type ExportProfileMode,
  type ExportArtifacts,
} from '@ograf-editor/codegen';
import {
  ANIMATABLE_LAYER_PROPERTIES,
  LAYER_MOTION_STYLES,
  EFFECT_CATALOG,
  EFFECT_BLEND_MODES,
  getEffectStack,
  effectProperty,
  effectEnabled,
  effectParams,
  MODIFIER_CATALOG,
  MODIFIER_TYPES,
  getLayerModifiers,
  numericModifierProperties,
  patternRows,
  patternRowOffset,
  sampleTicker,
  getTickerLayout,
  PATTERN_PRESETS,
  getPatternPresetPatch,
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
  inspectShaderElement,
  inspectDataFieldUsage,
  MAX_SHADER_IMAGE_BYTES,
  MAX_SHADER_SOURCE_BYTES,
  MAX_TEXT_CLIP_MARGIN,
  LOTTIE_READY_TIMEOUT_MS,
  PROJECT_SOURCE_EXTENSION,
  MOTION_PRESET_NAMES,
  STYLE_PACKS,
  polygonBounds,
  reviewCompositionDesign,
  transformBoundsPolygon,
  TRANSFORM_ANIMATION_PROPERTIES,
  TRANSITION_LOGIC_VERSION,
  valueAtSourcePath,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import JSZip from 'jszip';
import { writeTemplateFiles } from './projectFiles';
import { decodeTemplateSetArchive } from './templateSetFiles';
import {
  projectThumbnailFrame,
  thumbnailRenderProject,
  templateThumbnailName,
  THUMBNAIL_MAX_DIMENSION,
} from '@ograf-editor/scene-model';
import * as z from 'zod/v4';
import {
  authoringOperationSchema,
  EASING_PRESETS,
  fieldValueSchema,
  originalPromptSchema,
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

const SHADER_PAINT_CAPABILITIES = {
  type: 'shader',
  library: {
    storage: 'project.shaders',
    shape: '{id,paint:ShaderPaint}',
    read: 'ograf_get_project include:["shaders"]',
    semantics:
      'project.shaders stores saved library resources, with no layer or OGraf data fields. Applied shader paints remain independent copies in layer fills, text outlines or effect entries; the Resources UI also lists these usages without adding library copies.',
    authoring:
      'Read project.shaders, then copy resource.paint into update_element.patch.fill, text strokePaint, or add_effect/update_effect patch.shader. Remove inputImage when copying into an effect because its iChannel0 is the incoming stack image. New Shader, rename, Load GLSL, Save shader and library removal are editor UI actions; no dedicated shader-library mutation operation is exposed.',
  },
  slots: {
    fill: 'All listed elements',
    stroke: 'Text only, stored in element.strokePaint; absent uses strokeColor.',
    effect:
      'Post-process stack entry via add_effect/update_effect patch.shader; iChannel0 is reserved for preceding stack output.',
  },
  supportedElements: [
    'rectangle',
    'ellipse',
    'path',
    'pattern',
    'text',
    'image',
    'image-sequence',
    'lottie',
    'chart',
  ],
  shape:
    'Shader RGBA is multiplied by the object shape or source alpha; original media colors are replaced. Text outlines can use an independent strokePaint shader clipped by native glyph stroke alpha. One independent embedded image may be sampled through iChannel0; the shader cannot sample the painted object, lower layers or external broadcast video.',
  editor:
    'Resources > Shaders lists saved library shaders and applied Fill, Outline and shader Effect usages, including bypassed effects and component definitions. Edit/Load opens the dedicated shader editor; Properties retains parameter controls and an Edit shader action. Applied edits change only the identified layer slot or effect. Removing a library entry keeps applied copies; removing an applied entry detaches that paint or removes that effect. Dragging copies independently. Shader source edits use Save shader. Auto-keyframe and Timeline + Property expose declared channels; local loops have their own preview.',
  animation:
    'Use set_property_track for lifecycle keys, or set_layer_loop plus set_loop_property_track for ambient motion. Inspect shaderAnimationProperties for exact paths and limits. Float channels interpolate; int/bool hold (bool keys are 0/1), vec2 uses .x/.y, colors .r/.g/.b/.a. Active keyed channels override data only for those channels; loop-only channels return to data when inactive. iTime continues independently. Keep loop endpoints equal and exposed symbol names stable.',
  fragmentSource: {
    type: 'string',
    maximumBytes: MAX_SHADER_SOURCE_BYTES,
    description:
      'Self-contained GLSL Image pass defining mainImage(out vec4 fragColor, in vec2 fragCoord), preserved verbatim. The runtime supplies main, version, iTime, iResolution, optional iChannel0 and iChannelResolution. Mark literal global constants with #pragma ograf NAME CONTROL options to generate controls and OGraf fields automatically; omit custom uniform declarations.',
  },
  speed: { type: 'number', default: 1, minimum: 0, maximum: 10 },
  resolutionScale: { type: 'number', default: 1, minimum: 0.25, maximum: 1 },
  parameters: {
    type: 'object',
    default: {},
    values: 'number, boolean, or numeric vector, keyed by a marked source symbol',
    pragma: '#pragma ograf NAME slider|color|toggle|vector2 min(N) max(N) step(N)',
    declarations:
      'Literal global float/int/bool/vec2/vec3/vec4 constants or object-like #define constants. slider: float/int; color: vec3/vec4; toggle: bool; vector2: vec2.',
    exposure:
      'Every marked parameter automatically gets an ordinary typed data field and fill.parameters.NAME or strokePaint.parameters.NAME binding, exposed to OGraf by default. Identical parameter names in fill and outline remain independent. No pragma expose keyword or manual field creation is needed. Set the generated field exposeToOgraf:false to keep its controls, defaults, bindings and Rules internal while excluding it from public playout data. Removed symbols remove only unused generated fields; copies get independent fields.',
    dataTypes:
      'float: number; int: integer; bool: boolean; vec3/vec4 colors: #rrggbb/#rrggbbaa; vec2: object with numeric x and y properties.',
  },
  inputImage: {
    optional: true,
    shape: '{source,name?,wrap:"repeat"|"clamp",filter:"linear"|"nearest"}',
    source: 'Embedded PNG or JPEG data URI',
    maximumBytes: MAX_SHADER_IMAGE_BYTES,
    uniforms: ['sampler2D iChannel0', 'vec3 iChannelResolution[4]'],
    semantics:
      'One portable static image copied with the shader paint. It is independent of the painted object and external video.',
  },
  runtimeProfile: {
    renderer: 'WebGL2',
    passes: 1,
    supportedInputs: ['iTime', 'iResolution', 'iChannel0', 'iChannelResolution[0]'],
    unsupported: [
      'iChannel1–3',
      'video textures',
      'audio',
      'buffer passes',
      'feedback',
      'mouse',
      'date',
      'frame counters',
      'custom uniforms',
    ],
    timing:
      'iTime is absolute composition elapsed seconds multiplied by speed; deterministic backward and repeated seeking.',
    frameCompletion: {
      realtime: 'asynchronous-gpu-submission-without-finish-or-per-draw-error-read',
      deterministic: 'asynchronous-gpu-fence-at-content-readiness-seek-and-capture-boundaries',
      contract:
        'Ordinary shader animation submits GPU work without a blocking gl.finish or per-draw gl.getError. Explicit content readiness, OGraf goToTime and browser capture await the requested GPU frame using zero-timeout fence polling that yields to the event loop. Context loss, disposal, failed waits and a bounded timeout reject completion; they never report an unfinished capture as ready. Shader compilation and initialization diagnostics remain available. This changes GPU scheduling, not authored timing, uniforms, bindings, Rules or animation sampling.',
    },
    portability:
      'The target renderer must support WebGL2. Source inspection is not a GLSL compile or rendering check. SVG-only previews cannot render shader pixels.',
    editing:
      'Set element.fill to {type:shader, fragmentSource, speed:1, resolutionScale:1, parameters:{}, inputImage?} on an existing shape, text, or media layer. Use update_element.patch.fill for fill edits; text also accepts independent strokePaint with the same shape. Set strokePaint:null to restore its solid strokeColor. inputImage.source is an embedded PNG/JPEG data URI sampled as iChannel0. Source pragmas define editable parameters and automatically exposed typed runtime bindings. Exposed controls support numeric lifecycle and loop tracks. Scalars use fill.parameters.NAME or strokePaint.parameters.NAME; vec2 uses .x/.y, colors .r/.g/.b/.a. Integer/toggle keys hold until the next key (toggle values0/1). Only keyed channels override data; unkeyed channels retain data/defaults.',
    verification:
      'Inspect shaderPaintInspections.fill and shaderPaintInspections.stroke, then render and certify the exported package in a browser with WebGL2; test representative timestamps and backward seeks.',
  },
};

const WEBCAM_PREVIEW_CAPABILITIES = {
  ui: 'Camera Settings beside Start webcam in Live tag controls and Playout Controls > Background > Webcam, including the shared preview popup. Canvas Layout links to Open Playout Controls.',
  activation:
    'Opening settings does not start capture or request camera permission. Start webcam is the explicit permission and capture action; MCP does not activate or configure the local camera.',
  capture:
    'Requested resolution and FPS are session preferences. Save settings before Start stores them without capture; Apply while running uses constraints on the existing shared video track. Actual resolution and FPS are read back from the track and can differ from requested values. A shared or busy camera may restrict switching to a larger capture format.',
  nativeConstraints:
    'Apply serializes resolution/FPS constraints before image-control constraints on the same track. Actual values come from getSettings(); getConstraints() describes requests and is not proof of camera output. If a later phase fails, attempt to restore prior capture/image settings and report current actual values and any restoration error.',
  imageControls:
    'Show only image controls advertised by this browser and camera, using their supported ranges and modes. Exposure time, focus distance and color temperature require the matching manual mode when that mode control is advertised. Missing capabilities do not imply support; basic resolution/FPS preferences remain available.',
  sharedStream:
    'Live tags and the Webcam presentation background share one local camera stream. The editor and independent Studio previews share the presentation capture session; settings affect all active consumers. Stopping one consumer leaves other active consumers running.',
  previewOutput:
    'Single-template and combined previews render the webcam once beneath the graphic output, including embedded, fullscreen and detached windows. Sync editor and preview uses the editor mirror and must not add a second webcam layer. Authored opaque composition backgrounds or full-frame objects cover the camera; use transparent output where it should show.',
  lifecycle:
    'Presentation capture persists across template switches within the same set and Take, Update, Out or Clear. Explicit Stop background webcam or switching away from Webcam releases the presentation consumer while an active Live tag may retain the track. Opening an unrelated document/set or the capture owner pagehide stops all camera capture. Opening settings, restoring Webcam mode or opening a preview never requests permission or starts capture.',
  failure:
    'Rejected constraints keep the active stream and last accepted preferences; show the error and current actual values. Stop and camera switches invalidate stale settings results.',
  reset:
    'Reset clears requested resolution/FPS and restores readable image-control values captured when the current stream started. It is not a camera factory reset. Switching cameras keeps resolution/FPS preferences and clears camera-specific image preferences.',
  persistence:
    'Presentation mode and still-image preferences persist locally in IndexedDB, outside projects, .ogs, exports and workspace presets. Camera selection, capture settings and footage remain session-only; restoring Webcam mode never starts capture. Exported live tags still require the target renderer source hook.',
};

const MEDIA_PAINT_CAPABILITIES = {
  type: 'media',
  authoring:
    'Use add_media_cue/update_media_cue and cue.visual.targetLayerId for cue-driven media. A chart with mark-paint-v1 may also use an ordinary element.fill MediaPaint.',
  semantics:
    'A video/live source is clipped by the target geometry. Chart fills use provider-supplied mark coverage, preserving axes, text, outlines and labels. Audio stays on the nonvisual cue track; paint stays muted.',
  shape:
    '{type:"media",source:{kind:"clip",src}|{kind:"live",tag,fallback?},fit:"cover"|"contain"|"fill",positionX:0..1,positionY:0..1,loop:boolean,speed:0.1..16,offsetMs:nonnegative,trimEndMs:null|greater-than-offset,timelineStartMs:nonnegative,muted:true}',
  assetImport:
    'Import MP4/WebM or MP3/WAV/OGG through Resources > Media or ograf_import_asset. Paint clip sources must reference video media; audio stays on cues. Use asset:<id> for imported clips or fallback images.',
  timing:
    'Media Cue owns cue-driven trigger/retrigger/source transition and audio. Direct paint uses its existing trim/loop/speed/timeline fields. Media paint remains real-time-only; live source readiness and ZeroDensityHTML requirements are unchanged.',
  liveTag: {
    element: 'zd-ograf-media',
    version: 1,
    sourceAttribute: 'data-source-tag',
    manifestEngineRequirement: 'ZeroDensityHTML >= 1.0',
    webcamPreview: WEBCAM_PREVIEW_CAPABILITIES,
  },
};

const CAPABILITY_SECTIONS = [
  'elements',
  'shaders',
  'tiling',
  'easing',
  'semantics',
  'designSystem',
  'loops',
  'bindings',
  'plugins',
  'templateSets',
  'editor',
] as const;

type CapabilitySection = (typeof CAPABILITY_SECTIONS)[number];

const CAPABILITY_SECTION_KEYS: Record<CapabilitySection, readonly string[]> = {
  templateSets: ['templateSets'],
  shaders: ['paintSchemas', 'animatablePropertyPatterns'],
  tiling: ['tiling'],
  elements: [
    'elementTypes',
    'elementSchemas',
    'paintSchemas',
    'animatableProperties',
    'animatablePropertyPatterns',
    'layerMotion',
    'blendModes',
    'masking',
    'tiling',
    'composableEffects',
    'modifiers',
    'mediaCues',
    'cropping',
  ],
  easing: ['easingPresets', 'layerMotion'],
  semantics: ['semantics', 'semanticAuthoring'],
  designSystem: ['designSystem', 'assets', 'reusableComponents'],
  loops: ['loopAnimation', 'composableEffects'],
  bindings: ['bindings'],
  plugins: ['rendererPlugins', 'animationPresetPlugins', 'shaderPacks'],
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

function requireOriginalPromptForFirstArtwork(
  snapshot: { project: Project; revision: number },
  expectedRevision: number,
  operations: readonly AuthoringOperation[],
): void {
  const { project, revision } = snapshot;
  if (revision !== expectedRevision || project.authoringPrompts?.length) return;
  const startsArtwork = operations.some(
    ({ type }) =>
      type === 'add_layer' || type === 'instantiate_component' || type.startsWith('create_'),
  );
  if (
    !startsArtwork ||
    project.compositions.some((item) => item.layers.some((layer) => !layer.isGuide))
  )
    return;
  const recordsPrompt = operations.some(
    (operation) => operation.type === 'set_project_metadata' && operation.authoringPrompt,
  );
  if (!recordsPrompt)
    throw new Error(
      'This blank template needs its original prompt. Include a set_project_metadata operation with authoringPrompt: { id, text } using the exact user creation request, then retry the batch.',
    );
}

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
      title: 'Apply OGraf operations',
      description:
        'Atomic apply, dry-run, preview, or Accept/Reject proposal. When building in a blank template with no saved prompt, include set_project_metadata.authoringPrompt with the original user request in the first layer or recipe batch.',
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
        render: 'frame',
        ...(input.compositionId ? { compositionId: input.compositionId } : {}),
        ...(input.frame !== undefined ? { frame: input.frame } : {}),
        ...(input.frames ? { frames: input.frames } : {}),
        columns: input.columns,
        maxDimension: Math.min(input.maxDimension ?? 900, 1024),
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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
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

async function certifiedArtifacts(
  workspace: AuthoringWorkspacePort,
  bridge: EditorBridgePort,
  sessionId: string,
  profileId?: ExportProfileMode,
  includeThumbnail = false,
  thumbnailFrame?: number | null,
): Promise<{
  artifacts: ExportArtifacts;
  certification: Awaited<ReturnType<EditorBridgePort['certify']>>;
  thumbnailFrame?: number;
}> {
  const project = workspace.get(sessionId).snapshot().project;
  if (thumbnailFrame !== undefined) {
    if (thumbnailFrame !== null && thumbnailFrame > getTotalFrames(mainComposition(project)))
      throw new Error('Thumbnail frame is beyond the end of the template.');
    project.thumbnailFrame = thumbnailFrame;
  }
  let artifacts = buildExportArtifactsWithRuntime(
    project,
    mainComposition(project),
    await runtimeSource(),
    profileId ? getExportProfile(profileId) : undefined,
  );
  const staticErrors = [...artifacts.errors, ...validatePackageLayout(artifacts)];
  if (staticErrors.length > 0) {
    throw new Error(`OGraf certification failed:\n${staticErrors.join('\n')}`);
  }
  if (includeThumbnail) {
    const thumbnail = await bridge.capture({
      target: 'composition',
      project: thumbnailRenderProject(project),
      compositionId: project.mainCompositionId,
      frame: projectThumbnailFrame(project),
      maxDimension: THUMBNAIL_MAX_DIMENSION,
      matte: 'transparent',
    });
    artifacts = withExportThumbnail(artifacts, project, thumbnail.data);
    const errors = [...artifacts.errors, ...validatePackageLayout(artifacts)];
    if (errors.length) throw new Error(`OGraf certification failed:\n${errors.join('\n')}`);
  }
  const certification = await bridge.certify(artifacts);
  if (!certification.valid) {
    throw new Error(`OGraf certification failed:\n${certification.errors.join('\n')}`);
  }
  return {
    artifacts,
    certification,
    ...(includeThumbnail ? { thumbnailFrame: projectThumbnailFrame(project) } : {}),
  };
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
    mediaCues: structuredClone(composition.mediaCues ?? []),
    functions: structuredClone(composition.functions ?? []),
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
      ...(getElementShaderPaint(layer.element)
        ? { shaderInspection: inspectShaderElement(getElementShaderPaint(layer.element)!) }
        : {}),
      shaderAnimationProperties: getShaderAnimatableProperties(layer.element).map((property) => ({
        property,
        ...shaderAnimationPropertySpec(layer.element, property),
      })),
      ...(hasElementShaderPaint(layer.element)
        ? {
            shaderPaintInspections: Object.fromEntries(
              getElementShaderPaints(layer.element).map(({ slot, paint }) => [
                slot,
                inspectShaderElement(paint),
              ]),
            ),
          }
        : {}),
      modifiers: getLayerModifiers(layer),
      modifierAnimationProperties: numericModifierProperties(layer),
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
      autoLayout: layer.autoLayout,
      visualRules: layer.visualRules,
      updateTransition: layer.updateTransition,
      motionPath: layer.motionPath,
      textPath: layer.textPath ?? null,
      motionBlur: layer.motionBlur ?? null,
      semantics: layer.semantics,
      designTokenBindings: layer.designTokenBindings,
      componentLink: componentLinkSummary(layer.componentLink),
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
      scope: component.scope ?? 'local',
      layerCount: component.layers.length,
      fieldCount: component.dataFields.length,
      sourceLayers: component.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        kind: layer.element.type,
      })),
      sourceFields: component.dataFields.map((field) => ({
        id: field.id,
        key: field.key,
        type: field.type,
      })),
      assetCount: component.resources?.length ?? 0,
      patternCount: component.patterns?.length ?? 0,
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
  'dataConnections',
  'testRundowns',
  'review',
  'transitions',
  'layout',
  'patterns',
  'shaders',
  'plugins',
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
      if (sections.has('plugins')) {
        projectedComposition.rendererPlugins = (composition.rendererPlugins ?? []).map(
          (snapshot) => ({
            manifest: snapshot.manifest,
            sha256: snapshot.sha256,
            sourceBytes: Buffer.byteLength(snapshot.source, 'utf8'),
            licenseBytes: Buffer.byteLength(snapshot.licenseText, 'utf8'),
          }),
        );
        projectedComposition.animationPresetPlugins = (
          composition.animationPresetPlugins ?? []
        ).map((snapshot) => ({
          manifest: snapshot.manifest,
          sha256: snapshot.sha256,
          presets: snapshot.presets.map((preset) => ({
            id: preset.id,
            name: preset.name,
            description: preset.description,
            targetKinds: preset.targetKinds,
            parameters: preset.parameters,
            sides: Object.keys(preset.tracks),
          })),
          licenseBytes: Buffer.byteLength(snapshot.licenseText, 'utf8'),
        }));
      }
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
            projectedLayer.autoLayout = layer.autoLayout;
            projectedLayer.motionBlur = layer.motionBlur ?? null;
            projectedLayer.textPath = layer.textPath ?? null;
            projectedLayer.semantics = layer.semantics;
            projectedLayer.designTokenBindings = layer.designTokenBindings;
            projectedLayer.componentLink = componentLinkSummary(layer.componentLink);
            projectedLayer.bindings = layer.bindings;
            projectedLayer.binding = layer.bindings[0] ?? null;
            projectedLayer.animationPresets = layer.animationPresets;
            projectedLayer.animationTrackMode = layer.animationTrackMode;
          }
          if (sections.has('elements')) {
            projectedLayer.element = layer.element;
            projectedLayer.effects = layer.effects;
            projectedLayer.modifiers = layer.modifiers ?? [];
          }
          if (sections.has('tracks') && tracksMode !== 'none') {
            projectedLayer.animationTrackMode = layer.animationTrackMode;
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
        projectedComposition.functions = composition.functions ?? [];
        projectedComposition.dataFields = composition.dataFields;
        projectedComposition.nodosInputFieldIds = composition.nodosInputFieldIds;
        projectedComposition.runtimeCollections = composition.runtimeCollections;
      }
      if (sections.has('dataConnections')) {
        projectedComposition.dataConnections = composition.dataConnections;
      }
      if (sections.has('testRundowns'))
        projectedComposition.testRundowns = composition.testRundowns ?? [];
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
          scope: component.scope ?? 'local',
          layerCount: component.layers.length,
          fieldCount: component.dataFields.length,
          sourceLayers: component.layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            kind: layer.element.type,
          })),
          sourceFields: component.dataFields.map((field) => ({
            id: field.id,
            key: field.key,
            type: field.type,
          })),
        }));
      }
      return projectedComposition;
    }),
  };
  if (sections.has('shaders')) projectedProject.shaders = project.shaders;
  if (sections.has('review'))
    projectedProject.review = project.review
      ? {
          comments: project.review.comments,
          versions: project.review.versions.map(({ snapshot: _snapshot, ...metadata }) => metadata),
          approval: project.review.approval ?? null,
        }
      : { comments: [], versions: [], approval: null };
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
        'modifier',
        'media-cue',
        'data-connection',
        'review-comment',
        'review-version',
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
    if (generated.kind === 'review-comment' || generated.kind === 'review-version') return [base];
    if (generated.kind === 'modifier') {
      const layer = project.compositions
        .flatMap((composition) => composition.layers)
        .find((candidate) =>
          getLayerModifiers(candidate).some((entry) => entry.id === generated.id),
        );
      const modifier = layer && getLayerModifiers(layer).find((entry) => entry.id === generated.id);
      return [
        {
          ...base,
          layerId: layer?.id,
          name: modifier?.name,
          properties: layer
            ? numericModifierProperties({ modifiers: modifier ? [modifier] : [] })
            : [],
        },
      ];
    }
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
    if (generated.kind === 'data-connection') {
      const connection = project.compositions
        .flatMap((composition) => composition.dataConnections ?? [])
        .find((candidate) => candidate.id === generated.id);
      return [
        { ...base, connectionId: generated.id, ...(connection ? { name: connection.name } : {}) },
      ];
    }
    if (generated.kind === 'asset') {
      const asset = project.compositions
        .flatMap((composition) => composition.assets)
        .find((candidate) => candidate.id === generated.id);
      return [{ ...base, ...(asset ? { name: asset.name, mimeType: asset.mimeType } : {}) }];
    }
    if (generated.kind === 'media-cue') {
      const cue = project.compositions
        .flatMap((composition) => composition.mediaCues)
        .find((candidate) => candidate.id === generated.id);
      return [{ ...base, ...(cue ? { name: cue.name } : {}) }];
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

/** Compact scene reads expose inheritance controls without repeating cached layer snapshots. */
function componentLinkSummary(link: Composition['layers'][number]['componentLink']) {
  if (!link) return null;
  return {
    componentId: link.componentId,
    instanceId: link.instanceId,
    sourceLayerId: link.sourceLayerId,
    overridePaths: link.overridePaths ?? [],
    fieldIds: link.fieldIds ?? {},
    fieldOverridePaths: link.fieldOverridePaths ?? {},
    ...(link.offset ? { offset: link.offset } : {}),
  };
}

function wildcardNameMatcher(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function reserveComponentInstanceIdentity(definition: Composition['components'][number]) {
  const fieldIds: Record<string, string> = {};
  const reserveField = (field: Composition['dataFields'][number]) => {
    fieldIds[field.id] ??= createId('field');
    for (const property of field.properties) reserveField(property);
    if (field.items) reserveField(field.items);
  };
  for (const field of definition.dataFields) reserveField(field);
  return {
    instanceId: createId('component-instance'),
    groupId: createId('group'),
    layerIds: Object.fromEntries(definition.layers.map((layer) => [layer.id, createId('layer')])),
    fieldIds,
    keyIds: Object.fromEntries(
      definition.layers.map((layer) => {
        const keys: Record<string, string> = {};
        for (const key of layer.keyframes) keys[key.id] ??= createId('layer-key');
        const tracks = getResolvedLayerAnimationTracks(layer);
        for (const track of Object.values(tracks))
          for (const key of track ?? []) keys[key.id] ??= createId('property-key');
        for (const property of [
          'x',
          'y',
          'width',
          'height',
          'rotation',
          'opacity',
          'transformOriginX',
          'transformOriginY',
        ] as const)
          for (const key of tracks[property] ?? [])
            if (!layer.keyframes.some((pose) => pose.frame === key.frame))
              keys[`__aggregate:${key.frame}`] ??= createId('layer-key');
        if (layer.loop) {
          keys[layer.loop.id] ??= createId('layer-loop');
          for (const track of Object.values(layer.loop.tracks))
            for (const key of track ?? []) keys[key.id] ??= createId('loop-property-key');
        }
        for (const rule of layer.visualRules ?? []) keys[rule.id] ??= createId('visual-rule');
        for (const cue of definition.context?.mediaCues ?? [])
          keys[`__cue:${cue.id}`] ??= createId('media-cue');
        return [layer.id, keys];
      }),
    ),
  };
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

    if (operation.type === 'add_review_comment' || operation.type === 'save_review_version') {
      operation.id ??= createId(operation.type === 'add_review_comment' ? 'comment' : 'version');
      operation.createdAt = new Date().toISOString();
    }
    if (operation.type === 'set_review_approval') operation.at = new Date().toISOString();

    if (
      [
        'create_lower_third',
        'create_bug',
        'create_ticker',
        'create_scoreboard',
        'create_clock',
        'create_countdown',
        'create_repeater',
      ].includes(String(operation.type))
    ) {
      // Recipes create a graph of layers, fields, keys and groups. Reserve a unique seed
      // so selectors resolved against this projection target the identical final graph.
      operation.identitySeed = createId('recipe');
      if (operation.type === 'create_clock' || operation.type === 'create_countdown')
        operation.referenceTimeMs = Date.now();
    }

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
    if (operation.type === 'add_modifier' || operation.type === 'duplicate_modifier')
      operation.id = createId('modifier');
    if (operation.type === 'add_layer') {
      operation.id = createId('layer');
      const element = (operation.element ?? {}) as Record<string, unknown>;
      if (operation.kind === 'clock' || element.clock) {
        operation.element = {
          ...element,
          clock: {
            referenceTimeMs: Date.now(),
            ...(element.clock as Record<string, unknown> | undefined),
          },
        };
      }
    }
    if (operation.type === 'add_media_cue') {
      const cue = operation.cue as Record<string, unknown>;
      if (!cue.id) cue.id = createId('media-cue');
    }
    if (operation.type === 'add_data_field') operation.id = createId('field');
    if (operation.type === 'add_data_connection') operation.id = createId('data-connection');
    if (operation.type === 'create_timeline_group') operation.id = createId('timeline-group');
    if (operation.type === 'group_layers') operation.id = createId('group');
    if (operation.type === 'save_component') operation.id = createId('component');
    if (operation.type === 'make_component_unique') operation.id = createId('component');
    if (operation.type === 'instantiate_component') {
      const definition = composition.components.find(
        (component) => component.id === operation.componentId,
      );
      if (!definition)
        throw new Error(`Operation ${index}: component not found: ${operation.componentId}`);
      const identity = reserveComponentInstanceIdentity(definition);
      if (operation.instanceId !== undefined) {
        if (operation.linked === false)
          throw new Error(`Operation ${index}: instanceId requires linked:true.`);
        const instanceId = operation.instanceId;
        if (
          typeof instanceId !== 'string' ||
          instanceId.length > 256 ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(instanceId) ||
          ['__proto__', 'constructor', 'prototype'].includes(instanceId)
        )
          throw new Error(`Operation ${index}: use a safe component instance ID.`);
        if (composition.layers.some((layer) => layer.componentLink?.instanceId === instanceId))
          throw new Error(
            `Operation ${index}: component instance already exists in this composition: ${instanceId}`,
          );
        identity.instanceId = instanceId;
        delete operation.instanceId;
      }
      operation.identity = identity;
    }
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

    if (operation.type === 'update_element') {
      const patch = operation.patch as Record<string, unknown>;
      const layer = composition.layers.find((candidate) => candidate.id === operation.layerId);
      if (patch.clock && layer?.element.type === 'text' && !layer.element.clock) {
        patch.clock = { referenceTimeMs: Date.now(), ...(patch.clock as Record<string, unknown>) };
      }
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
  { inApp = false }: { inApp?: boolean } = {},
): AgentToolRecord[] {
  const exportCoordinated = coordinatedExportFile(workspace, bridge);
  const records: AgentToolRecord[] = [];
  const server: ToolRegistrar = {
    registerTool(name, config, handler) {
      records.push({
        name,
        config: config as AgentToolConfig,
        handler: async (args) => {
          try {
            return await (handler as unknown as AgentToolHandler)(args);
          } catch (cause) {
            // Only pre-admission readiness failures have an explicit retry contract.
            // Execution failures and uncertain command outcomes keep their original handling.
            if (
              cause instanceof Error &&
              'code' in cause &&
              cause.code === 'EDITOR_NOT_READY' &&
              'admitted' in cause &&
              cause.admitted === false
            ) {
              const error = cause as unknown as Error & {
                code: string;
                operation: string;
                health: unknown;
                retryAfterMs: number;
              };
              return {
                isError: true,
                content: [{ type: 'text', text: error.message }],
                structuredContent: {
                  error: {
                    code: error.code,
                    message: error.message,
                    operation: error.operation,
                    retryable: true,
                    admitted: false,
                    retryAfterMs: error.retryAfterMs,
                    health: error.health,
                  },
                },
              };
            }
            throw cause;
          }
        },
      });
    },
  };

  server.registerTool(
    'ograf_get_capabilities',
    {
      title: 'Get OGraf authoring capabilities',
      description: 'Discover section contracts and editor readiness.',
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
          'ograf_get_template_set',
          'ograf_update_template_set',
          'ograf_save_template_set',
          'ograf_export_coordinated_package',
          'ograf_get_playout',
          'ograf_control_playout',
          'ograf_capture',
          'ograf_render_strip',
          'ograf_apply_operations when mode=preview or mode=propose',
          'ograf_measure_text',
          'ograf_certify_project',
          'ograf_save_project',
          'ograf_export_package',
          'ograf_validate_project when browserTextOverflow=true',
        ],
        templateSets: {
          available: bridge.health.templateSetsReady === true,
          read: 'ograf_get_template_set',
          update: 'ograf_update_template_set',
          save: 'ograf_save_template_set',
          format: '.ogs',
          legacyFormat: '.ogp',
          storage: {
            defaultArchiveMode: 'compact',
            archiveSchemaVersion: 6,
            compatibleArchiveSchemaVersion: 5,
            contract:
              'Compact set archives store identical font/resource bytes and set component sources once, with validated member references. Opening hydrates ordinary editable projects with original IDs, bindings, animation and overrides. Compatible mode retains the v5 archive layout for older set readers. Readers retain v1–v5 and legacy .ogp support; JSON-only readers cannot open any set ZIP. Single-template saves/exports always embed resolved dependencies and never contain compact archive references.',
            mcpSave:
              'ograf_save_template_set saves a revision-checked snapshot copy of the connected editor set to a workspace-confined .ogs path. archiveMode compact (default) or compatible; confirm:true and explicit overwrite permission. Compressed MCP transfer limit 64 MiB; larger sets use Studio Save Template Set. Saving preserves open editor names, revisions and unsaved edits.',
          },
          sharedResources: {
            ui: 'Resources offers Template and Template Set views in a set. Template Set shows shared components, asset slots, per-template usage and inheritance/local override indicators; the existing Scene Outliner shared controls and asset slots editor remains available. Replacing a shared asset is reviewed in Studio before applying, including other slots using the same source.',
            model:
              'Asset slots explicitly link compatible template assets to a set-level source. Inherited bindings resolve the shared source; local bindings retain the template fallback. A slot currently maps at most one asset per template. Shared components have their own source and instance overrides. Compact storage deduplication alone does not create an editable shared link.',
            mcp: 'Read assetSlots, bindings and asset metadata from ograf_get_template_set; data URI payloads are omitted. Optional resourceUsage {slotIds?,componentIds?} returns bounded per-template usage for the selected template page plus shared-source slot impact counts and related-reference flags; inspect all pages for a complete set. Related references require review and do not imply all will change. With the returned set revision, bind_asset links or unlinks a template asset and set_asset_slot_source selects an existing set asset or fallback. Creating a slot, importing or replacing its file, and changing a slot binding inheritance remain Studio UI operations. The replacement impact review is a Studio UI flow, not a new MCP mutation. Resolve templates before standalone or coordinated export; published packages remain snapshots.',
          },
          tutorialWebPlayer: {
            module: 'packages/ograf-web-player/ograf-player.js',
            demo: 'packages/ograf-web-player/demo.html',
            contract:
              'The reusable browser module mounts a hosted, extracted OGraf package by manifest URL; it does not open .ogs sources, extract ZIPs or require Studio at playback. Use mountOGrafGraphic, then its play/next/stop/update/action/dispose methods. A coordinated export is one OGraf graphic; discover lane commands from its declared customActions and schema. Same-origin manifest/main is the default; cross-origin loading is explicit and needs CORS. Packages execute JavaScript and must be trusted or hosted in a separately isolated origin; this module is not a sandbox. Browser WebGL, media permissions and external-data policy still apply. This is a website integration module, not an MCP playback tool.',
            offlinePreview:
              'Standalone HTML is a separate export for single templates and coordinated sets. Choose Standalone HTML in Studio or an .html path in MCP. Open the file directly in a browser; it embeds the certified graphic, manifest, assets and authoring prompt metadata. OGraf ZIP is a separate package. Playout controls dock beside the fitted graphic; off-air edits stage until Take. Preview settings include local backgrounds and EBU R95 guides. Browser permissions, WebGL, audio and external live feeds can limit offline operation. Test the HTML in the target browser.',
          },
          transitionLogic: {
            definitionVersion: TRANSITION_LOGIC_VERSION,
            readableDefinitionVersions: [1, 2, 3, 4, 5, 6],
            slotUpdateMode: {
              minimumDefinitionVersion: 6,
              field: 'slot.updateMode',
              values: ['transition', 'in-place'],
              contract:
                'Studio labels it When its content changes. Omitted or transition mounts the template again and plays the lane update recipe. in-place keeps the mounted template for updateAction, same-state transition.take and Rule Update: no second host or WebGL context, unchanged layers stay at full alpha, and requestId stays the same, so detect updates by comparing data. Changed layers use layer updateTransition, then composition updateTransitionFrames, then the update recipe durationFrames. One data change, and its data Rules, happen when the slowest changed layer has left. A plain image source is staged first and a failed image returns an error with the old image on air. Other resources (video, Lottie, sequence, audio, shader source, image with a fill) use the normal Take. A state change, an Off lane, a pending request or a leaving lane also use the normal Take.',
            },
            authoring:
              'ograf_update_template_set operation set_transition_logic accepts a complete definition object or null. Uses the opaque set revision, validates graph/template/component references, and applies one undoable edit. JSON payload is bounded to 1 MiB, 32768 values and 32 levels. Unapplied UI drafts must be Applied or Reverted first. Removing the graph or replacing its ID requires confirm:true; editing the same ID does not. Loaded playout is unchanged until explicitly reloaded.',
            source:
              'Optional transitionLogic in the template-set snapshot. Definition v6 adds slot.updateMode; v5 adds independent incoming/outgoing content animations; v4 adds Take admission and named-state data presets. Definitions v1–v5 remain readable. New selectors require v5 so older runtimes reject unsupported motion. Source archive schema 6 and compatible schema 5 preserve the graph; archive compatibility does not down-convert graph features.',
            contentAnimations: {
              minimumDefinitionVersion: 5,
              fields: ['recipe.incomingAnimation', 'recipe.outgoingAnimation'],
              choices: ['template', 'builtin', 'plugin'],
              scope: 'whole-nonshared-template-content',
              contract:
                'Omit a side to preserve its existing transition style. type:template plays that side of the template authored tracks without an extra wrapper fade. type:builtin takes motion {style,direction?,distance?,easing?}; type:plugin takes exact reference {id,version,sha256}, presetId and numeric parameters from definition.animationPresetPlugins. Recipe incomingFrames/outgoingFrames own duration. Native/plugin overrides move one full-canvas content wrapper without rewriting source tracks or double-playing their entrance/exit. Shared objects retain morph and make-room behavior. Same-instance data updates do not replay these animations. Plugin presets must support that side and rectangle wrappers; catalog pins stay editable and exports bake ordinary tracks without executable plugin dependencies.',
            },
            layoutRules:
              'Optional layoutRules {id,name,slotId,whenSlotId,sharedOffsets}. The owning slot adds numeric x/y/width/height offsets while another slot enters/on-air/exits. Contributions from independent observed lanes add together; releasing one preserves the others. Updates preserve reserved space. Targets require baseline values and cannot create negative combined dimensions.',
            layoutTiming:
              'Recipe layoutPhase {startFrame,durationFrames} requires v3 and nonnegative integer frames within the transition duration. It times observed-slot occupancy for other slots responsive offsets using recipe easing: entry reserves, exit releases, replacements retain. Omit for legacy content-opacity timing. Separate from sharedFrames. Prepare changes no layout; phases start on Take/Out; Clear releases immediately.',
            slotDependencies:
              'Optional slot.parentSlotId is an existing parent slot ID; no self references or cycles. Studio labels it Take out with. Parent Out animates its active descendants Out using their own routes; parent Clear removes descendants immediately. Descendant active/prepared intent resets, while per-state editorial data remains. A parent Take does not revive descendants. A fresh dependent Take while its parent cascade is leaving is rejected. Omit parentSlotId for independent lanes. Drawing order and make-room layout remain separate.',
            slotAdmission: {
              minimumDefinitionVersion: 4,
              field: 'slot.admission',
              fields: ['requireOnSlotIds', 'blockWhileActiveSlotIds'],
              requireOn: 'settled-on',
              blockingPhases: ['preparing', 'entering', 'on', 'leaving'],
              rejectedTakeQueued: false,
              contract:
                'Require On lanes must have finished entering and must not be leaving. Blocking lanes include explicit prepared resources and pending activation intent until fully Off. Individual Take/Prepare reject before changing controls, occupancy or preparation and recheck before entry. They do not activate parents or queue a later revival. Batch Play may sequence explicitly selected parents and children; unselected prerequisites remain an error. Out/Clear remain available. Unknown/self references, repeated IDs, require-On cycles and the same lane required On and Off are invalid. Separate from Take out with; old dependencies keep their meaning.',
            },
            exportStartup: {
              defaults: 'compatible-baseline-in-stable-lane-order',
              dependentLanes: 'off',
              conflictingStates: 'excluded',
              takeSuggestions: 'independent-first-valid-state',
              playPlanning: 'whole-selection-preflight-and-resource-preparation-before-output',
              playTiming:
                'prerequisite-entry-and-blocker-exit-barriers-in-realtime-and-non-realtime',
              loadPreparation:
                'Realtime Load privately prepares only valid selected startup resources while lanes remain Off; no public Prepare, occupancy or activation. First matching Play reuses successful preparation after normal admission. State/data changes and superseding commands invalidate it; failures release it for ordinary Play-time retry. Non-real-time behavior is unchanged.',
              skipAnimation:
                'Skips authored transition waits, while finite resource/render/GPU readiness still applies. Measure both the Devtool detached-element check sequence (Load, unchanged full Update, empty Update, first skipped Play) and the complete visibly mounted multilane export. Await success, capture ready output after timing, and report first Play separately from warm replay. A response-time warning alone is not a frame-drop measurement; no template- or hardware-independent latency bound.',
              textFittingPerformance:
                'Shrink-to-fit retains its minimum-size/degenerate check. When authored size already fits, the fast path avoids repeated DOM layout probes while reproducing the original 16-step numeric result; overflowing text still searches and fit-to-width is unchanged. Preserve font-ready invalidation, glyph coverage/shader masks, Rules, transition/dependency timing and exact-frame readiness. Never bypass readiness or alter checker thresholds to improve a benchmark.',
              skipStageReadiness: 'coherent-frame-per-dependency-stage',
              skipStageOrdering:
                'Realtime skip batch Play shares final presentation for prepared independent lanes in one stage, outside nested Rules dispatch. Preserve each request/ready/advance event; release ordered Rules after stage readiness and check cancellation before the next stage. Direct Take, animated and non-real-time paths are unchanged.',
              rejectedSelection: 'status-550-with-on-air-selections-unchanged',
              supersession: 'newer-playout-commands-cancel-uncommitted-stages',
            },
            preparationCache: {
              scope: 'realtime-pristine-dormant-template-instances-and-shared-probes',
              maximumInstances: 4,
              maximumEstimatedBytes: 67_108_864,
              admission: 'unchanged-take-conditions-and-transition-timing',
              nonRealtime: 'fresh-deterministic-replay-without-instance-cache',
              diagnostics:
                'Optional runtime getPreparationCacheSnapshot() reports cache counts, estimated bytes, hits/misses/evictions, limits and preparation activity. This is not an OGraf lifecycle method or operator state.',
              contract:
                'One bounded pool retains unused prepared template instances and reusable shared resource probes, never previously on-air mutable state. Idle preparation may warm likely alternatives without firing Rules, lifecycle events, timer alarms or occupancy changes. A matching Take adopts a pristine template instance once; unactivated shared probes may return after readiness. Current data, admission, dependencies and authored transition timing still apply. Canonical on-air shared renderers retain their separate lifecycle. Load, disposal and owner-document changes invalidate the pool. Mismatched entries are not adopted; least-recently prepared entries are disposed when space is needed. The memory limit is an estimate, not a browser GPU-memory guarantee. Cache misses follow ordinary preparation and do not alter correctness.',
            },
            statePresets: {
              minimumDefinitionVersion: 4,
              field: 'state.dataDefaults',
              precedenceLowToHigh: [
                'template-defaults',
                'state-defaults',
                'retained-state-data',
                'explicit-data',
              ],
              contract:
                'Named states may share one template while supplying different editorial defaults. Use declared field keys and JSON-safe values, at most 64 KiB/4096 values/16 levels. Export validates field types, nested values and constraints; asset/image presets are packaged and resolved with their template namespace. A state name alone never changes its text or style. Preserve defaults in complete definition updates; caller data overrides only when deliberately supplied.',
            },
            scope:
              'Rules has a searchable list and resizable editor. + New rule creates undoable Rule #N. Target above When changes ownership; explicit action targets remain. Active/Duplicate/Delete live in the list. Then → Playout offers Take/Update/Out/Clear with Lane/Template targets. Window → Transitions authors lanes, matrix moments, styles, timing and make-room behavior. Preview & Export owns playback; Window → Playout Controls shares its transport, lane choices, actions and data in a dockable/detachable pane, including operation of fullscreen on another monitor. Keep the output pane open. Studio Preferences → Workspace & windows → Sync editor and preview mirrors the actual editor output for scrubbing/playback, uses editor test data and transport, and parks independent coordinated playout until disabled. This user preference is outside .ogs and exported OGraf. Canvas Try is an overflow action.',
            behavior:
              'The active transition finishes before the latest pending ready request; Clear is immediate. Preparation failures keep current output. Editor selection is separate from playout state.',
            limits:
              'Rules can issue Take/Update/Out/Clear; transition definitions remain in Transitions or set_transition_logic. Coordinated Rules supports data/change, pointer/entry hover, key-down/key-up, play/first-step/stop/custom-action, local set-data, animated properties and delayed commands. Shader/media Rule side effects and later-step behavior remain unsupported. Playout rules require coordinated set output; standalone exports reject them. Preview snapshots unsaved edits; failed replacement preparation preserves working output and details remain expandable. Only older unapplied drafts need Apply/Discard. Save Template Set writes .ogs; coordinated export certifies exact artifacts. MCP live output loads the applied set separately. ograf_export_coordinated_package exports a certified revision-checked set with operationId recovery; ograf_export_package exports the active composition. Legacy .ogp cannot preserve the coordinator.',
            livePlayout: {
              available: editor.playoutReady === true,
              read: 'ograf_get_playout',
              tickerUpdates:
                'Read-only runtime ticker queue status: policy, pendingCount, updatedCount, addedCount, removedCount, preparingCount and preparation errors. Counts describe source items awaiting their next appearance, not repeated pass copies.',
              control: 'ograf_control_playout',
              operations: [
                'load',
                'prepare',
                'take',
                'update',
                'out',
                'clear',
                'loop',
                'template-action',
                'unload',
              ],
              contract:
                'Read playout for its sessionId, opaque revision, states, per-slot readiness/current/pending/errors. Every command requires that revision and a unique requestId. A repeated requestId is idempotent only for the exact original command; reuse it after an uncertain response, never for a different command. Re-read after conflicts or timeouts; never automatically repeat with a fresh ID. Playout revision is distinct from authoring/set revisions.',
              behavior:
                'Load snapshots the open applied set explicitly. Prepare loads state/data without changing output; Take omitting stateId uses that slot prepared state and rechecks Take conditions. Guard rejection does not queue a Take or activate required lanes. Named-state defaults and retained operator data apply when data is omitted. Update addresses the on-air instance; optional stateId guards its active state. Update mode:"in-place" sends transition.patch without replaying lane transitions, retaining Rules, leaf text effects, scrolling and paused state. Omitted mode or mode:"transition" retains authored update transitions. target:"preview" still accepts Update only, for graphics already taken in Studio controls. Out follows routing; Clear is immediate and may target one slot or all slots. Unload explicitly disposes the session. Commands return admission snapshots; poll read for readiness/completion. Editor selection and on-air state remain independent.',
              payload:
                'JSON-safe data, at most 64 KiB, 4096 values and 16 nested levels. Commands expire before admission after the bridge deadline. Browser must stay connected and responsive.',
            },
            exportControl:
              'Exported data is {slots:{[slotId]:{stateId,data}}}; empty stateId is Off. Standard play/stop control selected states/all slots. Custom actions: transition.take {slotId,stateId,data?}, transition.patch {slotId,stateId?,data}, transition.out {slotId}, transition.clear {slotId?}, template.action {slotId,actionId,data?}, loop.pause/resume/next {slotId,groupId}. transition.patch merges feed values into an existing on-air/entering instance; optional stateId guards it, and Off/leaving targets reject. It preserves transition deadlines, loops and Rules while allowing configured leaf text effects. Standard updateAction and transition.take retain authored update transitions. Labeled GDD selects have matching defaults; allOf if/then narrows stateId to that lane plus Off. Target selects union executable authored actions, generated clock/timer commands or timed loop groups across relevant states; lane lists exclude lanes without targets. Commands/durations are omitted when no targets exist. Runtime validates the current on-air template. Filtering/reset requires a conditional-aware host; other controllers show flat unions and must select matching IDs. Clear defaults to one lane; API omission still clears all. Non-real-time packages accept scheduled actions and goToTime; the operator guide lists IDs. A standard manifest PNG thumbnail is generated before exact-artifact certification.',
            exportLimits:
              'Recipe contentMotion fade/slide/wipe uses first on-air poses; authored samples each template layer lifecycle motion across its incoming/outgoing phase. Independent layoutPhase controls reservation timing, with additive layout rules. Live loops/text/clock effects supported; matching output dimensions/frame rates required. Coordinated Rules supports data/change, pointer/once-per-entry hover, key-down/key-up, play/first-step/stop/custom-action, local set-data, animated properties and delayed commands. Authored template actions, Text FX and generated clock:<encodedLayerId>:start/pause/reset/restart commands use template.action {slotId,actionId,data?} on the active lane. Automatic count-up/down timers use the shared playout clock and deterministic non-real-time event replay; system clocks ignore commands; manual Reset/Restart rearm alarms without replacing the feed. Pointer and keyboard input require real time. Audio/media cues, shader/media Rule side effects, custom-action loop activation and later-step loops are rejected. Preserve .ogs source: coordinated packages cannot be reverse-imported as editable sets.',
          },
          revision:
            'Opaque editor-session token, distinct from numeric project revisions; re-read after conflicts.',
          defaults:
            'Main canvas size/rate/background, render modes, data transitions, guides display, snapping and bounds. Each property can inherit or be explicitly overridden; set_setting_override pins/resets a property independently. Editing inherited controls creates a local override. set_inheritance retains whole-template opt-out. Media/audio retain real-time-only support.',
          brandKit:
            'Optional set-owned master Brand Kit: typed palette/font/number/text tokens with stable IDs and per-template token overrides. set_brand_kit adopts a kit, upsert_brand_token/remove_brand_token manage tokens, set_brand_token_override pins/resets a token. Compatible semantic keys map on explicit adoption, never display names. Object token bindings retain overridden flags for local edits/reset. Shared font files and resolved values are embedded in standalone children; generated CSS is a safe custom-property view, not an external stylesheet runtime dependency.',
          typography: {
            shape:
              'TypographyPreset {id,name,properties:{fontFamily,fontSize,fontWeight,lineHeight,letterSpacing,textAlign,textTransform}}',
            operations:
              'upsert_brand_style/remove_brand_style kind:typography; apply_typography layerIds,presetId (null detaches); reset_typography_property layerId,property; set_brand_style_override templateId,styleId,override.',
            inheritance:
              'Combined presets resolve into native text values. Object typographyBinding.overrides pins individual properties; palette, content, rich runs, layout and tracks remain independent. Runtime data keeps its normal precedence.',
          },
          backgrounds: {
            shape:
              'BackgroundStyle {id,name,paint:Paint}; brandKit.defaultBackgroundStyleId string|null selects the set default. Composition backgroundStyleId/backgroundPaint and backgroundPaintOverridden record the resolved value and local override.',
            operations:
              'upsert_brand_style/remove_brand_style kind:background; set_background_style styleId,asDefault; set_background_paint paint (null removes rich paint); reset_background; set_brand_style_override.',
            rendering:
              'Render-only full-canvas rectangle below authored layers; never a selectable authoring layer. Gradients/shaders reuse native paint clocks. Media backgrounds are muted and real-time-only; live tags require ZeroDensityHTML and an explicitly started local source for webcam preview. Shared imported assets are copied into standalone exports and stored once in set .ogs archives.',
          },
          copies:
            'Independent template/project/composition identities. Same-set copies preserve parent control and shared-asset bindings. Cross-set paste materializes resolved local values.',
          files:
            'UI Open detects standalone JSON or template-set ZIP in .ogs; legacy .ogp/.ogeproj remain readable. Save Template Set writes compact schema 6 .ogs; compatible mode writes schema 5. Export Legacy Template Set (.ogp) flattens component links in a copy. Newer features are not down-converted. MCP project open/save remain standalone JSON; ograf_save_template_set writes a whole-set snapshot copy without file dialogs.',
        },
        cropping: {
          layer:
            'set_layer_crop: crop {x,y,width,height} in normalized layer coordinates (0..1); null resets. All visual layers, including shaders/patterns. coordinateSpace:composition uses canvas pixels at frame; repeat one rectangle across grouped layer IDs.',
          source:
            'update_element.patch.crop for image/image-sequence: normalized fractions, optional positive sourceAspectRatio; fit contain/cover/fill. Media Cue visual.crop uses the same source units.',
          canvas:
            'set_composition.crop: whole canvas pixels, non-empty and inside the authored canvas; null resets. Output dimensions change; authored layer coordinates and animation stay intact.',
        },
        elementTypes: [
          'ticker',
          'rectangle',
          'ellipse',
          'chart',
          'text',
          'image',
          'path',
          'pattern',
          'image-sequence',
          'lottie',
        ],
        paintSchemas: {
          shader: SHADER_PAINT_CAPABILITIES,
          media: MEDIA_PAINT_CAPABILITIES,
        },
        elementSchemas: {
          ticker: {
            authoring:
              'Native mixed-content ticker. add_layer kind:"ticker" and create_ticker use the same ticker element; update_element.patch edits its feed, direction, edge fades and update policy.',
            speedPixelsPerSecond:
              '0..2000; absolute elapsed-time movement, independent of composition FPS; fractional positions preserved.',
            direction:
              'left | right; defaults to left (right-to-left travel). Scroll direction is independent of Unicode text direction; explicitly saved directions are retained.',
            textDirection:
              'auto | ltr | rtl; native browser bidi shaping preserves Arabic/Hebrew and mixed-script text.',
            updatePolicy:
              'next-appearance | immediate; defaults to next-appearance. Visible item copies retain their text, artwork, width, effects and animation until they leave. New content is prepared offscreen; safe insertion/removal preserves travel and the preceding visible gap. Pending updates report items waiting for their next appearance.',
            gap: '0..16384 pixels between prepared items.',
            entryFade:
              '0..16384 pixels, stationary transparent entry mask; follows scroll direction.',
            exitFade:
              '0..16384 pixels, stationary transparent exit mask; follows scroll direction.',
            fadeSoftness: '0..1; fade curve softness.',
            background: 'Optional native Paint behind content; independent of edge fades.',
            items:
              '0..128 entries {id,name?,width:1..16384,height?:1..16384,element,effects?,animation?}. Stable IDs match [-A-Za-z0-9_]{1,100}; explicit widths preserve prepared layout. height defaults to ticker viewport. effects uses the standard LayerEffects stack.',
            itemElements: [
              'text',
              'image',
              'image-sequence',
              'lottie',
              'rectangle',
              'ellipse',
              'path',
              'pattern',
              'shader',
            ],
            itemAnimation:
              '{type:"none"|"fade"|"rise"|"scale",durationMs:0..60000,delayMs:0..60000}; Take animation shares the absolute OGraf content clock and does not restart each time the item enters the viewport.',
            assets:
              'Use normal asset:<id> sources for images/sequence frames; self-contained Lottie JSON and inline ShaderPaint retain native rendering. Nested tickers, chart and audio items are not supported.',
            bounds:
              'Ticker transform owns clipping/masking and ordinary lifecycle transitions; scrolling is independent of outer-layer entrance/exit animation.',
            binding:
              'items binds a complete array or JSON text feed and validates unique stable IDs and widths. items.<itemId>.width/height controls item geometry; items.<itemId>.<childProperty> targets ordinary child controls (for example content, src, fill.parameters.gain). Settings speedPixelsPerSecond, gap, entryFade, exitFade, fadeSoftness, direction, textDirection and updatePolicy are also bindable. Next-appearance snapshots preserve visible copies while additions/removals queue safely.',
            shaderResources:
              'Resources > Shaders includes ticker background, item fill/outline and item effect paints. Edit shader opens the normal shared shader editor; each usage remains independent.',
          },
          chart: {
            renderer: 'Pinned chart renderer plugin (HTML Canvas)',
            provider:
              'Required {id,version,sha256} reference to a matching snapshot in composition.rendererPlugins. Chart creation has no integrated renderer or implicit default.',
            fill: {
              optional: true,
              type: 'Paint',
              supported: ['solid', 'linear', 'radial', 'conic', 'shader', 'media'],
              requiredFeature: 'mark-paint-v1',
              requires: 'Pinned provider declares mark-paint-v1 (Chart.js 1.2.0+).',
              coverage:
                'Provider mark coverage only; native paint does not recolor axes, grid, text, outlines or value labels.',
              frameConsistency:
                'Publish base, mark coverage and foreground from one complete frame. Shader output must match canvas alpha association: premultiply final RGB only after straight-alpha effect math and masking, so zero coverage gives RGBA(0,0,0,0). Check moving marks live/replay/stills, tile boundaries, clear gaps on light/dark mattes, backward/repeated non-real-time seeks and data updates in Studio, standalone and coordinated exports.',
              fallback: 'Omitted fill preserves dataset colors and legacy presentation.gradient.',
              reset:
                'update_element.patch.fill:null removes the override and restores dataset colors.',
              media:
                'Standard MediaPaint clip/live sources; real-time-only with existing readiness, source and engine requirements.',
              trust:
                'Select a reviewed exact provider snapshot; never rewrite or silently upgrade an old provider digest.',
            },
            preset: [
              'bar',
              'horizontal-bar',
              'stacked-bar',
              'line',
              'area',
              'pie',
              'doughnut',
              'radar',
              'polar-area',
            ],
            data: {
              metrics:
                '{ labels: string[], datasets: [{ label, data: number[], backgroundColor, borderColor }] } — legacy independent metrics; totals are not constrained.',
              canonical:
                '{ mode:"counts"|"percentages", rows:[{id,label,value,color?}], seriesLabel?,color? } — 1–100 unique stable IDs; labels and geometry derive from these rows.',
              counts:
                'Finite non-negative counts with positive finite total; share=value/total*100. Preserve full precision; displayed rounding may total 99.99%.',
              percentages:
                'Direct distribution values 0–100 and total 100 within 1e-6. Reject missing/excess totals atomically; never normalize direct percentages.',
              scale: 'Canonical modes use a fixed 0–100 percentage value axis and % ticks.',
            },
            binding: 'Bind data to a textarea GDD field containing validated JSON.',
            fontSize: { type: 'number', default: 28, minimum: 8, maximum: 96 },
            textColor: { type: 'hex-color', default: '#e5e7eb' },
            showLegend: { type: 'boolean', default: false },
            showGrid: { type: 'boolean', default: true },
            presentation: {
              requires:
                'Pinned renderer manifest chartFeatures includes presentation-v1 (Chart.js 1.1.0+); legacy provider bytes and pins remain unchanged.',
              valueAxis:
                '{min?:-1e12..1e12,max?:-1e12..1e12,step?:positive,format?:"number"|"percent",decimals?:integer0..6}; max>min. Canonical data overrides min/max/format to0/100/percent.',
              fontFamily: { type: 'string', maximumLength: 200 },
              fontWeight: { type: 'integer', minimum: 100, maximum: 900 },
              maxBarThickness: { type: 'number', minimum: 1, maximum: 500 },
              valueLabels:
                '{show:boolean,decimals?:integer0..6,suffix?:string<=12}; labels use the sampled plotted value and follow the bar tip.',
              gradient: '{from:"#RRGGBB",to:"#RRGGBB"}; constrained gradient along the value axis.',
            },
            animation: {
              type: ['none', 'grow', 'reveal', 'fade'],
              default: 'grow',
              durationFrames: { type: 'integer', default: 25, minimum: 1, maximum: 1500 },
              delayFrames: { type: 'integer', default: 0, minimum: 0, maximum: 1500 },
              staggerFrames: { type: 'integer', default: 2, minimum: 0, maximum: 100 },
              easing: { type: 'EasingPreset', default: 'cubic-out' },
              curve:
                'Optional {x1,y1,x2,y2}, each 0..1, overrides easing; omit when selecting a named easing.',
              replayOnUpdate: { type: 'boolean', default: true },
              updateMode: {
                values: ['replay', 'morph'],
                default: 'replay',
                requires: 'morph-update-v1',
                description:
                  'Morph changes existing bars from their current sampled geometry without recreating the Chart instance. Stable canonical row IDs preserve identity across reorder.',
              },
            },
            markAnimations: {
              requiredFeature: 'mark-animation-v1',
              requires:
                'Chart.js renderer 1.3.0+; bars, stacked bars, pie, doughnut and polar area.',
              apply:
                'apply_animation_preset with target:chart-marks, side:in|out, pinned reference, presetId, durationFrames, optional delayFrames/staggerFrames/parameters. Each mark moves independently in dataset-major order; axes/grid/legend stay still. In replaces the built-in chart entrance; updates retain their normal behavior. Whole-layer motion is separate.',
              storage:
                'Source pins composition.animationPresetPlugins. Export bakes numeric mark curves; no installed animation pack needed. Timing must fit lifecycle In/Out. Clear with update_element patch.markAnimations:{}.',
            },
            timing:
              'Frame-sampled animation from lifecycle Start; deterministic under OGraf seeks.',
          },
          rectangle: {
            defaultTransform: { width: 200, height: 200, shape: 'square' },
            fill: {
              type: 'paint',
              values: [
                'solid-color-string',
                'linear-gradient',
                'radial-gradient',
                'conic-gradient',
                'shader',
                'media',
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
                'shader',
                'media',
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
            clock: {
              description:
                'Optional generated clock/timer text. Create with add_layer kind:"clock", stored as type:"text"; update via update_element.patch.clock. Null returns to ordinary text. Normal text paint, outline, typography and effects apply. Content/runs bindings are not supported on a generated clock.',
              shape: {
                mode: 'clock | count-up | count-down',
                source: 'automatic | manual; automatic reads the system clock or runs a timer',
                manualValue:
                  'manual fallback: milliseconds number/numeric string; clock HH:mm[:ss[.SSS]] or ISO with Z/offset; timer signed mm:ss or hh:mm:ss[.SSS]',
                format:
                  'hh:mm:ss by default; hh/h, mm/m, ss/s, SSS milliseconds, dd/d days, A/a meridiem; [literal text]',
                hourCycle: '12 | 24 (string)',
                timeZone: 'local | UTC | IANA zone, e.g. Europe/Istanbul',
                padHours: 'boolean; hh leading zero',
                padMinutes: 'boolean; mm leading zero',
                padSeconds: 'boolean; ss leading zero',
                showAmPm: 'boolean; append meridiem in 12-hour clock mode',
                uppercaseAmPm: 'boolean; appended AM/PM casing',
                initialValueMs:
                  'non-negative number; timers start here; new count-down defaults to 60000',
                limitMs: 'optional count-up limit in milliseconds, or null',
                endBehavior: 'stop | continue | loop',
                autoStart: 'boolean; start timers on Take In',
                pauseWhenOffAir: 'boolean; pause timers when taken off air',
                referenceTimeMs:
                  'epoch milliseconds captured for deterministic non-realtime rendering',
                prefix: 'text before the formatted time',
                suffix: 'text after the formatted time',
              },
              playback:
                'Clock uses the system clock in realtime and referenceTimeMs plus sampled time for offline frames. Timers measure elapsed monotonic time; count-down displays rounded-up seconds until zero. Timers retain total hours, or total minutes/seconds when higher units are omitted.',
              manual:
                'Manual source displays the supplied value without advancing. Bind clock.manualValue to a numeric or text field for external data; invalid feeds retain the authored fallback. Switching to automatic ignores but preserves the binding.',
              dataBindable:
                'Bind clock.timeZone, clock.hourCycle, clock.showAmPm, clock.format, clock.initialValueMs or clock.endBehavior to drive them on air; invalid values keep the authored setting. Use valueMap for choices.',
              alarms: {
                operation: 'set_layer_visual_rules',
                trigger: 'timer-alarm',
                configuration: 'rule.timerAlarm: {sourceLayerId,thresholdMs,direction:"up"|"down"}',
                behavior:
                  'Multiple alarm Rules may reference one count-up/count-down clock. Each fires once per run on a raw-value crossing, independently of text formatting. Reset/Restart rearm alarms; Pause/Resume retain fired state. Manual feed jumps are supported; Reset/Restart rearm without replacing the feed value. The Alarms property list and Rules edit the same records. Preserve existing rules when replacing the array.',
              },
              actions:
                'Generated custom action IDs: clock:<encodeURIComponent(layerId)>:start, :pause, :reset, :restart. Start resumes; Pause holds; Reset restores the automatic timer and pauses; Restart restores it and runs. Reset/Restart rearm alarms; manual values stay externally controlled. System clocks ignore commands. Coordinated exports use standard template.action {slotId,actionId} on the active template; offline schedules replay on the shared clock. Do not add duplicate definitions.',
              updateFx:
                'Set textAnimation.replayOnUpdate:true and a non-none textAnimation.type to replay the text effect when the displayed value changes.',
            },
            strokePaint: {
              type: 'shader-or-media-or-omitted',
              description:
                'Independent shader outline on editable text, using strokeWidth and glyph stroke alpha. Omitted uses strokeColor.',
            },
            fill: {
              type: 'paint-or-omitted',
              description:
                'Solid, gradient, shader, or media clipped by glyph alpha; omitted uses color.',
            },
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
            clipMarginX: {
              type: 'number',
              minimum: 0,
              maximum: MAX_TEXT_CLIP_MARGIN,
              default: 0,
              description:
                'Extra composition pixels on both horizontal sides of ordinary text with overflowPolicy:clip.',
            },
            clipMarginY: {
              type: 'number',
              minimum: 0,
              maximum: MAX_TEXT_CLIP_MARGIN,
              default: 0,
              description:
                'Extra composition pixels on both vertical sides of ordinary text with overflowPolicy:clip.',
            },
            autoFit: {
              type: 'enum',
              values: ['auto-size', 'shrink-to-fit', 'fit-to-width', 'squeeze', 'fixed'],
              default: 'auto-size',
            },
            textAnimation: {
              type: 'object',
              description:
                'Deterministic text reveal sampled from the OGraf frame clock. Patch through update_element.patch.textAnimation.',
              shape: {
                type: 'none | typewriter | fade | rise | pop | word-reveal | flip | blur | rotate | stretch | count-up | count-down | roll-up | roll-down',
                split: 'grapheme | word',
                durationFrames: 'positive integer',
                cursor: 'none | bar | block (Typewriter only)',
                cursorBlinkFrames: 'positive integer (Typewriter only)',
                replayOnUpdate: 'boolean',
                customActionId: 'existing custom action id or null',
                countFrom:
                  'number or null for automatic start; counting finishes at the single formatted number in Content',
                countRoll: 'none | up | down; optional digit rolling for count-up/count-down',
                animators:
                  'Array (max 32) of {id,enabled?,unit?,start?,end?,offset?,offsetKeyframes?:[{frame,value}],shape?,easing?,order?,seed?,durationFrames?,properties?}. Unit character|word|line; range 0..1; offset -1..1; shape square|ramp|triangle|round; easing linear|ease-in|ease-out|ease-in-out; order forward|reverse|center-out|random. Properties opacity,x,y,scale,rotation,blur,color,tracking. Color supports solids and gradients with parseable stops, not shader/media; per-glyph gradient repaint can be expensive. Count and roll presets may combine with animators.',
              },
              example: {
                type: 'update_element',
                layerName: 'Headline',
                patch: {
                  textAnimation: {
                    animators: [
                      {
                        id: 'rise',
                        unit: 'character',
                        order: 'random',
                        seed: 42,
                        durationFrames: 25,
                        properties: { y: 25, opacity: 0 },
                      },
                    ],
                  },
                },
              },
            },
          },
          image: {
            fill: { type: 'shader-or-media-or-omitted' },
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
              editor:
                'Blank-canvas clicks keep point editing active and preserve keyboard nudging. Done or Escape exits the mode.',
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
                'shader',
                'media',
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
            fill: { type: 'shader-or-media-or-omitted' },
            frames: {
              type: 'string-array',
              default: [],
              description: 'Ordered image URLs, data URIs, or asset:<id> references.',
            },
            fps: { type: 'number', default: 12, exclusiveMinimum: 0 },
            loop: { type: 'boolean', default: true },
          },
          lottie: {
            fill: {
              type: 'shader-or-media-or-omitted',
              description:
                'Shader paint replaces color through source alpha; omitted preserves original pixels.',
            },
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
          'fill.parameters.NAME / strokePaint.parameters.NAME':
            'Exposed float/int/bool scalar; int/bool hold outgoing values until next key. Bool keys are0/1.',
          'fill.parameters.NAME.CHANNEL / strokePaint.parameters.NAME.CHANNEL':
            'Exposed vector/color channels: vec2 x/y; color r/g/b/a. Ease numeric channels and clamp declared limits. Existing keyframe and loop operations apply. Only keyed channels override data; empty tracks do not override.',

          'effects.ID.PARAM':
            'Stable per-effect numeric target, independent of stack order; add_effect results and inspect_scene return exact property paths.',
          'fill.stops[N].offset':
            'Normalized 0..1 position of gradient stop N (zero-based) on rectangle/ellipse layers. Each stop owns an independent numeric track with incoming easing.',
        },
        easingPresets: [...EASING_PRESETS],
        layerMotion: {
          operation: 'set_layer_motion',
          sides: ['in', 'out'],
          styles: [...LAYER_MOTION_STYLES],
          directions: ['left', 'right', 'up', 'down', 'center'],
          specFields: [
            'style',
            'durationFrames',
            'direction?',
            'distance?',
            'easing?',
            'offsetFrames?',
          ],
          semantics:
            'Bakes an entrance or exit into ordinary keys in the Start-to-first-Step or last-Step-to-End window. Needs a Step; focus needs built-in blur; grow is not for text; center is wipe/grow only; spin turns right (clockwise) or left. offsetFrames ends the motion early, for stagger. null holds the on-air pose. Duration plus offset must fit the window.',
        },
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
            'One layer-local property clip may use lifecycle, Step, or customAction activation. Custom-action clips require finite repeats, apply the payload as a partial data update, and settle afterward. Other clips may repeat infinitely. Phase follows the OGraf timestamp/action schedule; clips never invoke lifecycle actions.',
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
            'create_countdown',
            'create_repeater',
          ],
          recipes: {
            layout:
              'Default starters reserve separate areas: scoreboard top-left; bug, clock and countdown down the right; lower third above the bottom ticker. Explicit placements and Brand Kit values win. Compact labels/scores use fixed shrink-to-fit boxes rather than geometry-hugging Max Text Width. Editable child tracks follow panel translation while retaining wipe clipping, independent motion, Text FX and Rules.',
            materials:
              'New recipe panels use one native animated shader fill: News signal grid, Sports velocity diagonals, Entertainment studio ribbons or Documentary contours. Kit surface/accent colors bind to ink/accent and their generated field defaults; strength/speed stay editable. Applying kits switches untouched built-in motifs across linked sources/instances while preserving real overrides, exposure choices and custom paints. Inherited paint/field baselines stay aligned through repeated kit switches. The reflection lives in this background; new accents use native gradient/glow to limit GPU contexts. Post-process effects remain available for input-image processing. Preserve ticker travel and review continuous motion.',
            typography:
              'News/Sports defaults embed Roboto Condensed variable 100–900 with its license before component creation: 900 headline/display, 600 body/ticker. Existing custom Brand Kit families and same-family project fonts are preserved. No online font dependency; component sources and exports carry the font.',
            lowerThird:
              'Creates an editable lower third with semantic roles, Brand Kit paints, dynamic text, a clipped lifecycle reveal and coordinated motion. Recipes become linked reusable component assets by default; asComponent:false retains independent layers. Entrance/exit keys and component source remain editable.',
            repeater:
              'Materializes a horizontal or vertical data collection as grouped ordinary layers with independent field mappings and semantic item/index tags.',
            bug: 'Creates a linked reusable bug/DOG with an editable identity field, Brand Kit material styling and lifecycle motion.',
            ticker:
              'Creates a native mixed-content ticker with editable label/headline fields. Defaults to right-to-left travel, Next appearance updates and transparent edge fades; visible copies retain their payload/geometry until exit. Supports items, RTL text, images, animations and shaders through the native ticker fields. result.layers.crawl is retained as the ticker layer ID alias; the headline binding targets items.headline.content, not legacy text crawl.',
            scoreboard:
              'Creates a linked two-team scoreboard with constrained score fields, rolling update text effects, Brand Kit paints and editable lifecycle motion.',
            clock:
              'Creates a live system clock or timer with configurable format, time zone, 12/24-hour display and automatic/manual source. count-up/count-down use durationSeconds; alarms creates linked Rules. Explicit legacy content.hours/minutes or fieldKeys.hours/minutes retain the two-field compatibility path. New live recipes expose fieldKeys.value for external manual values.',
            countdown:
              'Creates a native countdown timer with a duration, rolling text updates and editable Rules at five seconds and zero. Start/Pause/Reset/Restart use the existing clock commands; resets/restarts rearm alarms. Change Rule actions normally; coordinated exports retain timer commands and alarms.',
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
          transport:
            'set_layer_loop.timing links groupId, numeric holdFieldId and ordered holdRanges to independent Pause/Resume/Next controls. Only holds stretch; changes keep their authored duration. See loop-controls.md.',
          clock:
            'Layer-local editing timelines share the deterministic composition/OGraf clock; they are not autonomous timers.',
          easing:
            'Each loop property key owns its incoming easing and optional cubic-bezier curve independently.',
        },
        rendererPlugins: {
          apiVersion: 1,
          loadWarnings:
            'On template/set load Studio checks exact chart renderer requirements across all templates, including inactive ones. Blocking missing/disabled/untrusted builds open a mismatch dialog; a persistent Review plugins bar remains until resolved. Trusted compatible replacements require an explicit undoable source update; unfamiliar code still requires review and trust. A working older renderer does not trigger a blocking warning just because an update exists.',
          kinds: ['chart'],
          packageFiles: ['manifest.json', 'renderer.js', 'LICENSE.txt'],
          installation:
            'File > Preferences > OGraf Studio > Plugins manages installation, review, enabled state, removal and new-chart defaults. The Plugins pane browses templates; Add, gear and Manage plugin route to the same preferences page. Imported or unfamiliar saved code requires human Review saved bundle > Trust & Install. MCP cannot install or grant trust.',
          includedWithStudio: {
            ids: [
              'ograf.zd-news-shaders',
              'ograf.zd-news-shaders-2',
              'ograf.broadcast-motion',
              'ograf.chartjs',
            ],
            behavior:
              'The four offline bundles are installed and enabled on fresh profiles; Chart.js is the initial new-chart default. Only exact bundle and snapshot hashes compiled into the application grant included trust. Names or version labels never grant trust. Included versions cannot be removed; disabling and explicit defaults persist. Older installed versions and document pins remain intact. Template Set/Template > Plugins lists exact requirements and usage without automatic migration. Retry loading plugins recovers failed archives while verified packs remain available.',
          },
          components:
            'Top-level author/version/license describe the Studio adapter; optional library metadata describes the upstream engine separately. Declarations are not legal or identity verification. Bundled code contains both; independent vendor-file updates/BYOL are unsupported.',
          updates:
            'Same adapter ID/API/kind required. Review compares adapter/library versions and bytes, warns about downgrades and preset changes, then installs alongside old pins. Use for new charts changes only the default when explicitly chosen; existing templates never auto-upgrade.',
          toolbar:
            'The Plugins toolbar opens the dockable template browser. Select Charts, a provider and exact version to pin a gallery chart independently of the global new-chart default. Its gear or Manage plugin opens Studio Plugins in Settings & Preferences.',
          icons:
            'Optional manifest.icon is an embedded PNG/WebP data URL with matching signature and at most 32 KiB decoded bytes. Remote URLs and executable toolbar UI are unsupported; absent icons use a standard chart glyph.',
          selection:
            'Chart element.provider must be {id,version,sha256} for a renderer snapshot already pinned in composition.rendererPlugins. Missing providers are unconfigured, never a built-in fallback. add_layer and update_element use explicit existing pins; they cannot install or trust code.',
          catalogRemoval:
            'remove_renderer_plugin removes an exact unused composition snapshot by reference {id,version,sha256}. Layers, guides, prototypes and saved component definitions cannot still reference it. This never changes local installation or trust.',
          portability:
            'Templates pin manifest, source and license bytes. Exports keep the selected exact versions; installed updates do not alter prior packages. Studio blocks disabled or untrusted providers before preview, capture and certification.',
          clock:
            'After asynchronous create, provider renderAtFrame/update/dispose are synchronous; core supplies absolute frame timing and animation helpers.',
        },
        animationPresetPlugins: {
          apiVersion: 1,
          kinds: ['animation-presets'],
          packageFiles: ['manifest.json', 'presets.json', 'LICENSE.txt'],
          operation: 'apply_animation_preset',
          catalogRemoval:
            'remove_animation_preset_plugin removes an exact unused source snapshot by reference; refuses references from layers, guides, prototypes and saved components. It never changes local installation or baked tracks.',
          selection:
            'Requires an exact {id,version,sha256} pack already in composition.animationPresetPlugins, presetId, side in/out, durationFrames and optional numeric parameters/offsetFrames. MCP cannot install plugins.',
          behavior:
            'Declarative presets bake supported numeric channels into editable timeline keys; preserve the on-air anchor, loops and keys outside the selected lifecycle window. Duration plus offset must fit; keys that collide after frame rounding reject atomically.',
          safety:
            'No JavaScript, CSS, timers, arbitrary expressions or new renderer code. Only bounded validated JSON keyframes and parameter references are accepted.',
          portability:
            'Source keeps exact preset definitions and last-applied metadata. Export uses ordinary tracks, not an animation plugin engine. Removing or disabling a local pack does not stop already baked animation.',
        },
        shaderPacks: {
          apiVersion: 1,
          kinds: ['shader-pack'],
          packageFiles: ['manifest.json', 'shaders.json', 'LICENSE.txt'],
          targets: ['fill', 'outline', 'effect'],
          installation:
            'File > Preferences > OGraf Studio > Plugins manages shader packs. Both ZD News packs ship enabled with exact build-pinned trust; unfamiliar packs still require human review. GLSL is GPU code, not JavaScript; parsing and review never compile or preview it. MCP cannot install or grant trust.',
          application:
            'The Plugins toolbar gallery applies independent editable ShaderPaint copies or imports a compatible fill preset into Resources > Shaders. Shader controls retain normal #pragma ograf fields, bindings and tracks. Effects reserve iChannel0 for the incoming layer; effect-only presets cannot become fill resources without an image.',
          portability:
            'Copied paints include packProvenance: original exact reference, preset id, pack name and declared notices. This is attribution, not an execution pin or proof edited source still matches the original. Removing/updating the pack never rewrites existing copies. Exports include used shader-pack notices without a plugin engine dependency.',
          mcp: 'Read copied Resources shaders using get_project include:["shaders"], or applied element/effect paints, then use normal update_element/add_effect operations. MCP cannot install or trust a shader pack. No extra channels, multipass, feedback or raw JavaScript are added.',
          preview:
            'Explicit selected-shader preview only after local review/enable; one preview renderer at a time. GPU load and compiler failures remain possible; a source/hash declaration is not a safety guarantee.',
        },
        bindings: {
          operations: ['set_layer_bindings', 'set_layer_binding (legacy single-binding replace)'],
          dataConnections: {
            operations: ['add_data_connection', 'update_data_connection', 'remove_data_connection'],
            read: 'ograf_get_project include:["dataConnections","dataFields"]',
            configuration:
              'Connections belong to a composition and persist in standalone/set .ogs. Map sourcePath strings to existing local field IDs. URL and embedded JSON/CSV remain supported; public-markets uses Coinbase USD spot products plus dated ECB FX references without an API key.',
            targets:
              'editor-preview, coordinated-preview, or both. Omitted targets on older connections retain editor-only behavior. New public-market connections default to both.',
            lifecycle:
              'Enabled connections run at Studio application scope while the panel is closed or preview is fullscreen. Matching sources share requests. Native feed delivery uses in-place transition.patch for active template lanes without Take/Out, whole-lane update fades, source edits or a new runtime; Rules and configured leaf text effects still respond. Paused/transitioning lanes receive the latest values when ready. Explicit authored Update commands and standard updateAction retain transition behavior.',
            threading:
              'Public-market sources use persistent module Workers for fetching and normalization when supported, retaining source caches, freshness timing, cancellation and last-consumer disposal. Unsupported or blocked Worker startup falls back to the same provider. A running Worker failure remains visible and preserves last received output.',
            performance:
              'Feed changes must not recompile an unchanged editor composition or restart loop timing. Unrelated layer bindings and Rule results retain identity. Obscured editor painting yields only in its own document, preserving Sync mode and visible editors on other monitors. Hidden realtime visuals can defer paint only when dependencies permit; Rules, clocks, alarms and reveal/readiness correctness remain active. Settled realtime chart history may be checkpointed with morph/stagger-aware bounds; interrupted chains and non-realtime replay stay intact. Profile repeated live refreshes rather than assuming Worker use removes DOM or chart work.',
            publicMarkets:
              'Optional publicMarkets.symbols contains 1..16 unique Coinbase USD product IDs such as BTC-USD. Quotes use provider timestamps and 24-hour opening reference; triangles/colors follow that comparison. Stable per-symbol PriceValue, ChangeValue, OpenValue, HighValue, LowValue and Available fields support numeric comparisons. changeChartData and per-symbol RangeChartData contain validated chart JSON text for signed 24-hour changes and low/latest/high price levels, never fabricated history. Unavailable observations omit numeric/chart fields. FX is a dated daily reference, never presented as streaming FX. Source errors and stale values remain visible.',
            export:
              'Studio manages connections. Exported OGraf graphics still receive ordinary GDD updates from their controller; exports do not embed Studio polling or credentials.',
          },
          designerEdits:
            'Properties, inline text, update_element and effect edits synchronize the bound default or active mapping while preserving the binding. Nested edits preserve sibling values. Runtime data still overrides authored defaults.',
          semantics:
            'A layer may bind multiple independent content, effect and transform properties. Bindings are applied in order and a target property may appear only once. sourcePath is a segment array for nested object leaves; array paths are item-relative inside a registered runtime collection prototype.',
          transformBindings: {
            targets: [
              'layer.x',
              'layer.y',
              'layer.width',
              'layer.height',
              'layer.rotation',
              'layer.opacity',
            ],
            semantics:
              'Numeric geometry bindings replace sampled animation/loop channels before Rules, layout, modifiers and clipping. layer.opacity is a0..1 multiplier on authored animated opacity, preserving Take/Out fades. Width/height allow zero and reject negatives; all channels require finite numbers. Nested numeric field paths and runtime collection item paths work. Invalid live values fall back to authored sampling rather than poisoning geometry. Transforms remain actual layer poses, not a CSS-only visual adjustment.',
          },
          visualRules: {
            operation: 'set_layer_visual_rules',
            triggers: [
              'data',
              'hover',
              'click',
              'double-click',
              'pointer-enter',
              'pointer-leave',
              'pointer-down',
              'pointer-up',
              'key-down',
              'key-up',
              'play',
              'step',
              'stop',
              'custom-action',
              'timer-alarm',
            ],
            operators: [
              'equals',
              'not-equals',
              'greater-than',
              'greater-or-equal',
              'less-than',
              'less-or-equal',
              'between',
              'contains',
              'not-contains',
              'starts-with',
              'ends-with',
              'one-of',
              'not-one-of',
              'empty',
              'not-empty',
              'changed',
              'increased',
              'decreased',
            ],
            semantics:
              'data and hover rules are states: their show/hide and property actions hold while the conditions (or the pointer) hold and revert afterwards. Every other trigger, and data rules using changed/increased/decreased, is an event whose show/hide/property results persist until a later rule replaces them; a state rule that starts matching takes its properties back. Data rules require fieldId; conditions[] add more comparisons combined by match all/any, and on non-data triggers act as a guard. compareFieldId compares with another field instead of value; equality coerces numbers and booleans. Inside a runtime collection prototype the collection field reads the current row item.',
            timerAlarms:
              'Use trigger:"timer-alarm" and timerAlarm:{sourceLayerId,thresholdMs,direction:"up"|"down"}. The source is a non-guide text clock layer; thresholdMs is finite and nonnegative. Alarm Rule IDs are stable, actions use the ordinary Rules targets and conditions are optional guards. The owner can differ from the timer source. Empty-action alarm drafts are retained for authoring and omitted from executable output. Copies/components remap source references; removing the source prunes its alarm rules.',
            keyboard:
              'Use trigger:"key-down"|"key-up" with keyboard:{key,ctrl?,alt?,shift?,meta?,repeat?}. The key uses DOM event.key (Enter, Escape, Space, ArrowLeft, a); letters match without case, Space/Spacebar/literal space and Esc/Escape are aliases. Modifiers match exactly; omitted flags mean false. Repeated key-down fires only with repeat:true; key-up ignores repeat. IME composition is ignored. Optional data conditions, delays, targets and ordinary actions remain available. Keyboard input is interactive realtime only, not a remote OGraf action or scheduled non-realtime event.',
            mouseOperands: {
              fieldIds: ['$mouse.x', '$mouse.y'],
              units: 'Composition pixels from the top-left corner.',
              behavior:
                'Virtual inputs accepted in primary/extra conditions and compareFieldId with empty sourcePath. Updated by real pointer movement in Preview & Export and interactive packages; never real data fields or GDD controls, never writable by set-data/editorial data. Comparisons are false until pointer coordinates are known and after leaving; changed/increased/decreased require previous and current known positions. Non-real-time schedules have no live mouse.',
            },
            targets:
              'Top-level hostGroupId optionally owns a rule on an editor group; store it once on an editable member. Data/lifecycle evaluation runs once, while pointer/hover scopes include every member. Omit for object ownership. visibility, toggle-visibility and property actions accept targetLayerId or targetGroupId; omit both for the owner object/group. Explicit action targets survive owner changes. A collection prototype target resolves to the same row. Group/component copies remap group references. toggle-visibility needs an event trigger.',
            geometry: {
              properties: ['layer.x', 'layer.y', 'layer.width', 'layer.height'],
              labels: ['Position X', 'Position Y', 'Width', 'Height'],
              units: 'Absolute composition pixels; actual pose geometry, not CSS scaling.',
              legacyAliases: ['x', 'y', 'width', 'height'],
              validation:
                'Finite numeric coordinates; finite nonnegative dimensions. Numeric legacy strings remain readable.',
              precedence:
                'Active rule geometry replaces sampled animation channels. Existing layer.offsetX/layer.offsetY stay additive. Ordinary layout, modifiers, masks and crops consume the resulting pose; explicit coordinated shared-element pins retain priority. Data/hover state output reverts when no longer matching; event output persists until replaced.',
            },
            timing:
              'play fires when the first step is reached, step when a step keyframe is reached (eventId = step keyframe id, omit for any), stop when the graphic starts leaving, custom-action when the named custom actionId runs. delayFrames delays event actions; transitionFrames fades visibility or animates numeric/colour property values. Scheduled events replay deterministically in non-real-time schedules. Pointer and keyboard triggers need interactive real-time HTML playback; use a custom action for remote playout.',
            playout: {
              action:
                '{type:"playout",operation:"take"|"update"|"out"|"clear",slotId,stateId?,data?}',
              targets:
                'Read transitionLogic slots/states from ograf_get_template_set for stable IDs. Every command requires slotId. Take requires stateId in that lane. Update changes only the on-air state; optional stateId is a guard, never a template switch. Out/Clear accept neither stateId nor data. Composition validation checks shape; set validation and coordinated compilation resolve references.',
              data: 'Take without data keeps target retained/default values. Update without data copies effective triggering-template data using known field keys. Explicit {} adds no patch; literal values merge with retained target data. JSON object limit: 64 KiB, 4096 values, depth 16.',
              behavior:
                'Uses existing transition timing, readiness, pending policy, shared-element and make-room phases. Out animates dependent lanes via their own routes; Clear removes them immediately. Both reset descendant activation intent and preserve editorial data; parent Take never revives dependents. State/hover commands fire once on matching entry, without automatic reversal. Event delayFrames can delay commands. Test in Preview & Export, not canvas simulation.',
              output:
                'Enabled playout rules require coordinated set output. Coordinated triggers: data/change, pointer/once-per-entry hover, key-down/key-up, play, first-step step, stop and custom-action. Delayed playout commands, local set-data and animated properties supported. Shader/media side effects and later-step behavior unsupported. Pointer and keyboard input are real-time only.',
            },
          },
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
          gdd: 'Every publicly exposed compiled field emits gddType plus operator description, select labels, file extensions, JSON Schema constraints, recursive object properties, and array item schemas when authored.',
          testRundowns:
            'set_test_rundowns stores named authoring-only rows keyed by stable field ID. They are saved in editable sources and excluded from OGraf manifests and exported runtime packages.',
          review:
            'Local-only review supports add_review_comment, set_review_comment_resolved, save_review_version and set_review_approval. Read include:["review"] for comments and version metadata. Only record an explicitly authorized human approval; review does not imply multi-user sync or cryptographic signing.',
          playoutExposure: {
            property: 'exposeToOgraf',
            default: true,
            operations: ['add_data_field', 'update_data_field', 'update_component_field'],
            ui: 'Data > Expose: searchable tree of current-template controls grouped by scene objects, with nested object properties/array items and exposure checkboxes. Object/group checkboxes show all, none or mixed exposure; clicking mixed exposes all. Bulk changes include collapsed/filtered-out descendants and recursively update properties/items. Effective status accounts for internal parents/items; Data > Fields edits definitions and values.',
            semantics:
              'New and legacy fields are public unless explicitly disabled. true exposes a field; false keeps its default, local authoring controls, bindings and Rules available inside the graphic, but removes it from public OGraf schema and external playout updates. Omitting the flag in an update preserves its current value. Applies recursively to object properties; an internal parent hides its subtree and an explicitly internal item schema makes its array internal. Required only affects publicly exposed schema; it never forces an internal field into playout.',
            authoring:
              'Use exposeToOgraf:false for internal state or shader/effect controls the operator should not receive. get_project retains the complete field definition; revision-checked authoring operations may still change its default or exposure. Individual parent-field toggles retain child choices. For bulk MCP edits, batch the existing field operations and include the intended nested properties/items.',
            coordinatedForms:
              'Mixed per-state exposure uses standard conditional schemas. A conditional-aware controller shows the fields for the selected state; the exported runtime enforces each state policy independently of form support.',
            verification:
              'After save/reopen, check standalone and coordinated public schemas, defaults and README examples omit internal keys while internal descriptor defaults remain. Test public updates, blocked external writes to internal fields, internal Rule/custom-action writes, shader animation and replay in the actual renderer. Partial object updates must preserve omitted internal descendants; vector object-key ordering must not change shader validation, and merged color schemas must retain their GDD pattern.',
          },
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
          functions: {
            operation: 'set_logic_functions',
            version: 1,
            configuration:
              '{type:"javascript",version:1,id,name,enabled,pointer?:boolean,source,inputs:{alias:fieldId},outputs:{alias:fieldId},actions:[customActionId],emits?:{alias:customActionId},media?:{alias:mediaCueId},initialState?,timeoutMs?}',
            source:
              'A synchronous JavaScript function expression (context)=>result, or an IIFE returning it. Context has state,data mapped input aliases,event,nowMs. Events:load,play,out,data,blur,tick,custom-action; pointer-enabled Functions additionally receive focus when interaction returns. No source is evaluated on Studio or renderer main threads; execution is isolated from DOM, project access and network.',
            result:
              '{state?,data?:{outputAlias:value},actions?:[{name:emitAlias,payload?}],media?:[{name:mediaAlias,command:"play"|"restart"|"pause"|"resume"|"stop"|"controls",gain?,muted?}],wakeAt?:number|null}. Omitted state preserves prior state. wakeAt is absolute nowMs time; null cancels; omission preserves a scheduled wake except when tick consumes it. Actions/media require declared aliases; ordinary data bindings and Rules consume output patches.',
            performance:
              'One active invocation and at most one unused prepared Worker per function; executed realms are never reused. Native parsing never evaluates user source and has a separate2s startup limit; background preparation wall-time is not charged to the later authored execution deadline. Stale unused workers are discarded without a retry loop; a consumed stale preparation can be replaced once before user code, within the original request startup deadline. The user expression, function call and result serialization retain the16..1000ms execution limit. Immutable script bytes may be reused; origin/CSP isolation and JSON caps remain unchanged. The16ms wake floor starts at the invocation that explicitly requested the deadline, not after its completion; unrelated events omitting wakeAt keep the existing deadline. Emit only changed output aliases, with complete values for emitted object/array aliases. Keep state and change signatures compact; do not echo static geometry every tick. Measure execution elapsed time, transport latency and visible foreground rendering separately.',
            transport:
              'An opaque-origin trusted supervisor owns the fresh user workers and communicates with the parent over a private MessagePort; the iframe is bootstrap-only. The frame transfers its private ports to its actual owner window, authenticated by frame identity and token, so detached previews do not depend on the calling JavaScript realm. The user worker never receives those ports. The supervisor terminates each child before forwarding a completion, including any queued async work. A delayed parent deadline check can retrieve the retained verified completion without executing source again, or terminates an unfinished invocation; it does not increase the user-code budget. Disposal terminates active and idle children before acknowledgment. Startup and completion-delivery checks are separately bounded.',
            windowVerification:
              'Test standalone realtime Functions in embedded, fullscreen and detached Preview & Export, including initial load in a detached window, detach/dock-back and reopen. Verify custom actions, input, state preservation, blur, Out and cleanup in the current output document. Verify audio separately: clocks advance, mute/gain and pause/resume work, and Out releases players even when they were created in another window or adopted back. Loaded/unmuted audio alone does not prove playback. A supervisor connection failure is a runtime startup fault, not a template calculation timeout; do not repair it by weakening origin checks, raising execution limits or rewriting game state.',
            windowClose:
              'Closing a detached output window synchronously invalidates its pending Function work and pauses owned audio before disposing sandboxes. Returning the pane recreates the runtime from committed state through blur; explicit resume is required. Test this separately from Dock back. Owner shutdown must not become a permanent source failure, and genuine source failures must not be cleared.',
            pointer:
              'Opt in with pointer:true or Functions > Bindings > Mouse input. ctx.pointer is the latest {x,y} in authored composition pixels, accounting for crop and preview scaling, or null outside/on blur/off-air. Only opted-in Functions receive deduplicated on-air focus events after window/surface focus returns; typing remains blurred and focus never automatically resumes gameplay or music. Legacy Functions keep their existing events/tick behavior. Only the graphic surface is tracked; moving the mouse updates a snapshot and never enqueues a function call. Sample it in scheduled ticks/actions; capture-phase click coordinates are available to click-triggered Rules.',
            rendering:
              'Mouse-enabled ticks follow actual output-document frames. Rendering stalls suspend their sandboxes and pause owned media; unfinished output/effects are discarded. After healthy visible frames, recovery uses committed state and delivers blur, deferred Out/Play, latest coalesced data changes and focus. Rebase source time on blur/Out before simulation and require explicit gameplay resume. Nonpointer Functions keep their existing timer scheduling; real execution deadlines remain enforced.',
            references:
              'Create referenced fields/custom actions/media cues first. Each output field has one writer. Inputs and outputs may use the same field. Keep private state/output fields internal to OGraf. Remove or reconfigure functions before deleting their references. All visible objects remain native editable layers.',
            limits:
              'At most8 functions; unique IDs/names; source128KiB UTF8; initialState256KiB finite JSON; safe identifier aliases exclude __proto__/constructor/prototype; timeout16..1000ms (default250). Configuration validation never executes source; runtime reports parse/execution/time-limit errors.',
            export:
              'Version1 supports standalone realtime only. set_logic_functions sets supportsRealTime:true/supportsNonRealTime:false. Coordinated and non-realtime export reject Functions explicitly instead of omitting behavior.',
          },
          gradient:
            'Gradient fields bind the complete rectangle/ellipse/path/pattern fill. Color fields bind fill.stops[N].color for existing zero-based stops, preserving transparency and offsets. strokeColor and dropShadowColor accept colors. Runtime updateAction recolors without restarting motion.',
          brandDefaults:
            'Top-level color fields may set defaultTokenId to a color Brand Kit token ID. Token edits materialize the field default; runtime data overrides it. Set defaultTokenId:null to detach; explicitly editing defaultValue also detaches.',
          effectParameters:
            'Color/number fields may bind effects.ID.PARAM from the effect catalog. Live values override the sampled parameter; updating data does not restart an effect loop.',
          targetProperties: {
            rectangle: [
              'fill',
              'fill.stops[N].color',
              'fill.parameters.NAME',
              'strokeColor',
              'dropShadowColor',
            ],
            ellipse: [
              'fill',
              'fill.stops[N].color',
              'fill.parameters.NAME',
              'strokeColor',
              'dropShadowColor',
            ],
            text: [
              'content',
              'color',
              'fill',
              'fill.parameters.NAME',
              'strokePaint.parameters.NAME',
              'strokeColor',
              'dropShadowColor',
            ],
            image: ['src', 'fill.parameters.NAME', 'dropShadowColor'],
            path: [
              'fill',
              'fill.stops[N].color',
              'fill.parameters.NAME',
              'strokeColor',
              'dropShadowColor',
            ],
            pattern: [
              'fill',
              'fill.stops[N].color',
              'fill.parameters.NAME',
              'strokeColor',
              'dropShadowColor',
            ],
            'image-sequence': ['fill.parameters.NAME', 'dropShadowColor'],
            lottie: ['fill.parameters.NAME', 'dropShadowColor'],
            ticker: [
              'items',
              'speedPixelsPerSecond',
              'gap',
              'entryFade',
              'exitFade',
              'fadeSoftness',
              'direction',
              'textDirection',
              'updatePolicy',
              'items.ID.width',
              'items.ID.height',
              'items.ID.content',
              'items.ID.src',
              'items.ID.fill.parameters.NAME',
              'items.ID.dropShadowColor',
            ],
          },
        },
        editorParity: {
          timelineAuthoring: {
            resetChannel: {
              operation: 'reset_property_animation',
              ui: 'Reset [channel] animation in the selected channel editor; channel name/track/key right-click menus; Properties diamond right-click or Shift+F10 menu.',
              semantics:
                'Clear only the selected main/local-loop channel at an explicit frame, freezing its authored sampled static value. Other channels, bindings, Rules and modifiers remain. Virtual scale/wipe channels return to neutral; shared-lighting-owned channel resets require unlinking first. One Undo restores the reset.',
              timing:
                'Context menu Reset samples the current playhead rather than the clicked frame; Studio uses the displayed phase of an active editor loop. MCP requires frame; optional loopElapsedFrames supplies a held/custom-action loop phase.',
            },
            manualKeys:
              'Explicit property diamonds, key/track/loop insertion and lifecycle Steps do not require Auto-keyframe. The primary key action targets the selected property; Key transform explicitly captures all transform properties.',
            editScope:
              'Properties Edit defaults to At playhead: enabled property tracks record changes at the current time, while static properties remain static unless Auto-keyframe starts their animation. Whole animation explicitly offsets existing values without retiming keys.',
            newLayers:
              'New UI-created layers have one static base pose and independent opt-in property tracks. OGraf lifecycle markers remain separate. animationTrackMode:independent is authoring metadata; exported static channels use ordinary constant tracks. Legacy source tracks remain readable.',
            navigation:
              'Editable Current time accepts seconds, milliseconds, frames and timecode. Plain key selection pauses and seeks; modifier multi-selection stays available.',
            playback:
              'Continuous authoring playback is the default. Stop at Steps is optional playout rehearsal and does not change exported OGraf lifecycle semantics.',
            views:
              'Keys and Graph are exclusive views. Selecting an animated property replaces the keyframe rows with its Graph; Keys returns to keyframe editing, and Graph opens the curve manually. Both views share the ruler, zoom, horizontal scroll, left channel navigator and right Keyframe editor. Frame positions and lifecycle boundaries match Timeline. SVG pointer mapping and axes remain fixed for one drag, with one undoable time/value commit on release. Right-click empty Graph space for Add keyframe here: click X rounds to a whole frame clamped to the timeline, click Y supplies a property-constrained value. Insertion selects the new key without seeking, is one undoable edit, and is disabled for locked layers or an existing key at that frame; it never overwrites. Right-click a graph point or nearby curve for Delete keyframe; without a nearby point, a single visible selected key is used, otherwise Delete is disabled. Shift+F10/ContextMenu on a focused key opens the same menu. Deletion does not seek. Graph and channel selection remain active after deletion, including the last key; returning to Keys is explicit.',
            mcpBoundary:
              'MCP operations retain explicit authored/frame scope and property-track contracts; browser Auto-keyframe and Edit scope do not select a tool mutation scope. Graph last-key deletion does not change the MCP remove_property_key minimum-one-key contract.',
          },
          assistantContext: {
            preferences: 'Settings & Preferences > OGraf Studio > AI assistant',
            scope: 'Studio user preferences; never saved into template source or exports.',
            contract:
              'Automatic model-aware context uses available model metadata or a labelled conservative fallback, with optional user context-window, conversation and tool-page token overrides. Large tool outputs are retained as immutable snapshots and exposed through complete JSON pages, not cut serialized strings. Earlier conversation turns remain retrievable through history references. Estimates retain output/headroom reserves and do not override actual provider limits.',
            paging:
              'ograf_read_result_page reads a retained resultId by path and offset, or explicitly pages a read-only sourceTool/input. Existing MCP tools keep full responses by default. Snapshots are workspace/conversation scoped, retained for up to 30 minutes subject to a 64-entry/128-MiB estimated-memory cache; expiry is explicit and does not authorize repeating a mutation.',
            informationalOnly: true,
          },
          nodosPresetExport: {
            entryPoint: 'File → Preferences → OGraf Studio → Nodos',
            scope: 'selected-templates-of-open-document',
            format: 'Nodos node preset set through the Nodos Editor API',
            profiles: ['realtime', 'dual'],
            directHtmlPlayback:
              'Ordinary single/coordinated exported preview HTML also declares nodos-inputs and connects exposed native data and live textures when loaded directly in a compatible ElectroNode. No preset registration is required. In Nodos it loads and plays transparently without browser preview controls; ordinary browser playback retains those controls. Requires a Real-time or Dual export and existing case-sensitive matching input slots.',
            liveInputRouting:
              'Select one unlocked visual object, then Resources > Media > Use input here beside the webcam controls, or Fill > Live input. Routing writes the object fill with Undo and does not create a playback cue. Start webcam is an explicit local permission action; selecting or routing an input does not start capture.',
            contract:
              'Studio UI keeps ticked templates set as ElectroNode presets in Nodos and updates them as edits pause; the Studio server serves each exact certified OGraf package with nodos.html. Presets contain only URL and Resolution settings. The page declares fields selected in Data → Nodos inputs and live-media texture tags. Older templates retain their public field inputs until the selection is edited. The host matches pre-existing slots by name. Uses effective cropped output dimensions, real-time playback and public defaults. Object/array defaults and incoming values omit internal descendants while internal descriptor values, bindings and Rules remain inside the graphic. URL, Resolution, ShowPreview, Output and Audio are reserved names. No dedicated MCP Nodos export tool or coordinated Nodos controller.',
            targetRequirements:
              'Nodos must run on the same machine as the Studio server, which serves the files while it runs. Protocol and serialization use Nodos Editor SDK 5.1; Studio retains bounded request/cancellation handling. Requires a companion ElectroNode host that reads nodos-inputs declarations, matches names/types to existing slots, forwards native typed values through window.nodos.onData and supplies texture canvases through nodos-input. Process SDK 21.5 supports the typed-data bridge but an SDK version alone does not establish this complete host contract. OGraf certification does not verify Nodos engine, live data or texture changes; test installed targets separately.',
            fieldTypes:
              'Scalars retain their native type; object/gradient use nos.Dict, select-multiple [string], arrays [T]. Arrays of arrays use Dict items wrappers decoded before graphic updates. Data offers eligible engine structs/tables/enums from the current connected engine; saved ordinary field schemas and nodosType remain usable offline. Oversized, recursive, resource, union and dynamic shapes are unavailable. Invalid numeric ranges are rejected, not wrapped; 64-bit integers use the JavaScript safe range.',
            authoringMetadata:
              'add_data_field, nested field inputs and update_data_field preserve known nodosType names with an explicit ordinary schema. Values belong at operation top level. update_data_field nodosType:null clears the assignment; a plain fieldType change clears it unless replaced. These tools do not connect to or discover engine types. nodosType is source metadata, not an OGraf manifest extension or an exposed value.',
            pinSelection:
              'Set exposeToNodos:true on add_data_field or update_data_field to select a public top-level field, or false to deselect it. Omitting it preserves the selection. ograf_get_project with include:["dataFields"] shows nodosInputFieldIds when an explicit selection exists, including an empty array when no data pins are selected.',
            synchronization:
              'Stable template IDs determine new preset classes; existing unique names survive renames and re-selection. Shared controls/assets invalidate selected inactive templates too. Configuration, selection, document or connection changes cancel stale preparation before publication; already dispatched registrations may finish.',
            publication:
              'Files use immutable version URLs. Failed registrations preserve accepted files; uncertain outcomes retain staged files for 60 seconds. Current and previous accepted versions remain protected. Limits: 256 MiB total, 64 MiB/package, 128 versions, eight pending updates. Reject new staging at capacity rather than evict protected graphics. Handshake failures close their stream so later requests reconnect.',
            informationalOnly: true,
          },
          dialogWindows: {
            movement:
              'Studio-owned standalone dialogs move within the current browser window by dragging an empty header area. Header buttons and form controls remain interactive. This covers Settings & Preferences, save/export, resource, plugin details, camera, workspace, keyboard shortcuts and import dialogs.',
            keyboard:
              'Focus the header; arrow keys move 10 pixels and Shift+arrows move 50 pixels. Home or an empty-header double-click restores the initial position. Viewport changes keep moved dialogs reachable.',
            lifetime:
              'Position belongs to the open dialog and resets when it is closed and reopened. It is not template data, Undo history or saved workspace geometry.',
            boundary:
              'Dialogs are movable, not dockable. Existing dockable/detached panes, embedded plugin regions and native operating-system file pickers keep their existing behavior. No authoring operation is created for dialog movement.',
            informationalOnly: true,
            exported: false,
          },
          settingsScopes: {
            window: 'Settings & Preferences',
            search:
              'One settings window; search filters the scope/category list by names and setting keywords. Choosing a category opens its existing controls.',
            entryPoints: {
              filePreferences: { scope: 'studio', section: 'workspace' },
              templateSetGear: { scope: 'template-set', section: 'output' },
              templateContextSettings: { scope: 'template', section: 'output' },
              propertiesSettings: { scope: 'template', section: 'output' },
            },
            scopes: {
              studio: {
                label: 'OGraf Studio',
                sections: ['workspace', 'export', 'assistant', 'plugins', 'nodos'],
                changes: 'immediate-user-preferences',
                storage: 'browser-origin-profile-or-standalone-user-workspace-profile',
                detail:
                  'Workspace and export defaults save automatically for this user. The Export section sets the initial scope and file format. These preferences do not enter .ogs source, template undo history or rendered output.',
              },
              'template-set': {
                label: 'Template Set',
                sections: ['output', 'timing', 'canvas', 'inheritance', 'plugins'],
                changes: 'staged-until-apply-or-ok',
                storage: 'template-set-.ogs',
                detail:
                  'Output, render modes, data transitions, canvas aids/snapping and inheritance edit shared defaults. Apply updates the open set and keeps the window open; OK applies and closes. Save the .ogs file to persist them. Per-property overrides and whole-template inheritance choices remain explicit; local guides and animation identities stay with each template.',
                mcp: {
                  tool: 'ograf_update_template_set',
                  operations: ['set_defaults', 'set_inheritance', 'set_setting_override'],
                  concurrency:
                    'Use the current opaque set revision; re-read after conflicts or uncertain responses.',
                },
              },
              template: {
                label: 'Template',
                sections: ['output', 'background', 'canvas', 'guides', 'plugins'],
                changes: 'immediate-undoable-authoring',
                storage: 'canonical-project-and-composition-in-.ogs',
                detail:
                  'Uses the same composition controls as Properties. Template edits apply immediately and are undoable; save the template or set to persist them. Editing an inherited supported property creates a local override for that property; Reset restores inheritance. Standalone source and graphic exports contain resolved ordinary values and resources.',
                mcp: {
                  tool: 'ograf_apply_operations',
                  operations: [
                    'set_composition',
                    'set_composition_layout',
                    'set_project_metadata',
                    'add_canvas_guide',
                    'update_canvas_guide',
                    'remove_canvas_guide',
                  ],
                  inheritance:
                    'Use the existing template-set set_setting_override operation to pin/reset independent setting keys; preserve canonical background/style operations and numeric project revisions for authoring batches.',
                },
              },
            },
            exportBoundary:
              'Studio preferences are local UI state. Set defaults, inheritance and template values are saved authoring data; canvas guides/backdrops remain editor-only where already defined. Coordinated exports require matching effective output dimensions (including canvas crop) and frame rate across states; local overrides remain available and compatibility is checked before export.',
            informationalOnly: true,
          },
          fullscreenPreview: {
            surfaces: ['single-template', 'coordinated-set'],
            fpsOverlay: {
              label: 'Preview FPS',
              defaultVisible: true,
              metric: 'Browser animation-frame cadence, not authored frame rate or GPU throughput.',
              controls: 'Show FPS overlay; session-only preview preference.',
              offlineHtml:
                'Same preview badge; non-real-time pages also count completed Render FPS samples.',
              graphicOutput: false,
            },
            contextMenu:
              'Suppress the default browser context menu throughout Studio, including inputs, blank areas, detached panes and fullscreen output. Studio context menus and fullscreen right-click preview controls still work; controls open at the pointer and stay clamped to the viewport. Native operating-system picker/popover menus and browser chrome are outside this DOM boundary.',
            controls: {
              normalBackgroundTransparency: 0.6,
              defaultRowTransparency: 0.6,
              hoveredRowTransparency: 0.5,
              editingRowTransparency: 0.8,
              inactiveEditingTransparency: 1,
              editingBackgroundTransparency: 1,
              transparentEditorRetainsFocus: true,
              activeField:
                'Make the focused data/value DOM row or composite color picker row fully opaque while retaining focus and editability. While it is being edited, every other control and the pane background are 100% transparent. Restore the normal 60% default or 15% hovered appearance when editing ends through focus leave, commit or cancel. Do not compound opacity through nested row containers.',
              opening:
                'Right-click opens or repositions the controls at the pointer, clamped within the viewport. D shows or hides the controls outside an editor. Exit fullscreen in the popup header and Escape leave the owning preview window fullscreen without stopping playback. There is no duplicate Show/Hide Controls toolbar.',
              navigation:
                'Left/Right buttons and keys share Steps-first navigation, then adjacent templates. With no adjacent template, Right from the last Step plays Out and Left from the first Step returns to Start; Right from Off takes In. Native data inputs and the popup drag handle keep their own arrow keys. Synced editor mode retains frame navigation.',
              restoreOn: [
                'focus-leave',
                'edit-commit',
                'edit-cancel',
                'panel-hidden',
                'fullscreen-exit',
              ],
            },
            informationalOnly: true,
            exported: false,
          },
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
            'update_component_layer',
            'update_component_field',
            'reset_component_overrides',
            'make_component_unique',
            'refresh_component_instances',
            'rename_component',
            'remove_component',
          ],
          customActions: ['add_custom_action', 'update_custom_action', 'remove_custom_action'],
          assets: ['add_asset', 'remove_asset', 'ograf_import_asset', 'ograf_import_svg_bundle'],
          mediaCues: ['add_media_cue', 'update_media_cue', 'remove_media_cue'],
          detail:
            'Lifecycle retiming and component inheritance share the browser editor mutation rules. Live component assets retain stable instance IDs and per-property overrides; exports contain ordinary materialized layers.',
        },
        modifiers: {
          types: MODIFIER_TYPES,
          parameters: MODIFIER_CATALOG,
          staticParameters: {
            'max-text-width': { mode: ['squeeze', 'shrink'] },
            'auto-size': { source: 'geometry-reference', width: 'boolean', height: 'boolean' },
            'auto-follow': { source: 'geometry-reference', axisX: 'boolean', axisY: 'boolean' },
            'hide-empty': {
              source: 'value-reference',
              target: 'optional geometry-reference; omitted targets owner',
              trimWhitespace: 'boolean',
              invert: 'boolean',
            },
            'grid-arrange': {
              startCorner: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
              direction: ['horizontal', 'vertical'],
            },
            'radial-arrange': {
              arrangement: ['equal', 'radiate'],
              startFromOuter: 'boolean',
              orient: 'boolean',
            },
            justify: {
              horizontal: ['none', 'left', 'center', 'right'],
              vertical: ['none', 'top', 'center', 'bottom'],
            },
            'look-at': { source: 'geometry-reference', axis: ['x', 'y'], flip: 'boolean' },
          },
          motionBlur: {
            operation: 'set_layer_layout',
            property: 'motionBlur',
            shape: '{enabled:boolean, shutterAngle:number 0..360} or null',
            status: 'Experimental velocity-based blur of animated x/y.',
          },
          textPath: {
            operation: 'set_layer_layout',
            shape: '{sourceLayerId, startOffset, alignment: start|center|end} or null',
            source: 'Single-contour editable path in the same composition.',
            restrictions:
              'Single-line text with nonnegative tracking; simple Arabic RTL and Devanagari Word Reveal are supported under strict shaping restrictions. Color animators require solid fill. Clocks, crawls, squeeze/shrink-to-fit/fit-to-width, unsupported animator properties, shader strokes and nine-slice sources are rejected.',
          },
          splinePath: {
            operation: 'set_layer_layout',
            storage: 'motionPath',
            sourceLayerId: 'path layer in the same composition',
            progress: { min: 0, max: 1, property: 'motionPathProgress' },
            orientToPath: 'boolean',
            offsetX: 'finite composition pixels',
            offsetY: 'finite composition pixels',
            rotationOffset: { min: -360, max: 360, default: 0 },
            animation:
              'Animate motionPathProgress on lifecycle or local-loop tracks. Progress is not an element-data binding target. Source, orientation, offsets and rotationOffset are static layout controls. Set motionPath:null to detach.',
          },
          operations: [
            'add_modifier',
            'update_modifier',
            'duplicate_modifier',
            'remove_modifier',
            'reorder_modifiers',
          ],
          owner:
            "One layer. Auto Size/Follow/Look At references and Hide on Empty targets also accept groups. Grid Arrange, Radial Arrange and Justify arrange the owner's visible direct children (parentId); descendants move with each child. Spline Path is the layer motionPath (set_layer_layout) with optional rotationOffset.",
          references:
            '{kind:layer,layerId} or {kind:group,groupId}. Hide source is {kind:layer,layerId,property:content|src} or {kind:field,fieldId,sourcePath:[]}. Use stable IDs.',
          animation:
            'Numeric parameters use modifiers.ID.PARAM tracks or bindings. update_modifier uses authored lifecycle or explicit frame scope. Names/reorder/bypass preserve keys; duplicate starts disabled and copies links; remove clears owned keys/links.',
          evaluation:
            'Resolved data and animation feed a shared dependency-ordered frame evaluator. Authored transforms stay unchanged; cycles and conflicting geometry drivers are rejected. Max Text Width supports horizontal squeeze or proportional shrink.',
        },
        composableEffects: {
          blendModes: EFFECT_BLEND_MODES,
          blending:
            'Normal preserves legacy foreground filtering. Other modes combine each foreground effect with its input; glow/shadow blend their generated contribution only. blendOpacity mixes the foreground result with its input. Blend settings are static; numeric effect params retain their tracks. All bypassed skips filters; normal/full-strength uses CSS, mixed foreground effects use an sRGB SVG filter graph shared with masks and captures.',
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
            'New effects start bypassed; blendMode enables them. update_effect accepts name, enabled, blendMode, blendOpacity, params and a complete paint for shader. Numeric catalog params use authored or frame scope. Rename/bypass/reorder preserve keys. Duplicate copies owned tracks, bindings and shader; remove clears owned links.',
          groups:
            'The same effect operations accept groupId instead of layerId/layerName. They materialize one synchronized effect ID on every unlocked member layer. Member-only effects remain independent; group reorder changes only shared entries. Export uses ordinary per-layer OGraf effects.',
          compatibility:
            'Old blur and shadow remain reorderable base-blur/base-shadow slots backed by existing numeric tracks and dropShadowColor bindings. inspect_scene resolves virtual slots on old documents. Existing appearance and data keys are preserved.',
          animation:
            'Use effects.ID.PARAM for new numeric tracks/local loops, color/number Brand Kit tokens and OGraf data bindings. Runtime data overrides the sampled parameter. Effect IDs are scoped to a layer and survive reorder. Legacy slots keep their original property names.',
          rendering:
            'One ordered foreground chain powers Studio and export. Shader is a WebGL2 post-process: iChannel0 receives preceding output; GPU Blend/Opacity feeds later effects. inputImage and alpha-mask sourcing are rejected. SVG projections omit GLSL pixels; use browser certification. Path masks ignore effects. Catalog values clamp overshoot.',
          backdropBlur: {
            contract:
              'Use add_effect effectType:"backdrop-blur", patch.blendMode:"normal" and params.radius on rectangle or ellipse layers. It blurs earlier layers inside the same composition, clipped to the object geometry; it does not sample external video or the editor checkerboard.',
            fill: 'UI Fill None stores the canonical fill string "transparent"; use update_element.patch.fill:"transparent" for shape fills. Gradient stops use opacity 0..1, displayed as Alpha % 0..100. Fade to transparent replaces the gradient stops with first-stop color/alpha at 0 and that color at opacity 0 at 1.',
            strength:
              'blendOpacity scales the backdrop radius: effective radius = params.radius * blendOpacity. Only Normal blending is supported. Animate radius through the returned effects.ID.radius path.',
            limits:
              'Rectangles and ellipses only. Shader fills are supported; active backdrop blur and an active shader effect cannot share a layer. Backdrop-blurred alpha-mask sources are unsupported; geometric path masks remain available.',
            verification:
              'Pure SVG diagnostics omit backdrop blur. Inspect the actual browser viewport; PNG capture through serialized SVG foreignObject has not established backdrop-filter parity.',
          },
          shaderEffect: {
            contract:
              'Use add_effect with effectType:"shader" or update_effect with the returned effectId. patch.shader is a complete ShaderPaint: type, fragmentSource, speed, resolutionScale and parameters. Do not set inputImage.',
            input:
              'iChannel0 is the flattened layer result after preceding effects; iResolution and iChannelResolution[0] are the padded effect buffer.',
            controls:
              '#pragma ograf declarations populate shader.parameters and remain static effect controls; effect-track/runtime binding is not yet supported for those controls.',
            example: {
              type: 'add_effect',
              layerName: 'Layer name',
              effectType: 'shader',
              patch: {
                name: 'Invert incoming layer',
                blendMode: 'normal',
                blendOpacity: 1,
                shader: {
                  type: 'shader',
                  fragmentSource:
                    'void mainImage(out vec4 c, in vec2 p) { vec4 s = texture(iChannel0, p / iResolution.xy); c = vec4(1.0 - s.rgb, s.a); }',
                  speed: 1,
                  resolutionScale: 1,
                  parameters: {},
                },
              },
            },
          },
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
            'Copy a presets.entries[].patch into set_tiling_pattern.patch and adapt width/height/cycleFrames to the target composition. Set createLayer:false for a resource only. Returns pattern/layer IDs. There is no presetId operation argument. An empty patch still creates the legacy O/D motif; use an explicit preset for the new visual workflow.',
          presets: {
            referenceComposition: { width: 1920, height: 1080, frameRate: 25 },
            defaultId: 'dots',
            motion:
              'Presets start static. Use cyclesPerLoop:1 (or another whole number), cycleFrames:round(seconds*frameRate), and direction:left|right|alternate to animate. Clear per-row cycles overrides when toggling all rows.',
            entries: PATTERN_PRESETS.map((preset) => ({
              ...preset,
              patch: getPatternPresetPatch(preset.id, 1920, 1080, 25),
            })),
          },
          editor:
            'Resources > Patterns > Add pattern opens visual presets or Use selected shapes (rectangle/ellipse/path silhouettes). Edit has a local Play/Pause preview, layout, motion in seconds, shape replacement, SVG import and sequence ordering; precision source/row/lighting controls are under Advanced. Resources shows usage, Duplicate and Add to canvas; Properties > Make independent copies the shared resource for one layer.',
          sourceImport:
            'MCP accepts explicit symbols/sequence in set_tiling_pattern.patch, not SVG filenames, arbitrary selected-layer groups, or an importPatternSvg operation. The editor SVG picker imports filled vector silhouettes with supported affine transforms; strokes/text need conversion to outlines. Clips, masks, images, external content and ambiguous overlapping separate shapes are rejected. Imported colors are replaced by the layer paint.',
          duplication:
            'Read the definition, copy its authored fields without id into set_tiling_pattern.patch with a new name and createLayer:false. Use the returned patternId in update_element.patch.patternId for the chosen layer, preserving its other properties; leave other references unchanged. Inspect and deliberately preserve or relink any separate layer.lighting controller.',
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
            'Pattern layers accept solid/linear/radial/conic or shader fill, color outlines and effects. Gradient paint repeats with each motif; a shader fills the pattern layer through the moving geometry alpha mask. Shader outlines are text-only. Do not author element.definition; compilation resolves it from composition.patterns.',
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
          unsupportedSources: ['text', 'image-sequence', 'lottie', 'shader'],
          dynamicPaint:
            'Shader- or media-painted layers, and layers with active backdrop blur, may receive masks and provide geometric path masks; alpha-mask sourcing is unsupported.',
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
            values: ['none', 'big-buck-bunny', 'still-image', 'webcam'],
            ui: 'Playout Controls > Background, also shared by preview controls. Choose None, looping Big Buck Bunny video, Still image or Webcam. Canvas Layout provides Open Playout Controls instead of duplicate background controls.',
            property: 'presentationBackground',
            propertyScope:
              'Legacy composition.layout initial default only. Current presentation preferences belong to the local presentation background store.',
            stillImage: {
              urlProperty: 'presentationBackgroundImageSource',
              localFileSelection:
                'Background > Still image accepts an image URL or a local image up to 10 MB.',
              localFilesAreEmbeddedInProject: false,
              storage:
                'The selected image and background preferences are stored locally in IndexedDB.',
            },
            output:
              'One background is shared across the editor and independent single/combined preview output, including embedded, fullscreen and detached windows. Sync mode mirrors the editor once. Changes apply without rebuilding the graphic or requiring Replay; opaque authored output can cover the presentation background.',
            persistence:
              'Preferences initialize once per set/project from the active composition legacy layout, then persist locally in IndexedDB. Current edits do not change project source, .ogs, exported packages or workspace presets. Existing legacy layout settings remain readable as initial defaults; no file-format migration is required.',
            webcam:
              'Background > Webcam exposes Start webcam and Camera Settings. Selecting or restoring Webcam never starts capture; Start is explicit. Same-set template changes and Take/Update/Out/Clear retain capture. Stop or selecting another background releases only the presentation consumer. Opaque authored artwork occludes the camera; use transparent output. Camera capture settings and footage are session-only and never exported.',
            webcamSettings: WEBCAM_PREVIEW_CAPABILITIES,
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
        mediaCues: {
          operations: ['add_media_cue', 'update_media_cue', 'remove_media_cue'],
          sources: ['audio clip', 'video clip', 'renderer live input'],
          triggers: ['timeline frame', 'lifecycle state', 'customAction', 'manual preview'],
          retrigger: ['restart', 'resume', 'ignore'],
          transitions: ['cut', 'crossfade'],
          customActionPayload:
            '{source: SOURCE_ID_OR_NAME} selects a named cue source before triggering playback.',
          semantics:
            'Media Cues are composition-level Timeline tracks, not canvas objects. Audio is nonvisual. Video/live cues optionally paint one target layer while sharing trim, speed, loop, volume, mute, trigger and source-transition controls.',
          audioCustomAction:
            'For action-triggered sound, add_media_cue with an audio clip source and trigger:{type:"customAction",actionId}. In Studio, Audio -> Create Playback Cue creates a Manual advanced cue; Add at Playhead creates a timeline Sound Event.',
          runtime:
            'Initial profile is real-time-only. Crossfade double-buffers audio/video sources; live inputs require the zd-ograf-media renderer hook and target readiness verification.',
        },
        reusableComponents: {
          operations: [
            'save_component',
            'instantiate_component',
            'update_component_from_layers',
            'update_component_layer',
            'update_component_field',
            'reset_component_overrides',
            'make_component_unique',
            'refresh_component_instances',
            'rename_component',
            'remove_component',
          ],
          semantics:
            'save_component creates an asset and links selected layers without changing IDs. scope defaults local; set shares it. instantiate_component defaults linked:true; false copies independently. Parent edits and refresh preserve IDs, placement and overrides. Used assets cannot be removed. Export contains ordinary layers.',
          sharedIdentity:
            'Optional instanceId selects linked continuity across templates; duplicates within a composition fail. Use 1–256 ASCII letters/digits/._:-, starting alphanumeric; prototype keys are reserved. Other identities remain generated.',
          editing: {
            selection:
              'update_component_from_layers componentId,layerIds promotes members of one linked instance plus new independent layers. New layers join that source instance in place; canonical layer/field IDs, bindings and animation remain stable. Other instances receive one corresponding child while retaining overrides. An independent-only selection becomes a new linked source instance. Locked selected layers, foreign component members and multiple source instances are rejected atomically. Query the updated project for child mappings; this operation does not return an insertion result for the existing source instance.',
            asset:
              'update_component_layer componentId,sourceLayerId,patch edits canonical authored fields (not id/componentLink). Element/effects patches merge; animationTracks merges channels. update_component_field componentId,fieldId,patch uses type/defaultValue and the ordinary field schema inputs.',
            instance:
              'Ordinary layer/data-field edits create overrides. reset_component_overrides layerIds,paths? clears selected JSON Pointer overrides or all selected-member overrides. make_component_unique instanceId,name? creates a separate asset and relinks only that instance.',
            persistence:
              'Editable .ogs stores resolved layers and inheritance metadata; template sets share set-scoped definitions and portable dependencies. Legacy linked differences become overrides when migrated; existing independent copies remain detached. Remove a set-scoped asset through Studio, which can check inactive templates.',
            transitionReferences:
              'Connected Studio checks the prospective shared component library against the current Transitions graph before publishing project, set or Undo history, including MCP edits and Undo/Redo. Removal of a source used by a shared instance, state or resize target is rejected; retarget those graph references first. Standalone project sessions have no external set graph to validate.',
          },
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
      description: 'List session revisions.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => textResult({ sessions: workspace.list() }),
  );

  server.registerTool(
    'ograf_get_changes',
    {
      title: 'Get OGraf revision changes',
      description: 'Read up to 100 changes after sinceRevision.',
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
      description: 'Read project/revision; include/tracks filter output.',
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
      description: 'Inspect scene links/motion/warnings/revision.',
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
      description: 'Query layer semantics/names/bindings/motion.',
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
              'ticker',
              'rectangle',
              'ellipse',
              'text',
              'image',
              'path',
              'pattern',
              'image-sequence',
              'lottie',
              'chart',
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
          if (elementTypes && !elementTypes.some((type) => type === layer.element.type))
            return null;
          if (visible !== undefined && layer.isVisible !== visible) return null;
          if (
            animated !== undefined &&
            (animatedProperties.length > 0 ||
              layer.element.type === 'pattern' ||
              layer.element.type === 'ticker') !== animated
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
            hasLoop:
              Boolean(layer.loop) ||
              layer.element.type === 'pattern' ||
              layer.element.type === 'ticker',
            patternId: layer.element.type === 'pattern' ? layer.element.patternId : null,
            componentLink: componentLinkSummary(layer.componentLink),
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
      description: 'Read layer tracks/lifecycle/loops. Easing applies to the incoming segment.',
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
        'Sample geometry/lights/patterns; loopElapsedFrame is absolute on-air time. No browser.',
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
              ...(layer.element.type === 'ticker'
                ? {
                    ticker: {
                      ...sampleTicker(
                        layer.element,
                        pose.width,
                        ((loopElapsedFrame ?? frame) / composition.frameRate) * 1000,
                      ),
                      layout: getTickerLayout(layer.element, pose.height),
                      speedPixelsPerSecond: layer.element.speedPixelsPerSecond,
                      direction: layer.element.direction,
                      textDirection: layer.element.textDirection,
                    },
                  }
                : {}),
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
      description: 'Render a deterministic SVG without mutation.',
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
        'PNG; first Step default. Matte/dataOverrides: composition only. URL 5 min; base64 opt-in. Not certification.',
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
        'Browser strip: max12 frames, lifecycle/midpoints default; maxDimension/tile. URL 5 min; base64 opt-in.',
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
        'Show one large frame on the main canvas for Accept/Reject in AI Assistant. Accept applies exact operations only at baseRevision; stale proposals must be regenerated. Source stays unchanged until acceptance.',
      inputSchema: {
        sessionId: z.literal('editor').default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        title: z.string().min(1).max(120),
        description: z.string().max(1000).default(''),
        operations: z.array(authoringOperationSchema).min(1),
        render: z.enum(['frame', 'strip']).default('frame'),
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
      compositionId,
      frame,
      frames,
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
      if (!inApp) requireOriginalPromptForFirstArtwork(snapshot, expectedRevision, typedOperations);
      // Operator approval always presents one readable frame, even for legacy strip requests.
      const stepFrame = firstStepFrame(composition);
      const resolvedFrame =
        frame ?? (frames?.includes(stepFrame) ? stepFrame : frames?.[0]) ?? stepFrame;
      if (resolvedFrame > getTotalFrames(composition)) {
        throw new Error(`Frame ${resolvedFrame} is beyond the projected composition's duration.`);
      }
      const preview = await bridge.capture({
        target: 'composition',
        project: projection.project,
        compositionId: composition.id,
        frame: resolvedFrame,
        maxDimension,
        matte,
      });
      const renderedFrames = [resolvedFrame];
      const proposalId = randomUUID();
      const proposal = {
        id: proposalId,
        project: projection.project,
        compositionId: composition.id,
        title,
        description,
        sessionId,
        baseRevision: snapshot.revision,
        operationTypes: typedOperations.map((operation) => operation.type),
        operationCount: typedOperations.length,
        previewUrl: preview.url,
        previewExpiresAt: preview.expiresAt,
        render: 'frame' as const,
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
      description: 'Advisory semantic/field/text/broadcast checks; not certification.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        browserTextOverflow: z.boolean().default(false),
        dataFieldUsage: z.boolean().default(false),
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
      dataFieldUsage,
      broadcastLint,
      interlacedOutput,
      detail,
      testValues,
    }) => {
      const snapshot = workspace.get(sessionId).snapshot();
      if (!browserTextOverflow && !broadcastLint && !dataFieldUsage) {
        return textResult({
          sessionId,
          revision: snapshot.revision,
          validation: snapshot.validation,
          availableChecks: {
            hint: 'Optional checks were not run. Set dataFieldUsage=true for advisory field-reference checks; broadcastLint=true for non-gating safe-area, font-size, contrast, and optional interlaced-stroke checks; browserTextOverflow=true for live-font overflow checks.',
            dataFieldUsage: false,
            broadcastLint: false,
            browserTextOverflow: false,
          },
        });
      }
      const warnings = [...snapshot.validation.warnings];
      const fieldUsage = dataFieldUsage ? inspectDataFieldUsage(snapshot.project) : undefined;
      warnings.push(...(fieldUsage?.warnings ?? []));
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
        ...(fieldUsage
          ? {
              dataFieldUsage: {
                enabled: true,
                checked: fieldUsage.fields.length,
                reported:
                  detail === 'full'
                    ? fieldUsage.fields.length
                    : fieldUsage.fields.filter((field) => field.status !== 'referenced').length,
                fields:
                  detail === 'full'
                    ? fieldUsage.fields
                    : fieldUsage.fields.filter((field) => field.status !== 'referenced'),
                warnings: fieldUsage.warnings,
                limitation:
                  'Static references and authored visibility only; not a proof of visible output or runtime reachability. Connections and set-data actions count as references, not as visible consumers.',
              },
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'ograf_review_design',
    {
      title: 'Review OGraf design and motion',
      description: 'Advisory QA with IDs; includeStrip adds frames. Not certification.',
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
      description: 'Browser text fit/overflow/clipping at frame.',
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
        'Create a memory session with the original user prompt saved in the template. Pass the user’s request verbatim from your conversation. The editor session belongs to the browser.',
      inputSchema: {
        sessionId: z.string(),
        name: z.string().optional(),
        originalPrompt: originalPromptSchema,
      },
      annotations: mutation,
    },
    async ({ sessionId, name, originalPrompt }) => {
      const project = createProject({
        authoringPrompts: [{ id: createId('prompt'), text: originalPrompt }],
      });
      const session = workspace.create(sessionId, project);
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
        'Replace the session with a fresh template and save the supplied original user prompt verbatim. Requires confirmation and the current revision. keepDataFields retains main fields.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        expectedRevision: z.number().int().nonnegative(),
        confirm: z.literal(true),
        keepDataFields: z.boolean().default(false),
        originalPrompt: originalPromptSchema,
      },
      annotations: mutation,
    },
    async ({ sessionId, expectedRevision, keepDataFields, originalPrompt }) => {
      const session = workspace.get(sessionId);
      const previous = session.snapshot().project;
      const next = createProject({
        authoringPrompts: [{ id: createId('prompt'), text: originalPrompt }],
      });
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
      description: 'Delete a non-editor session with confirm; saved files remain.',
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
        'Open workspace JSON .ogs/.ogeproj in a new session. ZIP .ogs/.ogp: open in Studio and activate a template.',
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
      description: 'Embed workspace image/video/audio/font/text (32 MiB max); returns asset:<id>.',
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
            'video/mp4',
            'video/webm',
            'audio/mpeg',
            'audio/wav',
            'audio/ogg',
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
      description: 'Embed workspace SVG/CSS/images/fonts atomically: 32 MiB/file, 64 MiB total.',
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
        'Apply an atomic revision-checked batch: layers, tracks/loops, shader paints, patterns/lighting, masks, effects, Brand Kits, components, collections, assets and layout. Discover capabilities first. Select layers by layerId or exact layerName; creation returns stable IDs. preview renders; propose awaits acceptance; dry-run validates only. Transform/effect updates default to authored lifecycle frames; scope:frame requires frame. Keys are not implicitly retimed. Returns all warnings.',
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
        const snapshot = session.snapshot();
        const typedOperations = normalizeOperationSelectors(
          snapshot.project,
          operations as unknown[],
        );
        if (!inApp && !dryRun)
          requireOriginalPromptForFirstArtwork(snapshot, expectedRevision, typedOperations);
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
        const recipeOperationIndices = new Set(
          result.summary.semanticBlocks.map((block) => block.operationIndex),
        );
        const componentResults = result.summary.componentInstances
          .filter((instance) => !recipeOperationIndices.has(instance.operationIndex))
          .map((instance) => ({
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
          ...(block.componentId ? { componentId: block.componentId } : {}),
          ...(block.instanceId ? { instanceId: block.instanceId } : {}),
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
        description: `${action === 'undo' ? 'Undo' : 'Redo'} the latest agent transaction.`,
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
      title: 'Certify OGraf output',
      description: 'Certify project/manifest/package/module/lifecycle in the editor.',
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
      title: 'Save OGraf project and PNG',
      description: 'Certify/save .ogs + thumbnail.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        path: z.string(),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
        thumbnailFrame: z.number().int().nonnegative().nullable().optional(),
      },
      annotations: mutation,
    },
    async ({ sessionId, path, overwrite, thumbnailFrame }) => {
      if (extname(path).toLowerCase() !== PROJECT_SOURCE_EXTENSION)
        throw new Error(`Project path must end in ${PROJECT_SOURCE_EXTENSION}.`);
      const target = workspace.resolveAllowedPath(path);
      const snapshot = workspace.get(sessionId).snapshot();
      const project = snapshot.project;
      const thumbnailPath = workspace.resolveAllowedPath(
        join(dirname(target), templateThumbnailName(project)),
      );
      if (thumbnailFrame !== undefined) {
        if (thumbnailFrame !== null && thumbnailFrame > getTotalFrames(mainComposition(project)))
          throw new Error('Thumbnail frame is beyond the end of the template.');
        project.thumbnailFrame = thumbnailFrame;
      }
      const frame = projectThumbnailFrame(project);
      const artifacts = buildExportArtifactsWithRuntime(
        project,
        mainComposition(project),
        await runtimeSource(),
      );
      const errors = [...artifacts.errors, ...validatePackageLayout(artifacts)];
      if (errors.length) throw new Error(`OGraf certification failed:\n${errors.join('\n')}`);
      const certification = await bridge.certify(artifacts);
      if (!certification.valid)
        throw new Error(`OGraf certification failed:\n${certification.errors.join('\n')}`);
      const thumbnail = await bridge.capture({
        target: 'composition',
        project: thumbnailRenderProject(project),
        compositionId: project.mainCompositionId,
        frame,
        maxDimension: THUMBNAIL_MAX_DIMENSION,
        matte: 'transparent',
      });
      await writeTemplateFiles(
        [
          { path: target, data: `${JSON.stringify(project, null, 2)}\n` },
          { path: thumbnailPath, data: Buffer.from(thumbnail.data, 'base64') },
        ],
        overwrite,
      );
      return textResult(
        {
          sessionId,
          path: target,
          thumbnailPath,
          thumbnailFrame: frame,
          revision: snapshot.revision,
          certification,
        },
        `Certified and saved ${target} with ${thumbnailPath} (frame ${frame})`,
      );
    },
  );

  server.registerTool(
    'ograf_export_package',
    {
      title: 'Export certified OGraf or standalone HTML',
      description:
        'Export a certified .ograf.zip with thumbnail or a self-contained .html preview. The path extension selects the output.',
      inputSchema: {
        sessionId: z.string().default('editor'),
        path: z.string(),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
        profile: z.enum(['realtime', 'non-realtime', 'dual']).default('dual'),
        thumbnailFrame: z.number().int().nonnegative().nullable().optional(),
      },
      annotations: mutation,
    },
    async ({ sessionId, path, overwrite, profile, thumbnailFrame }) => {
      const lower = path.toLowerCase();
      const format = lower.endsWith('.html') ? 'html' : 'zip';
      if (format === 'zip' && !lower.endsWith('.ograf.zip'))
        throw new Error('Export path must end in .ograf.zip or .html.');
      const target = workspace.resolveAllowedPath(path);
      const {
        artifacts,
        certification,
        thumbnailFrame: renderedFrame,
      } = await certifiedArtifacts(workspace, bridge, sessionId, profile, true, thumbnailFrame);
      let output: Uint8Array;
      if (format === 'html') output = new TextEncoder().encode(buildOfflinePreviewHtml(artifacts));
      else {
        const zip = new JSZip();
        zip.file(artifacts.manifestFileName, JSON.stringify(artifacts.manifest, null, 2));
        zip.file('main.js', artifacts.mainJs);
        for (const resource of artifacts.resources) {
          zip.file(resource.path, resource.data, { base64: resource.base64 });
        }
        output = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      }
      await atomicWrite(target, output, overwrite);
      return textResult(
        {
          sessionId,
          path: target,
          profile,
          certification,
          thumbnailFrame: renderedFrame,
          format,
        },
        `Certified and exported ${target}`,
      );
    },
  );

  server.registerTool(
    'ograf_export_coordinated_package',
    {
      title: 'Export certified coordinated OGraf or standalone HTML',
      description:
        'Export frozen graph/artwork with a PNG thumbnail. Select a .ograf.zip package or self-contained .html preview by path extension. Lane-dependent selects have defaults and the runtime checks the current on-air template. Rejects stale revisions, unapplied drafts and source changes. Explicit workspace path; no picker. Reuse operationId with identical arguments to recover uncertain results or retry the same certified bytes. IDs live for this server process (32 operations); success rechecks output hash. Reports included states/templates and unreferenced templates.',
      inputSchema: {
        path: z.string().min(1),
        expectedRevision: z.string().min(1).max(256),
        operationId: z.string().min(1).max(128),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
        profile: z.enum(['realtime', 'non-realtime', 'dual']),
      },
      annotations: mutation,
    },
    async (input) => {
      const result = await exportCoordinated(input);
      return {
        ...textResult(
          result,
          result.outcome === 'saved'
            ? `Certified, saved and verified ${result.path}`
            : String(result.message ?? result.outcome),
        ),
        ...(result.outcome !== 'saved' ? { isError: true } : {}),
      };
    },
  );

  server.registerTool(
    'ograf_save_template_set',
    {
      title: 'Save the open template set',
      description:
        'Save a revision-checked whole-set .ogs snapshot copy. Compact stores shared payloads once; compatible writes schema 5 for older set readers. Workspace paths only, up to 64 MiB compressed. Does not certify playout or rename the open document.',
      inputSchema: {
        expectedRevision: z.string().min(1).max(256),
        path: z.string().min(1),
        archiveMode: z.enum(['compact', 'compatible']).default('compact'),
        confirm: z.literal(true),
        overwrite: z.boolean().default(false),
      },
      annotations: mutation,
    },
    async ({ expectedRevision, path, archiveMode, overwrite }) => {
      if (extname(path).toLowerCase() !== PROJECT_SOURCE_EXTENSION)
        throw new Error(`Template-set path must end in ${PROJECT_SOURCE_EXTENSION}.`);
      const target = workspace.resolveAllowedPath(path);
      if (!overwrite && (await exists(target)))
        throw new Error(
          'Target already exists. Set overwrite=true only after confirming replacement.',
        );
      if (!bridge.requestTemplateSet)
        throw new Error('Template-set saves require an updated, connected editor bridge.');
      const result = await bridge.requestTemplateSet(
        { action: 'archive', expectedRevision, archiveMode },
        120_000,
      );
      const { data, metadata } = await decodeTemplateSetArchive(
        result,
        expectedRevision,
        archiveMode,
      );
      await writeTemplateFiles([{ path: target, data }], overwrite);
      return textResult(
        { path: target, ...metadata },
        `Saved ${target} (${archiveMode}, ${metadata.archiveBytes} bytes)`,
      );
    },
  );
  server.registerTool(
    'ograf_get_template_set',
    {
      title: 'Inspect the open template set',
      description:
        'Read set/revision/defaults; projects and selected resourceUsage opt-in. Filter templateIds or page offset/limit.',
      inputSchema: {
        includeProjects: z.boolean().default(false),
        resourceUsage: z
          .object({
            slotIds: z.array(z.string().min(1).max(256)).max(16).optional(),
            componentIds: z.array(z.string().min(1).max(256)).max(16).optional(),
          })
          .strict()
          .optional(),
        templateIds: z.array(z.string().min(1).max(256)).max(256).optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(256).optional(),
      },
      annotations: readOnly,
    },
    async ({ includeProjects, resourceUsage, templateIds, offset, limit }) => {
      if (!bridge.requestTemplateSet)
        throw new Error('Template-set tools require an updated, connected editor bridge.');
      return textResult(
        await bridge.requestTemplateSet({
          action: 'read',
          includeProjects,
          ...(resourceUsage ? { resourceUsage } : {}),
          templateIds,
          offset,
          limit,
        }),
      );
    },
  );
  server.registerTool(
    'ograf_update_template_set',
    {
      title: 'Manage templates and shared set defaults',
      description:
        'Apply set command using get_template_set revision. For new_template, duplicate_template, or paste_template, pass the exact user request in originalPrompt. Confirm removal/replacement; file pickers use UI.',
      inputSchema: {
        expectedRevision: z.string().min(1),
        operation: inApp ? templateSetOperationSchema : mcpTemplateSetOperationSchema,
        confirm: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ expectedRevision, operation, confirm }) => {
      if (!bridge.requestTemplateSet)
        throw new Error('Template-set tools require an updated, connected editor bridge.');
      return textResult(
        await bridge.requestTemplateSet({
          action: 'command',
          expectedRevision,
          operation,
          confirm,
        }),
      );
    },
  );
  server.registerTool(
    'ograf_get_playout',
    {
      title: 'Inspect Studio live playout',
      description:
        'Read playout revision, states, lane readiness/current/pending/errors and tickerUpdates. target:preview reads the visible combined Preview & Export session; omitted/live reads the separate live/MCP session.',
      inputSchema: { target: z.enum(['live', 'preview']).optional() },
      annotations: readOnly,
    },
    async ({ target }) => {
      if (!bridge.requestLivePlayout)
        throw new Error('Live playout tools require an updated, connected Studio bridge.');
      return textResult(
        await bridge.requestLivePlayout({ action: 'read', ...(target ? { target } : {}) }),
      );
    },
  );
  server.registerTool(
    'ograf_control_playout',
    {
      title: 'Control Studio live playout',
      description:
        'Use matching-target revision + unique requestId; poll completion and retry uncertain results with the same requestId. Update mode:in-place patches on-air data without a lane transition; omitted/transition mode keeps authored update transitions. target:preview accepts Update only for graphics already taken in Studio controls. Omitted/live target: Take uses prepared state when stateId omitted; Update guards active state; parent Out/Clear cascades without restore; template-action runs on-air actions including clocks.',
      inputSchema: {
        target: z.enum(['live', 'preview']).optional(),
        expectedRevision: z.string().min(1).max(256),
        requestId: z.string().min(1).max(256),
        operation: livePlayoutOperationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ expectedRevision, requestId, operation, target }) => {
      if (!bridge.requestLivePlayout)
        throw new Error('Live playout tools require an updated, connected Studio bridge.');
      return textResult(
        await bridge.requestLivePlayout({
          action: 'command',
          ...(target ? { target } : {}),
          expectedRevision,
          requestId,
          operation,
        }),
      );
    },
  );
  const consolidated = consolidateOperationTools(records, workspace, bridge);
  const pager = toolResultPagerForWorkspace(workspace);
  const pageSchema = {
    resultId: z.string().min(1).max(128).optional(),
    sourceTool: z.string().min(1).max(128).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    sessionId: z.string().min(1).max(256).optional(),
    path: z
      .array(z.union([z.string().max(1024), z.number().int().nonnegative()]))
      .max(64)
      .optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(65_536).optional(),
    maxTokens: z.number().int().min(128).max(65_536).optional(),
  } satisfies z.ZodRawShape;
  const readableSources = new Set([
    'ograf_list_sessions',
    'ograf_get_capabilities',
    'ograf_query_scene',
    'ograf_inspect_scene',
    'ograf_get_project',
    'ograf_get_template_set',
    'ograf_get_changes',
    'ograf_get_playout',
    'ograf_get_timeline',
    'ograf_sample_tracks',
    'ograf_render_frame',
    'ograf_capture',
    'ograf_render_strip',
    'ograf_measure_text',
    'ograf_review_design',
    'ograf_validate_project',
  ]);
  consolidated.push({
    name: 'ograf_read_result_page',
    config: {
      title: 'Read a retained tool result',
      description:
        'Read complete JSON pages by resultId/path/offset, or page a read-only sourceTool/input. Never reruns a mutation.',
      inputSchema: pageSchema,
      annotations: readOnly,
    },
    async handler(raw) {
      const request = z.object(pageSchema).strict().parse(raw);
      try {
        let resultId = request.resultId;
        if (!!resultId === !!request.sourceTool || (resultId && request.input !== undefined))
          throw new ToolResultPagingError(
            'invalid-page',
            'Provide resultId, or sourceTool/input, but not both.',
          );
        if (request.sourceTool) {
          const source = consolidated.find((tool) => tool.name === request.sourceTool);
          if (
            !source ||
            !readableSources.has(request.sourceTool) ||
            source.config.annotations?.readOnlyHint !== true
          )
            throw new ToolResultPagingError(
              'invalid-page',
              'Only an existing read-only source tool may start a paged read. Mutations, imports, certification and exports are not admitted.',
            );
          const args = z.object(source.config.inputSchema).parse(request.input ?? {});
          const response = await source.handler(args);
          const value =
            response && typeof response === 'object' && 'structuredContent' in response
              ? response.structuredContent
              : response;
          resultId = pager.store(value, {
            toolName: source.name,
            sessionId: request.sessionId,
            ...(response &&
            typeof response === 'object' &&
            'isError' in response &&
            response.isError === true
              ? { isError: true }
              : {}),
          });
        }
        const page = pager.read({ ...request, resultId: resultId! });
        return { ...textResult({ ...page }), ...(page.source.isError ? { isError: true } : {}) };
      } catch (error) {
        if (!(error instanceof ToolResultPagingError)) throw error;
        return {
          ...textResult({
            error: { code: error.code, message: error.message },
            guidance:
              'Refresh a read-only source if needed; never repeat a mutation to recover a result.',
          }),
          isError: true,
        };
      }
    },
  });
  registerToolResultPager(consolidated, pager);
  return consolidated;
}
