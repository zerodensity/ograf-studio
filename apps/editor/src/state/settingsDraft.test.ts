import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import {
  createSettingsDialogDraft,
  mergeSettingsDraft,
  rebaseSettingsDialogDraft,
} from './settingsDraft';
import { templateSetSettingsFromProject } from './templateSetSettings';

function settings() {
  return templateSetSettingsFromProject(createProject({ name: 'Settings test' }));
}

describe('settings dialog draft merge', () => {
  it('preserves newer current settings when the draft is unchanged', () => {
    const baseline = settings();
    const draft = structuredClone(baseline);
    const current = {
      ...baseline,
      width: baseline.width + 200,
      backgroundColor: '#112233',
      layout: { ...baseline.layout, gridSize: baseline.layout.gridSize + 10 },
    };

    expect(mergeSettingsDraft(current, baseline, draft)).toEqual(current);
  });

  it('applies changed flat and layout fields while preserving untouched current fields', () => {
    const baseline = settings();
    const current = {
      ...baseline,
      height: baseline.height + 200,
      frameRate: 50,
      layout: { ...baseline.layout, snapThreshold: baseline.layout.snapThreshold + 2 },
    };
    const draft = {
      ...baseline,
      width: baseline.width + 100,
      layout: { ...baseline.layout, gridSize: baseline.layout.gridSize + 5 },
    };

    expect(mergeSettingsDraft(current, baseline, draft)).toEqual({
      ...current,
      width: draft.width,
      layout: { ...current.layout, gridSize: draft.layout.gridSize },
    });
  });

  it('preserves explicit false and zero values from the draft', () => {
    const baseline = {
      ...settings(),
      supportsRealTime: true,
      supportsNonRealTime: true,
      updateTransitionFrames: 12,
    };
    baseline.layout.snappingEnabled = true;
    baseline.layout.snapThreshold = 8;
    const current = structuredClone(baseline);
    const draft = {
      ...baseline,
      supportsRealTime: false,
      updateTransitionFrames: 0,
      layout: { ...baseline.layout, snappingEnabled: false, snapThreshold: 0 },
    };

    expect(mergeSettingsDraft(current, baseline, draft)).toMatchObject({
      supportsRealTime: false,
      supportsNonRealTime: true,
      updateTransitionFrames: 0,
      layout: { snappingEnabled: false, snapThreshold: 0 },
    });
  });

  it('does not mutate or share the input settings and nested layout', () => {
    const baseline = settings();
    const current = { ...baseline, layout: { ...baseline.layout } };
    const draft = { ...baseline, width: baseline.width + 100, layout: { ...baseline.layout } };
    const snapshots = structuredClone({ baseline, current, draft });

    const merged = mergeSettingsDraft(current, baseline, draft);
    expect({ baseline, current, draft }).toEqual(snapshots);
    expect(merged).not.toBe(current);
    expect(merged.layout).not.toBe(current.layout);
    expect(merged.layout).not.toBe(draft.layout);
    merged.layout.gridSize += 1;
    expect({ baseline, current, draft }).toEqual(snapshots);
  });
});

describe('settings dialog live draft rebase', () => {
  it('reflects live inheritance changes and allows staging the opposite value again', () => {
    const baseline = settings();
    const opened = createSettingsDialogDraft(baseline, { headline: true, ticker: true });

    const live = rebaseSettingsDialogDraft(opened, baseline, { headline: false, ticker: true });
    expect(live.inheritance).toEqual({ headline: false, ticker: true });
    expect(live.baselineInheritance).toEqual({ headline: false, ticker: true });

    const staged = { ...live, inheritance: { ...live.inheritance, headline: true } };
    const changed = Object.fromEntries(
      Object.entries(staged.inheritance).filter(
        ([id, inherit]) => staged.baselineInheritance[id] !== inherit,
      ),
    );
    expect(changed).toEqual({ headline: true });
  });

  it('adopts live default fields while preserving independently authored draft fields', () => {
    const baseline = settings();
    const opened = createSettingsDialogDraft(baseline, { headline: true });
    opened.settings.width = baseline.width + 100;
    opened.settings.layout.gridSize = baseline.layout.gridSize + 5;
    const current = {
      ...baseline,
      height: baseline.height + 200,
      width: baseline.width + 300,
      layout: { ...baseline.layout, snapThreshold: 0 },
    };

    const rebased = rebaseSettingsDialogDraft(opened, current, { headline: true });
    expect(rebased.settings).toEqual({
      ...current,
      width: opened.settings.width,
      layout: { ...current.layout, gridSize: opened.settings.layout.gridSize },
    });
    expect(rebased.baselineSettings).toEqual(current);
  });

  it('preserves staged inheritance while adopting untouched live checkbox values', () => {
    const baseline = settings();
    const opened = createSettingsDialogDraft(baseline, { headline: true, ticker: true });
    opened.inheritance.headline = false;

    const rebased = rebaseSettingsDialogDraft(opened, baseline, {
      headline: true,
      ticker: false,
    });
    expect(rebased.inheritance).toEqual({ headline: false, ticker: false });
    expect(rebased.baselineInheritance).toEqual({ headline: true, ticker: false });
  });

  it('adopts new templates and removes stale inheritance entries for removed templates', () => {
    const baseline = settings();
    const opened = createSettingsDialogDraft(baseline, { removed: true, kept: true });
    opened.inheritance.removed = false;
    opened.inheritance.kept = false;

    const rebased = rebaseSettingsDialogDraft(opened, baseline, { kept: true, added: false });
    expect(rebased.inheritance).toEqual({ kept: false, added: false });
    expect(rebased.baselineInheritance).toEqual({ kept: true, added: false });
  });

  it('is pure and returns the same draft for repeated notifications of the same live state', () => {
    const baseline = settings();
    const opened = createSettingsDialogDraft(baseline, { headline: true });
    opened.settings.width += 100;
    const current = { ...baseline, height: baseline.height + 50 };
    const currentInheritance = { headline: false };
    const originals = structuredClone({ opened, current, currentInheritance });

    const rebased = rebaseSettingsDialogDraft(opened, current, currentInheritance);
    expect({ opened, current, currentInheritance }).toEqual(originals);
    expect(rebaseSettingsDialogDraft(rebased, current, currentInheritance)).toBe(rebased);
    rebased.baselineSettings.layout.gridSize += 1;
    rebased.baselineInheritance.headline = true;
    expect({ opened, current, currentInheritance }).toEqual(originals);
  });
});
