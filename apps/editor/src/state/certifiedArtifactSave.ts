export class CoordinatedExportError extends Error {
  readonly outcome: string;
  readonly stage: string;
  constructor(outcome: string, stage: string, cause: unknown) {
    super(`${outcome} (${stage}): ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = 'CoordinatedExportError';
    this.outcome = outcome;
    this.stage = stage;
  }
}
export function exportFailure(error: unknown, stage: string): CoordinatedExportError {
  if (error instanceof CoordinatedExportError) return error;
  const name = (error as { name?: string })?.name;
  return new CoordinatedExportError(
    stage === 'picker' && name === 'AbortError'
      ? 'user-cancelled'
      : name === 'NotAllowedError'
        ? 'permission-denied'
        : stage === 'picker'
          ? 'picker-unavailable'
          : `${stage}-failed`,
    stage,
    error,
  );
}
export type CertifiedArtifactWriter = ((blob: Blob) => Promise<'saved' | 'downloaded'>) & {
  fileName?: string;
};
/** Invoke only for complete artifact bytes; callers must preserve fresh picker activation. */
export async function chooseCertifiedArtifactWriter(
  fileName: string,
  options: { downloadOnly?: boolean; ownerWindow?: Window } = {},
): Promise<CertifiedArtifactWriter> {
  const owner = options.ownerWindow ?? window;
  if (!options.downloadOnly && owner.showSaveFilePicker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await owner.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'Coordinated OGraf package',
            accept: { 'application/zip': ['.ograf.zip'] },
          },
        ],
      });
    } catch (error) {
      throw exportFailure(error, 'picker');
    }
    const writer: CertifiedArtifactWriter = async (blob) => {
      let writable: FileSystemWritableFileStream | undefined;
      try {
        writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        const saved = await handle.getFile();
        const [expected, actual] = await Promise.all([
          crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
          crypto.subtle.digest('SHA-256', await saved.arrayBuffer()),
        ]);
        if (String(new Uint8Array(expected)) !== String(new Uint8Array(actual)))
          throw new Error('Saved package checksum differs from the certified artifact.');
        return 'saved';
      } catch (error) {
        await writable?.abort().catch(() => undefined);
        throw exportFailure(error, 'write');
      }
    };
    writer.fileName = handle.name || fileName;
    return writer;
  }
  return async (blob) => {
    try {
      const url = URL.createObjectURL(blob);
      const anchor = owner.document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      owner.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return 'downloaded'; // Browser delivery requested; destination cannot be verified.
    } catch (error) {
      throw exportFailure(error, 'write');
    }
  };
}
