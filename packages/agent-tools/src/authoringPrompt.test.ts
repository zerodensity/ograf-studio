import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { AuthoringSession } from '@ograf-editor/authoring-core';
import { createProject } from '@ograf-editor/scene-model';
import { providerToolDefinition, withInAppToolDefaults } from './inAppTools';
import { authoringOperationSchema } from './schemas';

describe('external MCP authoring prompts', () => {
  it('appends explicit prompts in order and deduplicates retries by ID', () => {
    const session = new AuthoringSession(createProject(), 'prompt-history');
    const original = { id: 'original', text: '  Create a chart.\nUse café sales.  ' };
    const followUp = { id: 'follow-up', text: 'Make the chart blue.' };
    const apply = (authoringPrompt: typeof original) => {
      const operation = authoringOperationSchema.parse({
        type: 'set_project_metadata',
        authoringPrompt,
      });
      if (operation.type !== 'set_project_metadata') throw new Error('Unexpected operation');
      return session.apply({ expectedRevision: session.revision, operations: [operation] });
    };

    apply(original);
    apply(followUp);
    expect(apply(followUp).project.authoringPrompts).toEqual([original, followUp]);
    const before = session.snapshot();
    expect(() => apply({ ...original, text: 'Different text with the same ID' })).toThrow();
    expect(session.snapshot()).toEqual(before);
  });

  it('keeps explicit provenance out of model-generated operations in Studio', () => {
    const definition = providerToolDefinition({
      name: 'ograf_apply_operations',
      config: { inputSchema: { operations: z.array(authoringOperationSchema) } },
      handler: vi.fn(),
    });
    const providerSchema = JSON.stringify(definition.inputSchema);
    expect(providerSchema).toContain('set_project_metadata');
    expect(providerSchema).not.toContain('authoringPrompt');
    expect(() =>
      withInAppToolDefaults('ograf_apply_operations', {
        operations: [
          { type: 'set_project_metadata', authoringPrompt: { id: 'fake', text: 'Model text' } },
        ],
      }),
    ).toThrow('Studio records user prompts automatically.');
  });
});
