import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import * as z from 'zod/v4';
import { AuthoringSession } from '@ograf-editor/authoring-core';
import { createProject } from '@ograf-editor/scene-model';
import { decodeTemplateSetArchive } from './templateSetFiles';
import { createOGrafToolRecords } from './toolRecords';
import {
  MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES,
  type TemplateSetArchiveMode,
} from './templateSetStorage';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (
      dirname(resolve(folder)) !== resolve(tmpdir()) ||
      !basename(folder).startsWith('ograf-set-save-test-')
    )
      throw new Error('Invalid test cleanup path');
    await rm(folder, { recursive: true, force: true });
  }
});

async function archive(archiveMode: TemplateSetArchiveMode = 'compact', templateCount = 1) {
  const schemaVersion = archiveMode === 'compact' ? 6 : 5;
  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify({
      format: 'ograf-template-set',
      schemaVersion,
      name: 'News set',
      templates: templateCount ? [{ id: 'news' }] : [],
    }),
  );
  if (templateCount) zip.file('templates/news.ogs', '{}');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  return {
    revision: 'set:7',
    name: 'News set',
    archiveMode,
    schemaVersion,
    archiveBase64: bytes.toString('base64'),
    archiveBytes: bytes.byteLength,
    templateCount,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function tools(result: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'ograf-set-save-test-'));
  folders.push(root);
  const session = new AuthoringSession(createProject(), 'editor');
  const workspace: AuthoringWorkspacePort = {
    root,
    get: () => session,
    list: () => [],
    create: () => session,
    delete: vi.fn(),
    open: async () => session,
    resolveAllowedPath: (path) => {
      const target = resolve(root, path);
      if (dirname(target) !== root) throw new Error('Outside workspace');
      return target;
    },
  };
  const requestTemplateSet = vi.fn(async () => result);
  const bridge: EditorBridgePort = {
    health: {
      connected: true,
      responsive: true,
      templateSetsReady: true,
      latencyMs: 0,
      lastHeartbeat: null,
      likelyCause: null,
      certificationReady: true,
      certificationLikelyCause: null,
    },
    requestTemplateSet,
    certify: vi.fn(),
    capture: vi.fn(),
    renderStrip: vi.fn(),
    measureText: vi.fn(),
    presentProposal: vi.fn(),
  };
  const records = createOGrafToolRecords(workspace, bridge);
  const call = async (input: Record<string, unknown>) => {
    const tool = records.find((record) => record.name === 'ograf_save_template_set')!;
    return (await tool.handler(z.object(tool.config.inputSchema).parse(input))) as {
      structuredContent: Record<string, unknown>;
    };
  };
  return { root, call, requestTemplateSet, records };
}

describe('template-set MCP snapshot saves', () => {
  it.each(['compact', 'compatible'] as const)(
    'verifies and saves %s without returning archive bytes',
    async (mode) => {
      const payload = await archive(mode);
      const { root, call, requestTemplateSet } = await tools(payload);
      const result = await call({
        expectedRevision: 'set:7',
        path: 'News.ogs',
        archiveMode: mode,
        confirm: true,
      });
      expect(requestTemplateSet).toHaveBeenCalledWith(
        { action: 'archive', expectedRevision: 'set:7', archiveMode: mode },
        120_000,
      );
      expect(await readFile(join(root, 'News.ogs'))).toEqual(
        Buffer.from(payload.archiveBase64, 'base64'),
      );
      expect(result.structuredContent).toMatchObject({
        archiveMode: mode,
        revision: 'set:7',
        templateCount: 1,
        sha256: payload.sha256,
      });
      expect(result.structuredContent).not.toHaveProperty('archiveBase64');
    },
  );

  it('saves an empty set snapshot without requiring a transition graph', async () => {
    const payload = await archive('compact', 0);
    const { root, call } = await tools(payload);
    const result = await call({
      expectedRevision: 'set:7',
      path: 'Empty.ogs',
      confirm: true,
    });
    expect(result.structuredContent).toMatchObject({ templateCount: 0, schemaVersion: 6 });
    const zip = await JSZip.loadAsync(await readFile(join(root, 'Empty.ogs')));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.templates).toEqual([]);
    expect(manifest).not.toHaveProperty('transitionLogic');
  });

  it('defaults to compact, requires confirmation, and prevents silent overwrite', async () => {
    const { root, call, requestTemplateSet } = await tools(await archive());
    await expect(call({ expectedRevision: 'set:7', path: 'News.ogs' })).rejects.toThrow();
    expect(requestTemplateSet).not.toHaveBeenCalled();
    await call({ expectedRevision: 'set:7', path: 'News.ogs', confirm: true });
    await writeFile(join(root, 'News.ogs'), 'keep');
    await expect(
      call({ expectedRevision: 'set:7', path: 'News.ogs', confirm: true }),
    ).rejects.toThrow('already exists');
    expect(await readFile(join(root, 'News.ogs'), 'utf8')).toBe('keep');
    await call({ expectedRevision: 'set:7', path: 'News.ogs', confirm: true, overwrite: true });
    expect((await readFile(join(root, 'News.ogs'))).subarray(0, 2).toString()).toBe('PK');
  });

  it('rejects non-.ogs and escaping paths before contacting the editor', async () => {
    const { call, requestTemplateSet } = await tools(await archive());
    await expect(
      call({ expectedRevision: 'set:7', path: 'News.ogp', confirm: true }),
    ).rejects.toThrow('must end in .ogs');
    await expect(
      call({ expectedRevision: 'set:7', path: '../News.ogs', confirm: true }),
    ).rejects.toThrow('Outside workspace');
    expect(requestTemplateSet).not.toHaveBeenCalled();
  });

  it('advertises the new storage contract without adding file tools to the in-app surface', async () => {
    const { records } = await tools(await archive());
    const tool = records.find((record) => record.name === 'ograf_get_capabilities')!;
    const output = (await tool.handler({ sections: ['templateSets'] })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(output.structuredContent).toMatchObject({
      templateSets: {
        save: 'ograf_save_template_set',
        storage: {
          defaultArchiveMode: 'compact',
          archiveSchemaVersion: 6,
          compatibleArchiveSchemaVersion: 5,
        },
        transitionLogic: {
          exportStartup: {
            defaults: 'compatible-baseline-in-stable-lane-order',
            dependentLanes: 'off',
            loadPreparation: expect.any(String),
            skipAnimation: expect.any(String),
            skipStageReadiness: 'coherent-frame-per-dependency-stage',
            skipStageOrdering: expect.any(String),
            playPlanning: 'whole-selection-preflight-and-resource-preparation-before-output',
            rejectedSelection: 'status-550-with-on-air-selections-unchanged',
          },
        },
      },
    });
  });

  it.each([
    ['revision', { revision: 'set:8' }, 'revision changed'],
    ['mode', { archiveMode: 'compatible' }, 'metadata'],
    ['size', { archiveBytes: MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES + 1 }, '64 MiB'],
    ['base64', { archiveBase64: 'invalid!' }, 'incomplete or malformed'],
    ['checksum', { sha256: '0'.repeat(64) }, 'checksum'],
    ['manifest identity', { name: 'Other' }, 'manifest does not match'],
    ['manifest count', { templateCount: 2 }, 'manifest does not match'],
  ])('rejects an invalid %s before saving', async (_label, patch, message) => {
    const payload = { ...(await archive()), ...patch };
    await expect(decodeTemplateSetArchive(payload, 'set:7', 'compact')).rejects.toThrow(
      message as string,
    );
  });
});
