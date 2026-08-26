import {
  LEGACY_PROJECT_SOURCE_EXTENSIONS,
  PROJECT_SOURCE_EXTENSION,
  type Project,
} from '@ograf-editor/scene-model';
import { certifyProject } from './ografCompatibility';

const AUTOSAVE_KEY = 'ograf-editor:autosave-project';
const FILE_TYPES = [
  // Deliberately does not end in .json: ograf-devtool discovers every JSON file in a selected
  // directory as a possible manifest and would report an editor source file as incompatible.
  {
    description: 'OGraf Studio Project Source',
    accept: { 'application/json': [PROJECT_SOURCE_EXTENSION] },
  },
];
const OPEN_FILE_TYPES = [
  {
    description: 'OGraf Studio Project Source',
    accept: {
      'application/json': [PROJECT_SOURCE_EXTENSION, ...LEGACY_PROJECT_SOURCE_EXTENSIONS],
    },
  },
];
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

function downloadProjectAsFile(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name || 'untitled'}${PROJECT_SOURCE_EXTENSION}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Saves an editable project snapshot only after that exact snapshot passes the same OGraf
 * compatibility gate used by package export. This source file is not itself a playout manifest.
 */
export async function saveProjectToFile(
  project: Project,
): Promise<'saved' | 'cancelled' | 'downloaded'> {
  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  const compatibility = await certifyProject(snapshot);
  if (!compatibility.valid) {
    throw new Error(`Save blocked by OGraf compatibility gate: ${compatibility.errors.join(' ')}`);
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${snapshot.name || 'untitled'}${PROJECT_SOURCE_EXTENSION}`,
        types: FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(snapshot, null, 2));
      await writable.close();
      return 'saved';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      // Picker exists but writing failed for some other reason — fall through to a plain download.
    }
  }
  downloadProjectAsFile(snapshot);
  return 'downloaded';
}

/** Generic blob save via the File System Access API when available, otherwise a plain download. */
export async function saveBlobToFile(
  blob: Blob,
  suggestedName: string,
  types: { description: string; accept: Record<string, string[]> }[],
): Promise<'saved' | 'cancelled' | 'downloaded'> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      // Picker exists but writing failed for some other reason — fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

function isProject(value: unknown): value is Project {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    'compositions' in value &&
    Array.isArray((value as Project).compositions)
  );
}

export function parseProjectSource(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The project source is not valid JSON.');
  }
  if (!isProject(parsed)) throw new Error('That source is not a valid OGraf Studio project.');
  return parsed;
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

async function readRemoteProjectText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_PROJECT_BYTES) {
    throw new Error('Remote project exceeds the 32 MiB download limit.');
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REMOTE_PROJECT_BYTES) {
      throw new Error('Remote project exceeds the 32 MiB download limit.');
    }
    return new TextDecoder().decode(bytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const textChunks: string[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REMOTE_PROJECT_BYTES) {
      await reader.cancel();
      throw new Error('Remote project exceeds the 32 MiB download limit.');
    }
    textChunks.push(decoder.decode(value, { stream: true }));
  }
  textChunks.push(decoder.decode());
  return textChunks.join('');
}

/** Downloads an editable project without credentials; the remote server must allow browser CORS. */
export async function openProjectFromUrl(
  rawUrl: string,
  fetchProject: ProjectFetcher = (input, init) => fetch(input, init),
): Promise<Project> {
  const requestedUrl = requireHttpUrl(rawUrl, 'Project URL');
  let response: Response;
  try {
    response = await fetchProject(requestedUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      headers: { Accept: 'application/json, text/json;q=0.9, */*;q=0.1' },
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
  return parseProjectSource(await readRemoteProjectText(response));
}

function openProjectViaInputFallback(): Promise<Project | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [
      PROJECT_SOURCE_EXTENSION,
      ...LEGACY_PROJECT_SOURCE_EXTENSIONS,
      '.json',
      'application/json',
    ].join(',');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => {
          resolve(parseProjectSource(text));
        })
        .catch(reject);
    };
    input.click();
  });
}

/** Opens via the File System Access API when available, otherwise falls back to an <input type=file> picker. */
export async function openProjectFromFile(): Promise<Project | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: OPEN_FILE_TYPES, multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      const text = await file.text();
      return parseProjectSource(text);
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return openProjectViaInputFallback();
}
