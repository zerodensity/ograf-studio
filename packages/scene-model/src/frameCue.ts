import { logicFunctionJsonErrors } from './logicFunctions';

export const MAX_FRAME_CUES = 128;
export const MAX_FRAME_CUE_NAME_LENGTH = 80;
export const MAX_FRAME_CUE_PAYLOAD_BYTES = 16 * 1024;

/** One validation rule for project editing, export validation, and package recovery. */
export function frameCueErrors(cues: unknown, endFrame: number): string[] {
  if (cues === undefined) return [];
  if (!Array.isArray(cues) || cues.length > MAX_FRAME_CUES)
    return [`Frame cues must be a list of at most ${MAX_FRAME_CUES} entries.`];
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const [index, cue] of cues.entries()) {
    const label = `Frame cue ${index + 1}`;
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (typeof cue.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(cue.id))
      errors.push(`${label} needs a valid ID.`);
    else if (ids.has(cue.id)) errors.push(`${label} duplicates another cue ID.`);
    else ids.add(cue.id);
    if (
      typeof cue.name !== 'string' ||
      !cue.name.trim() ||
      cue.name.length > MAX_FRAME_CUE_NAME_LENGTH ||
      /[\r\n]/.test(cue.name)
    )
      errors.push(`${label} needs a name of 1–${MAX_FRAME_CUE_NAME_LENGTH} characters.`);
    if (!Number.isSafeInteger(cue.frame) || cue.frame < 0 || cue.frame > endFrame)
      errors.push(`${label} must be on a whole frame from 0 to ${endFrame}.`);
    if (
      cue.payload !== undefined &&
      logicFunctionJsonErrors(cue.payload, MAX_FRAME_CUE_PAYLOAD_BYTES).length
    )
      errors.push(`${label} payload must be plain, finite JSON data of at most 16 KiB.`);
  }
  return errors;
}
