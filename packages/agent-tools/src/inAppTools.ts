import * as z from 'zod/v4';
import type { AgentToolRecord } from './toolRecords';
import { compactProviderSchema } from './compactProviderSchema';
import { templateSetOperationSchema } from './templateSetSchemas';

export const IN_APP_AGENT_TOOL_NAMES = [
  'ograf_get_capabilities',
  'ograf_inspect_scene',
  'ograf_get_project',
  'ograf_get_template_set',
  'ograf_update_template_set',
  'ograf_get_playout',
  'ograf_control_playout',
  'ograf_sample_tracks',
  'ograf_apply_operations',
  'ograf_capture',
  'ograf_validate_project',
  'ograf_undo',
  'ograf_read_result_page',
] as const;

export type InAppAgentToolName = (typeof IN_APP_AGENT_TOOL_NAMES)[number];

/** Earlier in-app tools that a listed tool now covers. The chat reaches no other merged route. */
export const IN_APP_MERGED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'ograf_query_scene',
  'ograf_get_timeline',
  'ograf_render_strip',
  'ograf_measure_text',
  'ograf_review_design',
  'ograf_redo',
]);

const IN_APP_AGENT_TOOL_SET = new Set<string>(IN_APP_AGENT_TOOL_NAMES);

/** Filter over canonical records: no handler, schema, or description is forked for in-app use. */
export function filterInAppToolRecords(records: AgentToolRecord[]): AgentToolRecord[] {
  const filtered = records.filter((record) => IN_APP_AGENT_TOOL_SET.has(record.name));
  const missing = IN_APP_AGENT_TOOL_NAMES.filter(
    (name) => !filtered.some((record) => record.name === name),
  );
  if (missing.length > 0) {
    throw new Error(`In-app agent tool filter references missing records: ${missing.join(', ')}`);
  }
  return filtered;
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Compact provider-only wording; canonical MCP records and validation remain unchanged. */
const IN_APP_DESCRIPTIONS: Record<string, string> = {
  ograf_get_capabilities: 'Contracts/readiness.',
  ograf_get_project: 'Project/revision. view=timeline: tracks/lifecycle/loops/incoming easing.',
  ograf_inspect_scene: 'Links/motion/warnings/revision. mode=query or any filter: find layers.',
  ograf_sample_tracks: 'Pose; absolute on-air loopElapsedFrame; no browser.',
  ograf_capture:
    'PNG(first Step); composition-only matte/dataOverrides; URL5min; opt-in base64; uncertified. mode=strip: ≤12frames(lifecycle/midpoints default), tile maxDimension≤1024.',
  ograf_apply_operations: 'Atomic apply/dry-run/preview/propose(Accept/Reject).',
  ograf_validate_project:
    'Advisory semantic/field/text/broadcast QA; uncertified. check=design: QA+IDs, includeStrip=frames. check=text: browser fit/overflow/clipping of layerId at frame.',
  ograf_undo: 'Undo agent transaction. direction=redo: redo it.',
  ograf_get_template_set: 'Set/revision; opt-in projects/usage; IDs/offset/limit.',
  ograf_update_template_set:
    'Set revision; read templateSets capabilities; confirm removal/replacement; UI files.',
  ograf_read_result_page: 'Retained JSON: resultId/path/offset; Studio owner/budget.',
  ograf_get_playout:
    'Revision/readiness/current/pending/errors/tickers; target:preview=Studio; live(default)=independent.',
  ograf_control_playout:
    'Revision+unique requestId; poll/retry same ID. target:preview=Studio(on-air Update only); live(default)=independent. Out/Clear cascades without restore; read templateSets capabilities.',
};

export function providerToolDefinition(record: AgentToolRecord): ProviderToolDefinition {
  // The built-in reader consumes results already retained by its own tool loop. Starting a
  // read-only source is an external-MCP convenience; owner and budgets are trusted server data.
  // This projection keeps every authoring operation and the canonical reader validation intact.
  const input =
    record.name === 'ograf_read_result_page'
      ? Object.fromEntries(
          Object.entries(record.config.inputSchema).filter(([key]) =>
            ['resultId', 'path', 'offset'].includes(key),
          ),
        )
      : record.name === 'ograf_update_template_set'
        ? { ...record.config.inputSchema, operation: templateSetOperationSchema }
        : record.config.inputSchema;
  const schema = z.toJSONSchema(z.object(input), {
    target: 'draft-7',
    unrepresentable: 'any',
    // Studio records its own user messages. Explicit prompt provenance is for external clients.
    override: ({ jsonSchema }) => {
      if (record.name === 'ograf_apply_operations') delete jsonSchema.properties?.authoringPrompt;
    },
    // Compact the large operation union without changing canonical validation or other tools.
    reused: [
      'ograf_apply_operations',
      'ograf_update_template_set',
      'ograf_control_playout',
    ].includes(record.name)
      ? 'ref'
      : 'inline',
  }) as Record<string, unknown>;
  delete schema.$schema;
  if (record.name === 'ograf_read_result_page') schema.required = ['resultId'];
  if (record.name === 'ograf_update_template_set') {
    const operation = (schema.properties as Record<string, Record<string, unknown>>)?.operation;
    for (const variant of (operation?.oneOf ?? []) as Array<Record<string, unknown>>) {
      const definition = (variant.properties as Record<string, Record<string, unknown>>)
        ?.definition;
      if (
        typeof definition?.description === 'string' &&
        definition.description.startsWith('Definition/null. v6')
      )
        // The complete versioned motion/update/dependency contract is returned by capabilities;
        // avoid repeating it in every provider request. Canonical MCP annotations are untouched.
        delete definition.description;
    }
  }
  return {
    name: record.name,
    description: (
      IN_APP_DESCRIPTIONS[record.name] ??
      record.config.description ??
      record.config.title ??
      record.name
    ).replace(/\.$/, ''),
    inputSchema: compactProviderSchema(schema),
  };
}

export function providerToolDefinitions(records: AgentToolRecord[]): ProviderToolDefinition[] {
  return filterInAppToolRecords(records).map(providerToolDefinition);
}

export function providerToolWireBytes(records: AgentToolRecord[]): number {
  return Buffer.byteLength(JSON.stringify(providerToolDefinitions(records)), 'utf8');
}

/** In-app convenience only; the shared record and MCP default remain backward compatible. */
export function withInAppToolDefaults(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== 'ograf_apply_operations') return input;
  if (
    Array.isArray(input.operations) &&
    input.operations.some(
      (operation) =>
        operation?.type === 'set_project_metadata' && Object.hasOwn(operation, 'authoringPrompt'),
    )
  )
    throw new Error('Studio records user prompts automatically. Omit authoringPrompt.');
  if (
    input.includeReview !== undefined ||
    (input.mode !== undefined && input.mode !== 'apply' && input.mode !== 'dry-run')
  ) {
    return input;
  }
  return { ...input, includeReview: true };
}
