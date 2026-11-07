import { describe, expect, it } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  createComposition,
  createRectangleLayer,
  createShaderElement,
  type TransitionLogicDefinition,
  transitionLogicAdmissionError,
  planTransitionLogicPlay,
} from '@ograf-editor/scene-model';
import type { CoordinatedPlayoutSnapshot } from '@ograf-editor/ograf-types';
import { createTransitionLogicSession, reduceTransitionLogic } from '@ograf-editor/scene-model';
import {
  coordinatedCertificationCases,
  coordinatedCertificationCanvasCounts,
  coordinatedCertificationConflicts,
  coordinatedCertificationStateErrors,
  coordinatedCertificationSuccessErrors,
  coordinatedCertificationRejectionErrors,
  coordinatedCertificationNextTransitionFrame,
  createCoordinatedStartupEvidence,
} from './coordinatedCertification';

describe('coordinated canvas expectations', () => {
  function shaderDescriptor() {
    const rectangle = createRectangleLayer();
    if (rectangle.element.type !== 'rectangle') throw new Error('Expected rectangle');
    rectangle.element.fill = createShaderElement();
    return compileDescriptor(createComposition({ layers: [rectangle] }));
  }
  function fixture() {
    const descriptor = shaderDescriptor();
    const sharedLayers = [
      { layerId: descriptor.layers[0]!.id, instanceId: 'headline', sourceLayerId: 'panel' },
    ];
    return { descriptor, sharedLayers };
  }
  it('counts retained shader assets once for a template containing only their proxies', () => {
    const template = fixture();
    const shared = [shaderDescriptor(), shaderDescriptor()];
    expect(coordinatedCertificationCanvasCounts(template, shared)).toEqual({
      canvases: 2,
      shaders: 2,
    });
    // Removing a real retained source must still reduce the expected physical canvas count.
    expect(coordinatedCertificationCanvasCounts(template, shared.slice(0, 1))).toEqual({
      canvases: 1,
      shaders: 1,
    });
  });
  it('retains proxy and local shader checks for mixed templates, matching actual runtime allocation', () => {
    const template = fixture();
    template.descriptor.layers.push(...shaderDescriptor().layers);
    expect(
      coordinatedCertificationCanvasCounts(template, [shaderDescriptor(), shaderDescriptor()]),
    ).toEqual({ canvases: 4, shaders: 4 });
  });
  it('does not classify a template with runtime collection artwork as shared-only', () => {
    const template = fixture();
    template.descriptor.collections = [
      {
        id: 'rows',
        name: 'Rows',
        dataKey: 'rows',
        prototypeLayers: shaderDescriptor().layers,
        offsetPerItem: { x: 0, y: 100 },
        capacity: 3,
        overflow: 'truncate',
        itemKeyPath: [],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 3,
        page: 0,
      },
    ];
    expect(
      coordinatedCertificationCanvasCounts(template, [shaderDescriptor(), shaderDescriptor()]),
    ).toEqual({ canvases: 6, shaders: 6 });
  });
});

function fixture(): TransitionLogicDefinition {
  return {
    version: 4,
    id: 'news',
    name: 'News',
    slots: [
      {
        id: 'headline',
        name: 'Headline',
        order: 0,
        admission: { blockWhileActiveSlotIds: ['breaking'] },
      },
      {
        id: 'subline',
        name: 'Second line',
        order: 1,
        parentSlotId: 'headline',
        admission: { requireOnSlotIds: ['headline'], blockWhileActiveSlotIds: ['breaking'] },
      },
      {
        id: 'header',
        name: 'Header',
        order: 2,
        parentSlotId: 'subline',
        admission: { requireOnSlotIds: ['subline'], blockWhileActiveSlotIds: ['breaking'] },
      },
      { id: 'breaking', name: 'Breaking', order: 3 },
    ],
    states: ['breaking', 'headline', 'subline', 'header'].map((id) => ({
      id,
      name: id,
      slotId: id,
      templateId: id,
    })),
    transitions: [
      {
        id: 'wipe',
        name: 'Wipe',
        durationFrames: 10,
        outgoingFrames: 10,
        incomingStartFrame: 0,
        incomingFrames: 10,
        sharedFrames: 10,
        easing: 'linear',
      },
    ],
    routes: [],
    defaultTransitionId: 'wipe',
    sharedInstances: [],
    initialSharedValues: [],
  };
}

describe('coordinated certification Take prerequisites', () => {
  it('isolates cases and explicitly settles prerequisites before each dependent Take', () => {
    const definition = fixture();
    const cases = coordinatedCertificationCases(definition);
    expect(
      cases.find((entry) => entry.state.id === 'header')?.prerequisites.map((s) => s.id),
    ).toEqual(['headline', 'subline']);
    for (const { state, prerequisites } of cases) {
      let session = createTransitionLogicSession(definition);
      for (const next of [...prerequisites, state]) {
        expect(transitionLogicAdmissionError(definition, session, next.slotId, next.id)).toBeNull();
        const requestId = `certify-${next.id}`;
        session = reduceTransitionLogic(definition, session, {
          type: 'request',
          frame: session.frame,
          slotId: next.slotId,
          stateId: next.id,
          requestId,
        }).session;
        session = reduceTransitionLogic(definition, session, {
          type: 'ready',
          frame: session.frame,
          slotId: next.slotId,
          requestId,
        }).session;
        session = reduceTransitionLogic(definition, session, {
          type: 'advance',
          frame: session.frame + 10,
        }).session;
      }
    }
  });

  it('keeps direct invalid Take rejection meaningful rather than disabling admission for certification', () => {
    const definition = fixture();
    expect(
      transitionLogicAdmissionError(
        definition,
        createTransitionLogicSession(definition),
        'header',
        'header',
      ),
    ).toMatch(/must be On/);
  });

  it('reports missing or contradictory prerequisites instead of silently skipping a template', () => {
    const definition = fixture();
    definition.states = definition.states.filter((state) => state.id !== 'headline');
    expect(() => coordinatedCertificationCases(definition)).toThrow(
      /required lane headline has no state/,
    );
    const conflicting = fixture();
    conflicting.slots[2]!.admission!.blockWhileActiveSlotIds = ['subline'];
    expect(() => coordinatedCertificationCases(conflicting)).toThrow(
      /required lane subline must also be Off/,
    );
  });
});

function output(states: Record<string, string | null>): CoordinatedPlayoutSnapshot {
  return {
    loaded: true,
    definitionId: 'news',
    definitionRevision: '1',
    frame: 100,
    frameRate: 25,
    renderType: 'realtime',
    paused: false,
    recordingTruncated: false,
    clockEpochMs: null,
    error: null,
    slots: Object.fromEntries(
      Object.entries(states).map(([id, stateId]) => {
        const selection = stateId
          ? { requestId: id, instanceId: id, stateId, templateId: stateId, data: {} }
          : null;
        return [
          id,
          {
            slotId: id,
            name: id,
            current: selection,
            desired: selection,
            outgoing: null,
            incoming: null,
            pending: null,
            readiness: 'ready',
            error: null,
            transition: null,
          },
        ];
      }),
    ),
    prepared: {},
  };
}

describe('coordinated default Play certification', () => {
  it('requires explicit status 200 instead of accepting a well-shaped failure or missing return', () => {
    expect(coordinatedCertificationSuccessErrors({ statusCode: 200 })).toEqual([]);
    for (const payload of [
      undefined,
      {},
      { statusCode: 201 },
      { statusCode: 400 },
      { statusCode: 550 },
    ])
      expect(coordinatedCertificationSuccessErrors(payload)).not.toEqual([]);
  });

  it('checks the actual settled on-air selection, not pending or desired state', () => {
    const expected = { headline: 'headline', subline: null };
    const actual = output(expected);
    expect(coordinatedCertificationStateErrors(expected, actual)).toEqual([]);
    actual.slots.headline!.current = null;
    expect(coordinatedCertificationStateErrors(expected, actual)).toEqual([
      'Startup lane headline did not settle on state headline.',
    ]);
    actual.slots.headline!.current = actual.slots.headline!.desired;
    actual.slots.headline!.pending = {
      requestId: 'pending',
      stateId: 'headline',
      data: {},
      ready: true,
    };
    expect(coordinatedCertificationStateErrors(expected, actual)).not.toEqual([]);
    expect(coordinatedCertificationStateErrors(expected, null)).not.toEqual([]);
    expect(
      coordinatedCertificationStateErrors(expected, { ...output(expected), loaded: false }),
    ).not.toEqual([]);
  });

  it('requires rejected conflicts to preserve selections and preparation while allowing the clock to advance', () => {
    const before = output({ headline: 'headline', breaking: null });
    const after = structuredClone(before);
    after.frame += 1;
    expect(coordinatedCertificationRejectionErrors({ statusCode: 550 }, before, after)).toEqual([]);
    expect(coordinatedCertificationRejectionErrors({ statusCode: 200 }, before, after)).not.toEqual(
      [],
    );
    after.slots.headline!.current = null;
    expect(coordinatedCertificationRejectionErrors({ statusCode: 550 }, before, after)).toContain(
      'Conflicting Play changed retained output or resource preparation.',
    );
    expect(coordinatedCertificationRejectionErrors(undefined, before, before)).not.toEqual([]);
  });

  it('samples observed startup completion boundaries without seeking to a later timer or unused recipe', () => {
    const actual = output({ headline: null, subline: null });
    actual.frame = 0;
    actual.slots.headline!.transition = {
      id: 'entry',
      requestId: 'headline',
      transitionId: 'entry',
      startFrame: 0,
      endFrame: 25,
      progress: 0,
    };
    expect(coordinatedCertificationNextTransitionFrame(actual)).toBe(25);
    actual.frame = 25;
    actual.slots.headline!.transition = null;
    actual.slots.subline!.transition = {
      id: 'subline-entry',
      requestId: 'subline',
      transitionId: 'entry',
      startFrame: 25,
      endFrame: 50,
      progress: 0,
    };
    expect(coordinatedCertificationNextTransitionFrame(actual)).toBe(50);
    actual.frame = 50;
    actual.slots.subline!.transition = null;
    expect(coordinatedCertificationNextTransitionFrame(actual)).toBeNull();
    // No 5-second alarm or unrelated 20-second recipe participates in this choice.
    expect(coordinatedCertificationNextTransitionFrame(null)).toBeNull();
  });

  it('accepts authored post-Play Rules only after witnessing the complete settled baseline', () => {
    const expected = { headline: 'headline', subline: null };
    const evidence = createCoordinatedStartupEvidence(expected);
    const off = output({ headline: null, subline: null });
    evidence.observe(off);
    expect(evidence.entered).toBe(false);
    expect(evidence.errors(off)).not.toEqual([]);
    const completed = output(expected);
    evidence.observe(completed);
    expect(evidence.entered).toBe(true);
    // A final Played In/Step Rule may immediately Clear or replace the just-entered artwork.
    expect(evidence.errors(off)).toEqual([]);
    expect(evidence.errors({ ...off, error: 'Rules failed' })).not.toEqual([]);
    expect(createCoordinatedStartupEvidence(expected).errors(off)).not.toEqual([]);
  });

  it('does not accept a partial or interrupted entry as evidence of startup completion', () => {
    const expected = { headline: 'headline', subline: 'subline' };
    const evidence = createCoordinatedStartupEvidence(expected);
    evidence.observe(output({ headline: 'headline', subline: null }));
    const transitioning = output(expected);
    transitioning.slots.subline!.transition = {
      id: 'entry',
      requestId: 'subline',
      transitionId: 'entry',
      startFrame: 0,
      endFrame: 25,
      progress: 0.9,
    };
    evidence.observe(transitioning);
    const interrupted = output({ headline: null, subline: null });
    expect(evidence.entered).toBe(false);
    expect(evidence.errors(interrupted)).not.toEqual([]);
  });

  it('builds negative Signal Blue admission and takeover intents without modifying the definition', () => {
    const definition = fixture();
    definition.states.find((state) => state.id === 'breaking')!.takeOutSlotIds = [
      'headline',
      'subline',
      'header',
    ];
    const before = structuredClone(definition);
    const cases = coordinatedCertificationConflicts(definition);
    expect(
      cases.some((entry) => entry.states.header === 'header' && entry.states.subline === null),
    ).toBe(true);
    expect(
      cases.some(
        (entry) => entry.states.headline === 'headline' && entry.states.breaking === 'breaking',
      ),
    ).toBe(true);
    for (const entry of cases) {
      const session = createTransitionLogicSession(definition);
      const original = structuredClone(session);
      expect(planTransitionLogicPlay(definition, session, entry.states).valid).toBe(false);
      expect(session).toEqual(original);
    }
    expect(definition).toEqual(before);
  });
});
