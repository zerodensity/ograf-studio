import { describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
  TRANSITION_LOGIC_VERSION,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import {
  defaultTransitionContentMotion,
  pinTransitionAnimationPlugin,
  transitionAnimationChoiceKey,
  transitionAnimationPacks,
} from './transitionContentAnimationEditing';
import { resolveLayerPhase, setPhaseTiming } from './transitionChoreography';
import { inspectTransitionPhaseRule, upsertTransitionPhaseRule } from './transitionRuleAuthoring';

export function animationPack() {
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
  return createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.content',
      version: '1.0.0',
      name: 'Motion pack',
      license: 'MIT',
    },
    licenseText: 'MIT',
    presets: [
      {
        id: 'both',
        name: 'Both sides',
        tracks: {
          in: fade,
          out: [
            {
              property: 'opacity',
              mode: 'absolute',
              keys: [
                { at: 0, value: 'on-air' },
                { at: 1, value: 0 },
              ],
            },
          ],
        },
        parameters: [{ id: 'amount', label: 'Amount', default: 20, min: 0, max: 100, step: 1 }],
      },
      { id: 'in-only', name: 'Entrance only', tracks: { in: fade } },
      { id: 'text-only', name: 'Text only', targetKinds: ['text'], tracks: { in: fade } },
    ],
  });
}

export function animationDefinition(): TransitionLogicDefinition {
  return {
    version: TRANSITION_LOGIC_VERSION,
    id: 'logic',
    name: 'Test',
    defaultTransitionId: 'fade',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [
      { id: 'a', name: 'A', slotId: 'main', templateId: 'template-a' },
      { id: 'b', name: 'B', slotId: 'main', templateId: 'template-b' },
    ],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 24,
        outgoingFrames: 12,
        incomingStartFrame: 4,
        incomingFrames: 20,
        sharedFrames: 24,
        easing: 'ease-in-out',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
}

describe('transition content animation authoring', () => {
  it('filters plugins by enabled/trusted, side and rectangle-wrapper support', () => {
    const snapshot = animationPack();
    const entry = { snapshot, installedAt: '', enabled: true, trusted: true };
    expect(
      transitionAnimationPacks(animationDefinition(), [entry], 'in')[0]?.presets.map(
        (preset) => preset.id,
      ),
    ).toEqual(['both', 'in-only']);
    expect(
      transitionAnimationPacks(animationDefinition(), [entry], 'out')[0]?.presets.map(
        (preset) => preset.id,
      ),
    ).toEqual(['both']);
    expect(
      transitionAnimationPacks(animationDefinition(), [{ ...entry, trusted: false }], 'in'),
    ).toEqual([]);
    expect(
      transitionAnimationPacks(animationDefinition(), [{ ...entry, enabled: false }], 'in'),
    ).toEqual([]);
  });

  it('retains a portable exact pin after uninstall, deduplicates it and never mutates the source', () => {
    const source = animationDefinition();
    const pack = animationPack();
    const pinned = pinTransitionAnimationPlugin(source, pack);
    expect(source.animationPresetPlugins).toBeUndefined();
    expect(pinned.animationPresetPlugins).toEqual([pack]);
    expect(pinTransitionAnimationPlugin(pinned, structuredClone(pack))).toBe(pinned);
    expect(transitionAnimationPacks(pinned, [], 'out')[0]?.retained).toBe(true);
    expect(
      transitionAnimationPacks(
        pinned,
        [{ snapshot: pack, installedAt: '', enabled: true, trusted: true }],
        'in',
      ),
    ).toHaveLength(1);
    expect(
      transitionAnimationPacks(
        pinned,
        [{ snapshot: pack, installedAt: '', enabled: true, trusted: true }],
        'in',
      )[0]?.retained,
    ).toBe(false);
    expect(() => pinTransitionAnimationPlugin(source, { ...pack, sha256: '0'.repeat(64) })).toThrow(
      /integrity/,
    );
  });

  it('uses native motion defaults without baking a second duration or offset', () => {
    expect(defaultTransitionContentMotion('slide')).toEqual({
      type: 'builtin',
      motion: { style: 'slide', direction: 'left', distance: 80 },
    });
    expect(transitionAnimationChoiceKey()).toBe('default');
    expect(transitionAnimationChoiceKey({ type: 'template' })).toBe('template');
    expect(transitionAnimationChoiceKey(defaultTransitionContentMotion('spin'))).toBe(
      'builtin:spin',
    );
  });

  it('isolates a lane phase, retains overrides through retiming, and clears only the explicit side', () => {
    const source = animationDefinition();
    source.transitions[0]!.outgoingAnimation = { type: 'template' };
    let next = setPhaseTiming(
      source,
      { kind: 'layer', slotId: 'main', phase: 'enter' },
      { incomingAnimation: defaultTransitionContentMotion('slide') },
    );
    let recipe = resolveLayerPhase(next, 'main', 'enter').recipe!;
    expect(recipe.incomingAnimation).toMatchObject({ type: 'builtin', motion: { style: 'slide' } });
    expect(resolveLayerPhase(next, 'main', 'exit').recipe?.incomingAnimation).toBeUndefined();
    next = setPhaseTiming(
      next,
      { kind: 'layer', slotId: 'main', phase: 'enter' },
      { incomingFrames: 32, contentMotion: 'wipe' },
    );
    recipe = resolveLayerPhase(next, 'main', 'enter').recipe!;
    expect(recipe.incomingAnimation).toMatchObject({ type: 'builtin' });
    expect(recipe.outgoingAnimation).toEqual({ type: 'template' });
    next = setPhaseTiming(
      next,
      { kind: 'layer', slotId: 'main', phase: 'enter' },
      { incomingAnimation: null },
    );
    expect(resolveLayerPhase(next, 'main', 'enter').recipe?.incomingAnimation).toBeUndefined();
    expect(resolveLayerPhase(next, 'main', 'enter').recipe?.outgoingAnimation).toEqual({
      type: 'template',
    });
    expect(source.transitions[0]!.incomingAnimation).toBeUndefined();
  });

  it('compact rules retain stored choices on timing-only edits and scope a new choice to one state', () => {
    let source = animationDefinition();
    const pack = animationPack();
    source = pinTransitionAnimationPlugin(source, pack);
    source.transitions[0]!.incomingAnimation = {
      type: 'plugin',
      reference: studioPluginReference(pack),
      presetId: 'both',
      parameters: { amount: 45 },
    };
    const inspected = inspectTransitionPhaseRule(source, 'a', 'enter');
    const next = upsertTransitionPhaseRule(source, { ...inspected.input, incomingFrames: 30 });
    const recipe = inspectTransitionPhaseRule(next, 'a', 'enter').recipe!;
    expect(recipe.incomingAnimation).toEqual(source.transitions[0]!.incomingAnimation);
    expect(inspectTransitionPhaseRule(next, 'b', 'enter').recipe?.incomingFrames).toBe(20);
    const changed = upsertTransitionPhaseRule(next, {
      ...inspectTransitionPhaseRule(next, 'a', 'enter').input,
      incomingAnimation: { type: 'template' },
    });
    expect(inspectTransitionPhaseRule(changed, 'a', 'enter').recipe?.incomingAnimation).toEqual({
      type: 'template',
    });
    const cleared = upsertTransitionPhaseRule(changed, {
      ...inspectTransitionPhaseRule(changed, 'a', 'enter').input,
      incomingAnimation: null,
    });
    expect(
      inspectTransitionPhaseRule(cleared, 'a', 'enter').recipe?.incomingAnimation,
    ).toBeUndefined();
    expect(
      inspectTransitionPhaseRule(cleared, 'b', 'enter').recipe?.incomingAnimation,
    ).toMatchObject({ type: 'plugin' });
  });
});
