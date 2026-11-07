import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { AuthoringSession } from '@ograf-editor/authoring-core';
import { createProject } from '@ograf-editor/scene-model';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';
import { livePlayoutOperationSchema, livePlayoutRequestSchema } from './playoutSchemas';
import { createOGrafToolRecords } from './toolRecords';

function fixture() {
  const session = new AuthoringSession(createProject(), 'editor');
  const workspace: AuthoringWorkspacePort = {
    root: 'C:/ograf-tool-tests',
    get: () => session,
    list: () => [],
    create: () => session,
    delete: vi.fn(),
    open: async () => session,
    resolveAllowedPath: (path) => path,
  };
  const requestLivePlayout = vi
    .fn<NonNullable<EditorBridgePort['requestLivePlayout']>>()
    .mockResolvedValue({ revision: 'preview:8' });
  const bridge: EditorBridgePort = {
    health: {
      connected: false,
      responsive: false,
      latencyMs: null,
      lastHeartbeat: null,
      likelyCause: 'editor-disconnected',
      certificationReady: false,
      certificationLikelyCause: 'Disconnected',
    },
    certify: vi.fn(),
    capture: vi.fn(),
    renderStrip: vi.fn(),
    measureText: vi.fn(),
    presentProposal: vi.fn(),
    requestLivePlayout,
  };
  const tool = createOGrafToolRecords(workspace, bridge).find(
    (record) => record.name === 'ograf_control_playout',
  )!;
  return { tool, requestLivePlayout };
}

describe('MCP update delivery modes', () => {
  it.each([undefined, 'in-place', 'transition'] as const)(
    'preserves %s mode without introducing a default',
    (mode) => {
      const operation = {
        type: 'update',
        slotId: 'quotes',
        stateId: 'crypto-on',
        data: { btcPrice: '100.25' },
        ...(mode ? { mode } : {}),
      };
      const parsed = livePlayoutOperationSchema.parse(operation);
      expect(parsed).toEqual(operation);
      expect(Object.hasOwn(parsed, 'mode')).toBe(mode !== undefined);
    },
  );

  it.each(['live', 'preview'] as const)(
    'forwards all modes unchanged to the %s bridge',
    async (target) => {
      const { tool, requestLivePlayout } = fixture();
      for (const mode of [undefined, 'in-place', 'transition'] as const) {
        const input = {
          target,
          expectedRevision: 'preview:7',
          requestId: `quote-${mode ?? 'legacy'}`,
          operation: {
            type: 'update',
            slotId: 'quotes',
            stateId: 'crypto-on',
            data: { btcPrice: '100.25' },
            ...(mode ? { mode } : {}),
          },
        };
        await tool.handler(z.object(tool.config.inputSchema).parse(input));
        expect(requestLivePlayout).toHaveBeenLastCalledWith({ action: 'command', ...input });
      }
    },
  );

  it('retains the preview Update-only boundary for both modes', () => {
    for (const mode of ['in-place', 'transition']) {
      const request = {
        action: 'command',
        target: 'preview',
        expectedRevision: 'preview:7',
        requestId: 'quote',
        operation: { type: 'update', slotId: 'quotes', mode, data: {} },
      };
      expect(livePlayoutRequestSchema.safeParse(request).success).toBe(true);
      expect(
        livePlayoutRequestSchema.safeParse({
          ...request,
          operation: { type: 'take', slotId: 'quotes', stateId: 'crypto-on' },
        }).success,
      ).toBe(false);
    }
  });

  it.each(['instant', '', null, 1])('rejects unsupported update mode %j', (mode) => {
    expect(
      livePlayoutOperationSchema.safeParse({ type: 'update', slotId: 'quotes', mode, data: {} })
        .success,
    ).toBe(false);
  });

  it('keeps bounded JSON data and rejects update modes on Take', () => {
    expect(
      livePlayoutOperationSchema.safeParse({
        type: 'update',
        slotId: 'quotes',
        mode: 'in-place',
        data: { price: Number.NaN },
      }).success,
    ).toBe(false);
    expect(
      livePlayoutOperationSchema.safeParse({
        type: 'take',
        slotId: 'quotes',
        stateId: 'crypto-on',
        mode: 'in-place',
      }).success,
    ).toBe(false);
  });
});
