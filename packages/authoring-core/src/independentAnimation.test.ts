import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createProject,
  createRectangleLayer,
  getLayerTransformAtFrame,
  isLayerPropertyAnimated,
  migrateProject,
  type Layer,
  type Project,
} from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  composition.transitions.forEach((transition) => {
    transition.durationFrames = 25;
  });
  const layer = createRectangleLayer();
  layer.animationTrackMode = 'independent';
  layer.keyframes = [
    createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 220, width: 320, height: 180 })),
  ];
  layer.animationTracks = {};
  composition.layers.push(layer);
  return { session: new AuthoringSession(project), layerId: layer.id };
}

const layerIn = (project: Project, layerId: string): Layer =>
  project.compositions[0]!.layers.find((layer) => layer.id === layerId)!;
function expectOnlyX(layer: Layer) {
  expect(layer.animationTrackMode).toBe('independent');
  expect(Object.keys(layer.animationTracks)).toEqual(['x']);
  expect(isLayerPropertyAnimated(layer, 'x')).toBe(true);
  for (const property of ['y', 'width', 'height', 'rotation', 'opacity'] as const)
    expect(isLayerPropertyAnimated(layer, property)).toBe(false);
  for (const frame of [0, 12, 25, 50])
    expect(getLayerTransformAtFrame(layer, frame)).toMatchObject({
      y: 220,
      width: 320,
      height: 180,
      rotation: 0,
      opacity: 1,
    });
}

describe('independent animation through canonical authoring operations', () => {
  it('keys only the requested transform channel and preserves its source round trip', () => {
    const { session, layerId } = fixture();
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'set_property_key',
          layerId,
          property: 'x',
          frame: 0,
          value: 100,
          easing: 'linear',
        },
        { type: 'update_transform', layerId, scope: 'frame', frame: 25, patch: { x: 500 } },
      ],
    });
    expect(result.validation.errors).toEqual([]);
    const layer = layerIn(result.project, layerId);
    expectOnlyX(layer);
    expect(getLayerTransformAtFrame(layer, 0).x).toBe(100);
    expect(getLayerTransformAtFrame(layer, 25).x).toBe(500);
    const normalized = migrateProject(JSON.parse(JSON.stringify(result.project)));
    const reopened = new AuthoringSession(normalized).snapshot();
    expectOnlyX(layerIn(reopened.project, layerId));
    expect(getLayerTransformAtFrame(layerIn(reopened.project, layerId), 25).x).toBe(500);
  });

  it('preserves disabled channels when replacing, moving, changing and deleting a property key', () => {
    const { session, layerId } = fixture();
    const authored = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'set_property_track',
          layerId,
          property: 'x',
          keys: [
            { frame: 0, value: 100, easing: 'linear' },
            { frame: 25, value: 500, easing: 'linear' },
          ],
        },
      ],
    });
    expectOnlyX(layerIn(authored.project, layerId));
    const key = layerIn(authored.project, layerId).animationTracks.x!.find(
      (key) => key.frame === 25,
    )!;
    const moved = session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'move_property_key', layerId, property: 'x', keyframeId: key.id, frame: 30 },
        {
          type: 'set_property_key',
          layerId,
          property: 'x',
          frame: 30,
          value: 600,
          easing: 'linear',
        },
      ],
    });
    expectOnlyX(layerIn(moved.project, layerId));
    expect(getLayerTransformAtFrame(layerIn(moved.project, layerId), 15).x).toBe(350);
    const removed = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'remove_property_key',
          layerId,
          property: 'x',
          keyframeId: key.id,
        },
      ],
    });
    expectOnlyX(layerIn(removed.project, layerId));
    expect(layerIn(removed.project, layerId).animationTracks.x).toHaveLength(1);
    expect(getLayerTransformAtFrame(layerIn(removed.project, layerId), 30).x).toBe(100);
    expectOnlyX(
      layerIn(
        new AuthoringSession(JSON.parse(JSON.stringify(removed.project))).snapshot().project,
        layerId,
      ),
    );
  });
});
