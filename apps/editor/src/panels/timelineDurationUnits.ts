export const timelineDurationUnits = [
  { value: 'seconds', short: 's', label: 'Seconds' },
  { value: 'frames', short: 'f', label: 'Frames' },
  { value: 'timecode', short: 'TC', label: 'Timecode' },
] as const;

type DurationUnit = (typeof timelineDurationUnits)[number]['value'];

/** Changing the display unit does not retime the stored animation. */
export function nextTimelineDurationUnit(unit: DurationUnit): DurationUnit {
  const index = timelineDurationUnits.findIndex((candidate) => candidate.value === unit);
  return timelineDurationUnits[(index + 1) % timelineDurationUnits.length]!.value;
}
