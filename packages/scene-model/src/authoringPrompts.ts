import type { AuthoringPrompt, Project } from './types';

function assertPrompt(value: unknown): asserts value is AuthoringPrompt {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    !('text' in value) ||
    typeof value.text !== 'string' ||
    !value.text.trim()
  )
    throw new Error('An authoring prompt requires a nonempty ID and user text.');
}

export function validateAuthoringPrompts(value: unknown): asserts value is AuthoringPrompt[] {
  if (!Array.isArray(value)) throw new Error('Authoring prompts must be an ordered array.');
  const ids = new Set<string>();
  for (const prompt of value) {
    assertPrompt(prompt);
    if (ids.has(prompt.id)) throw new Error('Authoring prompt IDs must be unique.');
    ids.add(prompt.id);
  }
}

/** Append one human prompt. Retrying with the same ID and text is harmless. */
export function appendAuthoringPrompt(project: Project, prompt: AuthoringPrompt): boolean {
  assertPrompt(prompt);
  const previous = project.authoringPrompts ?? [];
  const existing = previous.find((entry) => entry.id === prompt.id);
  if (existing) {
    if (existing.text !== prompt.text) throw new Error('That authoring prompt ID is already used.');
    return false;
  }
  project.authoringPrompts = [...previous, { id: prompt.id, text: prompt.text }];
  return true;
}
