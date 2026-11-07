import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createLayerModifier,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  defaultTransformFor,
  type Composition,
} from '@ograf-editor/scene-model';

const state = vi.hoisted(() => ({
  composition: null as unknown,
  ids: [] as string[],
  selectedId: null as string | null,
}));
vi.mock('../state/projectStore', () => {
  const store = { setLayerMotionPath: vi.fn() };
  const useProjectStore = (select: (value: typeof store) => unknown) => select(store);
  useProjectStore.getState = () => store;
  return { useActiveComposition: () => state.composition, useProjectStore };
});
vi.mock('../state/selectionStore', () => ({
  useSelectionStore: (select: (value: unknown) => unknown) =>
    select({ selectedLayerIds: state.ids, selectedLayerId: state.selectedId }),
}));
vi.mock('../state/modifiersEditing', () => ({
  addModifier: vi.fn(),
  copyModifier: vi.fn(),
  deleteModifier: vi.fn(),
  editLayerModifier: vi.fn(),
  exposeModifierNumber: vi.fn(),
  moveModifier: vi.fn(),
  resetModifier: vi.fn(),
  setModifierNumber: vi.fn(),
  modifierDrivenProperties: () => ['Width'],
}));
import { ModifiersPanel, ModifierReferencePicker } from './ModifiersPanel';
import { containerModifierDefaults as containerDefaults } from '../state/modifierContainerDefaults';

describe('Modifiers pane interface', () => {
  let composition: Composition;
  beforeEach(() => {
    composition = createProject().compositions[0]!;
    state.composition = composition;
    state.ids = [];
    state.selectedId = null;
  });
  const render = () => renderToStaticMarkup(createElement(ModifiersPanel));

  it('clearly explains no selection and never attaches to an arbitrary selected group member', () => {
    expect(render()).toContain('Select an object');
    composition.layers.push(createLayerOfKind('text'), createLayerOfKind('rectangle'));
    state.ids = composition.layers.map((layer) => layer.id);
    state.selectedId = state.ids[0]!;
    const html = render();
    expect(html).toContain('Select one object');
    expect(html).toContain('not attached to an arbitrary group member');
    expect(html).not.toContain('+ Add Modifier');
  });

  it('shows the full object name and compact stack actions with animation/data shortcuts', () => {
    const layer = createLayerOfKind('text');
    layer.name = 'Presenter lower third — exceptionally long full name';
    layer.modifiers = [createLayerModifier('max-text-width', { maxWidth: 600 })];
    composition.layers.push(layer);
    state.ids = [layer.id];
    state.selectedId = layer.id;
    const html = render();
    expect(html).toContain(layer.name);
    expect(html).toContain('Filter modifiers');
    expect(html).toContain('+ Add Modifier');
    for (const label of ['Enable', 'Duplicate', 'Reset', 'Remove'])
      expect(html).toContain(`${label} Max Text Width`);
    expect(html).toContain('Animate Max Width');
    expect(html).toContain('Create data control for Max Width');
    expect(html).toContain('Authored values are preserved');
    expect(html).toContain('<summary>Advanced</summary>');
  });

  it('offers guided starting points when a selected object has no modifiers', () => {
    const layer = createLayerOfKind('rectangle');
    composition.layers.push(layer);
    state.ids = [layer.id];
    state.selectedId = layer.id;
    const html = render();
    for (const label of [
      'Panel follows text width',
      'Hide when empty',
      'Follow another layer',
      'Arrange in a row or grid',
    ])
      expect(html).toContain(label);
  });

  it('renders source and target choices with full readable names', () => {
    const first = createLayerOfKind('text');
    first.name = 'Presenter optional subtitle with full descriptive name';
    const second = createLayerOfKind('rectangle');
    second.name = 'Subtitle background rectangle';
    first.groupId = second.groupId = 'subtitle-group';
    composition.layers.push(first, second);
    const options = [
      { value: 'layer:' + first.id, label: first.name },
      { value: 'group:subtitle-group', label: `${first.name} + ${second.name}` },
    ];
    const html = renderToStaticMarkup(
      createElement(ModifierReferencePicker, {
        value: `layer:${first.id}`,
        options,
        onChange: vi.fn(),
        label: 'Reference',
      }),
    );
    expect(html).toContain(first.name);
  });

  it('offers Hide When Empty with group target and whitespace/invert controls', () => {
    const text = createLayerOfKind('text');
    const background = createLayerOfKind('rectangle');
    text.groupId = background.groupId = 'optional-strip';
    text.modifiers = [
      createLayerModifier('hide-empty', {
        source: { kind: 'layer', layerId: text.id, property: 'content' },
        target: { kind: 'group', groupId: 'optional-strip' },
      }),
    ];
    composition.layers.push(text, background);
    state.ids = [text.id];
    state.selectedId = text.id;
    const html = render();
    expect(html).toContain('Hide When Empty');
    expect(html).toContain('Object or group to hide');
    expect(html).toContain('Trim spaces');
    expect(html).toContain('Invert');
    expect(html).toContain('Collapse hidden');
  });

  it('locks editing visibly instead of silently ignoring changes', () => {
    const layer = createLayerOfKind('rectangle');
    layer.isLocked = true;
    composition.layers.push(layer);
    state.ids = [layer.id];
    state.selectedId = layer.id;
    const html = render();
    expect(html).toContain('This object is locked');
    expect(html).toContain('<fieldset class="modifier-stack" disabled=""');
  });

  it('presents container arrangement, Look At and the Spline Path card', () => {
    const row = createLayerOfKind('rectangle');
    row.name = 'Players';
    const card = createLayerOfKind('rectangle');
    card.parentId = row.id;
    const target = createLayerOfKind('ellipse');
    target.name = 'Ball';
    const route = createLayerOfKind('path');
    route.name = 'Route';
    row.modifiers = [
      createLayerModifier('grid-arrange', { columns: 4 }),
      createLayerModifier('radial-arrange'),
      createLayerModifier('justify'),
      createLayerModifier('look-at', { source: { kind: 'layer', layerId: target.id } }),
    ];
    row.motionPath = {
      sourceLayerId: route.id,
      progress: 0.25,
      orientToPath: true,
      offsetX: 0,
      offsetY: 0,
      rotationOffset: 30,
    };
    composition.layers.push(row, card, target, route);
    state.ids = [row.id];
    state.selectedId = row.id;
    const html = render();
    for (const text of [
      'Grid Arrange',
      'Uses 1 child object in Scene order',
      'Grid Arrange: Columns',
      'Bottom right',
      'Down columns first',
      'Radial Arrange: Inner Radius',
      'Point outward',
      'Justify: Horizontal',
      'Look At',
      'Ball',
      'Right side (X axis)',
      'Spline Path',
      'Route',
      'Spline Path: Base Orientation',
      'X/Y (Spline Path)',
    ])
      expect(html).toContain(text);
    expect(html).toContain('value="25"');
  });

  it('seeds readable arrangements from child size while respecting numeric limits', () => {
    const owner = createLayerOfKind('rectangle');
    const child = createLayerOfKind('rectangle');
    child.parentId = owner.id;
    child.keyframes = [
      createLayerKeyframe(0, { ...defaultTransformFor('rectangle'), width: 32768, height: 32768 }),
    ];
    for (const property of ['width', 'height'] as const)
      for (const key of child.animationTracks[property] ?? []) key.value = 32768;
    composition.layers.push(owner, child);
    expect(containerDefaults('grid-arrange', owner, composition)).toEqual({
      columns: 1,
      spreadX: 32768,
      spreadY: 32768,
    });
    expect(containerDefaults('radial-arrange', owner, composition)).toEqual({
      innerRadius: 32768,
      outerRadius: 32768,
    });
  });
});
