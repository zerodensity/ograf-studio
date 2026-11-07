import { describe, expect, it } from 'vitest';
import { createProject, type LayerVisualRule } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

function setup() {
  const session = new AuthoringSession(createProject(), 'rules');
  const created = session.apply({
    expectedRevision: 0,
    operations: [
      { type: 'add_layer', kind: 'rectangle', name: 'Tab' },
      { type: 'add_layer', kind: 'rectangle', name: 'Panel' },
      { type: 'add_data_field', fieldType: 'integer', key: 'home', label: 'Home' },
      { type: 'add_data_field', fieldType: 'integer', key: 'away', label: 'Away' },
    ],
  });
  const layers = created.summary.generatedIds.filter((item) => item.kind === 'layer');
  const fields = created.summary.generatedIds.filter((item) => item.kind === 'field');
  return {
    session,
    tabId: layers[0]!.id,
    panelId: layers[1]!.id,
    homeId: fields[0]!.id,
    awayId: fields[1]!.id,
  };
}

const openPanel = (panelId: string) =>
  ({
    id: 'open',
    name: 'Open panel',
    enabled: true,
    trigger: 'click',
    actions: [{ type: 'toggle-visibility', targetLayerId: panelId, transitionFrames: 6 }],
  }) as unknown as LayerVisualRule;

describe('visual rule operations', () => {
  it('creates a key event with a canonical key and rejects missing keys atomically', () => {
    const { session, tabId, panelId } = setup();
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [
          {
            type: 'set_layer_visual_rules',
            layerId: tabId,
            rules: [{ ...openPanel(panelId), trigger: 'key-down' }],
          },
        ],
      }),
    ).toThrow(/keyboard key/);
    expect(session.revision).toBe(1);
    const result = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_layer_visual_rules',
          layerId: tabId,
          rules: [
            { ...openPanel(panelId), trigger: 'key-up', keyboard: { key: 'Spacebar', alt: true } },
          ],
        },
      ],
    });
    expect(
      result.project.compositions[0]!.layers.find((layer) => layer.id === tabId)!.visualRules[0],
    ).toMatchObject({
      trigger: 'key-up',
      keyboard: { key: ' ', alt: true },
      actions: [{ targetLayerId: panelId }],
    });
    expect(result.validation.errors).toEqual([]);
  });
  it('validates real geometry values before mutating rules', () => {
    const { session, tabId } = setup();
    for (const value of [-1, null, '', true, Infinity]) {
      expect(() =>
        session.apply({
          expectedRevision: 1,
          operations: [
            {
              type: 'set_layer_visual_rules',
              layerId: tabId,
              rules: [
                {
                  ...openPanel(tabId),
                  actions: [{ type: 'property', targetProperty: 'height', value }],
                },
              ],
            },
          ],
        }),
      ).toThrow(/finite number|zero or more/);
      expect(session.revision).toBe(1);
    }
  });
  it('completes omitted condition keys and keeps cross-layer targets', () => {
    const { session, tabId, panelId } = setup();
    const result = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'set_layer_visual_rules', layerId: tabId, rules: [openPanel(panelId)] }],
    });
    const rule = result.project.compositions[0]!.layers.find((layer) => layer.id === tabId)!
      .visualRules[0]!;
    expect(rule).toMatchObject({ fieldId: '', sourcePath: [], operator: 'equals' });
    expect(rule.actions[0]).toEqual({
      type: 'toggle-visibility',
      targetLayerId: panelId,
      transitionFrames: 6,
    });
    expect(result.validation.errors).toEqual([]);
  });

  it('rejects missing targets, comparison fields, and trigger actions', () => {
    const { session, tabId, homeId } = setup();
    const apply = (rule: Partial<LayerVisualRule>) => () =>
      session.apply({
        expectedRevision: 1,
        operations: [
          {
            type: 'set_layer_visual_rules',
            layerId: tabId,
            rules: [
              {
                id: 'r',
                name: 'Rule',
                enabled: true,
                fieldId: homeId,
                sourcePath: [],
                operator: 'equals',
                actions: [{ type: 'visibility', visible: true }],
                ...rule,
              } as LayerVisualRule,
            ],
          },
        ],
      });
    expect(
      apply({ actions: [{ type: 'visibility', visible: true, targetLayerId: 'missing' }] }),
    ).toThrow(/target layer not found/);
    expect(apply({ compareFieldId: 'missing' })).toThrow(/field not found/);
    expect(apply({ trigger: 'custom-action', eventId: 'missing' })).toThrow(/custom action/);
  });

  it('prunes rule actions aimed at a removed layer', () => {
    const { session, tabId, panelId } = setup();
    session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_layer_visual_rules',
          layerId: tabId,
          rules: [
            {
              ...openPanel(panelId),
              actions: [
                { type: 'toggle-visibility', targetLayerId: panelId },
                { type: 'property', targetProperty: 'fill', value: '#2680ff' },
              ],
            },
          ],
        },
      ],
    });
    const removed = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'remove_layer', layerId: panelId }],
    });
    expect(removed.project.compositions[0]!.layers[0]!.visualRules[0]!.actions).toEqual([
      { type: 'property', targetProperty: 'fill', value: '#2680ff' },
    ]);
    expect(removed.validation.errors).toEqual([]);
  });

  it('treats rules as consumers of the fields they read', () => {
    const { session, tabId, homeId, awayId } = setup();
    session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_layer_visual_rules',
          layerId: tabId,
          rules: [
            {
              id: 'leads',
              name: 'Home leads',
              enabled: true,
              fieldId: homeId,
              sourcePath: [],
              operator: 'greater-than',
              compareFieldId: awayId,
              actions: [{ type: 'property', targetProperty: 'fill', value: '#f5c542' }],
            },
          ],
        },
      ],
    });
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'remove_data_field', fieldId: awayId }],
      }),
    ).toThrow(/force=true/);
    const forced = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'remove_data_field', fieldId: awayId, force: true }],
    });
    const rule = forced.project.compositions[0]!.layers[0]!.visualRules[0]!;
    expect(rule.compareFieldId).toBeUndefined();
    expect(rule.fieldId).toBe(homeId);
  });

  it('points duplicated group rules at the duplicated siblings', () => {
    const { session, tabId, panelId } = setup();
    session.apply({
      expectedRevision: 1,
      operations: [{ type: 'set_layer_visual_rules', layerId: tabId, rules: [openPanel(panelId)] }],
    });
    const duplicated = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'duplicate_group',
          source: { layerIds: [tabId, panelId] },
          count: 1,
          transformOffset: { x: 300 },
          bindings: 'share',
        },
      ],
    });
    const layers = duplicated.project.compositions[0]!.layers;
    const [, , tabCopy, panelCopy] = layers;
    expect(tabCopy!.visualRules[0]!.actions[0]).toMatchObject({ targetLayerId: panelCopy!.id });
    expect(tabCopy!.visualRules[0]!.id).not.toBe('open');
  });
});
