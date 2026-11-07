import { describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createChartElement,
  createComposition,
  studioPluginReference,
  type AnimationPluginPreset,
} from '@ograf-editor/scene-model';
import {
  chartMarkAnimationChoiceKey,
  chartMarkAnimationDraft,
  chartMarkAnimationPacks,
  parseChartMarkAnimationDraft,
} from './chartMarkAnimationEditing';

const fade = [
  {
    property: 'opacity' as const,
    mode: 'absolute' as const,
    keys: [
      { at: 0, value: 0 },
      { at: 1, value: 'on-air' as const },
    ],
  },
];
const preset: AnimationPluginPreset = {
  id: 'fade',
  name: 'Fade',
  targetKinds: ['rectangle'],
  tracks: {
    in: fade,
    out: [
      {
        ...fade[0]!,
        keys: [
          { at: 0, value: 'on-air' },
          { at: 1, value: 0 },
        ],
      },
    ],
  },
  parameters: [{ id: 'distance', label: 'Distance', default: 40, min: 0, max: 200, step: 1 }],
};
const pack = createAnimationPresetPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'animation-presets',
    id: 'test.chart-marks',
    version: '1.0.0',
    name: 'Mark motion',
    license: 'MIT',
  },
  licenseText: 'MIT',
  presets: [
    preset,
    { ...preset, id: 'ellipse', targetKinds: ['ellipse'] },
    { ...preset, id: 'text', targetKinds: ['text'] },
    { ...preset, id: 'in-only', tracks: { in: fade } },
  ],
});

describe('chart mark animation drafting', () => {
  it('offers only exact valid trusted enabled packs matching the side and mark kind', () => {
    const composition = createComposition();
    const element = createChartElement();
    const entry = { snapshot: pack, enabled: true, trusted: true, installedAt: '' };
    expect(
      chartMarkAnimationPacks(composition, element, [entry], 'in')[0]?.presets.map(
        (item) => item.id,
      ),
    ).toEqual(['fade', 'in-only']);
    expect(
      chartMarkAnimationPacks(composition, element, [entry], 'out')[0]?.presets.map(
        (item) => item.id,
      ),
    ).toEqual(['fade']);
    expect(
      chartMarkAnimationPacks(
        composition,
        { ...element, preset: 'pie' },
        [entry],
        'in',
      )[0]?.presets.map((item) => item.id),
    ).toEqual(['ellipse']);
    expect(
      chartMarkAnimationPacks(composition, { ...element, preset: 'line' }, [entry], 'in'),
    ).toEqual([]);
    expect(
      chartMarkAnimationPacks(composition, element, [{ ...entry, trusted: false }], 'in'),
    ).toEqual([]);
    expect(
      chartMarkAnimationPacks(composition, element, [{ ...entry, enabled: false }], 'in'),
    ).toEqual([]);
    expect(
      chartMarkAnimationPacks(
        composition,
        element,
        [{ ...entry, snapshot: { ...pack, sha256: '0'.repeat(64) } }],
        'in',
      ),
    ).toEqual([]);
  });

  it('retains, validates and deduplicates source pins without changing their contents or local trust', () => {
    const composition = createComposition({ animationPresetPlugins: [pack] });
    const element = createChartElement();
    const before = structuredClone(composition);
    expect(chartMarkAnimationPacks(composition, element, [], 'in')[0]?.retained).toBe(true);
    const entries = [{ snapshot: pack, installedAt: '', enabled: true, trusted: true }];
    const packs = chartMarkAnimationPacks(composition, element, entries, 'in');
    expect(packs).toHaveLength(1);
    expect(packs[0]?.retained).toBe(false);
    expect(composition).toEqual(before);
    expect(entries[0]?.trusted).toBe(true);
  });

  it('uses exact version and digest in choice identities', () => {
    const phase = { reference: studioPluginReference(pack), presetId: preset.id };
    expect(chartMarkAnimationChoiceKey()).toBe('');
    expect(chartMarkAnimationChoiceKey(phase)).not.toBe(
      chartMarkAnimationChoiceKey({
        ...phase,
        reference: { ...phase.reference, sha256: 'a'.repeat(64) },
      }),
    );
    expect(chartMarkAnimationChoiceKey(phase)).not.toBe(
      chartMarkAnimationChoiceKey({
        ...phase,
        reference: { ...phase.reference, version: '2.0.0' },
      }),
    );
  });

  it('keeps editing as strings until a valid complete atomic request can be created', () => {
    const element = createChartElement();
    const draft = chartMarkAnimationDraft(undefined, preset, 24);
    expect(draft).toEqual({
      durationFrames: '12',
      delayFrames: '0',
      staggerFrames: '0',
      parameters: { distance: '40' },
    });
    const saved = structuredClone(draft);
    expect(parseChartMarkAnimationDraft(draft, preset, element, 24)).toEqual({
      durationFrames: 12,
      delayFrames: 0,
      staggerFrames: 0,
      parameters: { distance: 40 },
    });
    expect(draft).toEqual(saved);
    expect(() =>
      parseChartMarkAnimationDraft({ ...draft, durationFrames: '' }, preset, element, 24),
    ).toThrow(/whole number/);
    expect(() =>
      parseChartMarkAnimationDraft({ ...draft, durationFrames: '1.5' }, preset, element, 24),
    ).toThrow(/whole number/);
    expect(() =>
      parseChartMarkAnimationDraft({ ...draft, delayFrames: '-1' }, preset, element, 24),
    ).toThrow(/whole number/);
    expect(() =>
      parseChartMarkAnimationDraft({ ...draft, staggerFrames: '101' }, preset, element, 24),
    ).toThrow(/whole number/);
    expect(() =>
      parseChartMarkAnimationDraft({ ...draft, parameters: { distance: '' } }, preset, element, 24),
    ).toThrow(/Distance/);
    expect(() =>
      parseChartMarkAnimationDraft(
        { ...draft, parameters: { distance: 'Infinity' } },
        preset,
        element,
        24,
      ),
    ).toThrow(/Distance/);
    expect(() =>
      parseChartMarkAnimationDraft(
        { ...draft, parameters: { distance: '201' } },
        preset,
        element,
        24,
      ),
    ).toThrow(/Distance/);
  });

  it('accounts for all marks across datasets when checking delay and stagger', () => {
    const element = createChartElement({
      data: {
        labels: ['A', 'B', 'C'],
        datasets: [
          { label: 'First', data: [1, 2, 3], backgroundColor: '#00aaff', borderColor: '#00aaff' },
          { label: 'Second', data: [3, 2, 1], backgroundColor: '#00aaff', borderColor: '#00aaff' },
        ],
      },
    });
    const draft = {
      ...chartMarkAnimationDraft(undefined, preset, 24),
      delayFrames: '2',
      staggerFrames: '2',
    };
    expect(parseChartMarkAnimationDraft(draft, preset, element, 24).staggerFrames).toBe(2);
    expect(() => parseChartMarkAnimationDraft(draft, preset, element, 23)).toThrow(
      /24 frames.*23 fit/,
    );
    expect(chartMarkAnimationDraft(undefined, preset, 0).durationFrames).toBe('1');
  });
});
