import type { ComponentDefinition, Project } from '@ograf-editor/scene-model';

/** Archive-only references. The editor always receives fully hydrated ordinary projects. */
export interface SetResourceReference {
  path: Array<string | number>;
  sha256: string;
}

export interface SetResourceRecord {
  sha256: string;
  path: string;
  byteLength: number;
  encoding: 'data-uri-utf8';
}

export interface SetComponentReference {
  compositionId: string;
  componentIds: string[];
  indices: number[];
}

export interface SharedComponentRecord {
  path: 'components/shared.json';
  sha256: string;
  componentIds: string[];
  resourceReferenceCount: number;
  resourceRefs?: SetResourceReference[];
}

const MAX_REFERENCES = 65_536;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const resourceByteLengths = new WeakMap<ReadonlyMap<string, string>, Map<string, number>>();
const componentByteLengths = new WeakMap<ComponentDefinition, number>();
export const setResourcePath = (hash: string): string => `resources/${hash}.uri`;

export async function setStorageSha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', owned.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Exact URI bytes retain MIME parameters, percent encoding and base64 spelling. */
export class SetResourcePool {
  readonly entries = new Map<string, { record: SetResourceRecord; bytes: Uint8Array }>();
  readonly #byUri = new Map<string, Promise<string>>();
  #totalBytes = 0;

  add(uri: string): Promise<string> {
    if (typeof uri !== 'string' || !/^data:[^,]*,/i.test(uri))
      throw new Error('Shared embedded resources must use valid data URIs.');
    let pending = this.#byUri.get(uri);
    if (!pending) {
      pending = (async () => {
        const bytes = new TextEncoder().encode(uri);
        if (bytes.byteLength > 128 * 1024 * 1024)
          throw new Error('A shared embedded resource exceeds the 128 MiB limit.');
        const hash = await setStorageSha256(bytes);
        if (!this.entries.has(hash)) {
          if (this.entries.size >= 8192)
            throw new Error('A template set can contain at most 8192 embedded resources.');
          if (this.#totalBytes + bytes.byteLength > 512 * 1024 * 1024)
            throw new Error('Shared embedded resources exceed the 512 MiB limit.');
          this.#totalBytes += bytes.byteLength;
          this.entries.set(hash, {
            record: {
              sha256: hash,
              path: setResourcePath(hash),
              byteLength: bytes.byteLength,
              encoding: 'data-uri-utf8',
            },
            bytes,
          });
        }
        return hash;
      })();
      this.#byUri.set(uri, pending);
    }
    return pending;
  }
}

/** Move every embedded URI, including paints, fonts and component resources, into one pool. */
export async function extractSetResources(
  value: unknown,
  pool: SetResourcePool,
): Promise<SetResourceReference[]> {
  const references: SetResourceReference[] = [];
  const visit = async (node: unknown, path: Array<string | number>): Promise<void> => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (UNSAFE_KEYS.has(key)) throw new Error('An archive object contains an unsafe property.');
      const segment = Array.isArray(node) ? Number(key) : key;
      const child = (node as Record<string, unknown>)[key];
      const childPath = [...path, segment];
      if (childPath.length > 64) throw new Error('Embedded resource nesting exceeds the limit.');
      if (typeof child === 'string' && /^data:[^,]*,/i.test(child)) {
        if (references.length >= MAX_REFERENCES)
          throw new Error('Embedded resource reference count exceeds the limit.');
        references.push({ path: childPath, sha256: await pool.add(child) });
        (node as Record<string, unknown>)[key] = '';
      } else await visit(child, childPath);
    }
  };
  await visit(value, []);
  return references;
}

export function hydrateSetResources(
  value: unknown,
  references: unknown,
  resources: ReadonlyMap<string, string>,
  accountExpandedBytes: (bytes: number) => void,
): void {
  if (references === undefined) return;
  if (!Array.isArray(references) || references.length > MAX_REFERENCES)
    throw new Error('Invalid embedded resource references.');
  let byteLengths = resourceByteLengths.get(resources);
  if (!byteLengths) {
    byteLengths = new Map();
    resourceByteLengths.set(resources, byteLengths);
  }
  const seen = new Set<string>();
  for (const reference of references as SetResourceReference[]) {
    if (
      !reference ||
      typeof reference !== 'object' ||
      Object.keys(reference).some((key) => !['path', 'sha256'].includes(key)) ||
      !Array.isArray(reference.path) ||
      !reference.path.length ||
      reference.path.length > 64 ||
      typeof reference.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(reference.sha256)
    )
      throw new Error('Invalid embedded resource reference.');
    const identity = JSON.stringify(reference.path);
    if (seen.has(identity)) throw new Error('Duplicate embedded resource reference.');
    seen.add(identity);
    const uri = resources.get(reference.sha256);
    if (uri === undefined)
      throw new Error('An embedded resource reference is missing its resource.');
    let parent: unknown = value;
    for (let index = 0; index < reference.path.length; index++) {
      const key = reference.path[index]!;
      if (
        (typeof key !== 'string' && typeof key !== 'number') ||
        (typeof key === 'string' && UNSAFE_KEYS.has(key)) ||
        (typeof key === 'number' && (!Number.isSafeInteger(key) || key < 0)) ||
        !parent ||
        typeof parent !== 'object' ||
        (Array.isArray(parent) ? typeof key !== 'number' : typeof key !== 'string') ||
        !Object.hasOwn(parent, key)
      )
        throw new Error('An embedded resource reference has an invalid path.');
      const target = parent as Record<string | number, unknown>;
      if (index === reference.path.length - 1) {
        if (target[key] !== '') throw new Error('An embedded resource placeholder is invalid.');
        let byteLength = byteLengths.get(reference.sha256);
        if (byteLength === undefined) {
          byteLength = new TextEncoder().encode(uri).byteLength;
          byteLengths.set(reference.sha256, byteLength);
        }
        accountExpandedBytes(byteLength);
        target[key] = uri;
      } else parent = target[key];
    }
  }
}

export function extractSetComponents(
  project: Project,
  library: readonly ComponentDefinition[],
): SetComponentReference[] {
  const canonical = new Map(library.map((definition) => [definition.id, definition]));
  const references: SetComponentReference[] = [];
  for (const composition of project.compositions) {
    const ids: string[] = [];
    const indices: number[] = [];
    const used = new Set<string>();
    composition.components.forEach((definition, index) => {
      if (used.has(definition.id))
        throw new Error('Duplicate component identity in a composition.');
      used.add(definition.id);
      if (canonical.has(definition.id)) {
        if (definition.scope !== 'set')
          throw new Error('A local component conflicts with a shared component identity.');
        ids.push(definition.id);
        indices.push(index);
      }
    });
    // Unplaced parents remain available just as they do in compatible archives.
    for (const definition of library)
      if (!used.has(definition.id)) {
        ids.push(definition.id);
        indices.push(0);
      }
    // Missing definitions append after all original positions, in stable library order.
    let nextIndex = composition.components.length;
    for (let index = 0; index < ids.length; index++)
      if (!used.has(ids[index]!)) indices[index] = nextIndex++;
    composition.components = composition.components.filter(
      (definition) => !canonical.has(definition.id),
    );
    if (ids.length) references.push({ compositionId: composition.id, componentIds: ids, indices });
  }
  return references;
}

export function hydrateSetComponents(
  project: Project,
  references: unknown,
  library: ReadonlyMap<string, ComponentDefinition>,
  accountExpandedBytes: (bytes: number) => void,
): void {
  if (references === undefined) return;
  if (!Array.isArray(references) || references.length > 4096)
    throw new Error('Invalid shared component references.');
  const seenCompositions = new Set<string>();
  let count = 0;
  for (const reference of references as SetComponentReference[]) {
    if (
      !reference ||
      typeof reference !== 'object' ||
      Object.keys(reference).some(
        (key) => !['compositionId', 'componentIds', 'indices'].includes(key),
      ) ||
      typeof reference.compositionId !== 'string' ||
      seenCompositions.has(reference.compositionId) ||
      !Array.isArray(reference.componentIds) ||
      !Array.isArray(reference.indices) ||
      reference.componentIds.length !== reference.indices.length ||
      reference.componentIds.length > 4096
    )
      throw new Error('Invalid shared component reference.');
    seenCompositions.add(reference.compositionId);
    const composition = project.compositions.find((item) => item.id === reference.compositionId);
    if (!composition || !Array.isArray(composition.components))
      throw new Error('Shared component reference has an unknown composition.');
    const finalLength = composition.components.length + reference.componentIds.length;
    const result: ComponentDefinition[] = new Array(finalLength);
    const ids = new Set(composition.components.map((definition) => definition.id));
    for (let index = 0; index < reference.componentIds.length; index++) {
      if (++count > MAX_REFERENCES)
        throw new Error('Shared component reference count exceeds the limit.');
      const id = reference.componentIds[index]!;
      const position = reference.indices[index]!;
      const definition = library.get(id);
      if (
        typeof id !== 'string' ||
        !definition ||
        ids.has(id) ||
        !Number.isSafeInteger(position) ||
        position < 0 ||
        position >= finalLength ||
        result[position]
      )
        throw new Error('Shared component identity or position is invalid.');
      ids.add(id);
      let byteLength = componentByteLengths.get(definition);
      if (byteLength === undefined) {
        byteLength = new TextEncoder().encode(JSON.stringify(definition)).byteLength;
        componentByteLengths.set(definition, byteLength);
      }
      accountExpandedBytes(byteLength);
      result[position] = structuredClone(definition);
    }
    let localIndex = 0;
    for (let position = 0; position < result.length; position++)
      if (!result[position]) result[position] = composition.components[localIndex++]!;
    composition.components = result;
  }
}

/** A missing reference must fail instead of publishing a partly hydrated editable project. */
export function assertCompleteCompactProject(
  project: Project,
  library: ReadonlyMap<string, ComponentDefinition>,
): void {
  for (const composition of project.compositions) {
    if (
      !composition ||
      !Array.isArray(composition.components) ||
      !Array.isArray(composition.assets)
    )
      throw new Error('Compact template composition is invalid.');
    for (const id of library.keys())
      if (
        composition.components.filter(
          (definition) => definition.id === id && definition.scope === 'set',
        ).length !== 1
      )
        throw new Error('Shared component references are incomplete.');
  }
  assertCompactResourcePlaceholdersResolved(project);
}

export function assertCompactResourcePlaceholdersResolved(value: unknown): void {
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object') return;
    if (depth > 64) throw new Error('Compact template object nesting exceeds the limit.');
    for (const [key, child] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key)) throw new Error('A compact template contains an unsafe property.');
      if (key === 'dataUri' && child === '')
        throw new Error('Embedded resource references are incomplete.');
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
}
