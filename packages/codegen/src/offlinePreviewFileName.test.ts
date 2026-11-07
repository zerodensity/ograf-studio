import { describe, expect, it } from 'vitest';
import {
  assertOfflinePreviewFileAvailable,
  getOfflinePreviewFileName,
} from './offlinePreviewFileName';

const named = (name: string) =>
  getOfflinePreviewFileName({ manifest: { name } } as Parameters<
    typeof getOfflinePreviewFileName
  >[0]);

describe('offline preview filenames', () => {
  it('uses the graphic name and preserves Unicode', () => {
    expect(named('Signal Blue')).toBe('Signal Blue.html');
    expect(named('AXIS Markets / 01 · AXIS Identity & UTC')).toBe(
      'AXIS Markets - 01 · AXIS Identity & UTC.html',
    );
    expect(named('İstanbul — Piyasa 📈')).toBe('İstanbul — Piyasa 📈.html');
    expect(named('Already.html')).toBe('Already.html');
  });

  it.each(['CON', 'nul', 'COM1', 'LPT9', 'AUX.report', 'COM¹'])(
    'avoids reserved Windows names: %s',
    (value) => {
      expect(named(value)).toBe(`_${value}.html`);
    },
  );

  it('bounds names without splitting Unicode and cannot escape the package root', () => {
    expect(named('../A\\B:<C>|?*\u0000')).toBe('-A-B--C-----.html');
    expect(named('... ')).toBe('OGraf Preview.html');
    const name = named('📈'.repeat(200));
    expect(name.length).toBeLessThanOrEqual(165);
    expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(205);
    expect(new TextEncoder().encode(named('市'.repeat(200))).byteLength).toBeLessThanOrEqual(205);
    expect(name).not.toMatch(/[\ud800-\udbff]\.html$/);
    expect(name).not.toMatch(/[\\/]/);
  });

  it.each([
    'SIGNAL BLUE.HTML',
    'Signal Blue.html/asset.png',
    'signal blue.HTML. /asset.png',
    'Signal Blue.html\\asset.png',
  ])('refuses Windows file or directory collisions: %s', (path) => {
    expect(() => assertOfflinePreviewFileAvailable([path], 'Signal Blue.html')).toThrow(
      'package already contains Signal Blue.html',
    );
  });

  it('allows unrelated package HTML files', () => {
    expect(() =>
      assertOfflinePreviewFileAvailable(
        ['index.html', 'assets/Signal Blue.html'],
        'Signal Blue.html',
      ),
    ).not.toThrow();
  });
});
