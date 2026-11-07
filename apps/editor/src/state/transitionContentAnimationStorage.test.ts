import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createAnimationPresetPluginSnapshot,
  createDefaultTransform,
  createLayerKeyframe,
  createProject,
  createRectangleLayer,
  studioPluginReference,
  TRANSITION_LOGIC_VERSION,
} from '@ograf-editor/scene-model';
import { buildCoordinatedExportArtifactsWithRuntime } from '@ograf-editor/codegen';
import {
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
} from './projectSet';

function fixture() {
  const project = createProject({ name: 'Title' });
  const composition = project.compositions[0]!;
  const layer = createRectangleLayer();
  layer.keyframes = computeKeyframeFrames(composition).map(({ frame }) =>
    createLayerKeyframe(frame, createDefaultTransform({ x: 100, y: 100, width: 400, height: 80 })),
  );
  composition.layers = [layer];
  const set = createProjectSet('Motion set', project);
  const snapshot = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.portable-transition',
      version: '1.0.0',
      name: 'Portable transition',
      license: 'MIT',
    },
    licenseText: 'MIT fixture notice retained exactly.',
    presets: [
      {
        id: 'fade-in',
        name: 'Fade in',
        tracks: {
          in: [
            {
              property: 'opacity',
              mode: 'absolute',
              keys: [
                { at: 0, value: 0 },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
        },
      },
    ],
  });
  set.transitionLogic = {
    version: TRANSITION_LOGIC_VERSION,
    id: 'motion-set-playout',
    name: 'Motion set playout',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [{ id: 'title', name: 'Title', slotId: 'main', templateId: set.templates[0]!.id }],
    transitions: [
      {
        id: 'motion',
        name: 'Motion',
        durationFrames: 12,
        outgoingFrames: 12,
        incomingStartFrame: 0,
        incomingFrames: 12,
        sharedFrames: 12,
        easing: 'ease-in-out',
        incomingAnimation: {
          type: 'plugin',
          reference: studioPluginReference(snapshot),
          presetId: 'fade-in',
        },
        outgoingAnimation: { type: 'builtin', motion: { style: 'wipe', direction: 'right' } },
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
    defaultTransitionId: 'motion',
    animationPresetPlugins: [snapshot],
  };
  return set;
}

describe('transition animation source portability', () => {
  it.each(['compact', 'compatible'] as const)(
    'round-trips %s source and exports selected motion without a local plugin installation',
    async (archiveMode) => {
      const source = fixture();
      const before = structuredClone(source);
      const archive = await createProjectSetArchive(source, { archiveMode });
      const opened = await openProjectSetArchive(new Uint8Array(await archive.arrayBuffer()));
      expect(opened.transitionLogic).toEqual(source.transitionLogic);
      expect(source).toEqual(before);
      const project = resolveProjectSetTemplate(opened, opened.templates[0]!.id);
      expect(project.compositions[0]!.layers[0]!.animationTracks).toEqual(
        resolveProjectSetTemplate(source, source.templates[0]!.id).compositions[0]!.layers[0]!
          .animationTracks,
      );
      const artifacts = buildCoordinatedExportArtifactsWithRuntime(
        {
          id: opened.id,
          name: opened.name,
          definition: opened.transitionLogic!,
          templates: opened.templates.map((template) => ({
            id: template.id,
            name: template.name,
            project: resolveProjectSetTemplate(opened, template.id),
          })),
          componentAssets: [],
        },
        'class CoordinatedGraphicElement {}',
      );
      expect(artifacts.errors).toEqual([]);
      const motion = artifacts.transitionDescriptor!.contentAnimations!.motion!;
      expect(motion.incoming!.layer.animationTracks.opacity!.map((key) => key.value)).toEqual([
        0, 1, 1,
      ]);
      expect(motion.outgoing!.layer.animationTracks.clipLeft!.at(-1)!.value).toBe(1);
      expect(artifacts.transitionDescriptor!.definition.animationPresetPlugins).toEqual(
        source.transitionLogic!.animationPresetPlugins,
      );
    },
  );
});
