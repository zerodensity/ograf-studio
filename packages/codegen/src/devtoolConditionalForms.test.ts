/* oxlint-disable unicorn/no-thenable -- JSON Schema uses standard then branches. */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

// Exercise the shipped integration helper with a standards-compliant condition validator.
// The browser run separately covers the official ograf-form renderer and its validator.
const source = readFileSync(
  new URL(
    '../../../scripts/integrations/ograf-devtool/conditionalActionSchema.js',
    import.meta.url,
  ),
  'utf8',
);
const ajv = new Ajv2020({ strict: false });
const helpers = new Function(
  'validateDataSimple',
  `${source.replace(/^import[^\n]*\n/, '').replaceAll('export function ', 'function ')}\nreturn { resolveConditionalActionSchema, normalizeConditionalActionData, projectOptionalFormSchema, optionalFormFields, setOptionalFormField };`,
)((schema: object, data: unknown) => {
  const validate = ajv.compile(schema);
  return { errors: validate(data) ? [] : (validate.errors ?? ['Invalid']) };
}) as {
  resolveConditionalActionSchema(schema: unknown, data: unknown): any;
  normalizeConditionalActionData(schema: unknown, next: any, previous?: any): any;
  projectOptionalFormSchema(schema: unknown, data: unknown): any;
  optionalFormFields(schema: unknown, data: unknown): any[];
  setOptionalFormField(data: unknown, path: string[], included: boolean, schema: unknown): any;
};

const condition = (key: string, value: string) => ({
  type: 'object',
  properties: { [key]: { type: 'string', enum: [value] } },
  required: [key],
});
const hue = { type: 'string', gddType: 'color-rrggbb', default: '#3366aa' };
const gain = { type: 'number', gddType: 'number', default: 0.6 };

function mainSchema() {
  return {
    type: 'object',
    properties: {
      slots: {
        type: 'object',
        properties: {
          graphic: {
            type: 'object',
            properties: {
              stateId: { type: 'string', gddType: 'select', enum: ['', 'A', 'B'], default: 'A' },
              data: { type: 'object', properties: {}, default: {} },
            },
            allOf: [
              {
                if: condition('stateId', 'A'),
                then: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: { hue },
                      required: ['hue'],
                      default: { hue: '#3366aa' },
                    },
                  },
                },
              },
              {
                if: condition('stateId', 'B'),
                then: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: { hue, gain },
                      required: ['hue', 'gain'],
                      default: { hue: '#3366aa', gain: 0.6 },
                    },
                  },
                },
              },
            ],
          },
          independent: {
            type: 'object',
            properties: { label: { type: 'string', default: 'Other lane' } },
          },
        },
      },
    },
  };
}

const data = (stateId: string, values: object = {}) => ({
  slots: {
    graphic: { stateId, data: values },
    independent: { label: 'Keep this', feedContext: 4 },
  },
});

describe('official Devtool conditional form integration', () => {
  it('keeps sparse optional fields absent until explicitly included, then removes them without null', () => {
    const schema = {
      type: 'object',
      required: ['slotId', 'data'],
      properties: {
        slotId: { type: 'string', default: 'crypto' },
        data: {
          type: 'object',
          default: {},
          properties: {
            cryptoItems: {
              type: 'array',
              items: { type: 'object', properties: { id: { type: 'string' } } },
            },
            cryptoStatus: { type: 'string' },
            options: { type: 'object', properties: { detail: { type: 'string' } } },
            mode: { type: 'string', gddType: 'select', enum: ['live', 'reference'] },
          },
        },
      },
    };
    const data = { slotId: 'crypto', data: {} };
    const before = structuredClone(schema);
    expect(helpers.normalizeConditionalActionData(schema, data)).toEqual(data);
    expect(helpers.projectOptionalFormSchema(schema, data).properties.data.properties).toEqual({});
    const fields = helpers.optionalFormFields(schema, data);
    expect(fields.map((field) => field.path.at(-1))).toEqual([
      'cryptoItems',
      'cryptoStatus',
      'options',
      'mode',
    ]);
    expect(fields.every((field) => !field.included)).toBe(true);
    const status = fields.find((field) => field.path.at(-1) === 'cryptoStatus')!;
    const included = helpers.setOptionalFormField(data, status.path, true, status.schema);
    expect(included).toEqual({ slotId: 'crypto', data: { cryptoStatus: '' } });
    included.data.cryptoStatus = 'LIVE QUOTES';
    const normalized = helpers.normalizeConditionalActionData(schema, included, data);
    expect(normalized.data).toEqual({ cryptoStatus: 'LIVE QUOTES' });
    expect(
      helpers.projectOptionalFormSchema(schema, normalized).properties.data.properties,
    ).toEqual({ cryptoStatus: { type: 'string' } });
    expect(helpers.setOptionalFormField(normalized, status.path, false, status.schema)).toEqual(
      data,
    );
    expect(schema).toEqual(before);
    expect(ajv.compile(schema)(normalized)).toBe(true);
  });

  it('preserves required, defaulted and present fields and their strict validators', () => {
    const schema = {
      type: 'object',
      required: ['required'],
      properties: {
        required: { type: 'string' },
        defaulted: { type: 'number', default: 7 },
        optional: { type: 'string' },
        nested: {
          type: 'object',
          properties: { included: { type: 'string' }, absent: { type: 'boolean' } },
        },
        rows: {
          type: 'array',
          items: { type: 'object', properties: { value: { type: 'string' } } },
        },
      },
    };
    const value = {
      required: 'Keep',
      optional: 123,
      nested: { included: 'Child' },
      rows: [{ value: 'Do not replace' }],
    };
    const normalized = helpers.normalizeConditionalActionData(schema, value);
    expect(normalized).toEqual({ ...value, defaulted: 7 });
    const projection = helpers.projectOptionalFormSchema(schema, normalized);
    expect(projection.properties.required).toEqual(schema.properties.required);
    expect(projection.properties.defaulted).toEqual(schema.properties.defaulted);
    expect(projection.properties.optional.type).toBe('string');
    expect(projection.properties.nested.properties).toEqual({ included: { type: 'string' } });
    expect(projection.properties.rows).toEqual(schema.properties.rows);
    expect(ajv.compile(projection)(normalized)).toBe(false);
    expect(
      helpers
        .optionalFormFields(schema, normalized)
        .some((field) => field.path[0] === 'required' || field.path[0] === 'defaulted'),
    ).toBe(false);
    expect(
      helpers.setOptionalFormField(normalized, ['nested', 'absent'], true, { type: 'boolean' })
        .rows,
    ).toEqual(value.rows);
  });

  it('does not add optional object shells or select defaults when changing a conditional guard', () => {
    const schema = {
      type: 'object',
      properties: {
        stateId: { type: 'string', gddType: 'select', enum: ['A', 'B'], default: 'A' },
        data: { type: 'object', properties: {}, default: {} },
      },
      allOf: [
        {
          if: condition('stateId', 'B'),
          then: {
            properties: {
              data: {
                type: 'object',
                properties: {
                  object: { type: 'object', properties: {} },
                  choice: { type: 'string', gddType: 'select', enum: ['first', 'second'] },
                },
              },
            },
          },
        },
      ],
    };
    const before = { stateId: 'A', data: {} },
      after = { stateId: 'B', data: {} };
    const normalized = helpers.normalizeConditionalActionData(schema, after, before);
    expect(normalized).toEqual(after);
    const resolved = helpers.resolveConditionalActionSchema(schema, normalized);
    expect(
      helpers.projectOptionalFormSchema(resolved, normalized).properties.data.properties,
    ).toEqual({});
    expect(helpers.normalizeConditionalActionData(schema, normalized)).toBe(normalized);
  });

  it('projects nested main-form data at the selected state path', () => {
    const a = helpers.resolveConditionalActionSchema(mainSchema(), data('A'));
    const b = helpers.resolveConditionalActionSchema(mainSchema(), data('B'));
    expect(Object.keys(a.properties.slots.properties.graphic.properties.data.properties)).toEqual([
      'hue',
    ]);
    expect(Object.keys(b.properties.slots.properties.graphic.properties.data.properties)).toEqual([
      'hue',
      'gain',
    ]);
    expect(b.properties.slots.properties.graphic.properties.data.required).toEqual(['hue', 'gain']);
    expect(a.properties.slots.properties.graphic).not.toHaveProperty('allOf');
    expect(a.properties.slots.properties.graphic).not.toHaveProperty('if');
  });

  it('seeds newly public defaults without changing independent lane or open-object context', () => {
    const before = data('A', { hue: '#ff0000', unrelatedContext: 7 });
    const next = helpers.normalizeConditionalActionData(
      mainSchema(),
      data('B', before.slots.graphic.data),
      before,
    );
    expect(next.slots.graphic.data).toEqual({ hue: '#ff0000', unrelatedContext: 7, gain: 0.6 });
    expect(next.slots.independent).toEqual(before.slots.independent);
  });

  it('removes a no-longer-public state field on state switches', () => {
    const before = data('B', { hue: '#ff0000', gain: 1.8 });
    const next = helpers.normalizeConditionalActionData(
      mainSchema(),
      data('A', before.slots.graphic.data),
      before,
    );
    expect(next.slots.graphic.data).toEqual({ hue: '#ff0000' });
  });

  it('does not reintroduce a hidden field from incoming data or a stale object default', () => {
    const schema = mainSchema();
    schema.properties.slots.properties.graphic.properties.data.default = { gain: 9 } as any;
    const fromIncoming = helpers.normalizeConditionalActionData(schema, data('A', { gain: 9 }));
    expect(fromIncoming.slots.graphic.data).toEqual({ hue: '#3366aa' });
    const fromDefault = helpers.normalizeConditionalActionData(schema, {
      slots: { graphic: { stateId: 'A' } },
    });
    expect(fromDefault.slots.graphic.data).toEqual({ hue: '#3366aa' });
  });

  it('clears state-specific fields on Off while preserving the independent lane', () => {
    const before = data('B', { hue: '#ff0000', gain: 1.8 });
    const next = helpers.normalizeConditionalActionData(
      mainSchema(),
      data('', before.slots.graphic.data),
      before,
    );
    expect(next.slots.graphic.data).toEqual({});
    expect(next.slots.independent).toEqual(before.slots.independent);
  });

  it('keeps the existing lane-dependent action dropdown behavior', () => {
    const schema = {
      type: 'object',
      properties: {
        slotId: { type: 'string', gddType: 'select', enum: ['main', 'ticker'], default: 'main' },
        stateId: { type: 'string', gddType: 'select', enum: ['A', 'B', 'T'], default: 'A' },
      },
      allOf: [
        {
          if: condition('slotId', 'main'),
          then: {
            type: 'object',
            properties: {
              stateId: { type: 'string', gddType: 'select', enum: ['A', 'B'], default: 'A' },
            },
          },
        },
        {
          if: condition('slotId', 'ticker'),
          then: {
            type: 'object',
            properties: {
              stateId: { type: 'string', gddType: 'select', enum: ['T'], default: 'T' },
            },
          },
        },
      ],
    };
    expect(
      helpers.normalizeConditionalActionData(
        schema,
        { slotId: 'ticker', stateId: 'A' },
        { slotId: 'main', stateId: 'A' },
      ),
    ).toEqual({ slotId: 'ticker', stateId: 'T' });
    expect(
      helpers.normalizeConditionalActionData(
        schema,
        { slotId: 'main', stateId: 'B' },
        { slotId: 'main', stateId: 'A' },
      ),
    ).toEqual({ slotId: 'main', stateId: 'B' });
  });

  it('is immutable and idempotent so render/update effects can settle', () => {
    const schema = mainSchema();
    const next = data('A', { gain: 9 });
    const snapshot = structuredClone({ schema, next });
    const normalized = helpers.normalizeConditionalActionData(schema, next);
    expect({ schema, next }).toEqual(snapshot);
    expect(helpers.normalizeConditionalActionData(schema, normalized)).toBe(normalized);
  });

  it('drops unknown keys only for objects explicitly closed by their schema', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { public: { type: 'number', default: 1 } },
    };
    expect(helpers.normalizeConditionalActionData(schema, { public: 2, unknown: 3 })).toEqual({
      public: 2,
    });
    expect(
      helpers.normalizeConditionalActionData(
        { ...schema, additionalProperties: true },
        { public: 2, unknown: 3 },
      ),
    ).toEqual({ public: 2, unknown: 3 });
  });
});
