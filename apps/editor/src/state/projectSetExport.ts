import JSZip from 'jszip';
import {
  chooseCertifiedArtifactWriter,
  CoordinatedExportError,
  exportFailure,
} from './certifiedArtifactSave';
import {
  STUDIO_RUNTIME_LICENSE_PATH,
  STUDIO_RUNTIME_LICENSE_TEXT,
  type ExportProfile,
} from '@ograf-editor/codegen';
import { createCertifiedProjectPackage } from './exportPackage';
import type { OGrafCompatibilityResult } from './ografCompatibility';
import { saveBlobToFile } from './fileIO';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import { createCertifiedCoordinatedPackage } from './coordinatedExport';
import { transitionLogicEditorSetSnapshot } from './transitionLogicEditing';
import {
  transitionLogicDraftChanged,
  useTransitionLogicDraftStore,
} from './transitionLogicDraftStore';

export interface ProjectSetExportResult {
  mode: 'coordinated' | 'independent';
  fileName: string;
  saveResult: 'saved' | 'cancelled' | 'downloaded' | 'prepared';
  templates: Array<{ id: string; name: string; packagePath: string }>;
  certifications: Array<{ templateId: string; result: OGrafCompatibilityResult }>;
  compatibility?: OGrafCompatibilityResult;
  unreferencedTemplates?: Array<{ id: string; name: string }>;
}

function fileSlug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 80) || 'template'
  );
}

let exportInProgress = false;

/** Exports the current set snapshot as one coordinated graphic or independent certified packages. */
export async function exportProjectSetAsZip(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  options: {
    downloadOnly?: boolean;
    ownerWindow?: Window;
    onProgress?: (stage: string) => void;
  } = {},
): Promise<ProjectSetExportResult> {
  if (exportInProgress)
    throw new Error('A template-set export is already in progress. Wait for it to finish.');
  const draft = useTransitionLogicDraftStore.getState().drafts[set.id];
  if (draft && transitionLogicDraftChanged(draft))
    throw new Error(
      'Playout transitions have unapplied edits. Apply or Revert the draft in Transitions before exporting.',
    );
  const snapshot = structuredClone(transitionLogicEditorSetSnapshot(set));
  if (!snapshot.templates.length) throw new Error('Insert a template before exporting this set.');
  exportInProgress = true;
  try {
    return snapshot.transitionLogic
      ? await exportCoordinatedSet(snapshot, profile, options)
      : await exportIndependentSet(snapshot, profile, options);
  } finally {
    exportInProgress = false;
  }
}

let certifiedSave: { blob: Blob; result: ProjectSetExportResult; ownerWindow?: Window } | undefined;
export interface CertifiedCoordinatedSaveSnapshot {
  fileName: string;
  byteLength: number;
  templateCount: number;
  ownerWindow?: Window;
  promptRevision: number;
  needsSave: boolean;
}
let certifiedSaveSnapshot: CertifiedCoordinatedSaveSnapshot | null = null;
let savePromptRevision = 0;
const certifiedSaveListeners = new Set<() => void>();

/** Stable, metadata-only React external-store snapshot; the certified bytes stay private. */
export function getCertifiedCoordinatedSaveSnapshot(): CertifiedCoordinatedSaveSnapshot | null {
  return certifiedSaveSnapshot;
}
export function subscribeCertifiedCoordinatedSave(listener: () => void): () => void {
  certifiedSaveListeners.add(listener);
  return () => certifiedSaveListeners.delete(listener);
}
function publishCertifiedSave(needsSave: boolean, requestPrompt = false): void {
  if (requestPrompt) savePromptRevision++;
  certifiedSaveSnapshot = certifiedSave
    ? {
        fileName: certifiedSave.result.fileName,
        byteLength: certifiedSave.blob.size,
        templateCount: certifiedSave.result.templates.length,
        ownerWindow: certifiedSave.ownerWindow,
        promptRevision: savePromptRevision,
        needsSave,
      }
    : null;
  for (const listener of certifiedSaveListeners) listener();
}
export function hasCertifiedCoordinatedSave(): boolean {
  return !!certifiedSave;
}
/** Retry exact certified bytes, including when the editor has since changed. */
export async function retryCertifiedCoordinatedSave(
  options: { downloadOnly?: boolean; ownerWindow?: Window } = {},
): Promise<ProjectSetExportResult> {
  if (!certifiedSave) throw new Error('No certified coordinated artifact is available to save.');
  if (exportInProgress) throw new Error('A template-set export is already in progress.');
  const cached = certifiedSave;
  exportInProgress = true;
  try {
    const writer = await chooseCertifiedArtifactWriter(cached.result.fileName, {
      ...options,
      ownerWindow:
        options.ownerWindow ?? (cached.ownerWindow?.closed ? undefined : cached.ownerWindow),
    });
    const result = {
      ...cached.result,
      fileName: writer.fileName ?? cached.result.fileName,
      saveResult: await writer(cached.blob),
    };
    cached.result = result;
    publishCertifiedSave(false);
    return result;
  } finally {
    exportInProgress = false;
  }
}
async function exportCoordinatedSet(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  options: {
    downloadOnly?: boolean;
    ownerWindow?: Window;
    onProgress?: (stage: string) => void;
  } = {},
): Promise<ProjectSetExportResult> {
  const fileName = `${fileSlug(set.name)}${profile?.fileNameSuffix ?? ''}.ograf.zip`;
  const { blob, compatibility, artifacts } = options.onProgress
    ? await createCertifiedCoordinatedPackage(set, profile, { onProgress: options.onProgress })
    : await createCertifiedCoordinatedPackage(set, profile);
  if (blob.size <= 0)
    throw exportFailure(
      new Error('The coordinated package is empty. No destination file was opened.'),
      'packaging',
    );
  const included = new Set(
    artifacts.transitionDescriptor?.templates.map((template) => template.id),
  );
  const result: ProjectSetExportResult = {
    mode: 'coordinated',
    fileName,
    saveResult: 'prepared',
    templates: set.templates
      .filter((template) => included.has(template.id))
      .map((template) => ({
        id: template.id,
        name: template.name,
        packagePath: fileName,
      })),
    certifications: [],
    compatibility,
    unreferencedTemplates: set.templates
      .filter((template) => !included.has(template.id))
      .map(({ id, name }) => ({ id, name })),
  };
  certifiedSave = { blob, result, ownerWindow: options.ownerWindow };
  publishCertifiedSave(false);
  const owner = options.ownerWindow ?? (typeof window === 'undefined' ? undefined : window);
  // A Chromium save picker creates a placeholder immediately. Only offer it after the
  // complete certified package exists, and require a fresh click if preparation took
  // longer than the browser's transient user activation.
  if (
    !options.downloadOnly &&
    owner?.showSaveFilePicker &&
    owner.navigator?.userActivation?.isActive === false
  ) {
    publishCertifiedSave(true, true);
    options.onProgress?.('ready');
    return result;
  }
  options.onProgress?.('picker');
  let writer: Awaited<ReturnType<typeof chooseCertifiedArtifactWriter>>;
  try {
    writer = await chooseCertifiedArtifactWriter(fileName, options);
  } catch (error) {
    // Hosts without UserActivation introspection can still reject an expired gesture.
    // Retain the prepared bytes for an explicit Save click; do not fall back to download.
    if (
      error instanceof CoordinatedExportError &&
      error.stage === 'picker' &&
      (error.cause as { name?: string } | undefined)?.name === 'SecurityError'
    ) {
      publishCertifiedSave(true, true);
      options.onProgress?.('ready');
      return result;
    }
    throw error;
  }
  result.fileName = writer.fileName ?? fileName;
  options.onProgress?.('write');
  try {
    result.saveResult = await writer(blob);
    publishCertifiedSave(false);
  } catch (error) {
    publishCertifiedSave(true, true);
    throw error;
  }
  return result;
}

async function exportIndependentSet(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  options: {
    downloadOnly?: boolean;
    ownerWindow?: Window;
    onProgress?: (stage: string) => void;
  } = {},
): Promise<ProjectSetExportResult> {
  const zip = new JSZip();
  zip.file(STUDIO_RUNTIME_LICENSE_PATH, STUDIO_RUNTIME_LICENSE_TEXT);
  const templates: ProjectSetExportResult['templates'] = [];
  const certifications: ProjectSetExportResult['certifications'] = [];

  for (const [index, template] of set.templates.entries()) {
    const resolved = resolveProjectSetTemplate(set, template.id);
    const composition = resolved.compositions.find(
      (item) => item.id === resolved.mainCompositionId,
    );
    if (!composition)
      throw new Error(`Template "${template.name}" has no main composition to export.`);

    let packaged: Awaited<ReturnType<typeof createCertifiedProjectPackage>>;
    try {
      packaged = await createCertifiedProjectPackage(resolved, composition, profile);
    } catch (error) {
      throw new Error(
        `Template "${template.name}" could not be certified: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const packagePath = `templates/${String(index + 1).padStart(2, '0')}-${fileSlug(template.name)}-${fileSlug(template.id)}.ograf.zip`;
    zip.file(packagePath, await packaged.blob.arrayBuffer());
    templates.push({ id: template.id, name: template.name, packagePath });
    certifications.push({ templateId: template.id, result: packaged.compatibility });
  }

  zip.file(
    'set-export.json',
    JSON.stringify(
      {
        format: 'ograf-template-set-export',
        schemaVersion: 1,
        setId: set.id,
        name: set.name,
        studioRuntimeLicense: STUDIO_RUNTIME_LICENSE_PATH,
        templates,
      },
      null,
      2,
    ),
  );

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const fileName = `${fileSlug(set.name)}${profile?.fileNameSuffix ?? ''}.ograf-set.zip`;
  const saveResult = await saveBlobToFile(
    blob,
    fileName,
    [{ description: 'OGraf template set export', accept: { 'application/zip': ['.zip'] } }],
    ...(Object.keys(options).length ? [options] : []),
  );
  return { mode: 'independent', fileName, saveResult, templates, certifications };
}
