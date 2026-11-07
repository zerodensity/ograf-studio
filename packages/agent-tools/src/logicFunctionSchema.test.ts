import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';
const definition = {
  type: 'javascript',
  version: 1,
  id: 'logic',
  name: 'Logic',
  enabled: true,
  source: '(ctx)=>({state:ctx.state})',
  inputs: {},
  outputs: {},
  actions: [],
};
const parse = (functions: unknown) =>
  authoringOperationSchema.safeParse({ type: 'set_logic_functions', functions });
describe('generic function operation schema', () => {
  it('accepts explicit mappings, state and bounded deadlines without a game-specific contract', () => {
    expect(parse([definition]).success).toBe(true);
    expect(parse([{ ...definition, pointer: true }]).success).toBe(true);
    expect(parse([{ ...definition, pointer: false }]).success).toBe(true);
    expect(
      parse([
        {
          ...definition,
          inputs: { score: 'in' },
          outputs: { score: 'out' },
          actions: ['start'],
          emits: { done: 'done' },
          media: { theme: 'music' },
          initialState: { score: 0 },
          timeoutMs: 250,
        },
      ]).success,
    ).toBe(true);
    expect(parse([]).success).toBe(true);
  });
  it('rejects unknown types/properties, unsafe aliases, non-JSON state, excessive UTF8 source and time limits', () => {
    for (const patch of [
      { type: 'falling-blocks' },
      { pointer: 'true' },
      { version: 2 },
      { scriptUrl: 'https://example.com' },
      { timeoutMs: 1001 },
      { timeoutMs: 15 },
      { source: 'é'.repeat(128 * 1024) },
      { initialState: Infinity },
      { outputs: JSON.parse('{"__proto__":"field"}') },
    ])
      expect(
        parse([{ ...definition, ...patch }]).success,
        JSON.stringify(patch).slice(0, 100),
      ).toBe(false);
    expect(
      parse(Array.from({ length: 9 }, (_, index) => ({ ...definition, id: String(index) })))
        .success,
    ).toBe(false);
  });
});
