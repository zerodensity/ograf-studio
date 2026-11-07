import Ajv from 'ajv';
import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { compactProviderSchema } from './compactProviderSchema';
import { templateSetOperationSchema } from './templateSetSchemas';
import { authoringOperationSchema } from './schemas';

function equivalent(schema: Record<string, unknown>, values: unknown[]) {
  const original = structuredClone(schema);
  const compact = compactProviderSchema(schema);
  const before = new Ajv({ strict: false }).compile(schema);
  const after = new Ajv({ strict: false }).compile(compact);
  for (const value of values) expect(after(value), JSON.stringify(value)).toBe(before(value));
  expect(schema).toEqual(original);
  expect(compactProviderSchema(compact)).toEqual(compact);
  return compact;
}

describe('provider reference and strict-union costs', () => {
  it('omits redundant open applicators and tautological literal unions without adding vocabulary', () => {
    const payload = { additionalProperties: {}, anyOf: [{ type: 'string' }, { type: 'null' }] };
    const schema = {
      type: 'object',
      properties: {
        open: { type: 'object', additionalProperties: {} },
        nullable: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Keep this guidance',
        },
        unrestricted: {
          anyOf: [{}, { enum: ['x', 'x\n', '🙂', 'a/b~c'] }],
          description: 'Keep this guidance',
        },
        unrestrictedConst: { anyOf: [{}, { const: 'literal\n🙂/~' }] },
        hinted: { anyOf: [{}, { enum: ['x'], description: 'Preserve branch guidance' }] },
        number: { anyOf: [{ type: 'integer' }, { type: 'number' }] },
        constrained: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] },
        annotated: { anyOf: [{ type: 'string', description: 'Visible string' }, { type: 'null' }] },
        exclusive: { oneOf: [{ type: 'integer' }, { type: 'number' }] },
        data: { const: payload, default: payload, examples: [payload] },
      },
      additionalProperties: false,
    };
    const compact = equivalent(schema, [
      {},
      { open: { arbitrary: [1, null, 'é'] }, nullable: null },
      ...['', 'x', 'x\n', '\n', 'Türkiye', '🙂', 'a/b~c', '\u2028'].map((nullable) => ({
        nullable,
      })),
      { open: null },
      { nullable: 1 },
      { nullable: {} },
      { unrestricted: 'other\n' },
      { unrestricted: '🙂\u2028' },
      { unrestricted: { arbitrary: true } },
      { unrestricted: [1, null] },
      { unrestrictedConst: 'other' },
      { unrestrictedConst: false },
      { number: 1 },
      { number: 1.5 },
      { number: '1' },
      { constrained: 'x' },
      { constrained: 'xx' },
      { constrained: null },
      { exclusive: 1 },
      { exclusive: 1.5 },
      { exclusive: null },
      { data: payload },
    ]);
    expect(compact.properties).toMatchObject({
      open: { type: 'object' },
      nullable: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Keep this guidance',
      },
      unrestricted: { description: 'Keep this guidance' },
      unrestrictedConst: {},
      hinted: { anyOf: [{}, { enum: ['x'], description: 'Preserve branch guidance' }] },
      number: { anyOf: [{ type: 'integer' }, { type: 'number' }] },
      constrained: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] },
      annotated: { anyOf: [{ type: 'string', description: 'Visible string' }, { type: 'null' }] },
      exclusive: { oneOf: [{ type: 'integer' }, { type: 'number' }] },
      data: { const: payload, default: payload, examples: [payload] },
    });
    expect((compact.properties as Record<string, Record<string, unknown>>).open).not.toHaveProperty(
      'additionalProperties',
    );
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(schema)),
    );
  });

  it('retains referenced schema positions and unevaluated applicator semantics', () => {
    const addressed = {
      type: 'object',
      properties: {
        open: { type: 'object', additionalProperties: {} },
        nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        literal: { anyOf: [{}, { enum: ['yes'] }] },
        openConstraint: { $ref: '#/properties/open/additionalProperties' },
        stringConstraint: { $ref: '#/properties/nullable/anyOf/0' },
        literalConstraint: { $ref: '#/properties/literal/anyOf/1' },
      },
    };
    const compact = equivalent(addressed, [
      {},
      { open: {}, nullable: null, openConstraint: 3, stringConstraint: 'x\n' },
      { stringConstraint: 3 },
      { literalConstraint: 'yes' },
      { literalConstraint: 'no' },
    ]);
    expect(compact.properties).toMatchObject({
      open: { additionalProperties: {} },
      nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      literal: { anyOf: [{}, { enum: ['yes'] }] },
    });
    for (const keyword of ['unevaluatedProperties', 'unevaluatedItems']) {
      const schema = {
        type: 'object',
        additionalProperties: {},
        properties: { value: { anyOf: [{}, { enum: ['x'] }] } },
        [keyword]: false,
      };
      expect(compactProviderSchema(schema)).toMatchObject(schema);
    }
  });

  it('inlines cheaper schemas including definition overhead without activating ref siblings or changing data', () => {
    const payload = { $ref: '#/definitions/text', definitions: { text: { const: 'data' } } };
    const schema = {
      type: 'object',
      definitions: {
        text: { type: 'string' },
        count: {
          type: 'integer',
          minimum: 2,
          maximum: 19,
          description: 'Visible count annotation',
        },
        unused: { type: 'string', description: 'Unused destination stays available' },
      },
      properties: {
        label: { $ref: '#/definitions/text' },
        count: { $ref: '#/definitions/count' },
        sibling: {
          $ref: '#/definitions/text',
          type: 'number',
          description: 'Keep this annotation',
        },
        payload: { const: payload, default: payload, examples: [payload] },
      },
      additionalProperties: false,
    };
    const compact = equivalent(schema, [
      {},
      { label: 'hello', count: 2 },
      { label: 2 },
      { count: 1 },
      { count: 20 },
      { count: 2.5 },
      { sibling: 'text' },
      { sibling: 3 },
      { payload },
      { extra: 'unknown' },
    ]);
    expect(compact.properties).toMatchObject({
      label: { type: 'string' },
      count: { type: 'integer', minimum: 2, maximum: 19, description: 'Visible count annotation' },
      sibling: { $ref: '#/$defs/0', type: 'number', description: 'Keep this annotation' },
      payload: { const: payload, default: payload, examples: [payload] },
    });
    expect(compact.$defs).toMatchObject({
      '0': { type: 'string' },
      '2': { description: 'Unused destination stays available' },
    });
    expect(compact.$defs).not.toHaveProperty('1');
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(schema)),
    );
  });

  it('consolidates identical definitions and preserves escaped descendant references and annotations', () => {
    const repeated = {
      type: 'object',
      properties: { 'a b#': { type: 'string', minLength: 3 } },
      additionalProperties: false,
      description: 'Shared object description',
    };
    const payload = { $ref: '#/$defs/copy~1name/properties/a%20b%23' };
    const schema = {
      type: 'object',
      $defs: { z: repeated, 'copy/name': repeated },
      properties: {
        nested: { $ref: '#/$defs/copy~1name/properties/a%20b%23' },
        whole: { $ref: '#/$defs/z' },
        payload: { const: payload },
      },
    };
    const compact = equivalent(schema, [
      {},
      { nested: 'good', whole: { 'a b#': 'okay' }, payload },
      { nested: 'no' },
      { nested: 4 },
      { whole: { 'a b#': 4 } },
      { whole: { unknown: true } },
    ]);
    expect(compact.$defs).toHaveProperty('z');
    expect(compact.$defs).not.toHaveProperty('copy/name');
    expect(compact.properties).toMatchObject({
      nested: { $ref: '#/$defs/z/properties/a%20b%23' },
      payload: { const: payload },
    });
  });

  it('keeps recursive destinations and resolves alias chains without introducing dangling references', () => {
    const schema = {
      definitions: {
        label: { type: 'string', minLength: 2 },
        alias: { $ref: '#/definitions/label' },
        node: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { $ref: '#/definitions/alias' },
            next: { $ref: '#/definitions/node' },
          },
          required: ['value'],
        },
      },
      $ref: '#/definitions/node',
    };
    equivalent(schema, [
      { value: 'okay' },
      { value: 'okay', next: { value: 'yes' } },
      { value: 'x' },
      { value: 'okay', next: { value: 1 } },
      { value: 'okay', extra: true },
      null,
      [],
      1,
    ]);
  });

  it.each(['anyOf', 'oneOf'])(
    'shares closed %s property constraints without allowing keys in other variants',
    (keyword) => {
      const common = { type: 'string', minLength: 3, maxLength: 40, description: 'Public label' };
      const branch = (kind: string, includeLabel: boolean) => ({
        type: 'object',
        properties: { kind: { const: kind }, ...(includeLabel ? { label: common } : {}) },
        required: includeLabel ? ['kind', 'label'] : ['kind'],
        additionalProperties: false,
      });
      const schema = { [keyword]: [branch('a', true), branch('b', true), branch('c', false)] };
      const compact = equivalent(schema, [
        { kind: 'a', label: 'okay' },
        { kind: 'b', label: 'okay' },
        { kind: 'c' },
        { kind: 'c', label: 'otherwise valid but not allowed' },
        { kind: 'a', label: 'no' },
        { kind: 'b', label: 3 },
        { kind: 'a', label: 'x'.repeat(41) },
        { kind: 'a' },
        { kind: 'a', label: 'okay', extra: true },
        {},
        false,
        null,
        1,
        [],
      ]);
      expect(compact.properties).toMatchObject({ label: common });
      expect((compact[keyword] as Array<Record<string, unknown>>)[0]!.properties).toMatchObject({
        label: {},
      });
      expect(
        (compact[keyword] as Array<Record<string, unknown>>)[2]!.properties,
      ).not.toHaveProperty('label');
    },
  );

  it('does not lift constraints across open/pattern branches or pointer-addressed descendants', () => {
    const common = { type: 'string', minLength: 3, maxLength: 40, description: 'Public label' };
    const closed = (kind: string) => ({
      type: 'object',
      properties: { kind: { const: kind }, label: common },
      required: ['kind'],
      additionalProperties: false,
    });
    for (const extra of [
      {
        type: 'object',
        properties: { kind: { const: 'other' } },
        required: ['kind'],
        additionalProperties: true,
      },
      {
        type: 'object',
        properties: { kind: { const: 'other' } },
        patternProperties: { '^label$': { type: 'number' } },
        required: ['kind'],
        additionalProperties: false,
      },
    ]) {
      const compact = equivalent({ anyOf: [closed('a'), closed('b'), extra] }, [
        { kind: 'other', label: 2 },
        { kind: 'a', label: 2 },
        { kind: 'a', label: 'yes' },
        { kind: 'a', label: 'x' },
      ]);
      expect(compact.properties).toBeUndefined();
    }
    const compact = equivalent(
      {
        type: 'object',
        properties: {
          choice: { oneOf: [closed('a'), closed('b')] },
          extracted: { $ref: '#/properties/choice/oneOf/0/properties/label' },
        },
      },
      [
        { extracted: 'yes' },
        { extracted: 'no' },
        { extracted: 3 },
        { choice: { kind: 'a', label: 'yes' } },
      ],
    );
    expect(
      (compact.properties as Record<string, Record<string, unknown>>).choice,
    ).not.toHaveProperty('properties');
  });
});

describe('provider schema compaction', () => {
  it('keeps draft-7 acceptance identical for canonical Template Set commands', () => {
    const schema = z.toJSONSchema(
      z.object({
        expectedRevision: z.string().min(1),
        operation: templateSetOperationSchema,
        confirm: z.boolean().default(false),
      }),
      { target: 'draft-7', reused: 'ref', unrepresentable: 'any' },
    );
    const compact = compactProviderSchema(schema);
    const ajv = new Ajv({ strict: false, allErrors: true });
    const originalValidation = ajv.compile(schema);
    const compactValidation = ajv.compile(compact);
    const token = {
      id: 'accent',
      key: 'brand.accent',
      name: 'Accent',
      type: 'color',
      value: '#ffffff',
      description: '',
    };
    const commands = [
      { type: 'create', name: 'News' },
      { type: 'upsert_brand_token', token },
      { type: 'set_brand_kit', brandKit: { name: 'News', tokens: [token] } },
      {
        type: 'set_setting_override',
        templateId: 'title',
        key: 'layout.showRulers',
        override: true,
      },
      { type: 'set_brand_token_override', templateId: 'title', tokenId: 'accent', override: false },
      {
        type: 'set_defaults',
        patch: { width: 1920, height: 1080, frameRate: 25, layout: { boundsMode: 'contain' } },
      },
      { type: 'remove_brand_token', tokenId: 'accent' },
      { type: 'set_brand_kit', brandKit: { name: 'News', tokens: [{ ...token, type: 7 }] } },
      { type: 'set_setting_override', templateId: 'title', key: 'unknown', override: true },
      {
        type: 'set_brand_token_override',
        templateId: 'title',
        tokenId: 'accent',
        override: 'false',
      },
      { type: 'set_defaults', patch: { width: 0 } },
      { type: 'set_defaults', patch: { width: 32769 } },
      { type: 'set_defaults', patch: { width: 2.5 } },
      { type: 'set_defaults', patch: { width: 1920, surprise: 'unknown property' } },
      {
        type: 'set_brand_kit',
        brandKit: { name: 'News', tokens: Array.from({ length: 1025 }, () => token) },
      },
      { type: 'remove_brand_token', tokenId: '' },
      { type: 'unrecognized' },
    ];
    for (const operation of commands) {
      const input = { expectedRevision: 'revision', operation, confirm: false };
      expect(compactValidation(input), JSON.stringify(operation)).toBe(originalValidation(input));
    }
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(schema)),
    );
  });

  it('preserves constraints, local references, tuple/unions and unknown-property rejection', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      definitions: {
        __schema0: { type: 'string', enum: ['hello', 'world'], minLength: 4 },
        __schema1: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        __schema2: {
          type: 'object',
          properties: { nested: { type: 'string', const: 'value' } },
          required: ['nested'],
          additionalProperties: false,
        },
      },
      properties: {
        name: { $ref: '#/definitions/__schema0' },
        hash: { $ref: '#/definitions/__schema1' },
        literal: { $ref: '#/definitions/__schema2/properties/nested' },
        tuple: {
          type: 'array',
          items: [
            { type: 'string', const: 'x' },
            { type: 'integer', minimum: 0 },
          ],
          additionalItems: false,
        },
        choice: {
          anyOf: [
            { type: 'string', const: 'ok' },
            { type: 'number', minimum: 1, maximum: 3 },
          ],
        },
      },
      required: ['name', 'hash', 'literal'],
    };
    const compact = compactProviderSchema(schema);
    expect(compact.$defs).toHaveProperty('2');
    expect(compact.properties).toMatchObject({
      literal: { $ref: '#/$defs/2/properties/nested' },
    });
    const ajv = new Ajv({ strict: false });
    const originalValidation = ajv.compile(schema),
      compactValidation = ajv.compile(compact);
    const valid = { name: 'hello', hash: 'a'.repeat(64), literal: 'value' };
    for (const input of [
      valid,
      { ...valid, tuple: ['x', 1], choice: 2 },
      { ...valid, name: 2 },
      { ...valid, name: 'unknown' },
      { ...valid, hash: 'bad' },
      { ...valid, literal: 'bad' },
      { ...valid, extra: true },
      { ...valid, tuple: ['x', 1, 2] },
      { ...valid, tuple: ['wrong', 1] },
      { ...valid, tuple: ['x', -1] },
      { ...valid, choice: 4 },
      { ...valid, choice: {} },
    ])
      expect(compactValidation(input)).toBe(originalValidation(input));
  });

  it('never walks schema-shaped data in defaults, examples, const or enum', () => {
    const data = {
      type: 'string',
      const: 'x',
      enum: ['x'],
      $ref: '#/definitions/__schema0',
      definitions: { __schema0: { type: 'string', const: 'data' } },
    };
    const schema = {
      type: 'object',
      definitions: { __schema0: { type: 'string', const: 'real-schema' } },
      default: data,
      examples: [data],
      properties: { payload: { const: data, enum: [data], default: data, examples: [data] } },
    };
    const before = structuredClone(schema);
    const compact = compactProviderSchema(schema);
    expect(compact.default).toEqual(data);
    expect(compact.examples).toEqual([data]);
    expect(compact.properties).toMatchObject({
      payload: { const: data, enum: [data], default: data, examples: [data] },
    });
    expect(schema).toEqual(before);
    expect((compact.$defs as Record<string, unknown>)['0']).toEqual({
      const: 'real-schema',
    });
  });

  it('keeps nested resource and external references in their own scope', () => {
    const schema = {
      definitions: { __schema0: { type: 'string', const: 'outer' } },
      properties: {
        outer: { $ref: '#/definitions/__schema0' },
        external: { $ref: 'https://example.com/schema#/definitions/__schema0' },
        inner: {
          $id: 'inner.json',
          definitions: { __schema0: { type: 'string', const: 'inner' } },
          $ref: '#/definitions/__schema0',
        },
      },
    };
    const compact = compactProviderSchema(schema);
    expect(compact).toEqual(schema);
    const withoutExternal = structuredClone(schema);
    delete (withoutExternal.properties as Partial<typeof schema.properties>).external;
    expect(compactProviderSchema(withoutExternal).properties).toMatchObject({
      outer: { $ref: '#/$defs/0' },
      inner: { $ref: '#/definitions/__schema0', definitions: { __schema0: { const: 'inner' } } },
    });
  });

  it('decodes escaped definition pointer segments before renaming them', () => {
    const schema = {
      definitions: { 'some/key~name': { type: 'string', const: 'x' } },
      $ref: '#/definitions/some~1key~0name',
    };
    const compact = compactProviderSchema(schema);
    expect(compact.$ref).toBe('#/$defs/0');
    expect(new Ajv({ strict: false }).compile(compact)('x')).toBe(true);
    const encoded = {
      definitions: {
        'some/key~name': { type: 'object', properties: { 'a b#': { const: 'okay' } } },
      },
      $ref: '#/%64efinitions/some%7E1key%7E0name/properties/a%20b%23',
    };
    const compactEncoded = compactProviderSchema(encoded);
    expect(compactEncoded.$ref).toBe('#/$defs/0/properties/a%20b%23');
    const before = new Ajv({ strict: false }).compile(encoded);
    const after = new Ajv({ strict: false }).compile(compactEncoded);
    for (const value of ['okay', 'wrong', 1]) expect(after(value)).toBe(before(value));
  });

  it('preserves format constraints and remains byte-stable when compacted again', () => {
    const definitions = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [
        `__schema${index}`,
        { type: 'string', const: `value-${index}` },
      ]),
    );
    const schema = {
      type: 'object',
      definitions,
      properties: { id: { type: 'string', format: 'broadcast-id' } },
      required: ['id'],
      additionalProperties: false,
    };
    const compact = compactProviderSchema(schema);
    const ajv = new Ajv({ strict: false }).addFormat('broadcast-id', /^[-a-zA-Z0-9_]{1,100}$/);
    const before = ajv.compile(schema),
      after = ajv.compile(compact);
    for (const data of [{ id: 'title_1' }, { id: 'bad format' }, { id: '' }, { id: 3 }])
      expect(after(data)).toBe(before(data));
    expect(compact.properties).toMatchObject({ id: { format: 'broadcast-id' } });
    expect(JSON.stringify(compactProviderSchema(compact))).toBe(JSON.stringify(compact));
  });

  it('removes only implied string key types while retaining property-name constraints and data', () => {
    const rawData = { propertyNames: { type: 'string' }, type: 'object', default: 'user data' };
    const schema = {
      type: 'object',
      properties: {
        unconstrained: {
          type: 'object',
          propertyNames: { type: 'string' },
          additionalProperties: { type: 'number' },
        },
        constrained: {
          type: 'object',
          propertyNames: { type: 'string', minLength: 2, pattern: '^[a-z]+$' },
        },
        impossible: { type: 'object', propertyNames: { type: 'number' } },
        annotated: { type: 'object', propertyNames: { type: 'string', description: 'Any key' } },
        data: { const: rawData, default: rawData, examples: [rawData] },
      },
    };
    const compact = compactProviderSchema(schema);
    const properties = compact.properties as Record<string, Record<string, unknown>>;
    expect(properties.unconstrained).not.toHaveProperty('propertyNames');
    expect(properties.constrained!.propertyNames).toEqual({ minLength: 2, pattern: '^[a-z]+$' });
    expect(properties.impossible!.propertyNames).toEqual({ type: 'number' });
    expect(properties.annotated!.propertyNames).toEqual({ description: 'Any key' });
    expect(properties.data).toEqual({ const: rawData, default: rawData, examples: [rawData] });
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(schema),
      after = ajv.compile(compact);
    for (const input of [
      {},
      { unconstrained: { '': 1, '1': 2, arbitrary: 3 }, constrained: { okay: true } },
      { unconstrained: { key: 'wrong value type' } },
      { constrained: { a: 1 } },
      { constrained: { 'BAD KEY': 1 } },
      { impossible: {} },
      { impossible: { key: true } },
      { data: rawData },
      { data: { ...rawData, default: 'changed' } },
    ])
      expect(after(input)).toBe(before(input));
    expect(schema.properties.unconstrained.propertyNames).toEqual({ type: 'string' });
  });

  it('factors only shared union constraints, preserving anyOf and exact-one matching', () => {
    const union = (keyword: string) => ({
      [keyword]: [
        {
          type: 'object',
          properties: { kind: { const: 'a' }, amount: { type: 'number', minimum: 2 } },
          required: ['kind', 'amount'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { enum: ['a', 'b'] }, label: { type: 'string', minLength: 3 } },
          required: ['kind', 'label'],
          additionalProperties: false,
        },
      ],
    });
    const values = [
      null,
      false,
      1,
      [],
      'text',
      {},
      { kind: 'a' },
      { kind: 'b' },
      { kind: 'a', amount: 2 },
      { kind: 'a', amount: 1 },
      { kind: 'b', label: 'okay' },
      { kind: 'a', label: 'okay' },
      { kind: 'b', label: 'no' },
      { kind: 'a', amount: 3, label: 'both' },
      { kind: 'b', label: 'okay', extra: true },
    ];
    for (const keyword of ['anyOf', 'oneOf']) {
      const schema = union(keyword);
      const compact = compactProviderSchema(schema);
      expect(compact).toMatchObject({ type: 'object', required: ['kind'] });
      const ajv = new Ajv({ strict: false });
      const before = ajv.compile(schema),
        after = ajv.compile(compact);
      for (const value of values)
        expect(after(value), `${keyword} ${JSON.stringify(value)}`).toBe(before(value));
      expect(compactProviderSchema(compact)).toEqual(compact);
    }
    const overlapping = {
      oneOf: [
        { type: 'object', required: ['x'], properties: { x: { type: 'number' } } },
        { type: 'object', required: ['x'], properties: { x: { type: 'number', minimum: 0 } } },
      ],
    };
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(overlapping),
      after = ajv.compile(compactProviderSchema(overlapping));
    for (const value of [{ x: 1 }, { x: -1 }, {}, 0, null])
      expect(after(value)).toBe(before(value));
  });

  it('preserves the full current authoring operation projection across valid and malformed commands', () => {
    const schema = z.toJSONSchema(
      z.object({
        sessionId: z.string(),
        operations: z.array(authoringOperationSchema).min(1),
      }),
      { target: 'draft-7', reused: 'ref', unrepresentable: 'any' },
    );
    const compact = compactProviderSchema(schema);
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(schema),
      after = ajv.compile(compact);
    const commands: unknown[] = [
      ...authoringOperationSchema.options.flatMap((option) => {
        const discriminator = z.toJSONSchema(option.shape.type);
        const values =
          'const' in discriminator
            ? [discriminator.const]
            : Array.isArray(discriminator.enum)
              ? discriminator.enum
              : [];
        return values.map((type) => ({ type }));
      }),
      {
        type: 'add_modifier',
        layerId: 'title',
        modifierType: 'max-text-width',
        params: { maxWidth: 600 },
      },
      { type: 'add_modifier', layerId: 'title', modifierType: 'unknown' },
      {
        type: 'update_modifier',
        layerId: 'title',
        modifierId: 'fit',
        patch: { params: { maxWidth: 720 } },
        scope: 'authored',
      },
      { type: 'update_modifier', modifierId: 0, patch: {} },
      { type: 'remove_modifier', layerId: 'title', modifierId: 'fit' },
      { type: 'reorder_modifiers', layerId: 'title', modifierIds: ['fit', 'follow'] },
      {
        type: 'update_transform',
        layerId: 'title',
        patch: { x: 200, y: 50, width: 300 },
        scope: 'authored',
      },
      {
        type: 'set_property_track',
        layerId: 'title',
        property: 'x',
        keyframes: [
          { frame: 0, value: 200 },
          { frame: 10, value: 400 },
        ],
      },
      {
        type: 'set_layer_bindings',
        layerId: 'title',
        bindings: [{ fieldId: 'text', targetProperty: 'content' }],
      },
      { type: 'add_layer', kind: 'rectangle', name: 'Background' },
      {
        type: 'add_layer',
        kind: 'text',
        name: 'Presenter',
        element: { content: 'Presenter', fontSize: 64 },
      },
      null,
      true,
      4,
      'add_layer',
      [],
      {},
      { type: 'unknown' },
    ];
    for (const command of commands) {
      const input = { sessionId: 'review', operations: [command] };
      expect(after(input), JSON.stringify(command)).toBe(before(input));
      if (command && typeof command === 'object' && !Array.isArray(command)) {
        expect(after({ ...input, operations: [{ ...command, type: null }] })).toBe(false);
        expect(after({ ...input, operations: [{ ...command, unexpected: true }] })).toBe(
          before({ ...input, operations: [{ ...command, unexpected: true }] }),
        );
      }
    }
    for (const input of [
      null,
      {},
      [],
      { sessionId: 'review', operations: [] },
      { sessionId: 1, operations: commands },
      { sessionId: 'review', operations: 'wrong' },
    ])
      expect(after(input)).toBe(before(input));
    expect(compactProviderSchema(compact)).toEqual(compact);
    // Compiling both complete command schemas is CPU-heavy when the whole workspace runs in parallel.
  }, 30_000);

  it('preserves pointer-addressed union branches and allOf descendants', () => {
    const schema = {
      type: 'object',
      definitions: {
        alternatives: {
          anyOf: [
            { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
            { type: 'object', properties: { y: { type: 'string' } }, required: ['y'] },
          ],
        },
        wrapped: { allOf: [{ type: 'number', minimum: 4 }] },
      },
      properties: {
        branch: { $ref: '#/definitions/alternatives/anyOf/0' },
        nested: { $ref: '#/definitions/wrapped/allOf/0' },
      },
    };
    const compact = compactProviderSchema(schema);
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(schema),
      after = ajv.compile(compact);
    for (const value of [
      {},
      { branch: 1 },
      { branch: {} },
      { branch: { x: 3 } },
      { branch: { x: 'wrong' } },
      { nested: 4 },
      { nested: 3 },
    ])
      expect(after(value)).toBe(before(value));
    expect(compactProviderSchema(compact)).toEqual(compact);
  });

  it('deduplicates repeated schemas without altering their data annotations or source object', () => {
    const data = {
      type: 'object',
      properties: { user: { const: 'leave unchanged' } },
      $ref: '#/definitions/user',
    };
    const repeated = {
      type: 'object',
      properties: { longLabel: { type: 'string', minLength: 3, maxLength: 128 } },
      required: ['longLabel'],
      additionalProperties: false,
      default: data,
      examples: [data],
    };
    const schema = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`entry${index}`, structuredClone(repeated)]),
      ),
    };
    const original = structuredClone(schema);
    const compact = compactProviderSchema(schema);
    expect(schema).toEqual(original);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(schema).length / 2);
    expect(JSON.stringify(compact)).toContain(JSON.stringify(data));
    expect(compactProviderSchema(compact)).toEqual(compact);
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(schema),
      after = ajv.compile(compact);
    for (const value of [
      {},
      { entry0: { longLabel: 'okay' } },
      { entry0: 4 },
      { entry5: { longLabel: 'no' } },
      { entry2: { longLabel: 'okay', extra: true } },
    ])
      expect(after(value)).toBe(before(value));
  });

  it('never factors a $ref sibling as an enforced constraint in draft-7', () => {
    const schema = {
      definitions: { value: {} },
      anyOf: [
        { $ref: '#/definitions/value', type: 'object', required: ['missing'] },
        { type: 'object', required: ['missing'] },
      ],
    };
    const compact = compactProviderSchema(schema);
    expect(compact.type).toBeUndefined();
    const ajv = new Ajv({ strict: false });
    const before = ajv.compile(schema),
      after = ajv.compile(compact);
    for (const value of [null, false, 1, {}, { missing: true }])
      expect(after(value)).toBe(before(value));
  });

  it('retains an identified resource and absolute references into its definitions', () => {
    const schema = {
      $id: 'https://example.com/root.json',
      definitions: { value: { type: 'string', pattern: '^[A-Z]+$' } },
      type: 'object',
      properties: {
        value: { $ref: 'https://example.com/root.json#/definitions/value' },
        local: { $ref: '#/definitions/value' },
      },
    };
    const compact = compactProviderSchema(schema);
    expect(compact.definitions).toHaveProperty('value');
    expect(compact.$defs).toBeUndefined();
    const before = new Ajv({ strict: false }).compile(schema);
    const after = new Ajv({ strict: false }).compile(compact);
    for (const value of [{}, { value: 'ABC' }, { value: 'bad' }, { local: 1 }])
      expect(after(value)).toBe(before(value));
  });

  it('does not relocate absolute pointer targets into repeated blocks or union branches', () => {
    const repeated = {
      type: 'object',
      properties: { value: { type: 'string', minLength: 4 } },
      required: ['value'],
      additionalProperties: false,
    };
    const schema = {
      $id: 'https://example.com/registered.json',
      type: 'object',
      properties: {
        first: repeated,
        second: repeated,
        choice: {
          anyOf: [
            { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
            { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          ],
        },
        deep: { $ref: 'https://example.com/registered.json#/properties/first/properties/value' },
        branch: { $ref: 'https://example.com/registered.json#/properties/choice/anyOf/0' },
      },
    };
    const compact = compactProviderSchema(schema);
    expect(compact).toEqual(schema);
    const before = new Ajv({ strict: false }).compile(schema);
    const after = new Ajv({ strict: false }).compile(compact);
    for (const value of [
      {},
      { deep: 'good', branch: { value: 1 } },
      { deep: 'bad' },
      { branch: null },
      { branch: { value: 'wrong' } },
    ])
      expect(after(value)).toBe(before(value));
  });

  it('does not move scoped resources, anchors, or dynamic schemas while compacting siblings', () => {
    const scoped = {
      $id: 'child.json',
      definitions: { value: { type: 'string' } },
      $ref: '#/definitions/value',
    };
    const anchor = {
      $anchor: 'named',
      type: 'object',
      anyOf: [
        { type: 'object', required: ['a'] },
        { type: 'object', required: ['a', 'b'] },
      ],
    };
    const dynamic = {
      $dynamicAnchor: 'node',
      type: 'object',
      properties: { next: { $dynamicRef: '#node' } },
    };
    const schema = {
      type: 'object',
      properties: {
        scoped,
        sameScope: scoped,
        anchor,
        sameAnchor: anchor,
        dynamic,
        sameDynamic: dynamic,
      },
    };
    const compact = compactProviderSchema(schema);
    expect(compact.properties).toEqual(schema.properties);
    expect(compactProviderSchema(compact)).toEqual(compact);
  });
});
