import type JSZip from 'jszip';

/** Keep compression interruptible while a Studio export is preparing. */
export async function generateExportZip(zip: JSZip, signal?: AbortSignal): Promise<Blob> {
  if (!signal) return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stream = zip.generateInternalStream({
      type: 'uint8array',
      compression: 'DEFLATE',
      streamFiles: true,
    });
    const chunks: BlobPart[] = [];
    const stop = () => {
      stream.pause();
      chunks.length = 0;
      reject(signal.reason);
    };
    signal.addEventListener('abort', stop, { once: true });
    stream
      .on('data', (chunk) => {
        if (signal.aborted) {
          // JSZip resumes on its own task. Stop again if cancellation preceded that task.
          stream.pause();
          return;
        }
        chunks.push(chunk as Uint8Array<ArrayBuffer>);
      })
      .on('error', (error) => {
        signal.removeEventListener('abort', stop);
        chunks.length = 0;
        reject(error);
      })
      .on('end', () => {
        signal.removeEventListener('abort', stop);
        if (signal.aborted) return;
        try {
          resolve(new Blob(chunks, { type: 'application/zip' }));
        } catch (error) {
          reject(error);
        } finally {
          chunks.length = 0;
        }
      })
      .resume();
  });
}
