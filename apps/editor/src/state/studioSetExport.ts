import type { ExportProfile } from '@ograf-editor/codegen';
import { useExportPreparationStore } from './exportPreparationStore';
import type { ExportFileFormat } from './offlinePreviewPackage';
import type { ProjectSetDocument } from './projectSet';
import { exportProjectSetAsZip } from './projectSetExport';

const progressMessages: Record<string, string> = {
  compilation: 'Building the coordinated graphic…',
  thumbnail: 'Rendering the preview thumbnail…',
  certification: 'Checking OGraf compatibility…',
  packaging: 'Assembling the export files…',
  ready: 'Export files verified.',
  picker: 'Preparing the download…',
  write: 'Sending the file to the browser…',
};

/** Leave a render opportunity before cloning a large set or starting compilation. */
function allowExportDialogPaint(ownerWindow: Window, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let frame: number | undefined;
    const done = () => {
      if (!ownerWindow.closed && frame !== undefined) ownerWindow.cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      signal.removeEventListener('abort', done);
      resolve();
    };
    // A detached or background window may not receive animation frames.
    const visible = !ownerWindow.closed && ownerWindow.document.visibilityState === 'visible';
    const fallback = window.setTimeout(done, visible ? 150 : 0);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
    else if (visible) {
      frame = ownerWindow.requestAnimationFrame(() => {
        frame = ownerWindow.requestAnimationFrame(done);
      });
    }
  });
}

export async function exportSetInStudio(
  set: ProjectSetDocument,
  profile: ExportProfile | undefined,
  options: { ownerWindow: Window; format?: ExportFileFormat; downloadOnly?: boolean },
) {
  const { ownerWindow, downloadOnly } = options;
  const preparation = useExportPreparationStore.getState();
  const { id, signal } = preparation.start({
    ownerWindow,
    name: set.name,
    templateCount: set.templates.length,
  });
  try {
    await allowExportDialogPaint(ownerWindow, signal);
    signal.throwIfAborted();
    const result = await exportProjectSetAsZip(set, profile, {
      ...options,
      prepareOnly: !downloadOnly,
      signal,
      onProgress: (stage) =>
        preparation.update(id, progressMessages[stage] ?? `Certifying ${stage}…`),
    });
    preparation.finish(id);
    return result;
  } catch (error) {
    if (signal.aborted) {
      preparation.finish(id);
      return null;
    }
    preparation.fail(id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
