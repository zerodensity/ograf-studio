import { describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createProject,
  createRendererPluginSnapshot,
  studioPluginReference,
  type ChartElement,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { AuthoringSession } from './session';
import type { AuthoringOperation } from './types';

function fixture(modern = true, pinProvider = true) {
  const project = createProject();
  const pack = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.mark-operations',
      version: '1.0.0',
      name: 'Mark motion',
      license: 'MIT',
    },
    licenseText: 'MIT',
    presets: [
      {
        id: 'fade',
        name: 'Fade marks',
        parameters: [{ id: 'distance', label: 'Distance', default: 20, min: 0, max: 200, step: 1 }],
        tracks: {
          in: [
            {
              property: 'x',
              mode: 'offset',
              keys: [
                { at: 0, value: { parameter: 'distance', multiplier: -1 } },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
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
      },
    ],
  });
  const provider = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.mark-operations-provider',
      version: modern ? '1.3.0' : '1.2.0',
      name: 'Chart renderer',
      license: 'MIT',
      presets: ['bar', 'pie', 'line'],
      ...(modern ? { chartFeatures: ['mark-animation-v1'] } : {}),
    },
    source:
      'export default {apiVersion:1,create(){return {renderAtFrame(){},update(){},dispose(){}}}};',
    licenseText: 'MIT',
  });
  project.compositions[0]!.animationPresetPlugins = [pack];
  project.compositions[0]!.rendererPlugins = [provider];
  const session = new AuthoringSession(project);
  session.apply({
    expectedRevision: 0,
    operations: [
      {
        type: 'add_layer',
        id: 'chart',
        kind: 'chart',
        name: 'Results',
        element: { provider: studioPluginReference(provider) },
      },
    ],
  });
  if (!pinProvider) {
    const source = session.snapshot().project;
    source.compositions[0]!.rendererPlugins = [];
    return { ...fixtureFrom(new AuthoringSession(source)), pack, provider };
  }
  return { ...fixtureFrom(session), pack, provider };
  function fixtureFrom(activeSession: AuthoringSession) {
    const reference = studioPluginReference(pack);
    const operation = {
      type: 'apply_animation_preset' as const,
      target: 'chart-marks' as const,
      layerId: 'chart',
      reference,
      presetId: 'fade',
      side: 'in' as const,
      durationFrames: 6,
      delayFrames: 1,
      staggerFrames: 1,
      parameters: { distance: 35 },
    };
    return { session: activeSession, reference, operation };
  }
}
const chart = (session: AuthoringSession) => session.snapshot().project.compositions[0]!.layers[0]!;

describe('chart mark animation authoring operations', () => {
  it('applies exact source presets independently, preserves layer keys and bakes compact seekable curves', () => {
    const { session, operation, pack } = fixture();
    const before = chart(session);
    const result = session.apply({
      expectedRevision: 1,
      operations: [operation, { ...operation, side: 'out', delayFrames: 0 }],
    });
    expect(result.validation.errors).toEqual([]);
    const target = chart(session);
    expect(target.element).toMatchObject({
      markAnimations: {
        in: {
          reference: studioPluginReference(pack),
          durationFrames: 6,
          delayFrames: 1,
          staggerFrames: 1,
          parameters: { distance: 35 },
        },
        out: { delayFrames: 0 },
      },
    });
    expect(target.animationTracks).toEqual(before.animationTracks);
    expect(target.keyframes).toEqual(before.keyframes);
    expect(target.animationPresets).toBeUndefined();
    const descriptor = compileDescriptor(result.project.compositions[0]!);
    expect(descriptor.layers[0]!).toMatchObject({
      chartMarkAnimations: {
        in: { durationFrames: 6, staggerFrames: 1 },
        out: { durationFrames: 6 },
      },
    });
    expect(JSON.stringify(descriptor.layers[0]!.chartMarkAnimations)).not.toContain(
      pack.manifest.id,
    );
    expect(descriptor).not.toHaveProperty('animationPresetPlugins');
    expect(session.undo(2).project.compositions[0]!.layers[0]).toEqual(before);
  });

  it('refuses to remove a referenced pack until all mark choices are explicitly cleared', () => {
    const { session, operation, reference } = fixture();
    session.apply({ expectedRevision: 1, operations: [operation] });
    const before = session.snapshot();
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'remove_animation_preset_plugin', reference }],
      }),
    ).toThrow(/still referenced.*Results/);
    expect(session.snapshot()).toEqual(before);
    const cleared = session.apply({
      expectedRevision: 2,
      operations: [
        { type: 'update_element', layerId: 'chart', patch: { markAnimations: {} } },
        { type: 'remove_animation_preset_plugin', reference },
      ],
    });
    expect(cleared.validation.errors).toEqual([]);
    expect(cleared.project.compositions[0]!.animationPresetPlugins).toBeUndefined();
    expect((chart(session).element as ChartElement).markAnimations).toEqual({});
  });

  it.each([
    { offsetFrames: 0 },
    { durationFrames: 13 },
    { delayFrames: -1 },
    { staggerFrames: 101 },
    { parameters: { distance: 201 } },
    { presetId: 'missing' },
    { reference: { id: 'test.mark-operations', version: '2.0.0', sha256: 'a'.repeat(64) } },
  ])('rejects an invalid mark request and preceding batch edits atomically: %j', (patch) => {
    const { session, operation } = fixture();
    const before = session.snapshot();
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [
          { type: 'rename_layer', layerId: 'chart', name: 'Must roll back' },
          { ...operation, ...patch },
        ],
      }),
    ).toThrow();
    expect(session.snapshot()).toEqual(before);
  });

  it.each([{ delayFrames: 0 }, { staggerFrames: 0 }])(
    'rejects mark-only timing on a whole-layer preset: %j',
    (patch) => {
      const { session, operation } = fixture();
      const {
        target: _target,
        delayFrames: _delay,
        staggerFrames: _stagger,
        ...layerOperation
      } = operation;
      const before = session.snapshot();
      expect(() =>
        session.apply({ expectedRevision: 1, operations: [{ ...layerOperation, ...patch }] }),
      ).toThrow(/require target chart-marks/);
      expect(session.snapshot()).toEqual(before);
    },
  );

  it.each(['old', 'missing'] as const)(
    'rejects a %s provider without publishing the mark choice',
    (kind) => {
      const { session, operation } = fixture(kind !== 'old', kind !== 'missing');
      const before = session.snapshot();
      expect(() =>
        session.apply({ expectedRevision: session.revision, operations: [operation] }),
      ).toThrow(/mark-animation-v1|pinned compatible renderer/);
      expect(session.snapshot()).toEqual(before);
    },
  );

  it('does not accept mark animation on another layer kind, even with a valid exact pack', () => {
    const { session, operation } = fixture();
    const before = session.snapshot();
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [
          { type: 'add_layer', id: 'rectangle', kind: 'rectangle' },
          { ...operation, layerId: 'rectangle' } as AuthoringOperation,
        ],
      }),
    ).toThrow(/chart layer/);
    expect(session.snapshot()).toEqual(before);
  });

  it('repairs an old-provider chart by explicitly clearing mark animation settings', () => {
    const { session, operation } = fixture();
    session.apply({ expectedRevision: 1, operations: [operation] });
    const source = session.snapshot().project;
    const old = fixture(false).provider;
    source.compositions[0]!.rendererPlugins = [old];
    (source.compositions[0]!.layers[0]!.element as ChartElement).provider =
      studioPluginReference(old);
    const repair = new AuthoringSession(source);
    expect(repair.snapshot().validation.errors.join(' ')).toContain('mark-animation-v1');
    const result = repair.apply({
      expectedRevision: 0,
      operations: [{ type: 'update_element', layerId: 'chart', patch: { markAnimations: {} } }],
    });
    expect(result.validation.errors).toEqual([]);
    expect((chart(repair).element as ChartElement).markAnimations).toEqual({});
  });
});
