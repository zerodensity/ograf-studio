import { homedir, networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { OGRAF_CLIENT_SETUP } from '@ograf-editor/agent-tools';

export interface StandaloneServerOptions {
  port: number;
  workspaceRoot: string;
  openBrowser: boolean;
  help: boolean;
  printSetupPrompt?: true;
  exportSkillPath?: string;
  playout?: { host: string; port: number };
}

export const OGRAF_STUDIO_STANDALONE_VERSION = '0.33.0';
export const OGRAF_STUDIO_REPOSITORY_URL = 'https://github.com/zerodensity/ograf-studio';
const ZERO_DENSITY_OD_ASCII = [
  '   ##########      ##########',
  ' ################  ############',
  '################## #############',
  '######      ###### ##############',
  '#####        #####   ############',
  '#####        #####     ##########',
  '#####        #####   ############',
  '######      ###### ##############',
  '################## #############',
  ' ################  ############',
  '   ##########      ##########',
];
const OGS_ASCII_WIDTH = 21;
const centerOgsAscii = (line: string) =>
  `${' '.repeat(Math.floor((OGS_ASCII_WIDTH - line.length) / 2))}${line}`;
export const OGRAF_STUDIO_ASCII_ART = [
  '/-----------------\\',
  '/---------------\\',
  '/-------------\\',
  '/-----------\\',
  '/---------\\',
  '/-------\\',
  'O    G    S',
  '/|\\',
  '/ | \\',
  '/  |  \\',
  '/___|___\\',
]
  .map(centerOgsAscii)
  .join('\n');
export const ZERO_DENSITY_ASCII_ART = ZERO_DENSITY_OD_ASCII.map(
  (line, index) => `${line.padEnd(35)}    ${OGRAF_STUDIO_ASCII_ART.split('\n')[index]}`,
).join('\n');

export function standaloneExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'OGrafStudioServer.exe' : 'OGrafStudioServer';
}

function readValue(args: string[], index: number, flag: string): [string, number] {
  const argument = args[index]!;
  if (argument.startsWith(`${flag}=`)) {
    const inline = argument.slice(flag.length + 1);
    if (!inline) throw new Error(`${flag} requires a value.`);
    return [inline, index];
  }
  const next = args[index + 1];
  if (!next || next.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return [next, index + 1];
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Port must be an integer from 1 to 65535, received "${value}".`);
  }
  return port;
}

function parsePlayoutHost(value: string): string {
  const family = isIP(value);
  if (!family || value.includes('%'))
    throw new Error('--playout-host must be a literal IP address.');
  const host = new URL(`http://${family === 6 ? `[${value}]` : value}`).hostname;
  if (host === '0.0.0.0' || host === '[::]')
    throw new Error('--playout-host must name the interface IP used in preview links.');
  return family === 6 ? host.slice(1, -1) : host;
}

function defaultPlayoutHost(interfaces: ReturnType<typeof networkInterfaces>): string {
  for (const addresses of Object.values(interfaces)) {
    for (const entry of addresses ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      const [first, second = 0] = entry.address.split('.').map(Number);
      if (
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      )
        return entry.address;
    }
  }
  return '127.0.0.1';
}

export function defaultStandaloneWorkspaceRoot(
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string {
  return resolve(
    environment.OGRAF_WORKSPACE_ROOT ?? userHome,
    ...(environment.OGRAF_WORKSPACE_ROOT ? [] : ['Documents', 'OGraf Studio', 'Projects']),
  );
}

export function parseStandaloneServerOptions(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
  interfaces = networkInterfaces(),
): StandaloneServerOptions {
  let port = parsePort(environment.OGRAF_MCP_PORT ?? '4318');
  let workspaceRoot = defaultStandaloneWorkspaceRoot(environment, userHome);
  let openBrowser = false;
  let help = false;
  let printSetupPrompt: true | undefined;
  let exportSkillPath: string | undefined;
  let playoutPort: number | undefined;
  let playoutHost: string | undefined;
  let noPlayout = false;
  const { exportFlag, promptFlag } = OGRAF_CLIENT_SETUP;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? '';
    if (argument === '--open') {
      openBrowser = true;
      continue;
    }
    if (argument === '--no-open') {
      openBrowser = false;
      continue;
    }
    if (argument === '--no-playout') {
      noPlayout = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === promptFlag) {
      printSetupPrompt = true;
      continue;
    }
    if (argument === exportFlag || argument.startsWith(`${exportFlag}=`)) {
      const [value, consumedIndex] = readValue(args, index, exportFlag);
      exportSkillPath = resolve(value);
      index = consumedIndex;
      continue;
    }
    if (argument === '--port' || argument.startsWith('--port=')) {
      const [value, consumedIndex] = readValue(args, index, '--port');
      port = parsePort(value);
      index = consumedIndex;
      continue;
    }
    if (argument === '--playout-port' || argument.startsWith('--playout-port=')) {
      const [value, consumedIndex] = readValue(args, index, '--playout-port');
      playoutPort = parsePort(value);
      index = consumedIndex;
      continue;
    }
    if (argument === '--playout-host' || argument.startsWith('--playout-host=')) {
      const [value, consumedIndex] = readValue(args, index, '--playout-host');
      playoutHost = parsePlayoutHost(value);
      index = consumedIndex;
      continue;
    }
    if (argument === '--workspace' || argument.startsWith('--workspace=')) {
      const [value, consumedIndex] = readValue(args, index, '--workspace');
      workspaceRoot = resolve(value);
      index = consumedIndex;
      continue;
    }
    throw new Error(`Unknown option "${argument}". Use --help to list supported options.`);
  }

  if (printSetupPrompt && exportSkillPath)
    throw new Error(`Choose either ${promptFlag} or ${exportFlag}.`);
  if (noPlayout && (playoutHost || playoutPort))
    throw new Error('--no-playout cannot be combined with a shared playout address or port.');
  if (playoutPort === port)
    throw new Error('--playout-port must differ from the editor and MCP port.');
  const defaultPlayoutPort = port <= 65_533 ? port + 2 : port - 2;
  return {
    port,
    workspaceRoot,
    openBrowser,
    help,
    ...(printSetupPrompt ? { printSetupPrompt } : {}),
    ...(exportSkillPath ? { exportSkillPath } : {}),
    ...(!noPlayout
      ? {
          playout: {
            host: playoutHost ?? defaultPlayoutHost(interfaces),
            port: playoutPort ?? defaultPlayoutPort,
          },
        }
      : {}),
  };
}

export const STANDALONE_HELP = `OGraf Studio ${OGRAF_STUDIO_STANDALONE_VERSION} standalone server

Usage: ${standaloneExecutableName()} [options]

Options:
  --port <number>       HTTP/MCP port (default: 4318)
  --playout-port <number>  Live preview port (default: editor port + 2)
  --playout-host <IP>      Live preview interface IP (default: private LAN IPv4 or loopback)
  --no-playout            Disable the live preview listener
  --workspace <path>   Writable project workspace
  --open               Open the editor in the default browser
  --no-open            Do not open a browser (default)
  ${OGRAF_CLIENT_SETUP.promptFlag}  Print the AI setup prompt and exit
  ${OGRAF_CLIENT_SETUP.exportFlag} <file> Export the bundled authoring skill ZIP to a new file and exit
  --help, -h           Show this help

Repository: ${OGRAF_STUDIO_REPOSITORY_URL}

Environment variables OGRAF_MCP_PORT and OGRAF_WORKSPACE_ROOT remain supported.
The editor and MCP listener binds to 127.0.0.1 only.`;
