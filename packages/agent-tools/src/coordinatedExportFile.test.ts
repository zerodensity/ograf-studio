import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { coordinatedExportFile } from './coordinatedExportFile';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';
const failures = vi.hoisted(() => ({ write: false }));
vi.mock('./projectFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./projectFiles')>();
  return {
    ...actual,
    writeTemplateFiles: async (...args: Parameters<typeof actual.writeTemplateFiles>) => {
      if (failures.write) {
        failures.write = false;
        throw new Error('disk unavailable');
      }
      return actual.writeTemplateFiles(...args);
    },
  };
});
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ograf-coordinated-test-'));
  folders.push(root);
  const zip = new JSZip();
  zip.file('main.js', 'certified module');
  zip.file('graphic.json', '{}');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const payload = {
    outcome: 'certified',
    revision: 'set:7',
    profile: 'realtime',
    certification: { valid: true },
    includedTemplateIds: ['headline'],
    includedStateIds: ['on'],
    unreferencedTemplates: [{ id: 'CH01', name: 'CH01' }],
    format: 'zip',
    archiveBase64: bytes.toString('base64'),
    archiveBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const requestTemplateSet = vi.fn(async () => payload as Record<string, unknown>);
  const workspace = {
    resolveAllowedPath: (path: string) => join(root, path),
  } as AuthoringWorkspacePort;
  const bridge = { requestTemplateSet } as unknown as EditorBridgePort;
  const run = coordinatedExportFile(workspace, bridge);
  const recreate = () => coordinatedExportFile(workspace, bridge);
  const input = {
    operationId: 'export-1',
    expectedRevision: 'set:7',
    profile: 'realtime' as const,
    overwrite: false,
    path: 'news.ograf.zip',
  };
  return { root, payload, bytes, requestTemplateSet, run, input, recreate };
}
describe('coordinated MCP output transaction', () => {
  it('writes certified bytes once, joins concurrent retries, and verifies recovery against disk', async () => {
    const { root, bytes, run, input, requestTemplateSet } = await fixture();
    const results = await Promise.all([run(input), run(input)]);
    expect(results.map((result) => result.outcome)).toEqual(['saved', 'saved']);
    expect(results.map((result) => result.format)).toEqual(['zip', 'zip']);
    expect(await readFile(join(root, input.path))).toEqual(bytes);
    expect(requestTemplateSet).toHaveBeenCalledOnce();
    expect(await run(input)).toMatchObject({
      outcome: 'saved',
      replayed: true,
      format: 'zip',
      unreferencedTemplates: [{ id: 'CH01' }],
    });
    await writeFile(join(root, input.path), 'changed externally');
    expect(await run(input)).toMatchObject({ outcome: 'verification-failed' });
    expect(await readFile(join(root, input.path), 'utf8')).toBe('changed externally');
  });
  it('writes and verifies standalone HTML on an .html path with no companion ZIP', async () => {
    const { root, payload, run, input, requestTemplateSet } = await fixture();
    const graphic = { manifest: { main: 'main.js' }, mainJs: 'certified module', resources: [] };
    const html = `<!doctype html><script type="application/json" id="ograf-package">${JSON.stringify(graphic)}</script>`;
    const data = Buffer.from(html);
    Object.assign(payload, {
      format: 'html',
      archiveBase64: data.toString('base64'),
      archiveBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
    const request = { ...input, path: 'news.html' };
    expect(await run(request)).toMatchObject({ outcome: 'saved', format: 'html' });
    expect(requestTemplateSet).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'export-coordinated', format: 'html' }),
      expect.any(Number),
    );
    expect(await readFile(join(root, request.path), 'utf8')).toBe(html);
    await expect(readFile(join(root, input.path))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await run(request)).toMatchObject({ outcome: 'saved', replayed: true, format: 'html' });
  });
  it('retains operation recovery when HTTP transport recreates its tool records', async () => {
    const { run, recreate, input, requestTemplateSet } = await fixture();
    expect(await run(input)).toMatchObject({ outcome: 'saved' });
    expect(await recreate()(input)).toMatchObject({ outcome: 'saved', replayed: true });
    expect(requestTemplateSet).toHaveBeenCalledOnce();
  });
  it('rejects reusing an operation ID with a different path or profile', async () => {
    const { run, input } = await fixture();
    await run(input);
    await expect(run({ ...input, path: 'another.ograf.zip' })).rejects.toThrow(
      'different export parameters',
    );
  });
  it('preserves an existing file without overwrite permission before certification', async () => {
    const { root, run, input, requestTemplateSet } = await fixture();
    await writeFile(join(root, input.path), 'original');
    expect(await run(input)).toMatchObject({ outcome: 'snapshot-failed' });
    expect(requestTemplateSet).not.toHaveBeenCalled();
    expect(await readFile(join(root, input.path), 'utf8')).toBe('original');
  });
  it('rejects a corrupted transfer without publishing output', async () => {
    const { run, input, payload } = await fixture();
    payload.sha256 = '0'.repeat(64);
    expect(await run(input)).toMatchObject({ outcome: 'verification-failed' });
  });
  it('retries retained certified bytes after a write failure with no second certification', async () => {
    const { root, run, input, requestTemplateSet, bytes } = await fixture();
    failures.write = true;
    expect(await run(input)).toMatchObject({
      outcome: 'write-failed',
      certifiedArtifactRetained: true,
    });
    expect(await run(input)).toMatchObject({ outcome: 'saved' });
    expect(requestTemplateSet).toHaveBeenCalledOnce();
    expect(await readFile(join(root, input.path))).toEqual(bytes);
  });
  it('returns the original browser failure stage', async () => {
    const { run, input, requestTemplateSet } = await fixture();
    requestTemplateSet.mockResolvedValue({
      outcome: 'compilation-failed',
      stage: 'compilation',
      message: 'unsupported graph',
    });
    expect(await run(input)).toMatchObject({ outcome: 'compilation-failed', stage: 'compilation' });
  });
});
