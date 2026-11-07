import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

describe('data connection MCP schema', () => {
  it('retains provider, routing and field mappings', () => {
    const input = {
      type: 'add_data_connection',
      connection: {
        source: 'public-markets',
        target: 'both',
        publicMarkets: { symbols: ['BTC-USD'] },
        mappings: [{ fieldId: 'btc', sourcePath: 'btcPrice' }],
      },
    };
    expect(authoringOperationSchema.parse(input)).toEqual(input);
  });
  it('rejects credentials, invalid targets and duplicate products', () => {
    for (const patch of [
      { target: 'network' },
      { id: 'replacement' },
      { headers: { Authorization: 'secret' } },
      { publicMarkets: { symbols: ['BTC-USD', 'BTC-USD'] } },
    ])
      expect(() =>
        authoringOperationSchema.parse({
          type: 'update_data_connection',
          connectionId: 'feed',
          patch,
        }),
      ).toThrow();
  });
});
