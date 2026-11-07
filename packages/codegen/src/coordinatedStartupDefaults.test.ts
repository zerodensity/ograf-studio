import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createProject,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type CoordinatedExportInput,
} from './buildCoordinatedExportArtifacts';
import { BUILT_IN_EXPORT_PROFILES } from './exportProfiles';

function signalBlueInput(): CoordinatedExportInput {
  const project = createProject({ name: 'Signal Blue startup guards' });
  project.compositions[0]!.dataFields.push(
    createFieldDefinition('text', { key: 'headline', defaultValue: 'STUDIO DEFAULT' }),
  );
  const definition: TransitionLogicDefinition = {
    version: 4,
    id: 'signal-blue-guards',
    name: 'Signal Blue guards',
    slots: [
      { id: 'empty', name: 'Empty lane', order: -1 },
      {
        id: 'headline',
        name: 'Headline',
        order: 0,
        admission: { blockWhileActiveSlotIds: ['alert'] },
      },
      {
        id: 'subline',
        name: 'Second line',
        order: 1,
        parentSlotId: 'headline',
        admission: { requireOnSlotIds: ['headline'], blockWhileActiveSlotIds: ['alert'] },
      },
      {
        id: 'header',
        name: 'Header',
        order: 2,
        parentSlotId: 'subline',
        admission: { requireOnSlotIds: ['subline'], blockWhileActiveSlotIds: ['alert'] },
      },
      { id: 'alert', name: 'Breaking', order: 3 },
      { id: 'clock', name: 'Clock', order: 4 },
      { id: 'ticker', name: 'Ticker', order: 5 },
    ],
    // Global state order must not let a takeover preempt the normal first lane.
    states: ['alert', 'header', 'subline', 'headline', 'clock', 'ticker'].map((id) => ({
      id: `${id}-state`,
      name: id,
      slotId: id,
      templateId: 'news',
      dataDefaults: { headline: `${id.toUpperCase()} DEFAULT` },
      ...(id === 'alert' ? { takeOutSlotIds: ['headline', 'subline', 'header'] } : {}),
    })),
    transitions: [
      {
        id: 'cut',
        name: 'Cut',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'linear',
      },
    ],
    routes: [],
    defaultTransitionId: 'cut',
    sharedInstances: [],
    initialSharedValues: [],
  };
  return {
    id: 'signal-blue-startup',
    name: 'Signal Blue startup',
    definition,
    templates: [{ id: 'news', name: 'News', project }],
    componentAssets: [],
  };
}

describe('coordinated safe startup defaults', () => {
  it.each(BUILT_IN_EXPORT_PROFILES)(
    'uses the same legal manifest/runtime baseline in $mode exports',
    (profile) => {
      const input = signalBlueInput();
      const before = structuredClone(input);
      const result = buildCoordinatedExportArtifactsWithRuntime(
        input,
        'class CoordinatedGraphicElement {}',
        profile,
      );
      expect(result.projectErrors).toEqual([]);
      const runtimeSlots = result.transitionDescriptor!.dataDefaults!.slots;
      expect(
        Object.fromEntries(Object.entries(runtimeSlots).map(([id, value]) => [id, value.stateId])),
      ).toEqual({
        empty: null,
        headline: 'headline-state',
        subline: null,
        header: null,
        alert: null,
        clock: 'clock-state',
        ticker: 'ticker-state',
      });
      const schema = result.manifest.schema as {
        default: { slots: Record<string, { stateId: string; data: Record<string, unknown> }> };
        properties: {
          slots: {
            default: Record<string, { stateId: string; data: Record<string, unknown> }>;
            properties: Record<
              string,
              {
                default: { stateId: string; data: Record<string, unknown> };
                properties: { stateId: { default: string }; data: { default: unknown } };
              }
            >;
          };
        };
      };
      for (const [id, slot] of Object.entries(runtimeSlots)) {
        const expected = { stateId: slot.stateId ?? '', data: slot.data };
        expect(schema.default.slots[id]).toEqual(expected);
        expect(schema.properties.slots.default[id]).toEqual(expected);
        expect(schema.properties.slots.properties[id]!.default).toEqual(expected);
        expect(schema.properties.slots.properties[id]!.properties.stateId.default).toBe(
          expected.stateId,
        );
        expect(schema.properties.slots.properties[id]!.properties.data.default).toEqual(slot.data);
      }
      expect(runtimeSlots.subline!.data).toEqual({ headline: 'SUBLINE DEFAULT' });
      expect(runtimeSlots.alert!.data).toEqual({ headline: 'ALERT DEFAULT' });
      expect(input).toEqual(before);
    },
  );

  it('keeps custom Take suggestions valid even when a lane starts Off', () => {
    const result = buildCoordinatedExportArtifactsWithRuntime(
      signalBlueInput(),
      'class CoordinatedGraphicElement {}',
    );
    const take = result.manifest.customActions!.find((action) => action.id === 'transition.take')!;
    const schema = take.schema as {
      properties: { slotId: { default: string }; stateId: { default: string } };
      allOf: Array<{
        if: { properties: { slotId: { const: string } } };
        then: { properties: { stateId: { enum: string[]; default: string } } };
      }>;
    };
    expect(schema.properties.slotId.default).toBe('headline');
    expect(schema.properties.stateId.default).toBe('headline-state');
    const header = schema.allOf.find((entry) => entry.if.properties.slotId.const === 'header')!;
    expect(result.transitionDescriptor!.dataDefaults!.slots.header!.stateId).toBeNull();
    expect(header.then.properties.stateId.default).toBe('header-state');
    expect(header.then.properties.stateId.enum).toContain('header-state');
    const guide = result.resources.find((resource) => resource.path === 'README.md')!.data;
    expect(guide).toContain('playAction({goto:0})');
    expect(guide).toContain('another Play after the single on-air Step advances Out');
    expect(guide).toContain('enters required parents before their dependents');
    expect(guide).toContain(
      'preparation failures reject the batch while preserving working output',
    );
    expect(guide).toContain('Custom Take form suggestions are separate');
    const dataExample = /```json\n([\s\S]*?)\n```/.exec(String(guide));
    expect(JSON.parse(dataExample![1]!)).toMatchObject({
      slots: { headline: { stateId: 'headline-state' } },
    });
  });

  it('uses the selected safe fallback state data rather than the conflicting first state preset', () => {
    const input = signalBlueInput();
    input.definition.slots.push({ id: 'overlay', name: 'Overlay', order: 6 });
    input.definition.states.push(
      {
        id: 'takeover-overlay',
        name: 'Takeover overlay',
        slotId: 'overlay',
        templateId: 'news',
        takeOutSlotIds: ['headline'],
        dataDefaults: { headline: 'WRONG PRESET' },
      },
      {
        id: 'safe-overlay',
        name: 'Safe overlay',
        slotId: 'overlay',
        templateId: 'news',
        dataDefaults: { headline: 'SAFE PRESET' },
      },
    );
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.projectErrors).toEqual([]);
    expect(result.transitionDescriptor!.dataDefaults!.slots.overlay).toEqual({
      stateId: 'safe-overlay',
      data: { headline: 'SAFE PRESET' },
    });
  });
});
