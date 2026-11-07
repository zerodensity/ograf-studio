import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  TRANSITION_LOGIC_VERSION,
  transitionLogicErrors,
  type ComponentDefinition,
  type TransitionLogicDefinition,
  type TransitionLogicReferences,
} from '@ograf-editor/scene-model';
import {
  applyResize,
  clearResize,
  readResizeSetting,
  RESIZE_ANCHORS,
  resizeTargets,
  type ResizeAnchor,
} from './transitionResize';

function fixture() {
  const layer = createLayerOfKind('rectangle');
  layer.id = 'glass';
  layer.name = 'Glass';
  layer.keyframes = [
    createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 200, width: 400, height: 200 })),
  ];
  const label = createLayerOfKind('rectangle');
  label.id = 'label';
  label.name = 'Label';
  label.keyframes = [
    createLayerKeyframe(0, createDefaultTransform({ x: 120, y: 220, width: 80, height: 40 })),
  ];
  const component: ComponentDefinition = {
    id: 'panel',
    name: 'Panel',
    layers: [layer, label],
    dataFields: [],
  };
  const definition: TransitionLogicDefinition = {
    version: 3,
    id: 'logic',
    name: 'News',
    slots: [
      { id: 'lower', name: 'Lower third', order: 0 },
      { id: 'ticker', name: 'Ticker', order: 1 },
      { id: 'bug', name: 'Bug', order: 2 },
    ],
    states: [
      { id: 'name', name: 'Correspondent', slotId: 'lower', templateId: 'template-name' },
      { id: 'headline', name: 'Headline', slotId: 'lower', templateId: 'template-headline' },
      { id: 'ticker-state', name: 'Ticker', slotId: 'ticker', templateId: 'template-ticker' },
    ],
    transitions: [
      {
        id: 'morph',
        name: 'Morph',
        durationFrames: 30,
        outgoingFrames: 30,
        incomingStartFrame: 0,
        incomingFrames: 30,
        sharedFrames: 30,
        easing: 'ease-in-out',
      },
    ],
    routes: [],
    defaultTransitionId: 'morph',
    sharedInstances: [
      {
        id: 'shared-panel',
        name: 'Lower panel',
        componentAssetId: 'panel',
        continuityKey: 'panel-key',
        slotId: 'lower',
      },
    ],
    initialSharedValues: [
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'x', value: 100 },
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'y', value: 200 },
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'width', value: 400 },
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'height', value: 200 },
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'opacity', value: 1 },
      { instanceId: 'shared-panel', sourceLayerId: 'label', property: 'y', value: 220 },
    ],
  };
  const references: TransitionLogicReferences = {
    templateIds: ['template-name', 'template-headline', 'template-ticker'],
    componentLayers: { panel: ['glass', 'label'] },
  };
  const components = [component];
  const target = resizeTargets(definition, components, 'lower', 'name')[0]!;
  return { definition, components, references, target };
}

function offsets(definition: TransitionLogicDefinition, sourceLayerId = 'glass') {
  return Object.fromEntries(
    (definition.layoutRules ?? [])
      .flatMap((rule) => rule.sharedOffsets)
      .filter((value) => value.sourceLayerId === sourceLayerId)
      .map((value) => [value.property, value.value]),
  );
}

const positions: Record<ResizeAnchor, [number, number]> = {
  'top-left': [0, 0],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  'center-left': [0, 0.5],
  center: [0.5, 0.5],
  'center-right': [1, 0.5],
  'bottom-left': [0, 1],
  'bottom-center': [0.5, 1],
  'bottom-right': [1, 1],
};

describe('explicit transition resize', () => {
  it.each([
    { label: 'height only', width: 400, height: 120 },
    { label: 'width only', width: 200, height: 200 },
    { label: 'unchanged size', width: 400, height: 200 },
  ])(
    'preserves every selected anchor after saving $label, including the next two-axis edit',
    ({ width, height }) => {
      for (const { value: anchor } of RESIZE_ANCHORS) {
        const { definition, references, target } = fixture();
        const resized = applyResize(
          definition,
          'ticker',
          'lower',
          target,
          { width, height, anchor },
          references,
        );
        const loaded = JSON.parse(JSON.stringify(resized)) as TransitionLogicDefinition;
        const setting = readResizeSetting(loaded, 'ticker', 'lower', target);
        expect(setting).toEqual({ width, height, anchor, configured: true });
        expect(
          loaded.layoutRules![0]!.sharedOffsets.find((entry) => entry.property === 'width')!
            .resizeAnchor,
        ).toBe(anchor);
        const next = applyResize(
          loaded,
          'ticker',
          'lower',
          target,
          { ...setting, width: 300, height: 160 },
          references,
        );
        const [anchorX, anchorY] = positions[anchor];
        expect(offsets(next)).toEqual({
          x: 100 * anchorX,
          y: 40 * anchorY,
          width: -100,
          height: -40,
        });
      }
    },
  );

  it('falls back to geometry inference if saved anchor metadata no longer matches the offsets', () => {
    const { definition, references, target } = fixture();
    const resized = applyResize(
      definition,
      'ticker',
      'lower',
      target,
      { width: 200, height: 120, anchor: 'bottom-right' },
      references,
    );
    resized.layoutRules![0]!.sharedOffsets.find(
      (entry) => entry.property === 'width',
    )!.resizeAnchor = 'top-left';
    expect(readResizeSetting(resized, 'ticker', 'lower', target).anchor).toBe('bottom-right');
    resized.layoutRules![0]!.sharedOffsets.find((entry) => entry.property === 'x')!.value = 37;
    expect(readResizeSetting(resized, 'ticker', 'lower', target).issue).toContain(
      'custom position',
    );
  });

  it.each(RESIZE_ANCHORS)(
    'keeps the $label anchor fixed and reads it after save/load',
    ({ value: anchor }) => {
      const { definition, references, target } = fixture();
      const resized = applyResize(
        definition,
        'ticker',
        'lower',
        target,
        { width: 200, height: 120, anchor },
        references,
      );
      const [anchorX, anchorY] = positions[anchor];
      const geometry = offsets(resized) as Record<string, number>;
      expect(geometry).toEqual({ x: 200 * anchorX, y: 80 * anchorY, width: -200, height: -80 });
      expect(target.x + geometry.x! + 200 * anchorX).toBe(target.x + target.width * anchorX);
      expect(target.y + geometry.y! + 120 * anchorY).toBe(target.y + target.height * anchorY);
      const loaded = JSON.parse(JSON.stringify(resized)) as TransitionLogicDefinition;
      expect(readResizeSetting(loaded, 'ticker', 'lower', target)).toEqual({
        width: 200,
        height: 120,
        anchor,
        configured: true,
      });
      expect(transitionLogicErrors(loaded, references)).toEqual([]);
    },
  );

  it('uses current template values before initial values and the component authored pose', () => {
    const { definition, components } = fixture();
    definition.states[0]!.sharedValues = [
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'width', value: 500 },
    ];
    expect(resizeTargets(definition, components, 'lower', 'name')[0]).toMatchObject({
      width: 500,
      x: 100,
      height: 200,
    });
    expect(resizeTargets(definition, components, 'lower', null)[1]).toMatchObject({
      width: 80,
      height: 40,
      y: 220,
    });
    expect(resizeTargets(definition, components, 'ticker', 'ticker-state')).toEqual([]);
    expect(resizeTargets(definition, components, 'lower', 'ticker-state')).toEqual([]);
  });

  it('seeds missing initial tracks from the component pose rather than a selected-state override', () => {
    const { definition, components, references } = fixture();
    definition.initialSharedValues = definition.initialSharedValues.filter(
      (value) => !(value.sourceLayerId === 'glass' && value.property === 'width'),
    );
    definition.states[0]!.sharedValues = [
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'width', value: 500 },
    ];
    const target = resizeTargets(definition, components, 'lower', 'name')[0]!;
    expect(target.width).toBe(500);
    expect(target.initialValues!.width).toBe(400);
    const resized = applyResize(
      definition,
      'ticker',
      'lower',
      target,
      { width: 450, height: 160, anchor: 'top-left' },
      references,
    );
    expect(
      resized.initialSharedValues.find(
        (value) => value.sourceLayerId === 'glass' && value.property === 'width',
      )!.value,
    ).toBe(400);
    expect(offsets(resized).width).toBe(-50);
    expect(resized.states[0]!.sharedValues).toEqual(definition.states[0]!.sharedValues);
  });

  it('replaces repeated absolute edits without accumulating drift or touching other objects', () => {
    const { definition, references, target } = fixture();
    definition.layoutRules = [
      {
        id: 'old-room',
        name: 'Existing room',
        slotId: 'lower',
        whenSlotId: 'ticker',
        sharedOffsets: [
          { instanceId: 'shared-panel', sourceLayerId: 'label', property: 'y', value: -20 },
        ],
      },
    ];
    const before = structuredClone(definition);
    const first = applyResize(
      definition,
      'ticker',
      'lower',
      target,
      { width: 300, height: 160, anchor: 'bottom-right' },
      references,
    );
    const second = applyResize(
      first,
      'ticker',
      'lower',
      target,
      { width: 320, height: 180, anchor: 'center' },
      references,
    );
    expect(offsets(second)).toEqual({ x: 40, y: 10, width: -80, height: -20 });
    expect(
      second.layoutRules![0]!.sharedOffsets.find((value) => value.sourceLayerId === 'label'),
    ).toEqual(before.layoutRules![0]!.sharedOffsets[0]);
    expect(second.initialSharedValues).toEqual(before.initialSharedValues);
    expect(second.states).toEqual(before.states);
    expect(second.transitions).toEqual(before.transitions);
    expect(definition).toEqual(before);
  });

  it('keeps another target and unrelated rules when changing or clearing the selected target', () => {
    const { definition, components, references, target } = fixture();
    const secondTarget = resizeTargets(definition, components, 'lower', 'name')[1]!;
    let changed = applyResize(
      definition,
      'ticker',
      'lower',
      target,
      { width: 300, height: 160, anchor: 'top-left' },
      references,
    );
    changed = applyResize(
      changed,
      'ticker',
      'lower',
      secondTarget,
      { width: 100, height: 60, anchor: 'center' },
      references,
    );
    // A separate rule may observe another lane while controlling a distinct property.
    changed.initialSharedValues.push({
      instanceId: 'shared-panel',
      sourceLayerId: 'glass',
      property: 'rotation',
      value: 0,
    });
    changed.layoutRules!.push({
      id: 'empty-unrelated',
      name: 'Other room',
      slotId: 'lower',
      whenSlotId: 'bug',
      sharedOffsets: [],
    });
    const before = structuredClone(changed);
    const cleared = clearResize(changed, 'ticker', 'lower', target, references);
    expect(readResizeSetting(cleared, 'ticker', 'lower', target)).toMatchObject({
      width: 400,
      height: 200,
      configured: false,
    });
    expect(offsets(cleared, 'label')).toEqual(offsets(before, 'label'));
    expect(cleared.layoutRules!.find((rule) => rule.id === 'empty-unrelated')).toEqual(
      before.layoutRules![1],
    );
    expect(cleared.initialSharedValues).toEqual(before.initialSharedValues);
    expect(changed).toEqual(before);
  });

  it('removes an empty resize rule on clear and leaves the authored baseline untouched', () => {
    const { definition, references, target } = fixture();
    const changed = applyResize(
      definition,
      'ticker',
      'lower',
      target,
      { width: 300, height: 160, anchor: 'top-left' },
      references,
    );
    const cleared = clearResize(changed, 'ticker', 'lower', target, references);
    expect(cleared.layoutRules).toBeUndefined();
    expect(cleared).toEqual({ ...definition, version: TRANSITION_LOGIC_VERSION });
  });

  it('reports legacy custom XY without changing them until an explicit resize is applied', () => {
    const { definition, references, target } = fixture();
    definition.layoutRules = [
      {
        id: 'manual',
        name: 'Manual move',
        slotId: 'lower',
        whenSlotId: 'ticker',
        sharedOffsets: [
          { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'x', value: 37 },
          { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'height', value: -40 },
        ],
      },
    ];
    const original = structuredClone(definition);
    expect(readResizeSetting(definition, 'ticker', 'lower', target)).toMatchObject({
      configured: true,
      width: 400,
      height: 160,
      issue: expect.stringContaining('custom position'),
    });
    expect(definition).toEqual(original);
    const resized = applyResize(
      definition,
      'ticker',
      'lower',
      target,
      { width: 300, height: 160, anchor: 'top-right' },
      references,
    );
    expect(offsets(resized)).toEqual({ x: 100, y: 0, width: -100, height: -40 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid dimensions %s without losing legacy offsets',
    (width) => {
      const { definition, references, target } = fixture();
      definition.layoutRules = [
        {
          id: 'manual',
          name: 'Manual move',
          slotId: 'lower',
          whenSlotId: 'ticker',
          sharedOffsets: [
            { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'y', value: -37 },
          ],
        },
      ];
      const before = structuredClone(definition);
      expect(() =>
        applyResize(
          definition,
          'ticker',
          'lower',
          target,
          { width, height: 160, anchor: 'top-left' },
          references,
        ),
      ).toThrow('positive, finite');
      expect(definition).toEqual(before);
    },
  );

  it('rejects a stale source, moved state, or target owned by another lane', () => {
    const { definition, references, target } = fixture();
    const setting = { width: 300, height: 160, anchor: 'top-left' as const };
    expect(() => applyResize(definition, 'ticker', 'bug', target, setting, references)).toThrow(
      'belonging',
    );
    expect(() =>
      applyResize(
        definition,
        'ticker',
        'lower',
        { ...target, sourceLayerId: 'missing' },
        setting,
        references,
      ),
    ).toThrow('removed');
    definition.states[0]!.slotId = 'bug';
    expect(() => applyResize(definition, 'ticker', 'lower', target, setting, references)).toThrow(
      'removed or moved',
    );
  });

  it('checks the result in every template because overlap offsets apply to the entire lane', () => {
    const { definition, references, target } = fixture();
    definition.states[1]!.sharedValues = [
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'height', value: 40 },
    ];
    const before = structuredClone(definition);
    expect(() =>
      applyResize(
        definition,
        'ticker',
        'lower',
        target,
        { width: 300, height: 160, anchor: 'top-left' },
        references,
      ),
    ).toThrow('Headline a non-positive height');
    expect(definition).toEqual(before);
  });

  it('composes another trigger while preserving its identity and resetting only this trigger', () => {
    const { definition, references, target } = fixture();
    definition.layoutRules = [
      {
        id: 'other',
        name: 'Other trigger',
        slotId: 'lower',
        whenSlotId: 'bug',
        sharedOffsets: [
          { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'width', value: -30 },
        ],
      },
    ];
    const before = structuredClone(definition);
    const resized = applyResize(
      definition,
      'ticker',
      'lower',
      target,
      { width: 300, height: 160, anchor: 'top-left' },
      references,
    );
    expect(resized.layoutRules![0]).toEqual(definition.layoutRules![0]);
    expect(readResizeSetting(resized, 'ticker', 'lower', target)).toEqual({
      width: 300,
      height: 160,
      anchor: 'top-left',
      configured: true,
    });
    expect(readResizeSetting(resized, 'bug', 'lower', target)).toEqual({
      width: 370,
      height: 200,
      anchor: 'top-left',
      configured: true,
    });
    const cleared = clearResize(resized, 'ticker', 'lower', target, references);
    expect(cleared.layoutRules).toEqual(definition.layoutRules);
    const again = applyResize(
      resized,
      'ticker',
      'lower',
      target,
      { width: 280, height: 140, anchor: 'top-left' },
      references,
    );
    expect(again.layoutRules!.map((rule) => rule.id)).toEqual(
      resized.layoutRules!.map((rule) => rule.id),
    );
    expect(definition).toEqual(before);
  });

  it('rejects combined unsafe dimensions from otherwise safe trigger sizes atomically', () => {
    const { definition, references, target } = fixture();
    const first = applyResize(
      definition,
      'bug',
      'lower',
      target,
      { width: 150, height: 200, anchor: 'top-left' },
      references,
    );
    const before = structuredClone(first);
    expect(() =>
      applyResize(
        first,
        'ticker',
        'lower',
        target,
        { width: 200, height: 160, anchor: 'top-left' },
        references,
      ),
    ).toThrow('negative shared dimension');
    expect(first).toEqual(before);
  });

  it('disables rotated or parented targets and omits invalid source dimensions', () => {
    const { definition, components, references } = fixture();
    const glass = components[0]!.layers[0]!;
    definition.initialSharedValues.push({
      instanceId: 'shared-panel',
      sourceLayerId: 'glass',
      property: 'rotation',
      value: 15,
    });
    let target = resizeTargets(definition, components, 'lower', 'name')[0]!;
    expect(target.disabledReason).toContain('unrotated');
    expect(() =>
      applyResize(
        definition,
        'ticker',
        'lower',
        target,
        { width: 300, height: 160, anchor: 'top-left' },
        references,
      ),
    ).toThrow('unrotated');
    glass.parentId = 'label';
    target = resizeTargets(definition, components, 'lower', 'name')[0]!;
    expect(target.disabledReason).toContain('parent');
    definition.initialSharedValues.find(
      (value) => value.sourceLayerId === 'glass' && value.property === 'width',
    )!.value = 0;
    expect(
      resizeTargets(definition, components, 'lower', 'name').map((entry) => entry.sourceLayerId),
    ).toEqual(['label']);
  });

  it('disables anchors when another template in the same lane rotates the selected object', () => {
    const { definition, components } = fixture();
    definition.initialSharedValues.push({
      instanceId: 'shared-panel',
      sourceLayerId: 'glass',
      property: 'rotation',
      value: 0,
    });
    definition.states[1]!.sharedValues = [
      { instanceId: 'shared-panel', sourceLayerId: 'glass', property: 'rotation', value: 90 },
    ];
    expect(resizeTargets(definition, components, 'lower', 'name')[0]!.disabledReason).toContain(
      'every template',
    );
  });
});
