const id = { type: 'string', minLength: 1 };
const record = { type: 'object' };
const ids = { type: 'array', items: id, uniqueItems: true };
const named = { id, name: { type: 'string' } };
const action = {
  type: 'object',
  properties: { ...named, schema: record },
  required: ['id', 'name'],
  additionalProperties: false,
};

/** The official manifest schema permits vendor fields; this schema validates our versioned contract. */
export const OGRAF_DISCOVERY_JSON_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      properties: { version: { const: 1 }, kind: { const: 'graphic' } },
      required: ['version', 'kind'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        version: { const: 1 },
        kind: { const: 'package' },
        catalog: {
          type: 'object',
          properties: {
            version: { const: 1 },
            ...named,
            templates: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: named,
                required: ['id', 'name'],
                additionalProperties: false,
              },
            },
            slots: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  ...named,
                  stateIds: ids,
                  requireOn: ids,
                  blockWhileActive: ids,
                  layoutWhen: ids,
                },
                required: ['id', 'name', 'stateIds', 'requireOn', 'blockWhileActive'],
                additionalProperties: false,
              },
            },
            states: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  ...named,
                  slotId: id,
                  templateId: id,
                  schema: record,
                  defaults: record,
                  actions: { type: 'array', items: action },
                },
                required: ['id', 'name', 'slotId', 'templateId', 'schema', 'defaults', 'actions'],
                additionalProperties: false,
              },
            },
            actions: {
              type: 'array',
              items: { $ref: 'https://ograf.ebu.io/v1/specification/json-schemas/lib/action.json' },
            },
            defaults: record,
          },
          required: [
            'version',
            'id',
            'name',
            'templates',
            'slots',
            'states',
            'actions',
            'defaults',
          ],
          additionalProperties: false,
        },
      },
      required: ['version', 'kind', 'catalog'],
      additionalProperties: false,
    },
  ],
};
