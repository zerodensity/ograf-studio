import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBuildRevision } from '../../buildRevision';

describe('Studio build metadata', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the injected public repository version and ISO build date', async () => {
    const rootPackage = JSON.parse(
      readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    vi.stubGlobal('__OGRAF_STUDIO_VERSION__', rootPackage.version);
    vi.stubGlobal('__OGRAF_STUDIO_BUILD_DATE__', '2026-09-26');
    vi.stubGlobal('__OGRAF_STUDIO_BUILD_REVISION__', '1234abcd');
    const { STUDIO_BUILD_DATE, STUDIO_BUILD_REVISION, STUDIO_VERSION } =
      await import('./buildInfo');

    expect(STUDIO_VERSION).toBe(rootPackage.version);
    expect(STUDIO_BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(STUDIO_BUILD_REVISION).toBe('1234abcd');
  });

  it('uses a reproducible override before the current checkout', () => {
    const readGit = vi.fn(() => 'bbbbbbbb');
    expect(resolveBuildRevision('ABCDEF1234567890', readGit)).toBe('abcdef12');
    expect(readGit).not.toHaveBeenCalled();
    expect(resolveBuildRevision('invalid', readGit)).toBe('unknown');
    expect(readGit).not.toHaveBeenCalled();
  });

  it('uses Git if available and degrades safely without it', () => {
    expect(resolveBuildRevision(undefined, () => '12345678\n')).toBe('12345678');
    expect(resolveBuildRevision(undefined, () => 'not a revision')).toBe('unknown');
    expect(
      resolveBuildRevision(undefined, () => {
        throw new Error('Git unavailable');
      }),
    ).toBe('unknown');
  });

  it('stacks version and build date on separate Window-menu rows', () => {
    const css = readFileSync(new URL('../panels/Menubar.css', import.meta.url), 'utf8');
    const menu = readFileSync(new URL('../panels/Menubar.tsx', import.meta.url), 'utf8');

    expect(css).toMatch(
      /\.menubar-build-info\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(css).toMatch(/\.menubar-build-info time\s*\{[^}]*display:\s*block;/s);
    expect(menu).toContain('href="https://github.com/zerodensity/ograf-studio"');
    expect(menu).toContain('target="_blank"');
    expect(menu).toContain('rel="noopener noreferrer"');
  });
});
