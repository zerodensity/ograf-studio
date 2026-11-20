import JSZip from 'jszip';
import {
  chooseCertifiedArtifactWriter,
  completeCertifiedArtifactSave,
  CoordinatedExportError,
  exportFailure,
  peekCertifiedArtifact,
  requestCertifiedArtifactSave,
  stageCertifiedArtifacts,
} from './certifiedArtifactSave';
import {
  STUDIO_RUNTIME_LICENSE_PATH,
  STUDIO_RUNTIME_LICENSE_TEXT,
  type ExportProfile,
} from '@ograf-editor/codegen';
import type { Project } from '@ograf-editor/scene-model';
import { createCertifiedProjectPackage } from './exportPackage';
import { generateExportZip } from './exportZip';
import type { OGrafCompatibilityResult } from './ografCompatibility';
import { saveBlobToFile } from './fileIO';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import {
  createCertifiedCoordinatedHtml,
  createCertifiedCoordinatedPackage,
} from './coordinatedExport';
import {
  createStandaloneHtmlFile,
  type ExportFile,
  type ExportFileFormat,
  type ExportFileSaveResult,
  type ExportFileSaveStatus,
} from './offlinePreviewPackage';
import { transitionLogicEditorSetSnapshot } from './transitionLogicEditing';
import {
  transitionLogicDraftChanged,
  useTransitionLogicDraftStore,
} from './transitionLogicDraftStore';

export {
  getCertifiedCoordinatedSaveSnapshot,
  subscribeCertifiedCoordinatedSave,
  type CertifiedCoordinatedSaveSnapshot,
} from './certifiedArtifactSave';

export interface ProjectSetExportResult {
  mode: 'coordinated' | 'independent';
  fileName: string;
  saveResult: ExportFileSaveStatus;
  files: ExportFileSaveResult[];
  templates: Array<{ id: string; name: string; packagePath: string }>;
  certifications: Array<{ templateId: string; result: OGrafCompatibilityResult }>;
  compatibility?: OGrafCompatibilityResult;
  unreferencedTemplates?: Array<{ id: string; name: string }>;
}

interface SetExportOptions {
  downloadOnly?: boolean;
  ownerWindow?: Window;
  onProgress?: (stage: string) => void;
  format?: ExportFileFormat;
  signal?: AbortSignal;
  /** Keep the complete certified files ready for an explicit Save or Download click. */
  prepareOnly?: boolean;
}

type SetPreparationOptions = Pick<SetExportOptions, 'format' | 'onProgress' | 'signal'>;

interface PreparedSetExport {
  files: ExportFile[];
  result: ProjectSetExportResult;
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

export function getProjectSetExportZipName(
  set: Pick<ProjectSetDocument, 'name' | 'transitionLogic'>,
  profile?: ExportProfile,
): string {
  const extension = set.transitionLogic ? '.ograf.zip' : '.ograf-set.zip';
  return `${fileSlug(set.name)}${profile?.fileNameSuffix ?? ''}${extension}`;
}

let exportInProgress = false;

export function snapshotProjectSetForExport(
  set: ProjectSetDocument,
  project?: Project,
): ProjectSetDocument {
  const draft = useTransitionLogicDraftStore.getState().drafts[set.id];
  if (draft && transitionLogicDraftChanged(draft))
    throw new Error(
      'Playout transitions have unapplied edits. Apply or Revert the draft in Transitions before exporting.',
    );
  const snapshot = structuredClone(transitionLogicEditorSetSnapshot(set, project));
  if (!snapshot.templates.length) throw new Error('Insert a template before exporting this set.');
  return snapshot;
}

async function runSetExport<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  if (exportInProgress)
    throw new Error('A template-set export is already in progress. Wait for it to finish.');
  exportInProgress = true;
  try {
    return await run();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    exportInProgress = false;
  }
}

function validateSetExportFormat(set: ProjectSetDocument, format?: ExportFileFormat): void {
  if (!set.transitionLogic && format && format !== 'zip')
    throw new Error('Choose Current template to export standalone HTML from an independent set.');
}

/** Prepare certified files for a snapshot captured using snapshotProjectSetForExport. */
export async function prepareProjectSetExportFiles(
  snapshot: ProjectSetDocument,
  profile: ExportProfile | undefined,
  options: SetPreparationOptions & { format: ExportFileFormat },
): Promise<ExportFile[]> {
  return runSetExport(options.signal, async () => {
    if (!snapshot.templates.length) throw new Error('Insert a template before exporting this set.');
    validateSetExportFormat(snapshot, options.format);
    const prepared = snapshot.transitionLogic
      ? await prepareCoordinatedSetExport(snapshot, profile, options)
      : await prepareIndependentSetExport(snapshot, profile, options);
    options.signal?.throwIfAborted();
    return prepared.files;
  });
}

/** Exports the current set snapshot as one coordinated graphic or independent certified packages. */
export async function exportProjectSetAsZip(
  set: ProjectSetDocument,
  profile?: ExportProfile,
  options: SetExportOptions = {},
): Promise<ProjectSetExportResult> {
  return runSetExport(options.signal, () => {
    const snapshot = snapshotProjectSetForExport(set);
    validateSetExportFormat(snapshot, options.format);
    return snapshot.transitionLogic
      ? exportCoordinatedSet(snapshot, profile, options)
      : exportIndependentSet(snapshot, profile, options);
  });
}

/** Retry exact certified bytes, including when the editor has since changed. */
export async function retryCertifiedCoordinatedSave(
  options: { downloadOnly?: boolean; ownerWindow?: Window } = {},
): Promise<ExportFileSaveResult> {
  const cached = peekCertifiedArtifact();
  if (!cached) throw new Error('No certified export is available to save.');
  if (exportInProgress) throw new Error('A template-set export is already in progress.');
  exportInProgress = true;
  try {
    const writer = await chooseCertifiedArtifactWriter(cached.file.fileName, {
      ...options,
      ownerWindow:
        options.ownerWindow ?? (cached.ownerWindow?.closed ? undefined : cached.ownerWindow),
      ...(cached.file.format === 'html' ? { format: 'html' } : {}),
      ...(cached.file.fileTypes ? { fileTypes: cached.file.fileTypes } : {}),
    });
    const fileName = writer.fileName ?? cached.file.fileName;
    const saveResult = await writer(cached.file.blob);
    completeCertifiedArtifactSave(cached.file, fileName);
    return { format: cached.file.format, fileName, saveResult };
  } finally {
    exportInProgress = false;
  }
}
async function prepareCoordinatedSetExport(
  set: ProjectSetDocument,
  profile: ExportProfile | undefined,
  { format = 'zip', onProgress, signal }: SetPreparationOptions,
): Promise<PreparedSetExport> {
  const buildOptions = onProgress || signal ? { onProgress, signal } : undefined;
  const suffix = profile?.fileNameSuffix ?? '';
  let files: ExportFile[];
  let packaged: Awaited<ReturnType<typeof createCertifiedCoordinatedPackage>>;
  if (format === 'html') {
    const html = buildOptions
      ? await createCertifiedCoordinatedHtml(set, profile, buildOptions)
      : await createCertifiedCoordinatedHtml(set, profile);
    signal?.throwIfAborted();
    packaged = html;
    files = [{ format: 'html', fileName: html.fileName, blob: html.blob }];
  } else {
    packaged = buildOptions
      ? await createCertifiedCoordinatedPackage(set, profile, buildOptions)
      : await createCertifiedCoordinatedPackage(set, profile);
    signal?.throwIfAborted();
    files = [
      { format: 'zip', fileName: getProjectSetExportZipName(set, profile), blob: packaged.blob },
    ];
    if (format === 'both') {
      if (signal) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      files.push(createStandaloneHtmlFile(packaged.artifacts, suffix));
    }
  }
  if (files.some((file) => file.blob.size <= 0))
    throw exportFailure(
      new Error('The coordinated export is empty. No destination file was opened.'),
      'packaging',
    );
  const { compatibility, artifacts } = packaged;
  const file = files[0]!;
  const included = new Set(
    artifacts.transitionDescriptor?.templates.map((template) => template.id),
  );
  const result: ProjectSetExportResult = {
    mode: 'coordinated',
    fileName: file.fileName,
    saveResult: 'prepared',
    files: files.map(({ format, fileName }) => ({ format, fileName, saveResult: 'prepared' })),
    templates: set.templates
      .filter((template) => included.has(template.id))
      .map((template) => ({
        id: template.id,
        name: template.name,
        packagePath: file.fileName,
      })),
    certifications: [],
    compatibility,
    unreferencedTemplates: set.templates
      .filter((template) => !included.has(template.id))
      .map(({ id, name }) => ({ id, name })),
  };
  signal?.throwIfAborted();
  return { files, result };
}

async function exportCoordinatedSet(
  set: ProjectSetDocument,
  profile: ExportProfile | undefined,
  options: SetExportOptions,
): Promise<ProjectSetExportResult> {
  const { format, onProgress, prepareOnly, signal, ...saveOptions } = options;
  const { files, result } = await prepareCoordinatedSetExport(set, profile, {
    format,
    onProgress,
    signal,
  });
  signal?.throwIfAborted();
  const file = files[0]!;
  const owner = saveOptions.ownerWindow ?? (typeof window === 'undefined' ? undefined : window);
  // A Chromium save picker creates a placeholder immediately. Only offer it after the
  // complete certified package exists, and require a fresh click if preparation took
  // longer than the browser's transient user activation.
  if (
    prepareOnly ||
    files.length > 1 ||
    (!saveOptions.downloadOnly &&
      owner?.showSaveFilePicker &&
      owner.navigator?.userActivation?.isActive === false)
  ) {
    stageCertifiedArtifacts(files, result.templates.length, saveOptions.ownerWindow);
    requestCertifiedArtifactSave(file);
    onProgress?.('ready');
    return result;
  }
  onProgress?.('picker');
  signal?.throwIfAborted();
  let writer: Awaited<ReturnType<typeof chooseCertifiedArtifactWriter>>;
  try {
    writer = await chooseCertifiedArtifactWriter(file.fileName, {
      ...saveOptions,
      ...(file.format === 'html' ? { format: 'html' } : {}),
    });
  } catch (error) {
    signal?.throwIfAborted();
    stageCertifiedArtifacts(files, result.templates.length, saveOptions.ownerWindow);
    // Hosts without UserActivation introspection can still reject an expired gesture.
    // Retain the prepared bytes for an explicit Save click; do not fall back to download.
    if (
      error instanceof CoordinatedExportError &&
      error.stage === 'picker' &&
      (error.cause as { name?: string } | undefined)?.name === 'SecurityError'
    ) {
      requestCertifiedArtifactSave(file);
      onProgress?.('ready');
      return result;
    }
    throw error;
  }
  result.fileName = writer.fileName ?? file.fileName;
  signal?.throwIfAborted();
  onProgress?.('write');
  signal?.throwIfAborted();
  stageCertifiedArtifacts(files, result.templates.length, saveOptions.ownerWindow);
  try {
    result.saveResult = await writer(file.blob);
    result.files = [
      { format: file.format, fileName: result.fileName, saveResult: result.saveResult },
    ];
    completeCertifiedArtifactSave(file, result.fileName);
  } catch (error) {
    signal?.throwIfAborted();
    requestCertifiedArtifactSave(file);
    throw error;
  }
  return result;
}

const SET_ZIP_FILE_TYPES = [
  { description: 'OGraf template set export', accept: { 'application/zip': ['.ograf-set.zip'] } },
];

async function prepareIndependentSetExport(
  set: ProjectSetDocument,
  profile: ExportProfile | undefined,
  { onProgress, signal }: SetPreparationOptions,
): Promise<PreparedSetExport> {
  const zip = new JSZip();
  zip.file(STUDIO_RUNTIME_LICENSE_PATH, STUDIO_RUNTIME_LICENSE_TEXT);
  const templates: ProjectSetExportResult['templates'] = [];
  const certifications: ProjectSetExportResult['certifications'] = [];

  for (const [index, template] of set.templates.entries()) {
    if (onProgress) {
      onProgress(`template ${index + 1} of ${set.templates.length}`);
      // Leave a task boundary before resolving and compiling the next template.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    const resolved = resolveProjectSetTemplate(set, template.id);
    const composition = resolved.compositions.find(
      (item) => item.id === resolved.mainCompositionId,
    );
    if (!composition)
      throw new Error(`Template "${template.name}" has no main composition to export.`);

    let packaged: Awaited<ReturnType<typeof createCertifiedProjectPackage>>;
    try {
      packaged = signal
        ? await createCertifiedProjectPackage(resolved, composition, profile, { signal })
        : await createCertifiedProjectPackage(resolved, composition, profile);
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(
        `Template "${template.name}" could not be certified: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    signal?.throwIfAborted();
    const packagePath = `templates/${String(index + 1).padStart(2, '0')}-${fileSlug(template.name)}-${fileSlug(template.id)}.ograf.zip`;
    if (!packaged.blob.size) throw new Error(`Template "${template.name}" produced an empty ZIP.`);
    const bytes = await packaged.blob.arrayBuffer();
    signal?.throwIfAborted();
    zip.file(packagePath, bytes);
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

  onProgress?.('packaging');
  signal?.throwIfAborted();
  const blob = await generateExportZip(zip, signal);
  signal?.throwIfAborted();
  const fileName = getProjectSetExportZipName(set, profile);
  return {
    files: [{ format: 'zip', fileName, blob }],
    result: {
      mode: 'independent',
      fileName,
      saveResult: 'prepared',
      templates,
      certifications,
      files: [{ format: 'zip', fileName, saveResult: 'prepared' }],
    },
  };
}

async function exportIndependentSet(
  set: ProjectSetDocument,
  profile: ExportProfile | undefined,
  options: SetExportOptions,
): Promise<ProjectSetExportResult> {
  const { format: _format, onProgress, prepareOnly, signal, ...saveOptions } = options;
  const { files, result } = await prepareIndependentSetExport(set, profile, { onProgress, signal });
  signal?.throwIfAborted();
  const file = files[0]!;
  let saveResult: ExportFileSaveStatus;
  if (prepareOnly) {
    stageCertifiedArtifacts(
      [{ ...file, fileTypes: SET_ZIP_FILE_TYPES }],
      result.templates.length,
      saveOptions.ownerWindow,
      true,
    );
    saveResult = 'prepared';
    onProgress?.('ready');
  } else {
    saveResult = await saveBlobToFile(
      file.blob,
      file.fileName,
      [{ description: 'OGraf template set export', accept: { 'application/zip': ['.zip'] } }],
      ...(Object.keys(saveOptions).length ? [saveOptions] : []),
    );
  }
  return {
    ...result,
    saveResult,
    files: [{ format: 'zip', fileName: file.fileName, saveResult }],
  };
}
