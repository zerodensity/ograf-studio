import { describe, expect, it } from 'vitest';
import { mcpTemplateSetOperationSchema, templateSetOperationSchema } from './templateSetSchemas';
import type { TransitionLogicDefinition } from '@ograf-editor/scene-model';

const token = {
  id: 'shared-accent',
  key: 'accent',
  name: 'Accent',
  type: 'color',
  value: '#1166aa',
};

describe('Template Set creation provenance', () => {
  it.each([
    { type: 'new_template' },
    { type: 'duplicate_template', templateId: 'news' },
    { type: 'paste_template' },
  ])('requires the original user prompt for external $type only', (operation) => {
    expect(mcpTemplateSetOperationSchema.safeParse(operation).success).toBe(false);
    expect(
      mcpTemplateSetOperationSchema.safeParse({ ...operation, originalPrompt: '  ' }).success,
    ).toBe(false);
    const originalPrompt = '  Build a new panel with two columns.\nKeep the headings.  ';
    expect(mcpTemplateSetOperationSchema.parse({ ...operation, originalPrompt })).toMatchObject({
      ...operation,
      originalPrompt,
    });
    expect(templateSetOperationSchema.parse(operation)).toMatchObject(operation);
    expect(templateSetOperationSchema.safeParse({ ...operation, originalPrompt }).success).toBe(
      false,
    );
  });

  it('can wrap an existing template in a set without claiming new provenance', () => {
    const operation = { type: 'create', name: 'News set' };
    expect(mcpTemplateSetOperationSchema.parse(operation)).toEqual(operation);
  });
});

describe('Template Set theme and per-setting MCP schemas', () => {
  it('parses all five new operations with explicit stable identities', () => {
    const operations = [
      { type: 'set_setting_override', templateId: 'news', key: 'layout.gridSize', override: true },
      { type: 'set_brand_kit', brandKit: { name: 'News Brand Kit', tokens: [token] } },
      { type: 'upsert_brand_token', token },
      { type: 'remove_brand_token', tokenId: token.id },
      { type: 'set_brand_token_override', templateId: 'news', tokenId: token.id, override: false },
    ];
    for (const operation of operations)
      expect(templateSetOperationSchema.parse(operation)).toMatchObject(operation);
    const parsed = templateSetOperationSchema.parse({ type: 'upsert_brand_token', token });
    expect(parsed).toMatchObject({ token: { ...token, description: '' } });
  });

  it('rejects unknown operation properties, nested executable fields and invalid setting keys', () => {
    const invalid = [
      { type: 'set_setting_override', templateId: 'news', key: 'gridSize', override: true },
      {
        type: 'set_setting_override',
        templateId: 'news',
        key: 'layout.presentationBackground',
        override: true,
      },
      { type: 'set_setting_override', templateId: 'news', key: 'width', override: 'yes' },
      { type: 'set_brand_kit', brandKit: { name: 'News', tokens: [token], css: 'body{}' } },
      { type: 'upsert_brand_token', token: { ...token, script: 'alert(1)' } },
      { type: 'upsert_brand_token', token: { ...token, value: true } },
      { type: 'remove_brand_token', tokenId: token.id, confirm: true },
      { type: 'set_brand_token_override', templateId: '', tokenId: token.id, override: true },
      { type: 'set_brand_token_override', templateId: 'news', tokenId: token.id, override: null },
      { type: 'run_theme_script', script: 'alert(1)' },
    ];
    for (const operation of invalid)
      expect(
        templateSetOperationSchema.safeParse(operation).success,
        JSON.stringify(operation),
      ).toBe(false);
  });

  it('accepts all declared flattened keys and bounded primitive token types', () => {
    for (const key of ['width', 'backgroundColor', 'supportsRealTime', 'layout.snapThreshold'])
      expect(
        templateSetOperationSchema.safeParse({
          type: 'set_setting_override',
          templateId: 'news',
          key,
          override: false,
        }).success,
      ).toBe(true);
    for (const [type, value] of [
      ['color', '#1166aa'],
      ['number', 48],
      ['text', 'Headline'],
      ['font-family', 'Show Sans'],
      ['font-weight', 700],
    ])
      expect(
        templateSetOperationSchema.safeParse({
          type: 'upsert_brand_token',
          token: { ...token, type, value },
        }).success,
      ).toBe(true);
    expect(
      templateSetOperationSchema.safeParse({
        type: 'upsert_brand_token',
        token: { ...token, type: 'css' },
      }).success,
    ).toBe(false);
  });
});

describe('Template Set MCP lane dependencies', () => {
  function transitionDefinition(): TransitionLogicDefinition {
    return {
      version: 3,
      id: 'dependency-test',
      name: 'Dependency test',
      defaultTransitionId: 'fade',
      slots: [
        { id: 'lower-third', name: 'Lower third', order: 0 },
        { id: 'ticker', name: 'Ticker', order: 1 },
      ],
      states: [],
      transitions: [
        {
          id: 'fade',
          name: 'Fade',
          durationFrames: 12,
          outgoingFrames: 12,
          incomingStartFrame: 0,
          incomingFrames: 12,
          sharedFrames: 12,
          easing: 'linear',
        },
      ],
      routes: [],
      sharedInstances: [],
      initialSharedValues: [],
    };
  }

  it('preserves an optional valid parent ID in a complete definition', () => {
    const definition = transitionDefinition();
    definition.slots.find((slot) => slot.id === 'ticker')!.parentSlotId = 'lower-third';
    expect(
      templateSetOperationSchema.parse({ type: 'set_transition_logic', definition }),
    ).toMatchObject({ definition });
  });

  it('preserves v4 admission and falsey state presets through the MCP schema', () => {
    const definition = transitionDefinition();
    definition.version = 4;
    definition.slots[1]!.admission = { requireOnSlotIds: ['lower-third'] };
    definition.states = [
      {
        id: 'source',
        name: 'Source',
        slotId: 'ticker',
        templateId: 'header',
        dataDefaults: { label: '', show: false, count: 0 },
      },
    ];
    expect(
      templateSetOperationSchema.parse({ type: 'set_transition_logic', definition }),
    ).toMatchObject({ definition });
    for (const version of [1, 2, 3] as const) {
      definition.version = version;
      expect(
        templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition }).success,
      ).toBe(false);
    }
  });

  it('rejects malformed, self-referential, cyclic and contradictory admission JSON', () => {
    for (const admission of [
      { requireOnSlotIds: 'lower-third' },
      { unexpected: ['lower-third'] },
      { requireOnSlotIds: ['ticker'] },
      { requireOnSlotIds: ['lower-third'], blockWhileActiveSlotIds: ['lower-third'] },
    ]) {
      const definition = transitionDefinition();
      definition.version = 4;
      const raw = definition as unknown as { slots: Array<{ admission?: unknown }> };
      raw.slots[1]!.admission = admission;
      expect(
        templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition }).success,
      ).toBe(false);
    }
    const definition = transitionDefinition();
    definition.version = 4;
    definition.slots[0]!.admission = { requireOnSlotIds: ['ticker'] };
    definition.slots[1]!.admission = { requireOnSlotIds: ['lower-third'] };
    expect(
      templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition }).success,
    ).toBe(false);
  });

  it('rejects non-object and oversized named-state preset JSON', () => {
    for (const dataDefaults of [false, [], { large: 'x'.repeat(65_537) }]) {
      const definition = transitionDefinition();
      definition.version = 4;
      const raw = {
        ...definition,
        states: [
          { id: 'source', name: 'Source', slotId: 'ticker', templateId: 'header', dataDefaults },
        ],
      };
      expect(
        templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition: raw })
          .success,
      ).toBe(false);
    }
  });

  it('preserves takeover targets and rejects unsafe references through the MCP contract', () => {
    const definition = transitionDefinition();
    definition.states = [
      {
        id: 'breaking',
        name: 'Breaking',
        slotId: 'lower-third',
        templateId: 'breaking-template',
        takeOutSlotIds: ['ticker'],
      },
    ];
    expect(
      templateSetOperationSchema.parse({ type: 'set_transition_logic', definition }),
    ).toMatchObject({ definition });
    for (const targets of [['missing'], ['lower-third'], ['ticker', 'ticker']]) {
      definition.states[0]!.takeOutSlotIds = targets;
      expect(
        templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition }).success,
      ).toBe(false);
    }
  });

  it('rejects absent, empty, self and cyclic parents through the domain validator', () => {
    for (const parent of ['missing', '', 'ticker']) {
      const definition = transitionDefinition();
      definition.slots.find((slot) => slot.id === 'ticker')!.parentSlotId = parent;
      expect(
        templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition }).success,
        parent,
      ).toBe(false);
    }
    const definition = transitionDefinition();
    definition.slots.find((slot) => slot.id === 'ticker')!.parentSlotId = 'lower-third';
    definition.slots.find((slot) => slot.id === 'lower-third')!.parentSlotId = 'ticker';
    expect(
      templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition }).success,
    ).toBe(false);
  });
});
