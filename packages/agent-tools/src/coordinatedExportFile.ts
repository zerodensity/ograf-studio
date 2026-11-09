import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';
import { writeTemplateFiles } from './projectFiles';
import { MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES } from './templateSetStorage';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
interface Input {
  path: string;
  expectedRevision: string;
  operationId: string;
  profile: 'realtime' | 'non-realtime' | 'dual';
  overwrite: boolean;
}
interface Operation {
  fingerprint: string;
  pending?: Promise<Record<string, unknown>>;
  data?: Buffer;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}
const hostOperations = new WeakMap<AuthoringWorkspacePort, Map<string, Operation>>();

/** Operation IDs are retained for this server lifetime; never silently evict an uncertain operation. */
export function coordinatedExportFile(workspace: AuthoringWorkspacePort, bridge: EditorBridgePort) {
  let operations = hostOperations.get(workspace);
  if (!operations) {
    operations = new Map<string, Operation>();
    hostOperations.set(workspace, operations);
  }
  const registry = operations;
  return async (input: Input): Promise<Record<string, unknown>> => {
    const target = workspace.resolveAllowedPath(input.path);
    const lower = target.toLowerCase();
    const format = lower.endsWith('.html') ? 'html' : 'zip';
    if (format === 'zip' && !lower.endsWith('.ograf.zip'))
      throw new Error('Export path must end in .ograf.zip or .html.');
    const fingerprint = JSON.stringify([
      target,
      input.expectedRevision,
      input.profile,
      input.overwrite,
    ]);
    let operation = registry.get(input.operationId);
    if (operation && operation.fingerprint !== fingerprint)
      throw new Error(
        'Operation ID already belongs to different export parameters. Use a new ID intentionally.',
      );
    if (operation?.pending) return operation.pending;
    if (!operation) {
      if (registry.size >= 32)
        throw new Error(
          'Export operation capacity reached; restart only after resolving prior operations.',
        );
      operation = { fingerprint };
      registry.set(input.operationId, operation);
    }
    const op = operation;
    const run = async (): Promise<Record<string, unknown>> => {
      let stage = 'snapshot';
      try {
        if (op.completed) {
          stage = 'verification';
          if (hash(await readFile(target)) !== op.metadata!.sha256)
            throw new Error(
              'Previously saved output was removed or changed. No file was rewritten.',
            );
          return { ...op.metadata!, outcome: 'saved', stage: 'complete', replayed: true };
        }
        // Refuse existing destinations before browser work. lstat rejects symlink targets too.
        try {
          const info = await lstat(target);
          if (!info.isFile()) throw new Error('Destination must be a regular file.');
          if (!input.overwrite)
            throw new Error('Target already exists. Explicit overwrite authorization is required.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (!op.data) {
          if (!bridge.requestTemplateSet)
            throw new Error('Coordinated export requires an updated connected editor.');
          const value = await bridge.requestTemplateSet(
            {
              action: 'export-coordinated',
              expectedRevision: input.expectedRevision,
              profile: input.profile,
              ...(format === 'html' ? { format } : {}),
            },
            600_000,
          );
          if (value.outcome !== 'certified') return { ...value, operationId: input.operationId };
          stage = 'verification';
          if (
            value.revision !== input.expectedRevision ||
            value.profile !== input.profile ||
            (value.format ?? 'zip') !== format ||
            !value.certification ||
            (value.certification as { valid?: boolean }).valid !== true ||
            !Array.isArray(value.includedTemplateIds) ||
            !value.includedTemplateIds.length ||
            !Array.isArray(value.includedStateIds) ||
            !Array.isArray(value.unreferencedTemplates)
          )
            throw new Error('Invalid coordinated snapshot/certification metadata.');
          if (
            typeof value.archiveBase64 !== 'string' ||
            !Number.isSafeInteger(value.archiveBytes) ||
            (value.archiveBytes as number) <= 0 ||
            (value.archiveBytes as number) > MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES ||
            value.archiveBase64.length > Math.ceil(MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES / 3) * 4
          )
            throw new Error('Coordinated output exceeds the 64 MiB transfer limit.');
          const data = Buffer.from(value.archiveBase64, 'base64');
          if (
            data.length !== value.archiveBytes ||
            data.toString('base64') !== value.archiveBase64 ||
            hash(data) !== value.sha256
          )
            throw new Error('Coordinated artifact checksum or transfer size mismatch.');
          if (format === 'html') {
            const html = new TextDecoder('utf-8', { fatal: true }).decode(data);
            const embedded = html.match(/id="ograf-package">([\s\S]*?)<\/script>/)?.[1];
            const payload = embedded && JSON.parse(embedded);
            if (
              !html.startsWith('<!doctype html>') ||
              payload?.manifest?.main !== 'main.js' ||
              typeof payload.mainJs !== 'string' ||
              !Array.isArray(payload.resources)
            )
              throw new Error('Coordinated HTML is missing its embedded graphic.');
          } else {
            const zip = await JSZip.loadAsync(data, { checkCRC32: true });
            if (
              !zip.file('main.js') ||
              !Object.keys(zip.files).some((name) => name.endsWith('.json'))
            )
              throw new Error('Coordinated package is missing its manifest or module.');
          }
          const { archiveBase64: _bytes, ...metadata } = value;
          const retainedBytes = [...registry.values()].reduce(
            (sum, item) => sum + (item.data?.length ?? 0),
            0,
          );
          if (retainedBytes + data.length > 128 * 1024 * 1024)
            throw new Error(
              'Retained certified artifacts exceed 128 MiB. Resolve earlier write failures first.',
            );
          op.metadata = { ...metadata, format, path: target, operationId: input.operationId };
          op.data = data;
        }
        stage = 'write';
        await writeTemplateFiles([{ path: target, data: op.data }], input.overwrite, async () => {
          stage = 'verification';
          if (hash(await readFile(target)) !== op.metadata!.sha256)
            throw new Error('Saved output checksum mismatch.');
        });
        op.metadata = {
          ...op.metadata!,
          progress: [
            ...(Array.isArray(op.metadata!.progress) ? op.metadata!.progress : []),
            'write',
            'verification',
            'complete',
          ],
        };
        op.completed = true;
        op.data = undefined;
        return { ...op.metadata, outcome: 'saved', stage: 'complete', replayed: false };
      } catch (error) {
        return {
          outcome:
            (error as NodeJS.ErrnoException).code === 'EACCES'
              ? 'permission-denied'
              : `${stage}-failed`,
          stage,
          operationId: input.operationId,
          message: error instanceof Error ? error.message : String(error),
          certifiedArtifactRetained: !!op.data,
        };
      }
    };
    op.pending = run();
    try {
      return await op.pending;
    } finally {
      op.pending = undefined;
    }
  };
}
