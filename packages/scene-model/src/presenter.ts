/** An editorial playback sequence, independent from a template set's authoring order. */
export interface PresenterEntry {
  id: string;
  /** The set template ID, or the project ID for a standalone template. */
  templateId: string;
  /** Optional explicit Transition Logic state for coordinated playback. */
  stateId?: string;
  title?: string;
  notes?: string;
  durationSeconds?: number;
  /** Disabled entries remain in the sequence but are skipped during playback. */
  enabled?: boolean;
}

export interface PresenterDefinition {
  version: 1;
  entries: PresenterEntry[];
  defaultDurationSeconds: number;
  loop: boolean;
  /** Auto uses coordinated playback when every enabled entry maps to a valid state. */
  playback?: 'auto' | 'independent' | 'coordinated';
}

export const PRESENTER_VERSION = 1;
export const PRESENTER_DEFAULT_DURATION_SECONDS = 18;
export const PRESENTER_MAX_ENTRIES = 1024;
export const PRESENTER_MAX_TITLE_LENGTH = 256;
export const PRESENTER_MAX_NOTES_LENGTH = 10000;
export const PRESENTER_MIN_DURATION_SECONDS = 1;
export const PRESENTER_MAX_DURATION_SECONDS = 3600;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value);
const isDuration = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= PRESENTER_MIN_DURATION_SECONDS &&
  value <= PRESENTER_MAX_DURATION_SECONDS;

/** Validate shape and bounds. Missing source references are recoverable editor warnings. */
export function presenterDefinitionErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['Presenter settings must be an object.'];
  const errors: string[] = [];
  if (value.version !== PRESENTER_VERSION) errors.push('Unsupported Presenter settings version.');
  if (!isDuration(value.defaultDurationSeconds))
    errors.push('Presenter default duration must be between 1 and 3600 seconds.');
  if (typeof value.loop !== 'boolean') errors.push('Presenter loop must be a boolean.');
  if (
    value.playback !== undefined &&
    value.playback !== 'auto' &&
    value.playback !== 'independent' &&
    value.playback !== 'coordinated'
  )
    errors.push('Presenter playback must be auto, independent, or coordinated.');
  if (!Array.isArray(value.entries)) return [...errors, 'Presenter entries must be an array.'];
  if (value.entries.length > PRESENTER_MAX_ENTRIES)
    return [...errors, `A presentation can contain at most ${PRESENTER_MAX_ENTRIES} entries.`];
  const ids = new Set<string>();
  for (const [index, entry] of value.entries.entries()) {
    const label = `Presenter entry ${index + 1}`;
    if (!isRecord(entry)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (!isId(entry.id)) errors.push(`${label} has an invalid ID.`);
    else if (ids.has(entry.id)) errors.push(`${label} has a duplicate ID.`);
    else ids.add(entry.id);
    if (!isId(entry.templateId)) errors.push(`${label} has an invalid template ID.`);
    if (entry.stateId !== undefined && !isId(entry.stateId))
      errors.push(`${label} has an invalid state ID.`);
    for (const [key, max] of [
      ['title', PRESENTER_MAX_TITLE_LENGTH],
      ['notes', PRESENTER_MAX_NOTES_LENGTH],
    ] as const)
      if (entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > max))
        errors.push(`${label} ${key} must be text with at most ${max} characters.`);
    if (entry.durationSeconds !== undefined && !isDuration(entry.durationSeconds))
      errors.push(`${label} duration must be between 1 and 3600 seconds.`);
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean')
      errors.push(`${label} enabled must be a boolean.`);
  }
  return errors;
}

export function validatePresenterDefinition(value: unknown): asserts value is PresenterDefinition {
  const errors = presenterDefinitionErrors(value);
  if (errors.length) throw new Error(errors.join(' '));
}
