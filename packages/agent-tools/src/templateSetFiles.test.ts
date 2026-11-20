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
  LOCAL_BRANDING_TEMPLATE_SET_ARCHIVE_SCHEMA_VERSION,
  MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES,
  type TemplateSetArchiveMode,
} from './templateSetStorage';
import type { AuthoringWorkspacePort, EditorBridgePort, TemplateSetRequest } from './ports';

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

async function archive(
  archiveMode: TemplateSetArchiveMode = 'compact',
  templateCount = 1,
  localBranding = false,
) {
  const schemaVersion =
    archiveMode === 'compatible'
      ? 5
      : localBranding
        ? LOCAL_BRANDING_TEMPLATE_SET_ARCHIVE_SCHEMA_VERSION
        : 6;
  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify({
      format: 'ograf-template-set',
      schemaVersion,
      name: 'News set',
      templates: templateCount
        ? [{ id: 'news', ...(localBranding ? { inheritBrandKit: false } : {}) }]
        : [],
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
  const requestTemplateSet = vi.fn(async (_request: TemplateSetRequest) => result);
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

  it('verifies the compact archive version that preserves local member branding', async () => {
    const payload = await archive('compact', 1, true);
    const { root, call } = await tools(payload);
    const result = await call({
      expectedRevision: payload.revision,
      path: 'Local branding.ogs',
      confirm: true,
    });
    expect(result.structuredContent).toMatchObject({
      schemaVersion: LOCAL_BRANDING_TEMPLATE_SET_ARCHIVE_SCHEMA_VERSION,
      sha256: payload.sha256,
    });
    expect(await readFile(join(root, 'Local branding.ogs'))).toEqual(
      Buffer.from(payload.archiveBase64, 'base64'),
    );
  });

  it('rejects a compatible archive that would lose local member branding', async () => {
    const payload = await archive('compatible', 1, true);
    await expect(decodeTemplateSetArchive(payload, payload.revision, 'compatible')).rejects.toThrow(
      'local Brand Kit settings',
    );
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
        save: 'ograf_save_project scope=set',
        storage: {
          defaultArchiveMode: 'compact',
          archiveSchemaVersion: 6,
          localBrandingArchiveSchemaVersion: LOCAL_BRANDING_TEMPLATE_SET_ARCHIVE_SCHEMA_VERSION,
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

describe('MCP template transfer review', () => {
  const expectedRevision = 'set:7';
  const suppliedPlan = { planId: 'plan-a', expectedRevision, sourceRevision: 'clipboard:8' };

  it('separates read-only review and rendering from explicit commit', async () => {
    const { records, requestTemplateSet } = await tools(suppliedPlan);
    const review = records.find((tool) => tool.name === 'ograf_review_template_transfer')!;
    const preview = records.find((tool) => tool.name === 'ograf_preview_template_transfer')!;
    const commit = records.find((tool) => tool.name === 'ograf_commit_template_transfer')!;
    expect(review.config.annotations?.readOnlyHint).toBe(true);
    expect(preview.config.annotations?.readOnlyHint).toBe(true);
    expect(commit.config.annotations?.readOnlyHint).toBe(false);
    expect(() => z.object(commit.config.inputSchema).parse(suppliedPlan)).toThrow();
    const reviewSchema = z.object(review.config.inputSchema);
    const clipboard = { expectedRevision, source: { kind: 'clipboard' } };
    // The listed tool also previews a plan, so each step applies its own defaults when called.
    expect(reviewSchema.parse(clipboard)).toEqual(clipboard);
    expect(() => reviewSchema.parse({ ...clipboard, limit: 51 })).toThrow();
    await review.handler(reviewSchema.parse(clipboard));
    expect(requestTemplateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'transfer-review', offset: 0, limit: 25 }),
      60_000,
    );

    await review.handler(
      reviewSchema.parse({
        ...clipboard,
        limit: 10,
        offset: 20,
      }),
    );
    expect(requestTemplateSet).toHaveBeenLastCalledWith(
      {
        action: 'transfer-review',
        expectedRevision,
        source: { kind: 'clipboard' },
        options: { policy: 'keep-appearance' },
        limit: 10,
        offset: 20,
      },
      60_000,
    );
    await preview.handler(z.object(preview.config.inputSchema).parse(suppliedPlan));
    expect(requestTemplateSet).toHaveBeenLastCalledWith(
      { action: 'transfer-preview', ...suppliedPlan },
      60_000,
    );
    await commit.handler(
      z.object(commit.config.inputSchema).parse({ ...suppliedPlan, confirm: true }),
    );
    expect(requestTemplateSet).toHaveBeenLastCalledWith(
      { action: 'transfer-commit', ...suppliedPlan },
      undefined,
    );
  });

  it('requires exact workspace file bytes and the selected member before preview or commit', async () => {
    const { root, records, requestTemplateSet } = await tools(suppliedPlan);
    const review = records.find((tool) => tool.name === 'ograf_review_template_transfer')!;
    const preview = records.find((tool) => tool.name === 'ograf_preview_template_transfer')!;
    const commit = records.find((tool) => tool.name === 'ograf_commit_template_transfer')!;
    const workspaceFile = { path: 'Source.ogs', templateId: 'lower-third' };
    const filename = join(root, workspaceFile.path);
    await writeFile(filename, 'source-one');
    await review.handler(
      z.object(review.config.inputSchema).parse({
        expectedRevision,
        source: { kind: 'workspace-file', ...workspaceFile },
        options: { policy: 'adopt-destination' },
      }),
    );
    const request = requestTemplateSet.mock.calls[0]![0];
    if (request.action !== 'transfer-review' || request.source.kind !== 'workspace-file')
      throw new Error('Expected a browser-side workspace file review.');
    expect(request.source).toMatchObject({
      filename: workspaceFile.path,
      templateId: workspaceFile.templateId,
      bytesBase64: Buffer.from('source-one').toString('base64'),
    });
    expect(request.source.sourceRevision).toMatch(/^workspace-file:[a-f0-9]{64}$/);
    const plan = { ...suppliedPlan, sourceRevision: request.source.sourceRevision };
    await expect(preview.handler(plan)).rejects.toThrow('same workspaceFile path and member');
    await expect(
      commit.handler({
        ...plan,
        workspaceFile: { ...workspaceFile, templateId: 'ticker' },
        confirm: true,
      }),
    ).rejects.toThrow('source changed');
    expect(requestTemplateSet).toHaveBeenCalledTimes(1);
    await preview.handler({ ...plan, workspaceFile });
    expect(requestTemplateSet).toHaveBeenLastCalledWith(
      { action: 'transfer-preview', ...plan },
      60_000,
    );

    await writeFile(filename, 'source-two');
    await expect(commit.handler({ ...plan, workspaceFile, confirm: true })).rejects.toThrow(
      'source changed',
    );
    expect(requestTemplateSet).toHaveBeenCalledTimes(2);
    await expect(
      review.handler({
        expectedRevision,
        source: { kind: 'workspace-file', path: '../Source.ogs' },
        options: { policy: 'keep-appearance' },
      }),
    ).rejects.toThrow('Outside workspace');
    expect(requestTemplateSet).toHaveBeenCalledTimes(2);
  });
});
