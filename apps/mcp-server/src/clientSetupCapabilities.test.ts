import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { createOGrafAuthoringHost } from './index';

it.each([
  {
    bundledAuthoringSkill: false,
    retrieval: {
      kind: 'source-tree',
      archivePath: 'skills/ograf-authoring/ograf-authoring.zip',
    },
  },
  {
    bundledAuthoringSkill: true,
    retrieval: {
      kind: 'standalone-executable',
      exportFlag: '--export-skill',
      setupPromptFlag: '--print-setup-prompt',
    },
  },
])(
  'discovers client setup over MCP with a bundled skill: $bundledAuthoringSkill',
  async ({ bundledAuthoringSkill, retrieval }) => {
    const { httpServer } = createOGrafAuthoringHost({ bundledAuthoringSkill });
    const client = new Client({ name: 'client-setup-contract-test', version: '1.0.0' });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = httpServer.address() as AddressInfo;
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
      );
      const { tools } = await client.listTools();
      expect(
        tools.find(({ name }) => name === 'ograf_get_capabilities')?.annotations,
      ).toMatchObject({
        readOnlyHint: true,
      });

      const result = await client.callTool({
        name: 'ograf_get_capabilities',
        arguments: { sections: ['editor'] },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty('clientSetup', {
        mcp: {
          preferredServerName: 'ograf-editor',
          transport: 'streamable-http',
          path: '/mcp',
        },
        authoringSkill: {
          archiveName: 'ograf-authoring.zip',
          retrieval,
          clients: {
            codex: {
              surfaces: ['Codex CLI', 'ChatGPT Desktop local Codex'],
              install: 'extract-folder',
              location: '~/.agents/skills/ograf-authoring',
            },
            claudeCode: {
              install: 'extract-folder',
              location: '~/.claude/skills/ograf-authoring',
            },
            claudeDesktop: {
              install: 'upload-zip',
              location: 'Customize → Skills → Upload a skill',
            },
          },
        },
      });

      const elements = await client.callTool({
        name: 'ograf_get_capabilities',
        arguments: { sections: ['elements'] },
      });
      expect(elements.isError).not.toBe(true);
      expect(elements.structuredContent).not.toHaveProperty('clientSetup');
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
