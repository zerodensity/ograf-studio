import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TOOL_MERGES } from '@ograf-editor/agent-tools';

export type AgentSurface = 'mcp' | 'chat';

interface Counts {
  tools: Record<string, number>;
  operations: Record<string, number>;
  refusals: Record<string, number>;
}

type UsageFile = { since: string } & Record<AgentSurface, Counts>;

const emptyCounts = (): Counts => ({ tools: {}, operations: {}, refusals: {} });

const selectors = new Map(TOOL_MERGES.map((merge) => [merge.into, merge.selector]));

/**
 * The shape of a refusal without what the project holds: quoted names, IDs and numbers are
 * replaced, so the same fault counts as one line whichever layer or field it met.
 */
function refusalShape(message: string): string {
  return message
    .split('\n', 1)[0]!
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '…')
    .replace(/\b[\w-]*\d[\w-]*\b/g, '#')
    .replace(/(not found|unknown|missing)([^.;:]*): [^.;]+/gi, '$1$2: …')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Counts which tools and operations agents call and which calls are refused, in one local file.
 * It exists so that the tool list can be judged on real use. The file holds names and counts
 * only, stays on this machine, and is written only when OGRAF_AGENT_USAGE_FILE names it.
 */
export class AgentToolUsage {
  readonly #path: string;
  readonly #file: UsageFile;
  #timer: NodeJS.Timeout | undefined;

  constructor(path: string) {
    this.#path = path;
    let saved: Partial<UsageFile> = {};
    try {
      saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<UsageFile>;
    } catch {
      // No counts yet, or a file this version cannot read: start a new one.
    }
    this.#file = {
      since: typeof saved.since === 'string' ? saved.since : new Date().toISOString(),
      mcp: { ...emptyCounts(), ...saved.mcp },
      chat: { ...emptyCounts(), ...saved.chat },
    };
  }

  /** One call of a tool, with the choice it selected and the operation types it sent. */
  called(surface: AgentSurface, tool: string, args: unknown): void {
    const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const choice = input[selectors.get(tool) ?? ''];
    const counts = this.#file[surface];
    this.#add(counts.tools, typeof choice === 'string' ? `${tool} ${choice}` : tool);
    if (tool === 'ograf_apply_operations' && Array.isArray(input.operations))
      for (const operation of input.operations) {
        const type = (operation as { type?: unknown } | null)?.type;
        if (typeof type === 'string') this.#add(counts.operations, type.slice(0, 64));
      }
  }

  /** One call that was refused or failed, by the shape of its message. */
  refused(surface: AgentSurface, tool: string, message: string): void {
    this.#add(this.#file[surface].refusals, `${tool}: ${refusalShape(message)}`);
  }

  /** Writes the counts now. Counting also writes them, shortly after each change. */
  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    mkdirSync(dirname(this.#path), { recursive: true });
    const pending = `${this.#path}.${process.pid}.tmp`;
    writeFileSync(pending, `${JSON.stringify(this.#file, null, 2)}\n`, 'utf8');
    renameSync(pending, this.#path);
  }

  #add(counts: Record<string, number>, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1;
    this.#timer ??= setTimeout(() => {
      try {
        this.flush();
      } catch (error) {
        console.error(`Agent usage counts could not be written to ${this.#path}:`, error);
      }
    }, 1_000).unref();
  }
}

/** The counter the environment asks for, or none: counting is off unless a file is named. */
export function agentToolUsageFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AgentToolUsage | undefined {
  const path = environment.OGRAF_AGENT_USAGE_FILE?.trim();
  return path ? new AgentToolUsage(path) : undefined;
}
