import type { Project } from '@ograf-editor/scene-model';
import { validateAuthoringPrompts, validatePresenterDefinition } from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from './projectSet';

/** The editable extension identifies a Studio document; its contents identify single or set mode. */
export type StudioDocument =
  { kind: 'template'; project: Project } | { kind: 'template-set'; projectSet: ProjectSetDocument };

function isProject(value: unknown): value is Project {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    'compositions' in value &&
    Array.isArray((value as Project).compositions),
  );
}

/** Legacy and current standalone source retain their ordinary JSON representation. */
export function parseProjectSource(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The project source is not valid JSON.');
  }
  if (parsed && typeof parsed === 'object' && 'archiveFragment' in parsed)
    throw new Error(
      'This source is part of a compact template set. Open the complete template set, then use Save Template to export a standalone template.',
    );
  if (!isProject(parsed)) throw new Error('That source is not a valid OGraf Studio project.');
  if (parsed.authoringPrompts !== undefined) validateAuthoringPrompts(parsed.authoringPrompts);
  if (parsed.presenter !== undefined) validatePresenterDefinition(parsed.presenter);
  return parsed;
}

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}

/** Sniff bytes, not filename or MIME; archive bounds and integrity checks remain in the set reader. */
export async function parseStudioDocument(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<StudioDocument> {
  const bytes =
    input instanceof Blob
      ? new Uint8Array(await input.arrayBuffer())
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  if (isZip(bytes)) {
    const { openProjectSetArchive } = await import('./projectSet');
    return { kind: 'template-set', projectSet: await openProjectSetArchive(bytes) };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The document is neither UTF-8 project JSON nor an OGraf Studio archive.');
  }
  return { kind: 'template', project: parseProjectSource(text) };
}

/** Project-only callers may consume a one-template archive; multiple templates must stay together. */
export async function singleTemplateFromStudioDocument(document: StudioDocument): Promise<Project> {
  if (document.kind === 'template') return document.project;
  const set = document.projectSet;
  if (set.presenter !== undefined)
    throw new Error(
      'This document contains a Presenter sequence. Open it with File → Open… to keep its presentation settings.',
    );
  if (set.transitionLogic !== undefined)
    throw new Error(
      'This document contains playout transitions. Open it with File → Open… to keep the complete set; extracting one template would lose its coordinated playout definitions.',
    );
  if (set.templates.length !== 1)
    throw new Error(
      set.templates.length
        ? 'This document contains multiple templates. Open it with File → Open… to keep the complete set; Add Template accepts one template at a time.'
        : 'This document contains no templates. Open it with File → Open….',
    );
  const { resolveProjectSetTemplate } = await import('./projectSet');
  return resolveProjectSetTemplate(set, set.templates[0]!.id);
}

/** Legacy export is a materialized copy: older set readers never see live component metadata. */
export async function legacyTemplateSetCopy(set: ProjectSetDocument): Promise<ProjectSetDocument> {
  if (set.presenter !== undefined)
    throw new Error(
      'Legacy .ogp export does not preserve Presenter settings. Save as .ogs instead.',
    );
  if (set.transitionLogic !== undefined)
    throw new Error(
      'Legacy .ogp export does not support playout transitions. Save the template set as .ogs to retain its coordinated playout definitions.',
    );
  const { resolveProjectSetTemplate } = await import('./projectSet');
  const result = structuredClone(set);
  delete result.componentAssets;
  result.templates = set.templates.map((template) => {
    const project = resolveProjectSetTemplate(set, template.id);
    for (const composition of project.compositions) {
      for (const layer of composition.layers) layer.componentLink = null;
      composition.components = [];
    }
    return { ...structuredClone(template), project };
  });
  return result;
}
