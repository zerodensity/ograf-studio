import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import {
  IN_APP_AGENT_TOOL_NAMES,
  filterInAppToolRecords,
  providerToolDefinitions,
  withInAppToolDefaults,
  type AgentToolRecord,
} from './index';

function record(name: string): AgentToolRecord {
  return {
    name,
    config: { description: `${name} description`, inputSchema: { value: z.string().optional() } },
    handler: vi.fn(),
  };
}

describe('in-app agent tool surface', () => {
  it('filters canonical records without cloning handlers and includes the result page reader', () => {
    const admitted = IN_APP_AGENT_TOOL_NAMES.map(record);
    const dropped = record('ograf_save_project');
    const filtered = filterInAppToolRecords([...admitted, dropped]);
    expect(filtered).toHaveLength(19);
    expect(filtered.map((tool) => tool.name)).toEqual(IN_APP_AGENT_TOOL_NAMES);
    expect(filtered[0]?.handler).toBe(admitted[0]?.handler);
    expect(filtered).not.toContain(dropped);
  });

  it('renders provider-neutral JSON schemas and defaults apply-and-review in-app', () => {
    const definitions = providerToolDefinitions(IN_APP_AGENT_TOOL_NAMES.map(record));
    expect(definitions[0]).toMatchObject({
      name: 'ograf_get_capabilities',
      inputSchema: { type: 'object' },
    });
    expect(withInAppToolDefaults('ograf_apply_operations', { mode: 'apply' })).toEqual({
      mode: 'apply',
      includeReview: true,
    });
    expect(withInAppToolDefaults('ograf_apply_operations', { mode: 'propose' })).toEqual({
      mode: 'propose',
    });
    const playout = definitions.find((tool) => tool.name === 'ograf_control_playout')!;
    expect(playout.description).toContain('target:preview');
    expect(playout.description).toContain('requestId');
    expect(playout.description).toContain('without restore');
  });
});
