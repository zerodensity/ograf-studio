import { resolve } from 'node:path';
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
    const operatorHome = resolve('fixtures', 'operator-home');
    const configuredRoot = resolve('fixtures', 'broadcast-projects');
    expect(defaultStandaloneWorkspaceRoot({}, operatorHome)).toBe(
      resolve(operatorHome, 'Documents', 'OGraf Studio', 'Projects'),
    );
    expect(
      defaultStandaloneWorkspaceRoot({ OGRAF_WORKSPACE_ROOT: configuredRoot }, operatorHome),
    ).toBe(configuredRoot);
  });

  it('parses explicit port, workspace, and browser options', () => {
    const workspaceRoot = resolve('fixtures', 'shows');
    expect(
      parseStandaloneServerOptions(
        ['--port=4400', '--workspace', workspaceRoot, '--open'],
        {},
        resolve('fixtures', 'operator-home'),
        {},
      ),
    ).toEqual({
      port: 4400,
      workspaceRoot,
      openBrowser: true,
      help: false,
      playout: { host: '127.0.0.1', port: 4402 },
    });
  });

  it('rejects invalid ports and unknown options', () => {
    expect(() => parseStandaloneServerOptions(['--port', '0'], {})).toThrow(/1 to 65535/);
    expect(() => parseStandaloneServerOptions(['--network'], {})).toThrow(/Unknown option/);
  });

  it('defaults to a separate preview listener on a private LAN IP or loopback', () => {
    const ipv4 = {
      family: 'IPv4' as const,
      address: '192.168.0.4',
      netmask: '255.255.255.0',
      internal: false,
      cidr: '192.168.0.4/24',
      mac: '00:00:00:00:00:00',
    };
    expect(
      parseStandaloneServerOptions([], {}, undefined, {
        Public: [{ ...ipv4, address: '203.0.113.4' }],
        Ethernet: [ipv4],
      }).playout,
    ).toEqual({
      host: '192.168.0.4',
      port: 4320,
    });
    expect(parseStandaloneServerOptions([], {}, undefined, {}).playout).toEqual({
      host: '127.0.0.1',
      port: 4320,
    });
    expect(parseStandaloneServerOptions(['--port=65535'], {}, undefined, {}).playout?.port).toBe(
      65533,
    );
  });

  it('allows a custom playout interface and port or a disabled listener', () => {
    expect(parseStandaloneServerOptions(['--no-playout'], {}).playout).toBeUndefined();
    expect(
      parseStandaloneServerOptions(['--playout-port=4401'], {}, undefined, {}).playout,
    ).toEqual({
      host: '127.0.0.1',
      port: 4401,
    });
    expect(
      parseStandaloneServerOptions(['--playout-port', '4401', '--playout-host', '192.168.0.4'], {})
        .playout,
    ).toEqual({ host: '192.168.0.4', port: 4401 });
    expect(
      parseStandaloneServerOptions(['--playout-port=4401', '--playout-host=::1'], {}).playout,
    ).toEqual({ host: '::1', port: 4401 });
    expect(() => parseStandaloneServerOptions(['--playout-port=4318'], {})).toThrow(/differ/);
    expect(parseStandaloneServerOptions(['--playout-host=192.168.0.4'], {}).playout).toEqual({
      host: '192.168.0.4',
      port: 4320,
    });
    expect(() => parseStandaloneServerOptions(['--no-playout', '--playout-port=4401'], {})).toThrow(
      /cannot be combined/,
    );
    expect(() =>
      parseStandaloneServerOptions(['--playout-port=4401', '--playout-host=localhost'], {}),
    ).toThrow(/literal IP/);
    expect(() =>
      parseStandaloneServerOptions(['--playout-port=4401', '--playout-host=0.0.0.0'], {}),
    ).toThrow(/interface IP/);
  });

  it('parses setup commands and retains the requested prompt port', () => {
    expect(
      parseStandaloneServerOptions(['--print-setup-prompt', '--port', '4400'], {}),
    ).toMatchObject({
      printSetupPrompt: true,
      port: 4400,
    });
    expect(parseStandaloneServerOptions(['--export-skill=My Skill.zip'], {})).toMatchObject({
      exportSkillPath: resolve('My Skill.zip'),
    });
    expect(() => parseStandaloneServerOptions(['--export-skill='], {})).toThrow(/requires a value/);
    expect(() =>
      parseStandaloneServerOptions(['--export-skill', 'skill.zip', '--print-setup-prompt'], {}),
    ).toThrow(/Choose either/);
  });

  it('includes the product version in standalone output', () => {
    expect(OGRAF_STUDIO_STANDALONE_VERSION).toBe('0.33.0');
    expect(STANDALONE_HELP).toContain('OGraf Studio 0.33.0 standalone server');
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
