import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createProject,
  getLayerTransformAtFrame,
} from '@ograf-editor/scene-model';
import { AuthoringSession, RevisionConflictError } from './session';

describe('AuthoringSession', () => {
  it('applies a multi-operation edit atomically with generated ids and one undo', () => {
    const session = new AuthoringSession(createProject(), 'test-session');
    const result = session.apply({
      expectedRevision: 0,
      reason: 'Build a title card',
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'Background' },
        { type: 'add_layer', kind: 'text', name: 'Headline' },
      ],
    });

    expect(result.revision).toBe(1);
    expect(result.summary.generatedIds).toHaveLength(2);
    expect(result.project.compositions[0]!.layers.map((layer) => layer.name)).toEqual([
      'Background',
      'Headline',
    ]);

    const undone = session.undo(1);
    expect(undone.revision).toBe(2);
    expect(undone.project.compositions[0]!.layers).toHaveLength(0);
  });

  it('rejects stale agent writes', () => {
    const session = new AuthoringSession(createProject(), 'test-session');
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_project_metadata', name: 'First' }],
    });

    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [{ type: 'set_project_metadata', name: 'Stale' }],
      }),
    ).toThrow(RevisionConflictError);
  });

  it('creates, edits, and ungroups timeline-only groups without changing layer order', () => {
    const session = new AuthoringSession(createProject(), 'timeline-group-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'Panel' },
        { type: 'add_layer', kind: 'text', name: 'Headline' },
      ],
    });
    const layerIds = created.summary.generatedIds.map((entry) => entry.id);
    const grouped = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'create_timeline_group',
          layerIds,
          name: 'Lower Third',
          color: '#31b7d4',
        },
      ],
    });
    const groupId = grouped.summary.generatedIds.find(
      (entry) => entry.kind === 'timeline-group',
    )!.id;
    expect(grouped.project.compositions[0]!.layout.timelineFolders).toEqual([
      { id: groupId, name: 'Lower Third', color: '#31b7d4', layerIds },
    ]);
    expect(grouped.project.compositions[0]!.layers.map((layer) => layer.id)).toEqual(layerIds);

    const edited = session.apply({
      expectedRevision: 2,
      operations: [
        { type: 'rename_timeline_group', groupId, name: 'Titles' },
        { type: 'set_timeline_group_color', groupId, color: '#f09a3e' },
      ],
    });
    expect(edited.project.compositions[0]!.layout.timelineFolders[0]).toMatchObject({
      name: 'Titles',
      color: '#f09a3e',
    });

    const ungrouped = session.apply({
      expectedRevision: 3,
      operations: [{ type: 'ungroup_timeline_group', groupId }],
    });
    expect(ungrouped.project.compositions[0]!.layout.timelineFolders).toEqual([]);
    expect(ungrouped.project.compositions[0]!.layers.map((layer) => layer.id)).toEqual(layerIds);
  });

  it('supports independent property keys without touching other tracks', () => {
    const session = new AuthoringSession(createProject(), 'test-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'rectangle' }],
    });
    const layerId = created.summary.generatedIds[0]!.id;
    const keyed = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'set_property_key', layerId, property: 'x', frame: 7, value: 720 }],
    });
    const layer = keyed.project.compositions[0]!.layers[0]!;

    expect(layer.animationTracks.x?.some((key) => key.frame === 7 && key.value === 720)).toBe(true);
    expect(layer.animationTracks.y?.some((key) => key.frame === 7)).toBe(false);
    expect(getLayerTransformAtFrame(layer, 7).x).toBe(720);
  });

  it('updates authored transforms at every lifecycle frame and retains explicit frame scope', () => {
    const session = new AuthoringSession(createProject(), 'authored-transform-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Panel' }],
    });
    const layerId = created.summary.generatedIds[0]!.id;
    const authored = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'update_transform', layerId, patch: { x: 321, height: 40 } }],
    });
    const composition = authored.project.compositions[0]!;
    const layer = composition.layers[0]!;
    for (const { frame } of computeKeyframeFrames(composition)) {
      expect(getLayerTransformAtFrame(layer, frame)).toMatchObject({ x: 321, height: 40 });
    }

    const framed = session.apply({
      expectedRevision: 2,
      operations: [
        { type: 'update_transform', layerId, scope: 'frame', frame: 7, patch: { x: 777 } },
      ],
    });
    expect(getLayerTransformAtFrame(framed.project.compositions[0]!.layers[0]!, 7).x).toBe(777);
    expect(getLayerTransformAtFrame(framed.project.compositions[0]!.layers[0]!, 0).x).toBe(321);
  });

  it('warns when shrink-to-fit typography falls below the safe box ratio', () => {
    const session = new AuthoringSession(createProject(), 'shrink-warning-session');
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          kind: 'text',
          name: 'Short box',
          transform: { height: 40 },
          element: { fontSize: 34, autoFit: 'shrink-to-fit' },
        },
      ],
    });
    expect(result.summary.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Short box')]),
    );
    expect(result.summary.warnings[0]).toContain('1.176');
  });

  it('replaces whole property tracks and expands stagger templates atomically', () => {
    const session = new AuthoringSession(createProject(), 'track-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'One' },
        { type: 'add_layer', kind: 'rectangle', name: 'Two' },
      ],
    });
    const [one, two] = created.summary.generatedIds.map((entry) => entry.id);
    const keyed = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_property_track',
          layerId: one!,
          property: 'opacity',
          keys: [
            { frame: 0, value: 0, easing: 'linear' },
            { frame: 6, value: 1, easing: 'quad-out' },
            { frame: 18, value: 0, easing: 'quad-in' },
          ],
        },
        {
          type: 'stagger_property_track',
          layerIds: [one!, two!],
          property: 'x',
          frameOffset: 3,
          keys: [
            { frame: 0, value: -200, easing: 'linear' },
            { frame: 6, value: 100, easing: 'cubic-out' },
          ],
        },
      ],
    });
    const [firstLayer, secondLayer] = keyed.project.compositions[0]!.layers;

    expect(firstLayer!.animationTracks.opacity?.map((key) => [key.frame, key.value])).toEqual([
      [0, 0],
      [6, 1],
      [18, 0],
    ]);
    expect(firstLayer!.animationTracks.x?.map((key) => key.frame)).toEqual([0, 6]);
    expect(secondLayer!.animationTracks.x?.map((key) => key.frame)).toEqual([3, 9]);
    expect(secondLayer!.animationTracks.y?.some((key) => key.frame === 3)).toBe(false);
    expect(keyed.summary.generatedIds).toHaveLength(7);
    expect(keyed.summary.affectedFrames).toEqual([0, 3, 6, 9, 18]);
  });

  it('authors a deterministic local multi-property loop without changing lifecycle tracks', () => {
    const session = new AuthoringSession(createProject(), 'loop-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'text', name: 'Flashing title' }],
    });
    const layerId = created.summary.generatedIds[0]!.id;
    const before = created.project.compositions[0]!.layers[0]!.animationTracks;
    const looped = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_layer_loop',
          layerId,
          durationFrames: 20,
          activation: { type: 'lifecycle' },
        },
        {
          type: 'set_loop_property_track',
          layerId,
          property: 'opacity',
          keys: [
            { frame: 0, value: 0.2, easing: 'linear' },
            { frame: 10, value: 1, easing: 'sine-out' },
            { frame: 20, value: 0.2, easing: 'sine-in' },
          ],
        },
        {
          type: 'set_loop_property_track',
          layerId,
          property: 'width',
          keys: [
            { frame: 0, value: 400, easing: 'linear' },
            { frame: 10, value: 440, easing: 'back-out' },
            { frame: 20, value: 400, easing: 'quad-in' },
          ],
        },
      ],
    });
    const layer = looped.project.compositions[0]!.layers[0]!;
    expect(layer.loop?.tracks.opacity?.map((key) => key.value)).toEqual([0.2, 1, 0.2]);
    expect(layer.loop?.tracks.width?.[1]).toMatchObject({ value: 440, easing: 'back-out' });
    expect(layer.animationTracks).toEqual(before);
    expect(looped.project.compositions[0]!.keyframes).toHaveLength(3);
    expect(looped.validation.valid).toBe(true);
  });

  it('persists layout metadata and bakes constraints and parent movement into tracks', () => {
    const session = new AuthoringSession(createProject(), 'layout-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'Parent' },
        { type: 'add_layer', kind: 'text', name: 'Child' },
      ],
    });
    const [parentId, childId] = created.summary.generatedIds.map((entry) => entry.id);
    const laidOut = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_composition_layout',
          patch: { showActionSafe: true, snapToGrid: true, gridSize: 20 },
        },
        { type: 'add_canvas_guide', axis: 'vertical', position: 960 },
        {
          type: 'set_layer_layout',
          layerId: parentId!,
          groupId: 'lower-third',
          constraints: { horizontal: 'right', vertical: 'bottom' },
        },
        {
          type: 'set_layer_layout',
          layerId: childId!,
          groupId: 'lower-third',
          parentId: parentId!,
        },
        { type: 'update_transform', layerId: parentId!, frame: 12, patch: { x: 300, y: 250 } },
        { type: 'set_composition', width: 2020, height: 1180 },
      ],
    });
    const composition = laidOut.project.compositions[0]!;
    const parent = composition.layers.find((layer) => layer.id === parentId)!;
    const child = composition.layers.find((layer) => layer.id === childId)!;
    expect(composition.layout).toMatchObject({
      showActionSafe: true,
      snapToGrid: true,
      gridSize: 20,
    });
    expect(composition.layout.guides[0]).toMatchObject({ axis: 'vertical', position: 960 });
    expect(getLayerTransformAtFrame(parent, 12)).toMatchObject({ x: 400, y: 350 });
    expect(getLayerTransformAtFrame(child, 12)).toMatchObject({ x: 300, y: 250 });

    session.apply({
      expectedRevision: 2,
      operations: [{ type: 'set_layer_layout', layerId: parentId!, isLocked: true }],
    });
    expect(() =>
      session.apply({
        expectedRevision: 3,
        operations: [{ type: 'update_transform', layerId: parentId!, frame: 12, patch: { x: 0 } }],
      }),
    ).toThrow('Layer is locked');
    expect(session.revision).toBe(3);
  });

  it('returns a dry-run project without changing the session revision', () => {
    const session = new AuthoringSession(createProject(), 'test-session');
    const result = session.apply({
      expectedRevision: 0,
      dryRun: true,
      operations: [{ type: 'add_layer', kind: 'text' }],
    });

    expect(result.dryRun).toBe(true);
    expect(result.project.compositions[0]!.layers).toHaveLength(1);
    expect(session.snapshot().project.compositions[0]!.layers).toHaveLength(0);
    expect(session.revision).toBe(0);
  });

  it('invalidates agent undo history when the human editor changes the base project', () => {
    const session = new AuthoringSession(createProject(), 'test-session');
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_project_metadata', name: 'Agent edit' }],
    });
    const editorProject = session.snapshot().project;
    editorProject.name = 'Human edit';
    session.replaceExternal(editorProject);

    expect(session.snapshot().project.name).toBe('Human edit');
    expect(() => session.undo(2)).toThrow('Nothing to undo');
  });

  it('initializes an editor baseline without creating a revision or history entry', () => {
    const session = new AuthoringSession(createProject(), 'editor-baseline-session');
    const browserProject = createProject();
    browserProject.name = 'Browser baseline';

    const initialized = session.initializeExternal(browserProject);

    expect(initialized.revision).toBe(0);
    expect(initialized.project.name).toBe('Browser baseline');
    expect(session.getChanges(0)).toEqual([]);
    expect(session.matchesExternal(browserProject)).toBe(true);
  });

  it('updates fields and refuses or atomically clears dependent bindings on removal', () => {
    const session = new AuthoringSession(createProject(), 'field-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'text', name: 'Bound headline' },
        {
          type: 'add_data_field',
          fieldType: 'text',
          key: 'headline',
          label: 'Headline',
        },
      ],
    });
    const layerId = created.summary.generatedIds.find((entry) => entry.kind === 'layer')!.id;
    const fieldId = created.summary.generatedIds.find((entry) => entry.kind === 'field')!.id;
    session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'set_layer_binding', layerId, binding: { fieldId, targetProperty: 'content' } },
        {
          type: 'update_data_field',
          fieldId,
          key: 'name',
          label: 'Name',
          defaultValue: 'Alex Morgan',
          required: true,
        },
      ],
    });

    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'remove_data_field', fieldId }],
      }),
    ).toThrow(/Bound headline.*force=true/);
    expect(session.revision).toBe(2);

    const removed = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'remove_data_field', fieldId, force: true }],
    });
    expect(removed.summary.clearedBindings).toEqual([
      { layerId, layerName: 'Bound headline', fieldId },
    ]);
    expect(removed.project.compositions[0]!.dataFields).toHaveLength(0);
    expect(removed.project.compositions[0]!.layers[0]!.bindings).toEqual([]);
  });

  it('registers assets once and duplicates independent grouped layers with cloned fields', () => {
    const session = new AuthoringSession(createProject(), 'duplicate-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_asset',
          name: 'Sun',
          mimeType: 'image/svg+xml',
          data: 'PHN2Zy8+',
        },
        { type: 'add_layer', kind: 'text', name: 'D1 High', transform: { x: 100 } },
        { type: 'add_data_field', fieldType: 'text', key: 'd1_high', label: 'Day 1 high' },
      ],
    });
    const layerId = created.summary.generatedIds.find((item) => item.kind === 'layer')!.id;
    const fieldId = created.summary.generatedIds.find((item) => item.kind === 'field')!.id;
    session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'set_layer_binding', layerId, binding: { fieldId, targetProperty: 'content' } },
      ],
    });
    const duplicateOperation = {
      type: 'duplicate_group' as const,
      source: { layerIds: [layerId] },
      count: 2,
      transformOffset: { x: 264 },
      namePattern: 'D{n} ',
      bindings: 'clone' as const,
      fieldKeyRewrite: { from: 'd1', to: 'd{n}' },
      labelRewrite: { from: 'Day 1', to: 'Day {n}' },
    };
    const projected = session.apply({
      expectedRevision: 2,
      dryRun: true,
      operations: [duplicateOperation],
    });
    expect(projected.summary.duplicateGroups[0]!.copies).toHaveLength(2);
    expect(session.revision).toBe(2);
    const duplicated = session.apply({
      expectedRevision: 2,
      operations: [duplicateOperation],
    });
    const composition = duplicated.project.compositions[0]!;
    expect(composition.assets).toHaveLength(1);
    expect(composition.layers.map((layer) => layer.name)).toEqual([
      'D1 High',
      'D2 High',
      'D3 High',
    ]);
    expect(composition.layers.map((layer) => getLayerTransformAtFrame(layer, 0).x)).toEqual([
      100, 364, 628,
    ]);
    expect(composition.dataFields.map((field) => field.key)).toEqual([
      'd1_high',
      'd2_high',
      'd3_high',
    ]);
    expect(new Set(composition.layers.map((layer) => layer.bindings[0]?.fieldId)).size).toBe(3);
    expect(duplicated.summary.duplicateGroups[0]!.copies).toHaveLength(2);
    session.apply({
      expectedRevision: 3,
      operations: [
        {
          type: 'duplicate_group',
          source: { layerIds: [layerId] },
          count: 1,
          frameOffset: 1,
          bindings: 'clear',
        },
      ],
    });
    session.apply({
      expectedRevision: 4,
      operations: [{ type: 'set_property_key', layerId, property: 'x', frame: 23, value: 999 }],
    });
    expect(() =>
      session.apply({
        expectedRevision: 5,
        operations: [
          {
            type: 'duplicate_group',
            source: { layerIds: [layerId] },
            count: 1,
            frameOffset: 2,
            bindings: 'clear',
          },
        ],
      }),
    ).toThrow(/outside 0../);
    expect(session.revision).toBe(5);
  });

  it('offsets authored duplicate keys while keeping lifecycle compatibility keys anchored', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.transitions[0]!.durationFrames = 30;
    composition.transitions[1]!.durationFrames = 20;
    const session = new AuthoringSession(project, 'duplicate-frame-offset-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: Array.from({ length: 9 }, (_, index) => ({
        type: 'add_layer' as const,
        kind: 'rectangle' as const,
        name: `D1 Layer ${index + 1}`,
      })),
    });
    const sourceIds = created.summary.generatedIds.map((entry) => entry.id);
    session.apply({
      expectedRevision: 1,
      operations: sourceIds.map((layerId, index) => ({
        type: 'set_property_key' as const,
        layerId,
        property: 'x' as const,
        frame: 38,
        value: 500 + index,
      })),
    });

    const duplicated = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'duplicate_group',
          source: { layerIds: sourceIds },
          count: 6,
          frameOffset: 2,
          namePattern: 'D{n} ',
        },
      ],
    });

    const copies = duplicated.summary.duplicateGroups[0]!.copies;
    expect(copies).toHaveLength(6);
    const resultComposition = duplicated.project.compositions[0]!;
    copies.forEach((copy, copyIndex) => {
      const layer = resultComposition.layers.find(
        (candidate) => candidate.id === copy.layers[sourceIds[0]!],
      )!;
      const expectedAuthoredFrame = 38 + (copyIndex + 1) * 2;
      const frames = layer.animationTracks.x?.map((key) => key.frame) ?? [];
      expect(frames).toEqual(expect.arrayContaining([0, 30, 50]));
      expect(frames).toContain(expectedAuthoredFrame);
      expect(layer.animationTracks.x?.every((key) => key.frame <= 50)).toBe(true);
      expect(getLayerTransformAtFrame(layer, expectedAuthoredFrame).x).toBe(500);
    });
  });

  it('duplicates clip-parent relationships with remapped ids', () => {
    const session = new AuthoringSession(createProject(), 'clip-duplicate-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'D1 Body' },
        { type: 'add_layer', kind: 'text', name: 'D1 Label' },
      ],
    });
    const [parentId, childId] = created.summary.generatedIds.map((entry) => entry.id);
    session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'set_layer_layout', layerId: parentId!, clipChildren: true },
        { type: 'set_layer_layout', layerId: childId!, parentId: parentId! },
      ],
    });

    const result = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'duplicate_group',
          source: { layerIds: [parentId!, childId!] },
          count: 1,
          namePattern: 'D{n} ',
        },
      ],
    });
    const copy = result.summary.duplicateGroups[0]!.copies[0]!;
    const copiedParent = result.project.compositions[0]!.layers.find(
      (layer) => layer.id === copy.layers[parentId!],
    )!;
    const copiedChild = result.project.compositions[0]!.layers.find(
      (layer) => layer.id === copy.layers[childId!],
    )!;
    expect(copiedParent.clipChildren).toBe(true);
    expect(copiedChild.parentId).toBe(copiedParent.id);
  });

  it('warns when transition retiming leaves keys at moved or out-of-range frames', () => {
    const project = createProject();
    const transitionId = project.compositions[0]!.transitions[1]!.id;
    const session = new AuthoringSession(project, 'retime-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Animated panel' }],
    });
    const layerId = created.summary.generatedIds[0]!.id;
    session.apply({
      expectedRevision: 1,
      operations: [{ type: 'set_property_key', layerId, property: 'x', frame: 24, value: 500 }],
    });
    const retimed = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'set_transition', transitionId, durationFrames: 4 }],
    });
    expect(retimed.summary.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('outside the new composition duration'),
        expect.stringContaining('moved lifecycle frame'),
      ]),
    );
  });

  it('saves and instantiates reusable components as independent standard layers', () => {
    const session = new AuthoringSession(createProject(), 'component-session');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'Panel' },
        { type: 'add_layer', kind: 'text', name: 'Label' },
      ],
    });
    const layerIds = created.summary.generatedIds.map((entry) => entry.id);
    const saved = session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'save_component', layerIds, name: 'Score row', id: 'component-score-row' },
      ],
    });
    expect(saved.project.compositions[0]!.components[0]).toMatchObject({
      id: 'component-score-row',
      name: 'Score row',
    });

    const inserted = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'instantiate_component',
          componentId: 'component-score-row',
          offset: { x: 100, y: 50 },
        },
      ],
    });
    const instance = inserted.summary.componentInstances[0]!;
    const instanceLayers = inserted.project.compositions[0]!.layers.filter((layer) =>
      Object.values(instance.layers).includes(layer.id),
    );
    expect(instanceLayers).toHaveLength(2);
    expect(new Set(instanceLayers.map((layer) => layer.groupId))).toEqual(
      new Set([instance.groupId]),
    );
    expect(instanceLayers.every((layer) => layer.name.startsWith('Score row — '))).toBe(true);
  });

  it('records browser and agent changes and makes reset undoable', () => {
    const session = new AuthoringSession(createProject(), 'history-session');
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Agent panel' }],
    });
    const editorProject = session.snapshot().project;
    editorProject.compositions[0]!.layers[0]!.name = 'Human-renamed panel';
    session.replaceExternal(editorProject, 'UI rename');
    const reset = session.reset(createProject(), 2);

    expect(session.getChanges(0).map((change) => change.source)).toEqual([
      'agent',
      'editor',
      'agent',
    ]);
    expect(reset.summary.operationTypes).toEqual(['reset_project']);
    expect(session.snapshot().project.compositions[0]!.layers).toHaveLength(0);
    expect(session.undo(3).project.compositions[0]!.layers[0]!.name).toBe('Human-renamed panel');
  });
});
