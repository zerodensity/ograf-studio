import { describe, expect, it } from 'vitest';
import {
  defaultStandaloneWorkspaceRoot,
  OGRAF_STUDIO_ASCII_ART,
  OGRAF_STUDIO_REPOSITORY_URL,
  OGRAF_STUDIO_STANDALONE_VERSION,
  parseStandaloneServerOptions,
  standaloneExecutableName,
  STANDALONE_HELP,
  ZERO_DENSITY_ASCII_ART,
} from './standaloneConfig';

describe('standalone server configuration', () => {
  it('uses an isolated writable user workspace without changing the source MCP default', () => {
    expect(defaultStandaloneWorkspaceRoot({}, 'C:\\Users\\operator')).toBe(
      'C:\\Users\\operator\\Documents\\OGraf Studio\\Projects',
    );
    expect(
      defaultStandaloneWorkspaceRoot(
        { OGRAF_WORKSPACE_ROOT: 'D:\\Broadcast\\Projects' },
        'C:\\Users\\operator',
      ),
    ).toBe('D:\\Broadcast\\Projects');
  });

  it('parses explicit port, workspace, and browser options', () => {
    expect(
      parseStandaloneServerOptions(
        ['--port=4400', '--workspace', 'D:\\Shows', '--open'],
        {},
        'C:\\Users\\operator',
      ),
    ).toEqual({
      port: 4400,
      workspaceRoot: 'D:\\Shows',
      openBrowser: true,
      help: false,
    });
  });

  it('rejects invalid ports and unknown options', () => {
    expect(() => parseStandaloneServerOptions(['--port', '0'], {})).toThrow(/1 to 65535/);
    expect(() => parseStandaloneServerOptions(['--network'], {})).toThrow(/Unknown option/);
  });

  it('includes the product version in standalone output', () => {
    expect(OGRAF_STUDIO_STANDALONE_VERSION).toBe('0.11');
    expect(STANDALONE_HELP).toContain('OGraf Studio 0.11 standalone server');
  });

  it('provides compact ASCII-only Zero Density and repository branding', () => {
    expect(OGRAF_STUDIO_REPOSITORY_URL).toBe('https://github.com/zerodensity/ograf-studio');
    expect(STANDALONE_HELP).toContain(OGRAF_STUDIO_REPOSITORY_URL);
    expect(ZERO_DENSITY_ASCII_ART).toMatch(/^[\x20-\x7e\n]+$/);
    expect(ZERO_DENSITY_ASCII_ART.split('\n')).toHaveLength(11);
    expect(ZERO_DENSITY_ASCII_ART).toContain('O    G    S');
    expect(Math.max(...ZERO_DENSITY_ASCII_ART.split('\n').map((line) => line.length))).toBeLessThan(
      80,
    );
    for (const line of OGRAF_STUDIO_ASCII_ART.split('\n')) {
      const visible = line.trimStart();
      const centerColumn = line.length - visible.length + (visible.length - 1) / 2;
      expect(centerColumn).toBe(10);
    }
  });

  it('uses a platform-appropriate executable name in help output', () => {
    expect(standaloneExecutableName('win32')).toBe('OGrafStudioServer.exe');
    expect(standaloneExecutableName('darwin')).toBe('OGrafStudioServer');
    expect(standaloneExecutableName('linux')).toBe('OGrafStudioServer');
  });
});
