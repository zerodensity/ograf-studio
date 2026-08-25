import * as z from 'zod/v4';
import type { AgentToolRecord } from './toolRecords';

export const IN_APP_AGENT_TOOL_NAMES = [
  'ograf_get_capabilities',
  'ograf_query_scene',
  'ograf_inspect_scene',
  'ograf_get_project',
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

export function providerToolDefinition(record: AgentToolRecord): ProviderToolDefinition {
  const schema = z.toJSONSchema(z.object(record.config.inputSchema), {
    target: 'draft-7',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: record.name,
    description: record.config.description ?? record.config.title ?? record.name,
    inputSchema: schema,
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
  if (
    toolName !== 'ograf_apply_operations' ||
    input.includeReview !== undefined ||
    (input.mode !== undefined && input.mode !== 'apply' && input.mode !== 'dry-run')
  ) {
    return input;
  }
  return { ...input, includeReview: true };
}
