import { describe, expect, it, vi } from 'vitest';
import {
  collectVisualRuleStates,
  firedVisualRuleEventRules,
  isVisualRuleKeyboardTrigger,
  normalizeVisualRuleKeyboardKey,
  visualRuleKeyboardMatches,
  visualRuleKeyboardErrors,
  createLayerVisualRule,
  interpolateVisualRuleValue,
  isVisualRuleState,
  normalizeLayerVisualRule,
  pruneVisualRuleReferences,
  remapVisualRule,
  visualRuleConditionsHold,
  visualRuleFieldIds,
  visualRuleMatches,
  visualRuleValue,
  type VisualRuleDataReader,
  type VisualRuleEngine,
} from './visualRules';
import { createComposition, createFieldDefinition, createLayerOfKind } from './factory';
import type { LayerVisualRule, VisualRuleCondition } from './types';

describe('keyboard visual rule contracts', () => {
  it.each([
    ['a', 'A'],
    ['Z', 'z'],
    ['Space', ' '],
    ['Spacebar', 'Space'],
    [' ', 'Spacebar'],
    ['Esc', 'Escape'],
    ['Escape', 'Esc'],
    ['ArrowLeft', 'ArrowLeft'],
  ])('matches semantic key aliases %s and %s', (key, input) => {
    expect(visualRuleKeyboardMatches({ key }, { key: input })).toBe(true);
  });
  it('normalizes authoring aliases and keeps named DOM keys readable', () => {
    expect(normalizeVisualRuleKeyboardKey('A')).toBe('a');
    expect(normalizeVisualRuleKeyboardKey('Spacebar')).toBe(' ');
    expect(normalizeVisualRuleKeyboardKey('esc')).toBe('Escape');
    expect(normalizeVisualRuleKeyboardKey('ArrowLeft')).toBe('ArrowLeft');
    expect(isVisualRuleKeyboardTrigger('key-down')).toBe(true);
    expect(isVisualRuleKeyboardTrigger('key-up')).toBe(true);
    expect(isVisualRuleKeyboardTrigger('click')).toBe(false);
  });
  it('handles malformed raw document keys without claiming any keyboard input', () => {
    for (const key of [undefined, null, 7, {}, []]) {
      expect(normalizeVisualRuleKeyboardKey(key as string)).toBe('');
      const keyboard = { key: key as string };
      expect(visualRuleKeyboardErrors(keyboard)).not.toEqual([]);
      expect(visualRuleKeyboardMatches(keyboard, { key: 'Enter' })).toBe(false);
      expect(visualRuleKeyboardMatches({ key: 'Enter' }, { key: key as string })).toBe(false);
    }
    expect(visualRuleKeyboardErrors(null)).not.toEqual([]);
  });
  it('matches modifiers exactly, defaults repeat off, and ignores composition input', () => {
    expect(visualRuleKeyboardMatches({ key: 'a' }, { key: 'a', ctrlKey: true })).toBe(false);
    expect(visualRuleKeyboardMatches({ key: 'A', ctrl: true }, { key: 'a' })).toBe(false);
    expect(visualRuleKeyboardMatches({ key: 'A', ctrl: true }, { key: 'a', ctrlKey: true })).toBe(
      true,
    );
    for (const modifier of ['altKey', 'shiftKey', 'metaKey'] as const)
      expect(visualRuleKeyboardMatches({ key: 'a' }, { key: 'a', [modifier]: true })).toBe(false);
    expect(visualRuleKeyboardMatches({ key: 'a' }, { key: 'a', repeat: true })).toBe(false);
    expect(visualRuleKeyboardMatches({ key: 'a', repeat: true }, { key: 'a', repeat: true })).toBe(
      true,
    );
    expect(
      visualRuleKeyboardMatches({ key: 'a', repeat: true }, { key: 'a', isComposing: true }),
    ).toBe(false);
    expect(visualRuleKeyboardErrors({ key: '' })).not.toEqual([]);
    expect(visualRuleKeyboardErrors({ key: '\t' })).not.toEqual([]);
    expect(visualRuleKeyboardErrors({ key: ' ', ctrl: 'yes' })).not.toEqual([]);
    expect(visualRuleKeyboardErrors({ key: ' ' })).toEqual([]);
  });
  it('filters the key before reading guards and retains ordinary targets, actions and delay', () => {
    const rule = createLayerVisualRule({
      trigger: 'key-down',
      keyboard: { key: 'Enter', shift: true },
      delayFrames: 9,
      conditions: [{ fieldId: 'enabled', sourcePath: [], operator: 'equals', value: true }],
      actions: [{ type: 'toggle-visibility', targetLayerId: 'panel', transitionFrames: 12 }],
    });
    const read = vi.fn(
      (condition: VisualRuleCondition, _host: string, data: Record<string, unknown>) =>
        data[condition.fieldId],
    );
    const engine = {
      hosts: [{ layerId: 'host', rules: [rule] }],
      reader: { read, readCompare: () => null },
    };
    expect(
      firedVisualRuleEventRules(
        engine,
        'key-down',
        { enabled: true },
        { keyboard: { key: 'Escape' } },
      ),
    ).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(
      firedVisualRuleEventRules(
        engine,
        'key-down',
        { enabled: false },
        { keyboard: { key: 'Enter', shiftKey: true } },
      ),
    ).toEqual([]);
    expect(
      firedVisualRuleEventRules(
        engine,
        'key-down',
        { enabled: true },
        { keyboard: { key: 'Enter', shiftKey: true } },
      ),
    ).toEqual([{ hostLayerId: 'host', rule }]);
    expect(firedVisualRuleEventRules(engine, 'key-down', { enabled: true })).toEqual([]);
    rule.trigger = 'key-up';
    expect(
      firedVisualRuleEventRules(
        engine,
        'key-up',
        { enabled: true },
        { keyboard: { key: 'Enter', shiftKey: true, repeat: true } },
      ),
    ).toEqual([{ hostLayerId: 'host', rule }]);
  });
});

describe('visual rules', () => {
  it('evaluates equality, emptiness, and numeric comparisons', () => {
    expect(visualRuleMatches('equals', 'GOLD', 'GOLD')).toBe(true);
    expect(visualRuleMatches('not-equals', 'SILVER', 'GOLD')).toBe(true);
    expect(visualRuleMatches('empty', '')).toBe(true);
    expect(visualRuleMatches('not-empty', ['row'])).toBe(true);
    expect(visualRuleMatches('greater-than', 4, 3)).toBe(true);
    expect(visualRuleMatches('less-than', 2, 3)).toBe(true);
  });

  it('matches typed data against values typed into the Rules panel', () => {
    expect(visualRuleMatches('equals', 5, '5')).toBe(true);
    expect(visualRuleMatches('equals', 5, ' 5 ')).toBe(true);
    expect(visualRuleMatches('not-equals', 5, '5')).toBe(false);
    expect(visualRuleMatches('equals', true, 'true')).toBe(true);
    expect(visualRuleMatches('equals', false, 'TRUE')).toBe(false);
    expect(visualRuleMatches('equals', '01', '1')).toBe(false);
    expect(visualRuleMatches('equals', 'Gold', 'gold')).toBe(false);
    expect(visualRuleMatches('equals', 'Gold', 'gold', undefined, { ignoreCase: true })).toBe(true);
    expect(visualRuleMatches('greater-than', '', -1)).toBe(false);
  });

  it('evaluates ranges, lists, and text operators', () => {
    expect(visualRuleMatches('between', 5, [1, 10])).toBe(true);
    expect(visualRuleMatches('between', 5, '10, 1')).toBe(true);
    expect(visualRuleMatches('between', 11, [1, 10])).toBe(false);
    expect(visualRuleMatches('greater-or-equal', 3, 3)).toBe(true);
    expect(visualRuleMatches('less-or-equal', 4, 3)).toBe(false);
    expect(visualRuleMatches('one-of', 'FB', 'GS, FB, BJK')).toBe(true);
    expect(visualRuleMatches('not-one-of', 'TS', ['GS', 'FB'])).toBe(true);
    expect(visualRuleMatches('one-of', 2, ['1', '2'])).toBe(true);
    expect(
      visualRuleMatches('contains', 'BREAKING NEWS', 'breaking', undefined, { ignoreCase: true }),
    ).toBe(true);
    expect(visualRuleMatches('contains', ['a', 'b'], 'b')).toBe(true);
    expect(visualRuleMatches('not-contains', 'Weather', 'news')).toBe(true);
    expect(visualRuleMatches('starts-with', 'LIVE: Match', 'LIVE')).toBe(true);
    expect(visualRuleMatches('ends-with', 'score.png', '.png')).toBe(true);
    expect(visualRuleMatches('contains', 'anything', '')).toBe(false);
  });

  it('detects changed, increased, and decreased updates only with a previous value', () => {
    expect(visualRuleMatches('changed', 2, undefined, 1)).toBe(true);
    expect(visualRuleMatches('increased', 2, undefined, 1)).toBe(true);
    expect(visualRuleMatches('decreased', 1, undefined, 2)).toBe(true);
    expect(visualRuleMatches('changed', 2, undefined, undefined)).toBe(false);
    expect(visualRuleMatches('changed', 2, undefined, '2')).toBe(false);
  });

  it('reads nested object values safely', () => {
    expect(visualRuleValue({ result: { medal: 'GOLD' } }, ['result', 'medal'])).toBe('GOLD');
    expect(visualRuleValue({}, ['missing', 'value'])).toBeUndefined();
  });

  it('interpolates numbers, colours and vectors and switches anything else', () => {
    expect(interpolateVisualRuleValue(0, 10, 0.5)).toBe(5);
    expect(interpolateVisualRuleValue('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(interpolateVisualRuleValue([0, 0], [1, 1], 0.5)).toEqual([0.5, 0.5]);
    expect(interpolateVisualRuleValue('Home', 'Away', 0.5)).toBe('Away');
    expect(interpolateVisualRuleValue('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});

describe('visual rule engine', () => {
  const data = { score: 3, target: 2, status: 'LIVE' } as Record<string, unknown>;
  const reader: VisualRuleDataReader<VisualRuleCondition, Record<string, unknown>> = {
    read: (condition, _host, values) =>
      visualRuleValue(values[condition.fieldId], condition.sourcePath),
    readCompare: (condition, _host, values) =>
      condition.compareFieldId ? { value: values[condition.compareFieldId] } : null,
  };
  const engine = (
    rules: LayerVisualRule[],
  ): VisualRuleEngine<VisualRuleCondition, LayerVisualRule, Record<string, unknown>> => ({
    hosts: [{ layerId: 'host', rules }],
    reader,
  });

  it('combines conditions with all or any and compares two fields', () => {
    const rule = createLayerVisualRule({
      fieldId: 'score',
      operator: 'greater-than',
      compareFieldId: 'target',
      conditions: [{ fieldId: 'status', sourcePath: [], operator: 'equals', value: 'FT' }],
    });
    expect(visualRuleConditionsHold(reader, rule, 'host', data)).toBe(false);
    expect(visualRuleConditionsHold(reader, { ...rule, match: 'any' }, 'host', data)).toBe(true);
    expect(visualRuleFieldIds(rule).sort()).toEqual(['score', 'status', 'target']);
  });

  it('treats non-data triggers as events guarded by their conditions', () => {
    const click = createLayerVisualRule({ trigger: 'click' });
    expect(isVisualRuleState(click)).toBe(false);
    expect(visualRuleConditionsHold(reader, click, 'host', data)).toBe(true);
    expect(isVisualRuleState(createLayerVisualRule({ trigger: 'hover' }))).toBe(true);
    expect(isVisualRuleState(createLayerVisualRule({ operator: 'increased' }))).toBe(false);
  });

  it('writes state actions to their target layers, later rules winning', () => {
    const states = collectVisualRuleStates(
      engine([
        createLayerVisualRule({
          fieldId: 'status',
          operator: 'not-empty',
          actions: [
            { type: 'property', targetProperty: 'fill', value: '#111111', targetLayerId: 'other' },
          ],
        }),
        createLayerVisualRule({
          fieldId: 'score',
          operator: 'greater-than',
          value: 1,
          actions: [
            { type: 'property', targetProperty: 'fill', value: '#222222', targetLayerId: 'other' },
            { type: 'visibility', visible: false, transitionFrames: 6 },
          ],
        }),
      ]),
      data,
    );
    expect(states.get('other')?.properties.fill).toBe('#222222');
    expect(states.get('host')).toMatchObject({
      visibility: false,
      transitionFrames: { '@visibility': 6 },
    });
  });

  it('fills the keys an agent may omit', () => {
    const rule = normalizeLayerVisualRule({
      id: 'r',
      name: 'Click',
      enabled: true,
      trigger: 'click',
      conditions: [{ fieldId: 'status' }],
      actions: [{ type: 'toggle-visibility' }],
    });
    expect(rule).toMatchObject({ fieldId: '', sourcePath: [], operator: 'equals' });
    expect(rule.conditions).toEqual([{ fieldId: 'status', sourcePath: [], operator: 'equals' }]);
  });
});

describe('visual rule references', () => {
  it('remaps copied layer and field references', () => {
    const rule = createLayerVisualRule({
      fieldId: 'f1',
      compareFieldId: 'f2',
      actions: [{ type: 'visibility', visible: true, targetLayerId: 'a' }],
    });
    const copy = remapVisualRule(rule, {
      layerIds: new Map([['a', 'a2']]),
      fieldIds: new Map([['f1', 'g1']]),
    });
    expect(copy.id).not.toBe(rule.id);
    expect(copy).toMatchObject({ fieldId: 'g1', compareFieldId: 'f2' });
    expect(copy.actions[0]).toMatchObject({ targetLayerId: 'a2' });
  });

  it('prunes parts that point at deleted things and keeps blank ones being authored', () => {
    const field = createFieldDefinition('text', { key: 'status' });
    const owner = createLayerOfKind('rectangle');
    owner.visualRules = [
      createLayerVisualRule({
        id: 'keep',
        fieldId: field.id,
        compareFieldId: 'gone-field',
        conditions: [{ fieldId: 'gone-field', sourcePath: [], operator: 'equals' }],
        actions: [
          { type: 'visibility', visible: true, targetLayerId: 'gone-layer' },
          { type: 'property', targetProperty: 'fill', value: '#fff' },
          { type: 'play-sound', cueId: '' },
        ],
      }),
      createLayerVisualRule({ id: 'dead-trigger', trigger: 'custom-action', eventId: 'gone' }),
      createLayerVisualRule({
        id: 'no-actions-left',
        trigger: 'click',
        actions: [{ type: 'visibility', visible: false, targetLayerId: 'gone-layer' }],
      }),
    ];
    const composition = createComposition({ layers: [owner], dataFields: [field] });
    pruneVisualRuleReferences(composition);
    const [kept, ...rest] = composition.layers[0]!.visualRules;
    expect(rest).toEqual([]);
    expect(kept!.id).toBe('keep');
    expect(kept!.compareFieldId).toBeUndefined();
    expect(kept!.conditions).toBeUndefined();
    expect(kept!.actions).toEqual([
      { type: 'property', targetProperty: 'fill', value: '#fff' },
      { type: 'play-sound', cueId: '' },
    ]);
  });
});
