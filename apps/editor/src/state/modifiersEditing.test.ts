import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayerPropertyKeyframe,
  getLayerPropertyValueAtFrame,
  modifierProperty,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { getHistorySnapshot, resetHistory, undo } from './historyStore';
import { useTimelineStore } from './timelineStore';
import { useTestDataStore } from './testDataStore';
import {
  addModifier,
  copyModifier,
  deleteModifier,
  editLayerModifier,
  exposeModifierNumber,
  moveModifier,
  resetModifier,
  setModifierNumber,
} from './modifiersEditing';

vi.stubGlobal('window', { clearTimeout });
const active = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};
const layer = (id: string) => active().layers.find((entry) => entry.id === id)!;

describe('Modifier pane editing services', () => {
  let textId: string;
  let backgroundId: string;
  beforeEach(() => {
    useProjectStore.getState().newProject();
    textId = useProjectStore.getState().addLayer('text');
    backgroundId = useProjectStore.getState().addLayer('rectangle');
    useTimelineStore.getState().setCurrentFrame(0);
    useTimelineStore.getState().setAutoKeyframe(false);
    useTestDataStore.getState().resetAll();
    resetHistory();
  });

  it('adds one stable modifier as a single undoable edit without changing authored geometry', () => {
    const before = structuredClone(layer(backgroundId).keyframes);
    const id = addModifier(backgroundId, 'auto-size', {
      source: { kind: 'layer', layerId: textId },
    });
    expect(layer(backgroundId).modifiers).toEqual([
      expect.objectContaining({ id, type: 'auto-size' }),
    ]);
    expect(layer(backgroundId).keyframes).toEqual(before);
    expect(getHistorySnapshot().past).toHaveLength(1);
    undo();
    expect(layer(backgroundId).modifiers ?? []).toEqual([]);
  });

  it('rejects missing references atomically and leaves history untouched', () => {
    const before = useProjectStore.getState().project;
    expect(() =>
      addModifier(backgroundId, 'auto-follow', {
        source: { kind: 'layer', layerId: 'missing' },
      }),
    ).toThrow();
    expect(useProjectStore.getState().project).toBe(before);
    expect(getHistorySnapshot().past).toHaveLength(0);
  });

  it('rejects dependency cycles and conflicting writers without publishing half an edit', () => {
    addModifier(backgroundId, 'auto-follow', { source: { kind: 'layer', layerId: textId } });
    const before = useProjectStore.getState().project;
    expect(() =>
      addModifier(textId, 'auto-follow', {
        source: { kind: 'layer', layerId: backgroundId },
      }),
    ).toThrow();
    expect(useProjectStore.getState().project).toBe(before);
    expect(() =>
      addModifier(backgroundId, 'auto-follow', {
        source: { kind: 'layer', layerId: textId },
      }),
    ).toThrow();
    expect(useProjectStore.getState().project).toBe(before);
  });

  it('duplicates disabled with fresh entry/key IDs and reorders by stable IDs', () => {
    const id = addModifier(textId, 'max-text-width', { maxWidth: 600 });
    useTimelineStore.getState().setAutoKeyframe(true);
    setModifierNumber(textId, id, 'maxWidth', 550);
    const copyId = copyModifier(textId, id);
    expect(copyId).not.toBe(id);
    expect(layer(textId).modifiers?.[1]).toMatchObject({ id: copyId, enabled: false });
    const first = layer(textId).animationTracks[modifierProperty(id, 'maxWidth')]![0]!;
    const copy = layer(textId).animationTracks[modifierProperty(copyId, 'maxWidth')]![0]!;
    expect(copy.value).toBe(first.value);
    expect(copy.id).not.toBe(first.id);
    moveModifier(textId, copyId, -1);
    expect(layer(textId).modifiers?.map((entry) => entry.id)).toEqual([copyId, id]);
  });

  it('Auto-keyframe edits only the requested parameter at the current frame', () => {
    const id = addModifier(textId, 'max-text-width', { maxWidth: 600 });
    const initialX = structuredClone(layer(textId).animationTracks.x);
    useTimelineStore.getState().setAutoKeyframe(true);
    useTimelineStore.getState().setCurrentFrame(8);
    setModifierNumber(textId, id, 'maxWidth', 420);
    expect(layer(textId).animationTracks[modifierProperty(id, 'maxWidth')]).toEqual([
      expect.objectContaining({ frame: 0, value: 600 }),
      expect.objectContaining({ frame: 8, value: 420 }),
    ]);
    expect(layer(textId).animationTracks[modifierProperty(id, 'minFontSize')]).toBeUndefined();
    expect(layer(textId).animationTracks.x).toEqual(initialX);
    expect(layer(backgroundId).modifiers).toBeUndefined();
  });

  it('whole-animation edits offset only existing keys on this parameter', () => {
    const id = addModifier(textId, 'max-text-width', { maxWidth: 600 });
    const property = modifierProperty(id, 'maxWidth');
    const project = structuredClone(useProjectStore.getState().project);
    const target = project.compositions[0]!.layers.find((entry) => entry.id === textId)!;
    target.animationTracks[property] = [
      createLayerPropertyKeyframe(0, 600),
      createLayerPropertyKeyframe(12, 400),
    ];
    useProjectStore.setState({ project });
    useTimelineStore.getState().setEditScope('whole-animation');
    setModifierNumber(textId, id, 'maxWidth', 700);
    expect(layer(textId).animationTracks[property]?.map((key) => key.value)).toEqual([700, 500]);
    expect(getLayerPropertyValueAtFrame(layer(textId), property, 0)).toBe(700);
  });

  it('keys an already animated modifier at the playhead with Auto off, preserving earlier keys', () => {
    const id = addModifier(textId, 'max-text-width', { maxWidth: 600 });
    const property = modifierProperty(id, 'maxWidth');
    useProjectStore.getState().enableLayerPropertyAnimation(textId, property, 0);
    useTimelineStore.getState().setCurrentFrame(8);
    setModifierNumber(textId, id, 'maxWidth', 420);
    expect(
      layer(textId).animationTracks[property]?.map(({ frame, value }) => ({ frame, value })),
    ).toEqual([
      { frame: 0, value: 600 },
      { frame: 8, value: 420 },
    ]);
    expect(getLayerPropertyValueAtFrame(layer(textId), property, 24)).toBe(420);
    expect(layer(textId).animationTracks.x).toBeUndefined();
  });

  it('creates one seeded Data field directly for the exact requested control', () => {
    const id = addModifier(textId, 'max-text-width', { maxWidth: 720 });
    const fieldId = exposeModifierNumber(textId, id, 'maxWidth');
    expect(active().dataFields.find((field) => field.id === fieldId)).toMatchObject({
      type: 'number',
      defaultValue: 720,
    });
    expect(layer(textId).bindings).toContainEqual({
      fieldId,
      targetProperty: modifierProperty(id, 'maxWidth'),
    });
    expect(exposeModifierNumber(textId, id, 'maxWidth')).toBe(fieldId);
    expect(active().dataFields.filter((field) => field.id === fieldId)).toHaveLength(1);
  });

  it('resets settings and animation while retaining the ID and chosen source', () => {
    const id = addModifier(backgroundId, 'auto-size', {
      source: { kind: 'layer', layerId: textId },
      paddingLeft: 90,
    });
    const geometry = structuredClone(layer(backgroundId).keyframes);
    useTimelineStore.getState().setAutoKeyframe(true);
    setModifierNumber(backgroundId, id, 'paddingLeft', 100);
    resetModifier(backgroundId, id);
    expect(layer(backgroundId).modifiers?.[0]).toMatchObject({
      id,
      params: { source: { kind: 'layer', layerId: textId }, paddingLeft: 0 },
    });
    expect(
      layer(backgroundId).animationTracks[modifierProperty(id, 'paddingLeft')],
    ).toBeUndefined();
    expect(layer(backgroundId).keyframes).toEqual(geometry);
  });

  it('removes only owned modifier keys and links', () => {
    const id = addModifier(textId, 'max-text-width', {});
    const fieldId = exposeModifierNumber(textId, id, 'maxWidth');
    useTimelineStore.getState().setAutoKeyframe(true);
    setModifierNumber(textId, id, 'maxWidth', 500);
    const x = structuredClone(layer(textId).animationTracks.x);
    deleteModifier(textId, id);
    expect(layer(textId).modifiers).toEqual([]);
    expect(layer(textId).animationTracks[modifierProperty(id, 'maxWidth')]).toBeUndefined();
    expect(layer(textId).bindings.some((binding) => binding.fieldId === fieldId)).toBe(false);
    expect(layer(textId).animationTracks.x).toEqual(x);
  });

  it('reset also restores the default behind an exposed value', () => {
    const id = addModifier(textId, 'max-text-width', { maxWidth: 720 });
    const fieldId = exposeModifierNumber(textId, id, 'maxWidth');
    resetModifier(textId, id);
    expect(active().dataFields.find((field) => field.id === fieldId)?.defaultValue).toBe(600);
    expect(layer(textId).bindings).toContainEqual({
      fieldId,
      targetProperty: modifierProperty(id, 'maxWidth'),
    });
  });

  it('designer edits update an exposed default and release its transient Test Data override', () => {
    const id = addModifier(textId, 'max-text-width', { maxWidth: 720 });
    const fieldId = exposeModifierNumber(textId, id, 'maxWidth');
    useTestDataStore.getState().setValue(fieldId, 230);
    setModifierNumber(textId, id, 'maxWidth', 640);
    expect(active().dataFields.find((field) => field.id === fieldId)?.defaultValue).toBe(640);
    expect(useTestDataStore.getState().values[fieldId]).toBeUndefined();
  });

  it('never changes a locked owner and can disable a modifier without altering authored values', () => {
    const id = addModifier(textId, 'max-text-width', {});
    const geometry = structuredClone(layer(textId).keyframes);
    editLayerModifier(textId, id, { enabled: false });
    expect(layer(textId).keyframes).toEqual(geometry);
    useProjectStore.getState().toggleLayerLock(textId);
    const before = useProjectStore.getState().project;
    expect(() => editLayerModifier(textId, id, { enabled: true })).toThrow(/Unlock/);
    expect(useProjectStore.getState().project).toBe(before);
  });

  it('records a materialized component child edit as a local override', () => {
    const componentId = useProjectStore.getState().createComponent([textId], 'Presenter');
    expect(componentId).toBeTruthy();
    addModifier(textId, 'max-text-width', { maxWidth: 500 });
    expect(
      layer(textId).componentLink?.overridePaths?.some((path) => path.startsWith('/modifiers')),
    ).toBe(true);
    expect(
      active().components.find((component) => component.id === componentId)?.layers[0]?.modifiers,
    ).toBeUndefined();
  });

  it('animates and exposes each newly added numeric modifier control by its stable entry ID', () => {
    const entries = [
      { type: 'grid-arrange', parameter: 'spreadX', value: 260 },
      { type: 'radial-arrange', parameter: 'innerRadius', value: 180 },
      { type: 'justify', parameter: 'offsetX', value: -20 },
      { type: 'look-at', parameter: 'rotationOffset', value: 15 },
    ] as const;
    for (const entry of entries) {
      const ownerId = useProjectStore.getState().addLayer('rectangle');
      const id = addModifier(
        ownerId,
        entry.type,
        entry.type === 'look-at' ? { source: { kind: 'layer', layerId: textId } } : {},
      );
      useTimelineStore.getState().setAutoKeyframe(true);
      useTimelineStore.getState().setCurrentFrame(10);
      setModifierNumber(ownerId, id, entry.parameter, entry.value);
      const property = modifierProperty(id, entry.parameter);
      expect(layer(ownerId).animationTracks[property]).toEqual([
        expect.objectContaining({ frame: 0 }),
        expect.objectContaining({ frame: 10, value: entry.value }),
      ]);
      const fieldId = exposeModifierNumber(ownerId, id, entry.parameter);
      expect(active().dataFields.find((field) => field.id === fieldId)?.defaultValue).toBe(
        entry.value,
      );
      expect(layer(ownerId).bindings).toContainEqual({ fieldId, targetProperty: property });
    }
  });
});
