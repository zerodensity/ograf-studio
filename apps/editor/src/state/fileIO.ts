import type { Project } from '@ograf-editor/scene-model';
import { certifyProject } from './ografCompatibility';

const AUTOSAVE_KEY = 'ograf-editor:autosave-project';
const FILE_TYPES = [
  // Deliberately does not end in .json: ograf-devtool discovers every JSON file in a selected
  // directory as a possible manifest and would report an editor source file as incompatible.
  { description: 'OGraf Studio Project Source', accept: { 'application/json': ['.ogeproj'] } },
];
const OPEN_FILE_TYPES = [
  {
    description: 'OGraf Studio Project Source',
    accept: { 'application/json': ['.ogeproj', '.ogeproj.json'] },
  },
];

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
  anchor.download = `${project.name || 'untitled'}.ogeproj`;
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
        suggestedName: `${snapshot.name || 'untitled'}.ogeproj`,
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

function openProjectViaInputFallback(): Promise<Project | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ogeproj,.ogeproj.json,.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => {
          const parsed: unknown = JSON.parse(text);
          if (!isProject(parsed)) {
            reject(new Error('That file is not a valid OGraf Studio project.'));
            return;
          }
          resolve(parsed);
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
      const parsed: unknown = JSON.parse(text);
      if (!isProject(parsed)) throw new Error('That file is not a valid OGraf Studio project.');
      return parsed;
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return openProjectViaInputFallback();
}
