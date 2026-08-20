import {
  OGRAF_MANIFEST_SCHEMA_URL,
  type ManifestActionDuration,
  type OGrafManifest,
} from '@ograf-editor/ograf-types';
import type { Composition, Project } from '@ograf-editor/scene-model';
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
    // Data swaps are instantaneous — no "update pulse" animation is modeled yet.
    { type: 'updateAction', duration: 0 },
    {
      type: 'stopAction',
      duration: msFor(transitionInto(endKeyframeId)?.durationFrames ?? 0),
    },
  ];

  for (const action of descriptor.customActions) {
    // Custom actions are declarative acknowledgements today, with no animation of their own.
    durations.push({ type: 'customAction', customActionId: action.id, duration: 0 });
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
  const customActions = compileCustomActions(composition);
  const needsPublicInternet = descriptor.layers.some((layer) => {
    const element = layer.element;
    if (element.type === 'image') return /^https?:\/\//i.test(element.src ?? '');
    if (element.type === 'image-sequence')
      return element.frames.some((frame) => /^https?:\/\//i.test(frame));
    return false;
  });

  const manifest: OGrafManifest = {
    $schema: OGRAF_MANIFEST_SCHEMA_URL,
    id: project.id,
    name: project.name,
    main: 'main.js',
    supportsRealTime: true,
    supportsNonRealTime: true,
    version: project.version,
    stepCount: descriptor.stepCount,
    actionDurations: compileActionDurations(descriptor),
    renderRequirements: [
      {
        // Per the EBU schema, these are constraint objects (modeled on MediaTrackConstraints'
        // ConstrainDouble/ConstrainBoolean), not raw values — confirmed against the live schema
        // during the Phase 5a ograf-devtool cross-check, which caught this exact divergence.
        resolution: { width: { exact: descriptor.width }, height: { exact: descriptor.height } },
        frameRate: { exact: descriptor.frameRate },
        accessToPublicInternet: { exact: needsPublicInternet },
      },
    ],
  };

  if (project.description) manifest.description = project.description;
  if (project.author.name) manifest.author = { ...project.author };
  if (Object.keys(schema.properties).length > 0)
    manifest.schema = schema as unknown as Record<string, unknown>;
  if (customActions.length > 0) manifest.customActions = customActions;

  return manifest;
}
