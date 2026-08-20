import type { EasingPreset } from '@ograf-editor/scene-model';

interface EasingOption {
  value: EasingPreset;
  label: string;
}

export const EASING_OPTION_GROUPS: Array<{ label: string; options: EasingOption[] }> = [
  {
    label: 'Basic',
    options: [
      { value: 'linear', label: 'None (Linear)' },
      { value: 'ease-in', label: 'Quad In' },
      { value: 'ease-out', label: 'Quad Out' },
      { value: 'ease-in-out', label: 'Quad In / Out' },
    ],
  },
  ...(
    ['cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back', 'bounce', 'elastic'] as const
  ).map((family) => {
    const familyLabel = family[0]!.toUpperCase() + family.slice(1);
    return {
      label: familyLabel,
      // Native selects do not show their optgroup after closing, so every selected option must
      // carry its family name rather than displaying an ambiguous bare "In" or "Out".
      options: [
        { value: `${family}-in` as EasingPreset, label: `${familyLabel} In` },
        { value: `${family}-out` as EasingPreset, label: `${familyLabel} Out` },
        { value: `${family}-in-out` as EasingPreset, label: `${familyLabel} In / Out` },
      ],
    };
  }),
];

export function easingOptions(): EasingOption[] {
  return EASING_OPTION_GROUPS.flatMap((group) => group.options);
}

export function easingLabel(preset: EasingPreset): string {
  return easingOptions().find((option) => option.value === preset)?.label ?? preset;
}
