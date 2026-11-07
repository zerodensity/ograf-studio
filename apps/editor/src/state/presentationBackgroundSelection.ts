import type { PresentationBackgroundSettings } from './presentationBackgroundStore';
import type { ProgramBackgroundMode } from './programMonitorStore';

/** Shared source list for the canvas and operator preview controls. */
export const PRESENTATION_BACKGROUND_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'big-buck-bunny', label: 'Big Buck Bunny · looping video' },
  { value: 'still-image', label: 'Still image' },
  { value: 'webcam', label: 'Webcam · local preview' },
  { value: 'program:black', label: 'Black' },
  { value: 'program:checker', label: 'Checkerboard' },
  { value: 'program:video', label: 'Local video' },
  { value: 'program:sample-news', label: 'News studio · bundled loop' },
  { value: 'program:sample-entertainment', label: 'Entertainment studio · bundled loop' },
] as const;

export type PresentationBackgroundChoice =
  (typeof PRESENTATION_BACKGROUND_OPTIONS)[number]['value'];

export function presentationBackgroundChoice(
  mode: PresentationBackgroundSettings['mode'],
  program: ProgramBackgroundMode,
): PresentationBackgroundChoice {
  return program === 'document' ? mode : `program:${program}`;
}

/** Apply the same camera lifecycle and ownership rules from either picker. */
export function choosePresentationBackground(
  value: string,
  ownerKey: string | null,
  settings: PresentationBackgroundSettings,
  update: (patch: Partial<PresentationBackgroundSettings>, ownerKey: string | null) => boolean,
  setProgramBackground: (value: ProgramBackgroundMode) => void,
  stopWebcam: () => void,
): boolean {
  if (!ownerKey || !PRESENTATION_BACKGROUND_OPTIONS.some((option) => option.value === value))
    return false;
  if (value.startsWith('program:')) {
    if (settings.mode === 'webcam') stopWebcam();
    setProgramBackground(value.slice(8) as ProgramBackgroundMode);
    return true;
  }
  if (!update({ mode: value as PresentationBackgroundSettings['mode'] }, ownerKey)) return false;
  setProgramBackground('document');
  return true;
}
