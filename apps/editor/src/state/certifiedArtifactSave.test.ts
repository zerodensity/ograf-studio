import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseCertifiedArtifactWriter } from './certifiedArtifactSave';
afterEach(() => vi.unstubAllGlobals());
function fixture(failure?: string, saved = 'certified') {
  const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn().mockResolvedValue(undefined) };
  if (failure) writable.write.mockRejectedValue(new DOMException('disk failure', failure));
  const picker = vi.fn().mockResolvedValue({
    createWritable: async () => writable,
    getFile: async () => new Blob([saved]),
  });
  const download = vi.fn();
  vi.stubGlobal('window', { showSaveFilePicker: picker, document: { createElement: download } });
  return { picker, writable, download };
}
describe('certified coordinated save', () => {
  it('opens the picker during invocation and reports success only after close and byte verification', async () => {
    const { picker, writable } = fixture();
    const pending = chooseCertifiedArtifactWriter('news.ograf.zip');
    expect(picker).toHaveBeenCalledOnce();
    const writer = await pending;
    expect(writable.write).not.toHaveBeenCalled();
    await expect(writer(new Blob(['certified']))).resolves.toBe('saved');
    expect(writable.close).toHaveBeenCalledOnce();
  });
  it.each(['AbortError', 'NotAllowedError', 'UnknownError'])(
    'preserves %s during writing and never falls back to download',
    async (name) => {
      const { writable, download } = fixture(name);
      const writer = await chooseCertifiedArtifactWriter('news.ograf.zip');
      await expect(writer(new Blob(['certified']))).rejects.toMatchObject({
        stage: 'write',
        outcome: name === 'NotAllowedError' ? 'permission-denied' : 'write-failed',
      });
      expect(writable.abort).toHaveBeenCalledOnce();
      expect(download).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['AbortError', 'user-cancelled'],
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'picker-unavailable'],
  ])('classifies picker %s', async (name, outcome) => {
    const { picker } = fixture();
    picker.mockRejectedValue(new DOMException('picker error', name));
    await expect(chooseCertifiedArtifactWriter('news.ograf.zip')).rejects.toMatchObject({
      stage: 'picker',
      outcome,
    });
  });
  it('rejects output bytes that differ from the certified artifact', async () => {
    fixture(undefined, 'corrupt');
    const writer = await chooseCertifiedArtifactWriter('news.ograf.zip');
    await expect(writer(new Blob(['certified']))).rejects.toMatchObject({
      stage: 'write',
      outcome: 'write-failed',
    });
  });
});
