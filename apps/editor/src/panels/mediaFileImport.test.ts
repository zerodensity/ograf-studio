import { describe, expect, it } from 'vitest';
import {
  audioFileBatchImportError,
  audioFileImportError,
  MAX_MEDIA_FILE_BYTES,
  mediaFileBatchImportError,
  mediaFileImportError,
} from './mediaFileImport';

const candidate = (overrides: Partial<{ name: string; size: number; type: string }> = {}) => ({
  name: 'clip.mp4',
  size: 1024,
  type: 'video/mp4',
  ...overrides,
});

describe('media file import guard', () => {
  it('accepts MP4 and WebM even when Windows omits the MIME type', () => {
    expect(mediaFileImportError(candidate())).toBeNull();
    expect(mediaFileImportError(candidate({ name: 'clip.webm', type: '' }))).toBeNull();
  });

  it('rejects unsupported, empty, and unsafe individual files', () => {
    expect(mediaFileImportError(candidate({ name: 'clip.mov', type: 'video/quicktime' }))).toMatch(
      /MP4 or WebM/,
    );
    expect(mediaFileImportError(candidate({ size: 0 }))).toMatch(/empty/);
    expect(mediaFileImportError(candidate({ size: MAX_MEDIA_FILE_BYTES + 1 }))).toMatch(/128 MiB/);
  });

  it('limits the total memory pressure of a multi-file import', () => {
    expect(
      mediaFileBatchImportError([
        candidate({ name: 'one.mp4', size: MAX_MEDIA_FILE_BYTES - 1 }),
        candidate({ name: 'two.mp4', size: MAX_MEDIA_FILE_BYTES - 1 }),
        candidate({ name: 'three.mp4', size: MAX_MEDIA_FILE_BYTES - 1 }),
      ]),
    ).toMatch(/256 MiB/);
  });

  it('accepts MP3/WAV/OGG audio and applies the same memory limits', () => {
    expect(audioFileImportError(candidate({ name: 'theme.mp3', type: 'audio/mpeg' }))).toBeNull();
    expect(audioFileImportError(candidate({ name: 'theme.wav', type: '' }))).toBeNull();
    expect(audioFileImportError(candidate({ name: 'theme.aac', type: 'audio/aac' }))).toMatch(
      /MP3, WAV, or OGG/,
    );
    expect(
      audioFileBatchImportError([
        candidate({ name: 'one.mp3', type: 'audio/mpeg', size: MAX_MEDIA_FILE_BYTES }),
        candidate({ name: 'two.ogg', type: 'audio/ogg', size: MAX_MEDIA_FILE_BYTES }),
        candidate({ name: 'three.wav', type: 'audio/wav', size: 1 }),
      ]),
    ).toMatch(/256 MiB/);
  });
});
