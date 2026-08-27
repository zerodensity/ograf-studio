import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AgentProvider = 'anthropic' | 'openai-compatible';

export interface AgentProviderConfig {
  provider: AgentProvider;
  baseUrl: string;
  model: string;
  cheapModel?: string;
  apiKey: string;
  organization?: string;
  project?: string;
  effort: 'low' | 'medium' | 'high';
}

const CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OGCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  [DllImport("advapi32", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, uint type, int flags, out IntPtr credential);
  [DllImport("advapi32", SetLastError=true)] public static extern void CredFree(IntPtr credential);
}
'@
$pointer = [IntPtr]::Zero
if (-not [OGCredential]::CredRead($env:OGRAF_CREDENTIAL_TARGET, 1, 0, [ref]$pointer)) { exit 2 }
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][OGCredential+CREDENTIAL])
  if ($credential.CredentialBlobSize -eq 0) { exit 3 }
  [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2))
} finally { [OGCredential]::CredFree($pointer) }
`;

async function readWindowsCredential(target: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CREDENTIAL_SCRIPT],
      { env: { ...process.env, OGRAF_CREDENTIAL_TARGET: target }, windowsHide: true },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function loadAgentProviderConfig(): Promise<AgentProviderConfig | null> {
  const providerValue = process.env.OGRAF_AGENT_PROVIDER?.trim().toLowerCase();
  const provider: AgentProvider | null =
    providerValue === 'anthropic' || providerValue === 'openai-compatible' ? providerValue : null;
  const baseUrl = process.env.OGRAF_AGENT_BASE_URL?.trim();
  const model = process.env.OGRAF_AGENT_MODEL?.trim();
  if (!provider || !baseUrl || !model) return null;
  const credentialTarget =
    process.env.OGRAF_AGENT_CREDENTIAL_TARGET?.trim() || `OGraf Studio/${provider}`;
  const apiKey =
    (await readWindowsCredential(credentialTarget)) ?? process.env.OGRAF_AGENT_API_KEY?.trim();
  if (!apiKey) return null;
  const effortValue = process.env.OGRAF_AGENT_EFFORT?.trim().toLowerCase();
  const effort = effortValue === 'low' || effortValue === 'high' ? effortValue : 'medium';
  return {
    provider,
    baseUrl: baseUrl.replace(/\/$/, ''),
    model,
    ...(process.env.OGRAF_AGENT_CHEAP_MODEL?.trim()
      ? { cheapModel: process.env.OGRAF_AGENT_CHEAP_MODEL.trim() }
      : {}),
    apiKey,
    ...(process.env.OGRAF_AGENT_ORGANIZATION?.trim()
      ? { organization: process.env.OGRAF_AGENT_ORGANIZATION.trim() }
      : {}),
    ...(process.env.OGRAF_AGENT_PROJECT?.trim()
      ? { project: process.env.OGRAF_AGENT_PROJECT.trim() }
      : {}),
    effort,
  };
}

export function redactProviderError(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, '[REDACTED]');
  }
  return message
    .replace(/(authorization|x-api-key|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1: [REDACTED]')
    .slice(0, 1_000);
}
