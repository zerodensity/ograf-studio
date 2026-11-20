import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOGrafToolRecords } from './toolRecords';
import { listedToolRecords, MERGED_TOOL_NAMES } from './mergedTools';
import { UNLISTED_OPERATION_TYPES } from './mergedOperations';
import { authoringOperationSchema } from './schemas';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';

const skillRoot = resolve(__dirname, '../../../skills/ograf-authoring');
const documents = [
  'SKILL.md',
  ...readdirSync(resolve(skillRoot, 'references'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `references/${name}`),
].map((name) => ({ name, text: readFileSync(resolve(skillRoot, name), 'utf8') }));

const operationNames = new Set(
  authoringOperationSchema.options.flatMap((option) => {
    const type = option.shape.type as { value?: string; options?: string[] };
    return type.options ?? [type.value!];
  }),
);
const toolRecords = createOGrafToolRecords({} as AuthoringWorkspacePort, {} as EditorBridgePort);
const listedTools = new Set(listedToolRecords(toolRecords).map((record) => record.name));

/** Every object with an operation name as its `type`, anywhere inside a JSON example. */
function operationsIn(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(operationsIn);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const own = typeof record.type === 'string' && operationNames.has(record.type) ? [record] : [];
  // An operation's own arguments are checked with it; only containers are searched further.
  return own.length ? own : Object.values(record).flatMap(operationsIn);
}

describe('authoring skill vocabulary', () => {
  it('names only tools an agent is shown', () => {
    for (const { name, text } of documents) {
      const mentioned = new Set(text.match(/\bograf_[a-z]+(?:_[a-z]+)+\b/g) ?? []);
      for (const tool of mentioned) {
        if (!toolRecords.some((record) => record.name === tool)) continue;
        expect(MERGED_TOOL_NAMES.has(tool), `${name} names the earlier tool ${tool}`).toBe(false);
        expect(listedTools.has(tool), `${name} names ${tool}`).toBe(true);
      }
    }
  });

  it('names only operations an agent is shown', () => {
    for (const { name, text } of documents)
      for (const code of text.match(/`[a-z]+(?:_[a-z]+)+`/g) ?? [])
        expect(
          UNLISTED_OPERATION_TYPES.has(code.slice(1, -1)),
          `${name} names the earlier operation ${code}`,
        ).toBe(false);
  });

  it('gives JSON examples that the operation schema accepts', () => {
    let checked = 0;
    for (const { name, text } of documents) {
      for (const block of text.match(/```json\n[\s\S]*?\n```/g) ?? []) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(block.slice('```json\n'.length, -'\n```'.length));
        } catch {
          continue; // A fragment with an ellipsis or a comment is prose, not a payload.
        }
        for (const operation of operationsIn(parsed)) {
          // A value such as "<inspected digest>" stands for one the agent reads at run time.
          if (/"<[^"]*>"/.test(JSON.stringify(operation))) continue;
          checked += 1;
          expect(
            UNLISTED_OPERATION_TYPES.has(String(operation.type)),
            `${name} shows the earlier operation ${operation.type}`,
          ).toBe(false);
          const result = authoringOperationSchema.safeParse(operation);
          expect(
            result.success,
            `${name}: ${JSON.stringify(operation).slice(0, 200)}\n${result.success ? '' : result.error.message}`,
          ).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
