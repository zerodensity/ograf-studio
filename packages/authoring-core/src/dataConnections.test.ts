import { describe, expect, it } from 'vitest';
import { createComposition, createFieldDefinition, createProject } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

function fixture() {
  const field = createFieldDefinition('text', { key: 'btcPrice' });
  const other = createFieldDefinition('text', { key: 'other' });
  const composition = createComposition({ dataFields: [field] });
  const sibling = createComposition({ dataFields: [other] });
  return {
    field,
    other,
    composition,
    sibling,
    session: new AuthoringSession(
      createProject({ mainCompositionId: composition.id, compositions: [composition, sibling] }),
    ),
  };
}

describe('data connection authoring', () => {
  it('preserves a reserved proposal identity and rejects duplicate connection IDs atomically', () => {
    const { session } = fixture();
    const project = session.snapshot().project;
    const operation = {
      type: 'add_data_connection' as const,
      id: 'reserved-market-feed',
      connection: { source: 'public-markets' as const },
    };
    const proposed = new AuthoringSession(project).apply({
      expectedRevision: 0,
      operations: [operation],
    });
    const accepted = session.apply({ expectedRevision: 0, operations: [operation] });
    expect(accepted.summary.generatedIds).toEqual(proposed.summary.generatedIds);
    expect(accepted.project.compositions[0]!.dataConnections[0]!.id).toBe(operation.id);
    expect(() => session.apply({ expectedRevision: 1, operations: [operation] })).toThrow(
      'already exists',
    );
    expect(session.snapshot().revision).toBe(1);
    expect(session.snapshot().project.compositions[0]!.dataConnections).toHaveLength(1);
  });

  it('creates, patches, removes and undoes a provider without changing field defaults', () => {
    const { session, field } = fixture();
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_data_connection',
          connection: {
            source: 'public-markets',
            mappings: [{ fieldId: field.id, sourcePath: 'btcPrice' }],
          },
        },
      ],
    });
    const id = created.summary.generatedIds.find((entry) => entry.kind === 'data-connection')!.id;
    expect(created.project.compositions[0]!.dataConnections[0]).toMatchObject({
      id,
      source: 'public-markets',
      target: 'both',
      refreshMs: 5000,
      missing: 'keep-last',
    });
    expect(created.project.compositions[0]!.dataFields[0]).toEqual(field);
    const patched = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_data_connection',
          connectionId: id,
          patch: { enabled: false, publicMarkets: { symbols: ['ETH-USD'] } },
        },
      ],
    });
    expect(patched.project.compositions[0]!.dataConnections[0]).toMatchObject({
      enabled: false,
      publicMarkets: { symbols: ['ETH-USD'] },
    });
    const removed = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'remove_data_connection', connectionId: id }],
    });
    expect(removed.project.compositions[0]!.dataConnections).toEqual([]);
    expect(session.undo(3).project.compositions[0]!.dataConnections).toHaveLength(1);
  });

  it('rejects mappings into another composition and leaves an invalid batch unchanged', () => {
    const { session, field, other } = fixture();
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          { type: 'update_data_field', fieldId: field.id, defaultValue: 'changed' },
          {
            type: 'add_data_connection',
            connection: { mappings: [{ fieldId: other.id, sourcePath: 'other' }] },
          },
        ],
      }),
    ).toThrow('unknown field');
    expect(session.snapshot().revision).toBe(0);
    expect(session.snapshot().project.compositions[0]!.dataFields[0]!.defaultValue).toEqual(
      field.defaultValue,
    );
  });

  it('protects mapped fields and clears their mappings on explicit forced removal', () => {
    const { session, field } = fixture();
    session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_data_connection',
          connection: { mappings: [{ fieldId: field.id, sourcePath: 'btcPrice' }] },
        },
      ],
    });
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [{ type: 'remove_data_field', fieldId: field.id }],
      }),
    ).toThrow('data connection');
    const removed = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'remove_data_field', fieldId: field.id, force: true }],
    });
    expect(removed.validation.valid).toBe(true);
    expect(removed.project.compositions[0]!.dataConnections[0]!.mappings).toEqual([]);
  });

  it('rejects duplicate field mappings, unsafe paths and repeated products', () => {
    for (const connection of [
      {
        mappings: [
          { fieldId: 'field', sourcePath: 'a' },
          { fieldId: 'field', sourcePath: 'b' },
        ],
      },
      { mappings: [{ fieldId: 'field', sourcePath: '__proto__.value' }] },
      { source: 'public-markets' as const, publicMarkets: { symbols: ['BTC-USD', 'BTC-USD'] } },
    ]) {
      const { session, field } = fixture();
      const payload = {
        ...connection,
        ...(connection.mappings
          ? { mappings: connection.mappings.map((m) => ({ ...m, fieldId: field.id })) }
          : {}),
      };
      expect(() =>
        session.apply({
          expectedRevision: 0,
          operations: [{ type: 'add_data_connection', connection: payload }],
        }),
      ).toThrow();
      expect(session.snapshot().revision).toBe(0);
    }
  });
});
