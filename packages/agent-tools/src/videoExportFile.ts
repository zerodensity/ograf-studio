import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import type { AuthoringWorkspacePort, BrowserVideoRequest, EditorBridgePort } from './ports';
import { writeTemplateFiles } from './projectFiles';

/** The editor hands the movie over in one message, as it does a set archive. */
export const MAX_VIDEO_EXPORT_BYTES = 64 * 1024 * 1024;

const WEBM_START = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface Input {
  path: string;
  operationId: string;
  overwrite: boolean;
  /** The session revision the movie is rendered from. */
  revision: number;
  request: BrowserVideoRequest;
}

interface Operation {
  fingerprint: string;
  pending?: Promise<Record<string, unknown>>;
  saved?: Record<string, unknown> & { sha256: string };
}

const hostOperations = new WeakMap<AuthoringWorkspacePort, Map<string, Operation>>();
const MAX_OPERATIONS = 32;

async function assertWritable(target: string, overwrite: boolean): Promise<void> {
  try {
    // lstat also refuses a symbolic link as the destination.
    if (!(await lstat(target)).isFile()) throw new Error('The destination must be a regular file.');
    if (!overwrite)
      throw new Error('The video file already exists. Pass overwrite: true to replace it.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Renders a template as a WebM movie in the connected editor and saves it in the workspace.
 * An export can outlast a client's patience, so each one has an operation ID: a second call with
 * the same ID waits for the running export, or answers again for one that was saved.
 */
export function videoExportFile(workspace: AuthoringWorkspacePort, bridge: EditorBridgePort) {
  let operations = hostOperations.get(workspace);
  if (!operations) {
    operations = new Map<string, Operation>();
    hostOperations.set(workspace, operations);
  }
  const registry = operations;

  return async (input: Input): Promise<Record<string, unknown>> => {
    const target = workspace.resolveAllowedPath(input.path);
    if (!target.toLowerCase().endsWith('.webm'))
      throw new Error('A video export path must end in .webm.');
    const { project: _project, ...settings } = input.request;
    const fingerprint = JSON.stringify([target, input.revision, input.overwrite, settings]);

    let operation = registry.get(input.operationId);
    if (operation && operation.fingerprint !== fingerprint)
      throw new Error(
        'This operationId belongs to a different video export. Use a new ID for a new export.',
      );
    if (operation?.pending) return operation.pending;
    if (operation?.saved) {
      if (hash(await readFile(target).catch(() => new Uint8Array())) !== operation.saved.sha256)
        throw new Error(
          'The saved video was removed or changed. Use a new operationId to export again.',
        );
      return { ...operation.saved, replayed: true };
    }
    if (!operation) {
      if (registry.size >= MAX_OPERATIONS) {
        const oldestSaved = [...registry].find(([, candidate]) => candidate.saved)?.[0];
        if (oldestSaved === undefined)
          throw new Error('Too many video exports are running. Wait for one to finish.');
        registry.delete(oldestSaved);
      }
      operation = { fingerprint };
      registry.set(input.operationId, operation);
    }
    const entry = operation;

    entry.pending = (async () => {
      await assertWritable(target, input.overwrite);
      if (!bridge.exportVideo)
        throw new Error('Video export requires an updated, connected Studio editor.');
      const movie = await bridge.exportVideo(input.request);
      if (
        movie.mimeType !== 'video/webm' ||
        !Number.isSafeInteger(movie.bytes) ||
        movie.bytes <= 0 ||
        movie.bytes > MAX_VIDEO_EXPORT_BYTES
      )
        throw new Error('The editor returned a movie outside the 64 MiB transfer limit.');
      const data = Buffer.from(movie.data, 'base64');
      if (
        data.length !== movie.bytes ||
        hash(data) !== movie.sha256 ||
        !data.subarray(0, WEBM_START.length).equals(WEBM_START)
      )
        throw new Error('The movie did not arrive whole from the editor. Nothing was saved.');
      await writeTemplateFiles([{ path: target, data }], input.overwrite, async () => {
        if (hash(await readFile(target)) !== movie.sha256)
          throw new Error('The saved video does not match the rendered one.');
      });
      const { data: _data, ...metadata } = movie;
      entry.saved = { ...metadata, path: target, operationId: input.operationId };
      return { ...entry.saved, replayed: false };
    })();
    try {
      return await entry.pending;
    } catch (error) {
      // A failed export leaves nothing to answer for, so the same ID may try again.
      registry.delete(input.operationId);
      throw error;
    } finally {
      entry.pending = undefined;
    }
  };
}
