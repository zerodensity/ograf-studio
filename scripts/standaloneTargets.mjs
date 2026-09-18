const targets = [
  {
    platform: 'windows',
    target: 'bun-windows-x64-baseline',
    file: 'OGrafStudioServer.exe',
    format: 'pe',
    architecture: 'x64',
  },
  {
    platform: 'macos',
    target: 'bun-darwin-x64',
    file: 'OGrafStudioServer-macos-x64',
    format: 'mach-o',
    architecture: 'x64',
  },
  {
    platform: 'macos',
    target: 'bun-darwin-arm64',
    file: 'OGrafStudioServer-macos-arm64',
    format: 'mach-o',
    architecture: 'arm64',
  },
  {
    platform: 'linux',
    target: 'bun-linux-x64',
    file: 'OGrafStudioServer-linux-x64',
    format: 'elf',
    architecture: 'x64',
  },
  {
    platform: 'linux',
    target: 'bun-linux-arm64',
    file: 'OGrafStudioServer-linux-arm64',
    format: 'elf',
    architecture: 'arm64',
  },
];

export function selectedStandaloneTargets() {
  const platforms = (process.env.OGRAF_STANDALONE_PLATFORMS ?? 'windows,macos,linux')
    .split(',')
    .map((value) => value.trim());
  if (platforms.some((platform) => !['windows', 'macos', 'linux'].includes(platform)))
    throw new Error('OGRAF_STANDALONE_PLATFORMS must list windows, macos, and/or linux.');
  return targets.filter((target) => platforms.includes(target.platform));
}
