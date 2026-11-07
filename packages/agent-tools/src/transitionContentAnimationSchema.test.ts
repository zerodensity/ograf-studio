import { describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
  TRANSITION_LOGIC_VERSION,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { templateSetOperationSchema } from './templateSetSchemas';

function fixture(): TransitionLogicDefinition {
  return {
    version: TRANSITION_LOGIC_VERSION,
    id: 'content-motion',
    name: 'Content motion',
    defaultTransitionId: 'switch',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [],
    transitions: [
      {
        id: 'switch',
        name: 'Switch',
        durationFrames: 24,
        outgoingFrames: 12,
        incomingStartFrame: 12,
        incomingFrames: 12,
        sharedFrames: 24,
        easing: 'ease-in-out',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
}

function pack() {
  return createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'example.motion',
      version: '1.0.0',
      name: 'Example motion',
      license: 'MIT',
    },
    licenseText: 'MIT example data',
    presets: [
      {
        id: 'exit',
        name: 'Exit',
        targetKinds: ['rectangle'],
        parameters: [{ id: 'distance', label: 'Distance', default: 80, min: 0, max: 500, step: 1 }],
        tracks: {
          out: [
            {
              property: 'y',
              mode: 'offset',
              keys: [
                { at: 0, value: 'on-air' },
                { at: 1, value: { parameter: 'distance' }, easing: 'cubic-in' },
              ],
            },
          ],
        },
      },
    ],
  });
}

function accepted(definition: unknown): boolean {
  return templateSetOperationSchema.safeParse({ type: 'set_transition_logic', definition }).success;
}

describe('Transition content animation MCP contract', () => {
  it('preserves independent native and pinned plugin choices without changing shared timings', () => {
    const definition = fixture();
    const snapshot = pack();
    definition.animationPresetPlugins = [snapshot];
    definition.transitions[0]!.incomingAnimation = {
      type: 'builtin',
      motion: { style: 'slide', direction: 'left', distance: 120, easing: 'cubic-out' },
    };
    definition.transitions[0]!.outgoingAnimation = {
      type: 'plugin',
      reference: studioPluginReference(snapshot),
      presetId: 'exit',
      parameters: { distance: 160 },
    };
    const result = templateSetOperationSchema.parse({ type: 'set_transition_logic', definition });
    expect(result).toEqual({ type: 'set_transition_logic', definition });
    expect(definition.transitions[0]!.sharedFrames).toBe(24);
  });

  it('accepts explicit template animation and retains legacy defaults when choices are absent', () => {
    const definition = fixture();
    definition.transitions[0]!.incomingAnimation = { type: 'template' };
    expect(accepted(definition)).toBe(true);
    delete definition.transitions[0]!.incomingAnimation;
    for (const version of [1, 2, 3, 4] as const) {
      definition.version = version;
      expect(accepted(definition)).toBe(true);
    }
  });

  it('requires v5 for selectors, including explicit template choices and pack definitions', () => {
    const definition = fixture();
    definition.version = 4;
    definition.transitions[0]!.incomingAnimation = { type: 'template' };
    expect(accepted(definition)).toBe(false);
    delete definition.transitions[0]!.incomingAnimation;
    definition.animationPresetPlugins = [pack()];
    expect(accepted(definition)).toBe(false);
  });

  it('rejects executable choices and native options outside the existing motion contract', () => {
    for (const incomingAnimation of [
      { type: 'javascript', source: 'alert(1)' },
      { type: 'template', script: 'alert(1)' },
      { type: 'builtin', motion: { style: 'unknown' } },
      { type: 'builtin', motion: { style: 'slide', distance: -10 } },
      { type: 'builtin', motion: { style: 'slide', durationFrames: 12 } },
    ]) {
      const definition = fixture();
      const raw = {
        ...definition,
        transitions: [{ ...definition.transitions[0], incomingAnimation }],
      };
      expect(accepted(raw), JSON.stringify(incomingAnimation)).toBe(false);
    }
  });

  it('rejects missing, tampered, wrong-side and out-of-range plugin selections', () => {
    const definition = fixture();
    const snapshot = pack();
    definition.transitions[0]!.outgoingAnimation = {
      type: 'plugin',
      reference: studioPluginReference(snapshot),
      presetId: 'exit',
      parameters: { distance: 160 },
    };
    expect(accepted(definition)).toBe(false);
    definition.animationPresetPlugins = [snapshot];
    expect(accepted(definition)).toBe(true);
    definition.transitions[0]!.incomingAnimation = definition.transitions[0]!.outgoingAnimation;
    expect(accepted(definition)).toBe(false);
    delete definition.transitions[0]!.incomingAnimation;
    definition.transitions[0]!.outgoingAnimation.parameters = { distance: 501 };
    expect(accepted(definition)).toBe(false);
    definition.transitions[0]!.outgoingAnimation.parameters = { distance: 160 };
    snapshot.presets[0]!.name = 'Tampered';
    expect(accepted(definition)).toBe(false);
  });
});
