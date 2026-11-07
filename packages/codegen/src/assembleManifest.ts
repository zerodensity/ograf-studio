import {
  OGRAF_MANIFEST_SCHEMA_URL,
  type ManifestActionDuration,
  type OGrafManifest,
} from '@ograf-editor/ograf-types';
import type { Composition, Project } from '@ograf-editor/scene-model';
import {
  isMediaPaint,
  walkElementContents,
  elementAssetReferences,
} from '@ograf-editor/scene-model';
import { compileCustomActions, compileDataSchema } from './compileDataSchema';
import type { CompiledGraphicDescriptor } from './compileDescriptor';

/**
 * Publishes how long each action actually animates, so a playout system can schedule takes against
 * real timings instead of guessing. Everything is derived from the authored transitions — the
 * runtime tweens between keyframes over exactly those durations — and rounded to integer
 * milliseconds because the EBU schema types `duration` as an integer.
 */
function compileActionDurations(descriptor: CompiledGraphicDescriptor): ManifestActionDuration[] {
  const { frameRate, stepKeyframeIds, transitions, endKeyframeId } = descriptor;
  const msFor = (durationFrames: number) => Math.round((durationFrames / frameRate) * 1000);
  const transitionInto = (keyframeId: string | undefined) =>
    keyframeId ? transitions.find((t) => t.toKeyframeId === keyframeId) : undefined;

  // playAction: one entry per target step, using the transition that leads into that step.
  const steps = stepKeyframeIds
    .map((keyframeId, step) => {
      const transition = transitionInto(keyframeId);
      return transition ? { step, duration: msFor(transition.durationFrames) } : null;
    })
    .filter((entry): entry is { step: number; duration: number } => entry !== null);

  const durations: ManifestActionDuration[] = [
    {
      type: 'playAction',
      // Fallback for any step without its own entry (e.g. step 0, which has no inbound transition).
      duration: 0,
      ...(steps.length > 0 ? { steps } : {}),
    },
    {
      type: 'updateAction',
      duration: msFor(
        Math.max(
          descriptor.updateTransitionFrames ?? 0,
          ...descriptor.layers.map((layer) => layer.updateTransition?.durationFrames ?? 0),
        ),
      ),
    },
    {
      type: 'stopAction',
      duration: msFor(
        descriptor.exitTailStartFrame === undefined
          ? (transitionInto(endKeyframeId)?.durationFrames ?? 0)
          : (descriptor.keyframes.find((key) => key.id === endKeyframeId)?.frame ??
              descriptor.exitTailStartFrame) - descriptor.exitTailStartFrame,
      ),
    },
  ];

  for (const action of descriptor.customActions) {
    durations.push({
      type: 'customAction',
      customActionId: action.id,
      duration: msFor(action.durationFrames),
    });
  }

  return durations;
}

/** CompiledGraphicDescriptor + Project/Composition metadata -> a `*.ograf.json` manifest. */
export function assembleManifest(
  project: Project,
  composition: Composition,
  descriptor: CompiledGraphicDescriptor,
): OGrafManifest {
  const schema = compileDataSchema(composition);
  const customActions: NonNullable<OGrafManifest['customActions']> =
    compileCustomActions(composition);
  const compiledLayers = [
    ...descriptor.layers,
    ...(descriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
  ];
  const loopGroups = [
    ...new Set(
      compiledLayers.flatMap((layer) => (layer.loop?.timing ? [layer.loop.timing.groupId] : [])),
    ),
  ];
  if (loopGroups.length) {
    for (const action of ['pause', 'resume', 'next']) {
      const id = `loop.${action}`;
      if (customActions.some((existing) => existing.id === id))
        throw new Error(
          `Custom action ${id} is reserved by timed loop controls. Rename the custom action.`,
        );
      customActions.push({
        id,
        name: `${action === 'next' ? 'Advance' : action === 'pause' ? 'Pause' : 'Resume'} a loop group`,
        schema: {
          type: 'object',
          properties: { groupId: { type: 'string', enum: loopGroups } },
          required: ['groupId'],
          additionalProperties: false,
        },
      });
    }
  }
  const mediaPaints = compiledLayers.flatMap((layer) => {
    return walkElementContents(layer.element).flatMap((element) => {
      const fill =
        element.type === 'ticker'
          ? element.background
          : 'fill' in element
            ? element.fill
            : undefined;
      return isMediaPaint(fill) ? [fill] : [];
    });
  });
  const cueSources = (descriptor.mediaCues ?? []).flatMap((cue) => cue.sources);
  const needsLiveMedia =
    mediaPaints.some((paint) => paint.source.kind === 'live') ||
    cueSources.some((source) => source.kind === 'live');
  const needsPublicInternet =
    cueSources.some((source) =>
      source.kind === 'clip'
        ? /^https?:\/\//i.test(source.src)
        : /^https?:\/\//i.test(source.fallback ?? ''),
    ) ||
    compiledLayers.some((layer) => {
      if (elementAssetReferences(layer.element).some((source) => /^https?:\/\//i.test(source)))
        return true;
      const element = layer.element;
      if (element.type === 'image') return /^https?:\/\//i.test(element.src ?? '');
      if (element.type === 'audio') return /^https?:\/\//i.test(element.src ?? '');
      if (element.type === 'image-sequence')
        return element.frames.some((frame) => /^https?:\/\//i.test(frame));
      const fill = 'fill' in element ? element.fill : undefined;
      if (isMediaPaint(fill)) {
        const source = fill.source.kind === 'clip' ? fill.source.src : fill.source.fallback;
        return /^https?:\/\//i.test(source ?? '');
      }
      return false;
    });

  const manifest: OGrafManifest = {
    $schema: OGRAF_MANIFEST_SCHEMA_URL,
    id: project.id,
    name: project.name,
    main: 'main.js',
    supportsRealTime: project.supportsRealTime,
    supportsNonRealTime: project.supportsNonRealTime,
    version: project.version,
    stepCount: descriptor.stepCount,
    actionDurations: compileActionDurations(descriptor),
    renderRequirements: [
      {
        // Per the EBU schema, these are constraint objects (modeled on MediaTrackConstraints'
        // ConstrainDouble/ConstrainBoolean), not raw values — confirmed against the live schema
        // during the Phase 5a ograf-devtool cross-check, which caught this exact divergence.
        resolution: {
          width: { exact: descriptor.crop?.width ?? descriptor.width },
          height: { exact: descriptor.crop?.height ?? descriptor.height },
        },
        frameRate: { exact: descriptor.frameRate },
        accessToPublicInternet: { exact: needsPublicInternet },
        ...(needsLiveMedia
          ? { engine: [{ type: 'ZeroDensityHTML', version: { min: '1.0' } }] }
          : {}),
      },
    ],
  };

  if (project.description) manifest.description = project.description;
  if (project.author.name) manifest.author = { ...project.author };
  if (Object.keys(schema.properties).length > 0)
    manifest.schema = schema as unknown as Record<string, unknown>;
  if (customActions.length > 0) manifest.customActions = customActions;
  if (loopGroups.length)
    for (const action of ['pause', 'resume', 'next'])
      manifest.actionDurations!.push({
        type: 'customAction',
        customActionId: `loop.${action}`,
        duration: 0,
      });

  return manifest;
}
