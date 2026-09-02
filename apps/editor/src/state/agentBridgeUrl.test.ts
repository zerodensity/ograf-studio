import { describe, expect, it } from 'vitest';
import { resolveAgentBridgeUrl } from './agentBridgeUrl';

describe('agent bridge URL', () => {
  it('preserves the existing development default', () => {
    expect(resolveAgentBridgeUrl(undefined, { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://127.0.0.1:4318/editor',
    );
  });

  it('uses the packaged server origin only in standalone mode', () => {
    expect(
      resolveAgentBridgeUrl('same-origin', { protocol: 'http:', host: '127.0.0.1:4318' }),
    ).toBe('ws://127.0.0.1:4318/editor');
    expect(resolveAgentBridgeUrl('same-origin', { protocol: 'https:', host: 'studio.test' })).toBe(
      'wss://studio.test/editor',
    );
  });

  it('honors an explicit bridge override', () => {
    expect(
      resolveAgentBridgeUrl('ws://127.0.0.1:5000/editor', {
        protocol: 'http:',
        host: 'localhost:5173',
      }),
    ).toBe('ws://127.0.0.1:5000/editor');
  });
});
