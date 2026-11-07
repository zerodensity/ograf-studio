import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createProject,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { createProjectSet } from '../state/projectSet';
import { TransitionLaneConditions } from './TransitionLaneConditions';
function fixture() {
  const project = createProject();
  project.compositions[0]!.dataFields = [
    createFieldDefinition('color', {
      key: 'signal',
      label: 'Signal color',
      defaultValue: '#2676ef',
    }),
    createFieldDefinition('boolean', { key: 'show', label: 'Show label', defaultValue: true }),
  ];
  const set = createProjectSet('Preset controls', project);
  const definition: TransitionLogicDefinition = {
    version: 4,
    id: 'conditions-ui',
    name: 'Conditions UI',
    slots: [
      { id: 'header', name: 'Header', order: 0, admission: { requireOnSlotIds: ['headline'] } },
      { id: 'headline', name: 'Headline', order: 1 },
    ],
    states: [
      {
        id: 'source',
        name: 'Source',
        slotId: 'header',
        templateId: set.templates[0]!.id,
        dataDefaults: { signal: '#be1622', show: false },
      },
    ],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'linear',
      },
    ],
    defaultTransitionId: 'fade',
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
  return { set, definition };
}
describe('compact lane conditions authoring controls', () => {
  it('renders collapsed optional settings and shared color/Boolean controls', () => {
    const { set, definition } = fixture();
    const html = renderToStaticMarkup(
      createElement(TransitionLaneConditions, {
        set,
        definition,
        slot: definition.slots[0]!,
        references: {},
        disabled: false,
        run: () => {},
      }),
    );
    expect(html.match(/<details>/g)).toHaveLength(2);
    expect(html).not.toContain('<details open');
    expect(html).toContain('Take conditions');
    expect(html).toContain('Template presets');
    expect(html).toMatch(/aria-label="Choose Signal color preset for Source"/);
    expect(html).toMatch(/aria-label="Show label preset for Source"[^>]+type="checkbox"/);
    expect(html).not.toContain('>false<');
  });
  it('keeps conflicting choices mutually exclusive and exposes no extra playback mode', () => {
    const { set, definition } = fixture();
    const html = renderToStaticMarkup(
      createElement(TransitionLaneConditions, {
        set,
        definition,
        slot: definition.slots[0]!,
        references: {},
        disabled: false,
        run: () => {},
      }),
    );
    expect(html).toMatch(/aria-label="Block Header while Headline is active"[^>]+disabled/);
    expect(html).toContain('A blocked Take stays Off');
    expect(html).not.toMatch(/Rehearsal|Preview mode|Presentation mode/);
  });
});
