import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface StandaloneServerOptions {
  port: number;
  workspaceRoot: string;
  openBrowser: boolean;
  help: boolean;
}

export const OGRAF_STUDIO_STANDALONE_VERSION = '0.14';
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
  const inline = args[index]?.slice(flag.length + 1);
  if (inline) return [inline, index];
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
): StandaloneServerOptions {
  let port = parsePort(environment.OGRAF_MCP_PORT ?? '4318');
  let workspaceRoot = defaultStandaloneWorkspaceRoot(environment, userHome);
  let openBrowser = false;
  let help = false;

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
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--port' || argument.startsWith('--port=')) {
      const [value, consumedIndex] = readValue(args, index, '--port');
      port = parsePort(value);
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

  return { port, workspaceRoot, openBrowser, help };
}

export const STANDALONE_HELP = `OGraf Studio ${OGRAF_STUDIO_STANDALONE_VERSION} standalone server

Usage: ${standaloneExecutableName()} [options]

Options:
  --port <number>       HTTP/MCP port (default: 4318)
  --workspace <path>   Writable project workspace
  --open               Open the editor in the default browser
  --no-open            Do not open a browser (default)
  --help, -h           Show this help

Repository: ${OGRAF_STUDIO_REPOSITORY_URL}

Environment variables OGRAF_MCP_PORT and OGRAF_WORKSPACE_ROOT remain supported.
The standalone server binds to 127.0.0.1 only.`;
