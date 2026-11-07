import {
  PROJECT_SOURCE_EXTENSION,
  templateBaseName,
  templateThumbnailName,
  type Project,
} from '@ograf-editor/scene-model';
import { certifyProject } from './ografCompatibility';
import JSZip from 'jszip';
import type { ProjectSetDocument, ProjectSetArchiveProgress } from './projectSet';
import { associateRecentDocument, rememberRecentDocument } from './recentDocuments';
import { createProjectSetArchiveTask } from './projectSetArchiveTask';
import {
  parseStudioDocument,
  singleTemplateFromStudioDocument,
  legacyTemplateSetCopy,
  type StudioDocument,
} from './studioDocument';
export { parseProjectSource } from './studioDocument';

const AUTOSAVE_KEY = 'ograf-editor:autosave-project';
const PROJECT_SET_AUTOSAVE_KEY = 'ograf-editor:autosave-project-set';
const PROJECT_SET_AUTOSAVE_DATABASE = 'ograf-editor-autosave';
const PROJECT_SET_AUTOSAVE_STORE = 'sessions';
const PROJECT_SET_AUTOSAVE_RECORD = 'project-set';
const PROJECT_SET_AUTOSAVE_TOMBSTONE = '__cleared__';
const OPEN_FILE_TYPES: FilePickerAcceptType[] = [
  {
    description: 'OGraf Studio documents',
    accept: {
      // A JSON MIME type makes Chromium add .json to this filter automatically.
      'application/x-ograf-studio-project': [PROJECT_SOURCE_EXTENSION, '.ogp', '.ogeproj'],
    },
  },
  {
    description: 'JSON files',
    accept: {
      'application/json': ['.json'],
    },
  },
];
const SINGLE_TEMPLATE_FILE_TYPE: FilePickerAcceptType = {
  description: 'OGS template files',
  accept: { 'application/x-ograf-studio-project': [PROJECT_SOURCE_EXTENSION] },
};
export const MAX_REMOTE_PROJECT_BYTES = 32 * 1024 * 1024;

export type ProjectFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function saveAutosave(project: Project): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    // Autosave is a convenience, not the source of truth — ignore quota/availability errors.
  }
}

export function loadAutosave(): Project | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

export interface ProjectSetAutosave {
  version: 1;
  projectSet: ProjectSetDocument;
  activeTemplateId: string | null;
}

export type ProjectSetAutosaveInput = Omit<ProjectSetAutosave, 'version'>;

let projectSetAutosaveDatabase: Promise<IDBDatabase> | undefined;

function openProjectSetAutosaveDatabase(): Promise<IDBDatabase> {
  return (projectSetAutosaveDatabase ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(PROJECT_SET_AUTOSAVE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROJECT_SET_AUTOSAVE_STORE))
        request.result.createObjectStore(PROJECT_SET_AUTOSAVE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open set autosave storage.'));
    request.onblocked = () => reject(new Error('Set autosave storage is blocked by another tab.'));
  }));
}

function validProjectSetAutosave(value: unknown): value is ProjectSetAutosave {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<ProjectSetAutosave>;
  return (
    (session.version === undefined || session.version === 1) &&
    !!session.projectSet &&
    Array.isArray(session.projectSet.templates) &&
    ((session.projectSet.templates.length === 0 && session.activeTemplateId === null) ||
      (typeof session.activeTemplateId === 'string' &&
        session.projectSet.templates.some((template) => template.id === session.activeTemplateId)))
  );
}

export async function saveProjectSetAutosave(session: ProjectSetAutosaveInput): Promise<boolean> {
  const record: ProjectSetAutosave = { version: 1, ...session };
  try {
    localStorage.setItem(PROJECT_SET_AUTOSAVE_KEY, PROJECT_SET_AUTOSAVE_TOMBSTONE);
  } catch {
    // IndexedDB remains the primary store when localStorage is unavailable.
  }
  try {
    const db = await openProjectSetAutosaveDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PROJECT_SET_AUTOSAVE_STORE, 'readwrite');
      transaction.objectStore(PROJECT_SET_AUTOSAVE_STORE).put(record, PROJECT_SET_AUTOSAVE_RECORD);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error('Could not save the template set session.'));
    });
    try {
      localStorage.removeItem(PROJECT_SET_AUTOSAVE_KEY);
    } catch {
      // IndexedDB already has the durable record.
    }
    return true;
  } catch {
    try {
      localStorage.setItem(PROJECT_SET_AUTOSAVE_KEY, JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  }
}

export async function loadProjectSetAutosave(): Promise<ProjectSetAutosave | null> {
  let legacyRecord: string | null = null;
  try {
    legacyRecord = localStorage.getItem(PROJECT_SET_AUTOSAVE_KEY);
    if (legacyRecord === PROJECT_SET_AUTOSAVE_TOMBSTONE) return null;
  } catch {
    // Continue with IndexedDB when localStorage is unavailable.
  }
  if (legacyRecord) {
    try {
      const parsed: unknown = JSON.parse(legacyRecord);
      if (validProjectSetAutosave(parsed)) return { ...parsed, version: 1 };
    } catch {
      // Fall through to the indexed record when the compatibility copy is damaged.
    }
  }
  try {
    const db = await openProjectSetAutosaveDatabase();
    const result = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction(PROJECT_SET_AUTOSAVE_STORE, 'readonly')
        .objectStore(PROJECT_SET_AUTOSAVE_STORE)
        .get(PROJECT_SET_AUTOSAVE_RECORD);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not load the set session.'));
    });
    if (validProjectSetAutosave(result)) return { ...result, version: 1 };
  } catch {
    // The localStorage compatibility copy was already checked above.
  }
  return null;
}

export async function clearProjectSetAutosave(): Promise<void> {
  try {
    localStorage.setItem(PROJECT_SET_AUTOSAVE_KEY, PROJECT_SET_AUTOSAVE_TOMBSTONE);
  } catch {
    // ignore
  }
  try {
    const db = await openProjectSetAutosaveDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PROJECT_SET_AUTOSAVE_STORE, 'readwrite');
      transaction.objectStore(PROJECT_SET_AUTOSAVE_STORE).delete(PROJECT_SET_AUTOSAVE_RECORD);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error('Could not clear the template set session.'));
    });
  } catch {
    // The project autosave remains available if IndexedDB cannot be cleared.
  }
}

function downloadBlob(blob: Blob, name: string, ownerWindow: Window = window): void {
  const url = URL.createObjectURL(blob);
  const anchor = ownerWindow.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  ownerWindow.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function isAbort(err: unknown): boolean {
  // A detached pane's picker can reject with a DOMException from another window.
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError';
}

async function writeBlobToHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

/** Downloads editable source as one file, without requesting folder access. */
export async function downloadProjectSource(
  project: Project,
  options: { baseName?: string; ownerWindow?: Window } = {},
): Promise<'downloaded'> {
  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  const compatibility = await certifyProject(snapshot);
  if (!compatibility.valid)
    throw new Error(`Save blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`);
  const baseName = templateBaseName(options.baseName ?? snapshot.name);
  downloadBlob(
    new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    `${baseName}${PROJECT_SOURCE_EXTENSION}`,
    options.ownerWindow,
  );
  return 'downloaded';
}

export type ProjectSourceSaveResult =
  { status: 'cancelled' } | { status: 'saved' | 'downloaded'; project: Project; fileName: string };

/** Opens the file save dialog during the click, then verifies and writes the chosen .ogs file. */
export async function saveProjectSourceToFile(
  project: Project,
  options: { baseName?: string; ownerWindow?: Window } = {},
): Promise<ProjectSourceSaveResult> {
  const ownerWindow = options.ownerWindow ?? window;
  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  const baseName = templateBaseName(options.baseName ?? snapshot.name);
  const suggestedName = `${baseName}${PROJECT_SOURCE_EXTENSION}`;
  if (!ownerWindow.showSaveFilePicker) {
    await downloadProjectSource(snapshot, { baseName, ownerWindow });
    return { status: 'downloaded', project: snapshot, fileName: suggestedName };
  }

  let handle: FileSystemFileHandle;
  try {
    handle = await ownerWindow.showSaveFilePicker({
      suggestedName,
      types: [SINGLE_TEMPLATE_FILE_TYPE],
    });
  } catch (error) {
    if (isAbort(error)) return { status: 'cancelled' };
    throw error;
  }

  // The native picker can change the suggested filename. Certify and persist that exact name.
  const fileName = handle.name;
  snapshot.name = fileName.replace(/\.ogs$/i, '').trim() || snapshot.name;
  const compatibility = await certifyProject(snapshot);
  if (!compatibility.valid)
    throw new Error(`Save blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`);
  await writeBlobToHandle(
    handle,
    new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
  );
  void rememberRecentDocument(handle);
  return { status: 'saved', project: snapshot, fileName };
}

export type ProjectSetSaveResult =
  | { status: 'cancelled' }
  | { status: 'saved' | 'downloaded'; projectSet: ProjectSetDocument; fileName: string };

/** Chooses the set filename before generating the archive so its root name matches the saved file. */
export async function saveProjectSetToFile(
  set: ProjectSetDocument,
  options: {
    legacyFormat?: boolean;
    archiveMode?: 'compact' | 'compatible';
    downloadOnly?: boolean;
    ownerWindow?: Window;
    onProgress?: (progress: ProjectSetArchiveProgress) => void;
  } = {},
): Promise<ProjectSetSaveResult> {
  const ownerWindow = options.ownerWindow ?? window;
  if (options.legacyFormat && set.transitionLogic) {
    throw new Error(
      'Playout transitions require a template-set .ogs document. Legacy .ogp cannot preserve coordinated playback.',
    );
  }
  let snapshot = structuredClone(set);
  const baseName =
    snapshot.name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\.(ogs|ogp)$/i, '')
      .trim() || 'Untitled Template Set';
  const extension = options.legacyFormat ? '.ogp' : PROJECT_SOURCE_EXTENSION;
  let fileName = `${baseName}${extension}`;
  let handle: FileSystemFileHandle | undefined;
  if (ownerWindow.showSaveFilePicker && !options.downloadOnly) {
    try {
      handle = await ownerWindow.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: options.legacyFormat
              ? 'Legacy OGraf template sets'
              : 'OGraf Studio template sets',
            accept: { 'application/x-ograf-template-set': [extension] },
          },
        ],
      });
      fileName = handle.name;
    } catch (error) {
      if (isAbort(error)) return { status: 'cancelled' };
      throw error;
    }
  }
  const { renameProjectSet } = await import('./projectSet');
  snapshot = renameProjectSet(snapshot, fileName.replace(/\.(ogs|ogp)$/i, ''));
  if (options.legacyFormat) snapshot = await legacyTemplateSetCopy(snapshot);
  const blob = await createProjectSetArchiveTask(snapshot, {
    legacyFormat: options.legacyFormat,
    archiveMode: options.archiveMode,
    onProgress: options.onProgress,
  });
  if (handle) {
    await writeBlobToHandle(handle, blob);
    void rememberRecentDocument(handle);
  } else downloadBlob(blob, fileName, ownerWindow);
  return {
    status: handle ? 'saved' : 'downloaded',
    projectSet: options.legacyFormat ? set : snapshot,
    fileName,
  };
}

/**
 * Saves an editable project snapshot only after that exact snapshot passes the same OGraf
 * compatibility gate used by package export. This source file is not itself a playout manifest.
 */
export async function saveProjectToFile(
  project: Project,
  options: { baseName?: string; downloadOnly?: boolean } = {},
): Promise<'saved' | 'cancelled' | 'downloaded'> {
  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  const baseName = templateBaseName(options.baseName ?? snapshot.name);
  let directory: FileSystemDirectoryHandle | undefined;
  if (window.showDirectoryPicker && !options.downloadOnly) {
    try {
      directory = await window.showDirectoryPicker({ mode: 'readwrite', id: 'ograf-templates' });
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      throw error;
    }
  }
  const { createTemplateThumbnail } = await import('./templateThumbnail');
  const thumbnail = await createTemplateThumbnail(snapshot);
  const compatibility = await certifyProject(snapshot);
  if (!compatibility.valid) {
    throw new Error(`Save blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`);
  }
  const files = [
    {
      name: `${baseName}${PROJECT_SOURCE_EXTENSION}`,
      data: new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    },
    { name: templateThumbnailName(snapshot), data: thumbnail },
  ];
  if (directory) {
    const existing: string[] = [];
    for (const file of files) {
      try {
        await directory.getFileHandle(file.name);
        existing.push(file.name);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
    }
    if (existing.length && !window.confirm(`Replace these existing files?\n${existing.join('\n')}`))
      return 'cancelled';
    const streams: FileSystemWritableFileStream[] = [];
    try {
      for (const file of files)
        streams.push(
          await (await directory.getFileHandle(file.name, { create: true })).createWritable(),
        );
      for (let index = 0; index < files.length; index++)
        await streams[index]!.write(files[index]!.data);
      for (const stream of streams) await stream.close();
    } catch (error) {
      await Promise.allSettled(streams.map((stream) => stream.abort()));
      throw new Error(
        `Could not finish saving both template files. Check the selected folder. ${error instanceof Error ? error.message : ''}`,
      );
    }
    return 'saved';
  }
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, await file.data.arrayBuffer());
  downloadBlob(
    await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }),
    `${baseName}.source.zip`,
  );
  return 'downloaded';
}

/** Generic blob save via the File System Access API when available, otherwise a plain download. */
export async function saveBlobToFile(
  blob: Blob,
  suggestedName: string,
  types: { description: string; accept: Record<string, string[]> }[],
  options: { downloadOnly?: boolean; ownerWindow?: Window } = {},
): Promise<'saved' | 'cancelled' | 'downloaded'> {
  const ownerWindow = options.ownerWindow ?? window;
  if (ownerWindow.showSaveFilePicker && !options.downloadOnly) {
    try {
      const handle = await ownerWindow.showSaveFilePicker({ suggestedName, types });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      // Picker exists but writing failed for some other reason — fall through to a plain download.
    }
  }
  downloadBlob(blob, suggestedName, ownerWindow);
  return 'downloaded';
}

function requireHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a complete HTTP or HTTPS URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return url;
}

async function readRemoteDocumentBytes(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_PROJECT_BYTES) {
    throw new Error('Remote project exceeds the 32 MiB download limit.');
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REMOTE_PROJECT_BYTES) {
      throw new Error('Remote project exceeds the 32 MiB download limit.');
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REMOTE_PROJECT_BYTES) {
      await reader.cancel();
      throw new Error('Remote project exceeds the 32 MiB download limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Downloads an editable project without credentials; the remote server must allow browser CORS. */
export async function openStudioDocumentFromUrl(
  rawUrl: string,
  fetchProject: ProjectFetcher = (input, init) => fetch(input, init),
): Promise<StudioDocument> {
  const requestedUrl = requireHttpUrl(rawUrl, 'Project URL');
  let response: Response;
  try {
    response = await fetchProject(requestedUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        Accept:
          'application/x-ograf-template-set, application/octet-stream, application/json, text/json;q=0.9, */*;q=0.1',
      },
    });
  } catch {
    throw new Error(
      'Could not download the remote project. Check the URL, network connection, and server CORS policy.',
    );
  }
  if (!response.ok) {
    throw new Error(`Remote project request failed with HTTP ${response.status}.`);
  }
  if (response.url) requireHttpUrl(response.url, 'Redirected project URL');
  const document = await parseStudioDocument(await readRemoteDocumentBytes(response));
  return associateRecentDocument(document, {
    url: requestedUrl.href,
    name: document.kind === 'template-set' ? document.projectSet.name : document.project.name,
  });
}

/** Single-template compatibility API used by Add Template and older project-only callers. */
export async function openProjectFromUrl(
  rawUrl: string,
  fetchProject: ProjectFetcher = (input, init) => fetch(input, init),
): Promise<Project> {
  return singleTemplateFromStudioDocument(await openStudioDocumentFromUrl(rawUrl, fetchProject));
}

function openStudioDocumentViaInputFallback(
  ownerDocument: Document,
): Promise<StudioDocument | null> {
  return new Promise((resolve, reject) => {
    const input = ownerDocument.createElement('input');
    input.type = 'file';
    input.accept = '.ogs,.ogp,.ogeproj,.json';
    input.addEventListener('cancel', () => resolve(null));
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.arrayBuffer().then(parseStudioDocument).then(resolve).catch(reject);
    };
    input.click();
  });
}

/** Opens via the File System Access API when available, otherwise falls back to an <input type=file> picker. */
export async function openStudioDocumentFromFile(
  ownerWindow: Window = window,
): Promise<StudioDocument | null> {
  if (ownerWindow.showOpenFilePicker) {
    try {
      const [handle] = await ownerWindow.showOpenFilePicker({
        types: OPEN_FILE_TYPES,
        excludeAcceptAllOption: false,
        multiple: false,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      const document = await parseStudioDocument(await file.arrayBuffer());
      return associateRecentDocument(document, { handle });
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return openStudioDocumentViaInputFallback(ownerWindow.document);
}

export async function openProjectFromFile(): Promise<Project | null> {
  const document = await openStudioDocumentFromFile();
  return document ? singleTemplateFromStudioDocument(document) : null;
}
