import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createFieldDefinition,
  createCustomActionDefinition,
  createLayerKeyframe,
  createLayerVisualRule,
  createLayerLoopClip,
  createLayerPropertyKeyframe,
  createProject,
  createRectangleLayer,
  getLayerPropertyValueAtFrame,
  getElementShaderPaint,
  getResolvedLayerAnimationTracks,
  isLayerPropertyAnimated,
  migrateProject,
  resetLayerPropertyAnimation,
  setLayerLighting,
  setTilingPattern,
  type Layer,
  type Project,
} from '@ograf-editor/scene-model';
import { AuthoringSession, RevisionConflictError } from './session';

function fixture(legacy = false) {
  const project = createProject();
  const composition = project.compositions[0]!;
  composition.transitions.forEach((transition) => {
    transition.durationFrames = 25;
  });
  const layer = createRectangleLayer();
  layer.name = 'Moving panel';
  layer.keyframes = [0, 25, 50].map((frame) =>
    createLayerKeyframe(frame, createDefaultTransform({ x: 100 + frame * 8, y: 220 + frame * 4 })),
  );
  if (!legacy) {
    layer.animationTrackMode = 'independent';
    layer.keyframes = [layer.keyframes[0]!];
    layer.animationTracks = {
      x: [createLayerPropertyKeyframe(0, 100), createLayerPropertyKeyframe(50, 500)],
      y: [createLayerPropertyKeyframe(0, 220), createLayerPropertyKeyframe(50, 420)],
    };
  }
  composition.layers.push(layer);
  return { project, composition, layer };
}
const layerIn = (project: Project, layerId: string): Layer =>
  project.compositions[0]!.layers.find((layer) => layer.id === layerId)!;
const reset = (
  session: AuthoringSession,
  layerId: string,
  property: 'x' | 'scale' | 'opacity',
  frame: number,
  loopElapsedFrames?: number,
) =>
  session.apply({
    expectedRevision: session.revision,
    operations: [
      {
        type: 'reset_property_animation',
        layerId,
        property,
        frame,
        ...(loopElapsedFrames !== undefined ? { loopElapsedFrames } : {}),
      },
    ],
  });

describe('canonical reset property animation', () => {
  it.each(['x', 'y'] as const)(
    'retains a fractional reset %s through editor mirroring, JSON migration, later MCP edits and reopening',
    (property) => {
      const { project, composition, layer } = fixture();
      layer.loop = createLayerLoopClip({
        durationFrames: 10,
        tracks: {
          x: [createLayerPropertyKeyframe(0, 100), createLayerPropertyKeyframe(10, 200)],
          y: [createLayerPropertyKeyframe(0, 100), createLayerPropertyKeyframe(10, 200)],
        },
      });
      const session = new AuthoringSession(project);
      // Match a UI Reset of a held preview loop, whose base playhead remains on the Step.
      const frozen = resetLayerPropertyAnimation(layer, property, 25, {
        composition,
        loopElapsedFrames: 5.247,
      });
      expect(frozen).toBeCloseTo(152.47);
      const serialized: Project = JSON.parse(JSON.stringify(project));
      const normalized = migrateProject(serialized);
      expect(getLayerPropertyValueAtFrame(layerIn(normalized, layer.id), property, 25)).toBe(
        frozen,
      );
      const mirrored = session.replaceExternal(serialized);
      expect(getLayerPropertyValueAtFrame(layerIn(mirrored.project, layer.id), property, 25)).toBe(
        frozen,
      );
      expect(session.matchesExternal(serialized)).toBe(true);
      const next = session.apply({
        expectedRevision: session.revision,
        operations: [{ type: 'rename_layer', layerId: layer.id, name: 'After fractional reset' }],
      });
      expect(next.validation.errors).toEqual([]);
      expect(getLayerPropertyValueAtFrame(layerIn(next.project, layer.id), property, 25)).toBe(
        frozen,
      );
      const reopened = new AuthoringSession(JSON.parse(JSON.stringify(next.project)));
      expect(
        getLayerPropertyValueAtFrame(layerIn(reopened.snapshot().project, layer.id), property, 25),
      ).toBe(frozen);
      const authored = reopened.apply({
        expectedRevision: reopened.revision,
        operations: [
          {
            type: 'update_transform',
            layerId: layer.id,
            scope: 'frame',
            frame: 7,
            patch: { [property]: 19.6 },
          },
        ],
      });
      expect(getLayerPropertyValueAtFrame(layerIn(authored.project, layer.id), property, 7)).toBe(
        20,
      );
    },
  );

  it('freezes only the selected channel at the explicit playhead and survives source reload and Undo', () => {
    const { project, layer } = fixture();
    const session = new AuthoringSession(project);
    const before = session.snapshot().project;
    const y = structuredClone(layerIn(before, layer.id).animationTracks.y);
    const result = reset(session, layer.id, 'x', 25);
    expect(result.validation.errors).toEqual([]);
    const after = layerIn(result.project, layer.id);
    expect(isLayerPropertyAnimated(after, 'x')).toBe(false);
    expect(after.animationTracks.y).toEqual(y);
    for (const frame of [0, 25, 50])
      expect(getLayerPropertyValueAtFrame(after, 'x', frame)).toBe(300);
    expect(after.keyframes.some((key) => key.frame === 0)).toBe(true);
    const reopened = new AuthoringSession(
      migrateProject(JSON.parse(JSON.stringify(result.project))),
    ).snapshot();
    expect(isLayerPropertyAnimated(layerIn(reopened.project, layer.id), 'x')).toBe(false);
    expect(getLayerPropertyValueAtFrame(layerIn(reopened.project, layer.id), 'x', 0)).toBe(300);
    expect(session.undo(1).project).toEqual(before);
    expect(session.redo(2).project).toEqual(result.project);
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          { type: 'reset_property_animation', layerId: layer.id, property: 'y', frame: 25 },
        ],
      }),
    ).toThrow(RevisionConflictError);
  });

  it('removes this main and local-loop channel while retaining unrelated loop timing and keys', () => {
    const { project, layer } = fixture();
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: {
        x: [createLayerPropertyKeyframe(0, 10), createLayerPropertyKeyframe(10, 50)],
        y: [createLayerPropertyKeyframe(0, 220), createLayerPropertyKeyframe(10, 240)],
      },
    });
    const session = new AuthoringSession(project);
    const before = layerIn(session.snapshot().project, layer.id);
    const result = reset(session, layer.id, 'x', 30);
    const after = layerIn(result.project, layer.id);
    expect(getLayerPropertyValueAtFrame(after, 'x', 0)).toBe(30);
    expect(after.animationTracks.x).toBeUndefined();
    expect(after.animationTracks.y).toEqual(before.animationTracks.y);
    expect(after.loop).toEqual({ ...before.loop!, tracks: { y: before.loop!.tracks.y } });
    expect(result.validation.errors).toEqual([]);
  });

  it('uses an explicitly supplied held/custom-action loop phase', () => {
    const { project, composition, layer } = fixture();
    composition.customActions.push(createCustomActionDefinition({ actionId: 'pulse' }));
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      activation: { type: 'customAction', customActionId: 'pulse' },
      tracks: {
        x: [createLayerPropertyKeyframe(0, 10), createLayerPropertyKeyframe(10, 50)],
        y: [createLayerPropertyKeyframe(0, 220), createLayerPropertyKeyframe(10, 240)],
      },
    });
    const inactive = reset(new AuthoringSession(project), layer.id, 'x', 25);
    expect(getLayerPropertyValueAtFrame(layerIn(inactive.project, layer.id), 'x', 0)).toBe(300);
    const active = reset(new AuthoringSession(project), layer.id, 'x', 25, 2.5);
    expect(getLayerPropertyValueAtFrame(layerIn(active.project, layer.id), 'x', 0)).toBe(20);
    expect(layerIn(active.project, layer.id).loop!.activation).toEqual(layer.loop.activation);
  });

  it('preserves legacy sibling animation exactly while making only the chosen channel static', () => {
    const { project, layer } = fixture(true);
    const session = new AuthoringSession(project);
    const before = layerIn(session.snapshot().project, layer.id);
    const y = structuredClone(getResolvedLayerAnimationTracks(before).y);
    const after = layerIn(reset(session, layer.id, 'x', 25).project, layer.id);
    expect(after.animationTrackMode).toBe('independent');
    expect(isLayerPropertyAnimated(after, 'x')).toBe(false);
    expect(getResolvedLayerAnimationTracks(after).y).toEqual(y);
    for (const frame of [0, 12, 25, 37, 50]) {
      expect(getLayerPropertyValueAtFrame(after, 'x', frame)).toBe(300);
      expect(getLayerPropertyValueAtFrame(after, 'y', frame)).toBe(
        getLayerPropertyValueAtFrame(before, 'y', frame),
      );
    }
  });

  it('restores a virtual reveal channel to neutral instead of leaving hidden artwork', () => {
    const { project, layer } = fixture();
    layer.animationTracks.scale = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(50, 1),
    ];
    layer.loop = createLayerLoopClip({
      tracks: {
        scale: [createLayerPropertyKeyframe(0, 0.2), createLayerPropertyKeyframe(30, 0.6)],
        y: [createLayerPropertyKeyframe(0, 220)],
      },
    });
    const after = layerIn(
      reset(new AuthoringSession(project), layer.id, 'scale', 0).project,
      layer.id,
    );
    expect(getLayerPropertyValueAtFrame(after, 'scale', 0)).toBe(1);
    expect(after.animationTracks.scale).toBeUndefined();
    expect(after.loop?.tracks.scale).toBeUndefined();
    expect(after.loop?.tracks.y).toEqual(layer.loop.tracks.y);
  });

  it('rejects a locked target atomically, preserving earlier operations and revision', () => {
    const { project, layer } = fixture();
    layer.isLocked = true;
    const session = new AuthoringSession(project);
    const before = session.snapshot();
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          { type: 'set_project_metadata', name: 'Must not persist' },
          { type: 'reset_property_animation', layerId: layer.id, property: 'x', frame: 25 },
        ],
      }),
    ).toThrow(/lock/i);
    expect(session.snapshot()).toEqual(before);
  });

  it('retains ordinary transform and effect data defaults when their authored animation resets', () => {
    const { project, composition, layer } = fixture();
    const position = createFieldDefinition('number', { key: 'position', defaultValue: 900 });
    const blur = createFieldDefinition('number', { key: 'blur', defaultValue: 20 });
    composition.dataFields.push(position, blur);
    layer.bindings = [
      { fieldId: position.id, targetProperty: 'layer.x' },
      { fieldId: blur.id, targetProperty: 'blur' },
    ];
    layer.visualRules = [
      createLayerVisualRule({
        fieldId: position.id,
        value: 900,
        actions: [{ type: 'visibility', visible: true }],
      }),
    ];
    layer.animationTracks.blur = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(50, 10),
    ];
    const session = new AuthoringSession(project);
    const before = session.snapshot().project;
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'reset_property_animation', layerId: layer.id, property: 'x', frame: 25 },
        { type: 'reset_property_animation', layerId: layer.id, property: 'blur', frame: 25 },
      ],
    });
    expect(result.validation.errors).toEqual([]);
    expect(result.project.compositions[0]!.dataFields).toEqual(before.compositions[0]!.dataFields);
    expect(layerIn(result.project, layer.id).bindings).toEqual(layerIn(before, layer.id).bindings);
    expect(layerIn(result.project, layer.id).visualRules).toEqual(
      layerIn(before, layer.id).visualRules,
    );
    expect(getLayerPropertyValueAtFrame(layerIn(result.project, layer.id), 'x', 0)).toBe(300);
    expect(getLayerPropertyValueAtFrame(layerIn(result.project, layer.id), 'blur', 0)).toBe(5);
  });

  it('rejects a shared-lighting-owned channel without disconnecting the light controller', () => {
    const { project, composition, layer } = fixture();
    const pattern = setTilingPattern(composition, { lighting: {} });
    setLayerLighting(composition, layer.id, {
      patternId: pattern.id,
      role: 'light',
      phaseOffset: 0,
      gain: 1,
      cyclesPerLoop: 1,
    });
    const session = new AuthoringSession(project);
    const before = session.snapshot();
    expect(() => reset(session, layer.id, 'opacity', 25)).toThrow(/light|unlink/i);
    expect(session.snapshot()).toEqual(before);
  });

  it('retains shader bindings while updating only the reset uniform fallback', () => {
    const fragmentSource = `#pragma ograf amount slider min(0) max(2) step(0.1)
const float amount = 0.5;
#pragma ograf offset vector2 min(-1) max(1)
const vec2 offset = vec2(0.0);
void mainImage(out vec4 c, in vec2 p) { c = vec4(amount + offset.x); }`;
    const session = new AuthoringSession(createProject());
    const added = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'shader', element: { fragmentSource } }],
    });
    const id = added.project.compositions[0]!.layers[0]!.id;
    const keyed = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_property_track',
          layerId: id,
          property: 'fill.parameters.amount',
          keys: [
            { frame: 0, value: 0.2, easing: 'linear' },
            { frame: 24, value: 1.8, easing: 'linear' },
          ],
        },
      ],
    });
    const before = keyed.project.compositions[0]!;
    const otherField = before.dataFields.find(
      (field) => field.generatedShaderParameter?.name === 'offset',
    )!;
    const result = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'reset_property_animation',
          layerId: id,
          property: 'fill.parameters.amount',
          frame: 12,
        },
      ],
    });
    const after = result.project.compositions[0]!;
    expect(result.validation.errors).toEqual([]);
    expect(layerIn(result.project, id).bindings).toEqual(layerIn(keyed.project, id).bindings);
    expect(
      getElementShaderPaint(layerIn(result.project, id).element)?.parameters.amount,
    ).toBeCloseTo(1);
    expect(
      after.dataFields.find((field) => field.generatedShaderParameter?.name === 'amount')!
        .defaultValue,
    ).toBeCloseTo(1);
    expect(after.dataFields.find((field) => field.id === otherField.id)).toEqual(otherField);
    const reopened = new AuthoringSession(JSON.parse(JSON.stringify(result.project))).snapshot();
    expect(
      getElementShaderPaint(layerIn(reopened.project, id).element)?.parameters.amount,
    ).toBeCloseTo(1);
    expect(layerIn(reopened.project, id).animationTracks['fill.parameters.amount']).toBeUndefined();
  });
});
