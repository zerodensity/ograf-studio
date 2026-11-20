import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentToolUsage, agentToolUsageFromEnvironment } from './agentToolUsage';
import { createOGrafAuthoringHost } from './index';
import { createOGrafMcpServer } from './mcpServer';

const folders: string[] = [];
function usageFile(): string {
  const folder = mkdtempSync(join(tmpdir(), 'ograf-agent-usage-'));
  folders.push(folder);
  return join(folder, 'nested', 'usage.json');
}
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('agent usage counts', () => {
  it('is off unless the environment names a file', () => {
    expect(agentToolUsageFromEnvironment({})).toBeUndefined();
    expect(agentToolUsageFromEnvironment({ OGRAF_AGENT_USAGE_FILE: '  ' })).toBeUndefined();
    expect(agentToolUsageFromEnvironment({ OGRAF_AGENT_USAGE_FILE: usageFile() })).toBeInstanceOf(
      AgentToolUsage,
    );
  });

  it('counts tools with their choice, operation types and refusals, and adds to saved counts', () => {
    const path = usageFile();
    const usage = new AgentToolUsage(path);
    usage.called('mcp', 'ograf_capture', { mode: 'strip', frames: [0, 10] });
    usage.called('mcp', 'ograf_capture', { frame: 4 });
    usage.called('chat', 'ograf_apply_operations', {
      operations: [{ type: 'set_data_field' }, { type: 'add_layer' }, { type: 'add_layer' }],
    });
    usage.refused(
      'chat',
      'ograf_apply_operations',
      'Operation 3: layerName "Guest · Name" is unknown; no matches.\nmore detail',
    );
    usage.refused(
      'chat',
      'ograf_apply_operations',
      "Operation 0: layerName 'Title' is unknown; no matches.",
    );
    usage.flush();

    expect(read(path)).toMatchObject({
      since: expect.any(String),
      mcp: { tools: { 'ograf_capture strip': 1, ograf_capture: 1 }, operations: {}, refusals: {} },
      chat: {
        tools: { ograf_apply_operations: 1 },
        operations: { set_data_field: 1, add_layer: 2 },
        // One line for one fault, whatever layer it met; nothing from the project is kept.
        refusals: { 'ograf_apply_operations: Operation #: layerName … is unknown; no matches.': 2 },
      },
    });

    const later = new AgentToolUsage(path);
    later.called('mcp', 'ograf_capture', {});
    later.flush();
    expect(read(path).mcp.tools.ograf_capture).toBe(2);
    expect(read(path).since).toBe(read(path).since);
  });

  it('counts MCP calls, earlier names and refusals as the server sees them', async () => {
    const path = usageFile();
    const usage = new AgentToolUsage(path);
    const host = createOGrafAuthoringHost();
    const server = createOGrafMcpServer(host.workspace, host.bridge, { usage });
    const client = new Client({ name: 'usage-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await client.callTool({ name: 'ograf_get_capabilities', arguments: { view: 'sessions' } });
      await client.callTool({ name: 'ograf_list_sessions', arguments: {} });
      const refused = await client.callTool({
        name: 'ograf_apply_operations',
        arguments: {
          sessionId: 'editor',
          expectedRevision: 0,
          operations: [{ type: 'update_layer', layerName: 'Nowhere', isVisible: false }],
        },
      });
      expect(refused.isError).toBe(true);
      const invalid = await client.callTool({
        name: 'ograf_apply_operations',
        arguments: { sessionId: 'editor', expectedRevision: 0, operations: [{ type: 'paint' }] },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
    usage.flush();
    const counts = read(path).mcp;
    expect(counts.tools).toEqual({
      'ograf_get_capabilities sessions': 1,
      ograf_list_sessions: 1,
      ograf_apply_operations: 2,
    });
    expect(counts.operations).toEqual({ update_layer: 1, paint: 1 });
    expect(Object.keys(counts.refusals)).toHaveLength(2);
    expect(JSON.stringify(counts.refusals)).not.toContain('Nowhere');
  });
});
