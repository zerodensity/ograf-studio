import * as z from 'zod/v4';
import type { AgentToolRecord } from './toolRecords';
import { compactProviderSchema } from './compactProviderSchema';
import { templateSetOperationSchema } from './templateSetSchemas';

export const IN_APP_AGENT_TOOL_NAMES = [
  'ograf_get_capabilities',
  'ograf_query_scene',
  'ograf_inspect_scene',
  'ograf_get_project',
  'ograf_get_template_set',
  'ograf_update_template_set',
  'ograf_get_playout',
  'ograf_control_playout',
  'ograf_get_timeline',
  'ograf_sample_tracks',
  'ograf_apply_operations',
  'ograf_capture',
  'ograf_render_strip',
  'ograf_measure_text',
  'ograf_review_design',
  'ograf_validate_project',
  'ograf_undo',
  'ograf_redo',
  'ograf_read_result_page',
] as const;

export type InAppAgentToolName = (typeof IN_APP_AGENT_TOOL_NAMES)[number];

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
  ograf_get_capabilities: 'Contracts/editor readiness.',
  ograf_get_project: 'Project/revision.',
  ograf_inspect_scene: 'Links/motion/warnings/revision.',
  ograf_query_scene: 'Find scene layers.',
  ograf_get_timeline: 'Tracks/lifecycle/loops; incoming easing.',
  ograf_sample_tracks: 'Sample pose; absolute on-air loopElapsedFrame. No browser.',
  ograf_capture:
    'PNG(first Step); composition matte/dataOverrides only. URL5min; base64 opt-in. Not certification.',
  ograf_render_strip:
    'PNG strip≤12frames; defaults lifecycle/midpoints. maxDimension/tile; URL5min, base64 opt-in.',
  ograf_apply_operations: 'Atomic apply/dry-run/preview/propose(Accept/Reject).',
  ograf_validate_project: 'Advisory semantic/field/text/broadcast QA; not certification.',
  ograf_review_design: 'Advisory QA+IDs; includeStrip adds frames. Not certification.',
  ograf_measure_text: 'Browser text fit/overflow/clipping at frame.',
  ograf_undo: 'Undo last agent transaction.',
  ograf_redo: 'Redo last agent transaction.',
  ograf_get_template_set: 'Set/revision; projects/usage opt-in; IDs or offset/limit.',
  ograf_update_template_set:
    'Current set revision; confirm removal/replacement; file pickers via UI.',
  ograf_read_result_page: 'Retained JSON by resultId/path/offset; Studio supplies owner/budget.',
  ograf_get_playout:
    'Read revision/readiness/current/pending/errors/tickers. target:preview=Studio; omitted/live=independent.',
  ograf_control_playout:
    'Revision+unique requestId; poll/retry ID if uncertain. target:preview=Studio(on-air updates); omitted/live=independent. Update in-place/transition; prepared Take. Parent Out/Clear cascade without restore; template-action includes clocks.',
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
        definition.description =
          'v1–6/null. v6 updateMode; v5 in/out(template/builtin/plugin)+pinned animationPresetPlugins. Move nonshared/morph shared; keep guards/defaults/precedence. parentSlotId cascades Out/Clear; takeOutSlotIds waits targets/dependents Out, no restore.';
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
