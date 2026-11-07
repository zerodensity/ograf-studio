export const MEDIA_FILE_ACCEPT = 'video/mp4,video/webm,.mp4,.webm';
export const AUDIO_FILE_ACCEPT = 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg';
export const MAX_MEDIA_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_MEDIA_BATCH_BYTES = 256 * 1024 * 1024;

export interface MediaImportStatus {
  kind: 'info' | 'error';
  message: string;
}

type MediaFileCandidate = Pick<File, 'name' | 'size' | 'type'>;

function mediaExtension(name: string): string {
  return name.split('.').at(-1)?.toLocaleLowerCase() ?? '';
}

export function mediaFileImportError(file: MediaFileCandidate): string | null {
  const supportedMime = file.type === 'video/mp4' || file.type === 'video/webm';
  const supportedExtension = ['mp4', 'webm'].includes(mediaExtension(file.name));
  if (!supportedMime && !supportedExtension) {
    return `${file.name} is not a supported video. Import an MP4 or WebM clip.`;
  }
  if (file.size <= 0) return `${file.name} is empty and cannot be imported.`;
  if (file.size > MAX_MEDIA_FILE_BYTES) {
    return `${file.name} exceeds the 128 MiB per-clip safety limit. Trim or transcode it before importing.`;
  }
  return null;
}

export function mediaFileBatchImportError(files: MediaFileCandidate[]): string | null {
  for (const file of files) {
    const problem = mediaFileImportError(file);
    if (problem) return problem;
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_MEDIA_BATCH_BYTES) {
    return 'The selected clips exceed the 256 MiB batch safety limit. Import fewer clips at a time.';
  }
  return null;
}

export function audioFileImportError(file: MediaFileCandidate): string | null {
  const supportedMime = ['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(file.type);
  const supportedExtension = ['mp3', 'wav', 'ogg'].includes(mediaExtension(file.name));
  if (!supportedMime && !supportedExtension) {
    return `${file.name} is not supported audio. Import MP3, WAV, or OGG.`;
  }
  if (file.size <= 0) return `${file.name} is empty and cannot be imported.`;
  if (file.size > MAX_MEDIA_FILE_BYTES) {
    return `${file.name} exceeds the 128 MiB per-clip safety limit. Trim or transcode it before importing.`;
  }
  return null;
}

export function audioFileBatchImportError(files: MediaFileCandidate[]): string | null {
  for (const file of files) {
    const problem = audioFileImportError(file);
    if (problem) return problem;
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_MEDIA_BATCH_BYTES) {
    return 'The selected audio files exceed the 256 MiB batch safety limit. Import fewer clips at a time.';
  }
  return null;
}
