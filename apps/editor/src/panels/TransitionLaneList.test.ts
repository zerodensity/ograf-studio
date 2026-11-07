import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { layersTopFirst } from '../state/transitionChoreography';
import { activeTransitionLane } from '../state/transitionLaneSelection';
import { TransitionLaneList } from './TransitionLaneList';

describe('transition lane navigation', () => {
  const definition = createTransitionLogicNewsExample(0).transitionLogic!;
  const lanes = layersTopFirst(definition);

  it('keeps a selection by identity after reordering and falls back after removal', () => {
    const selected = lanes[1]!;
    expect(activeTransitionLane([...lanes].reverse(), selected.id)?.id).toBe(selected.id);
    const remaining = lanes.filter((lane) => lane.id !== selected.id);
    expect(activeTransitionLane(remaining, selected.id)?.id).toBe(remaining[0]?.id);
    expect(activeTransitionLane([], selected.id)).toBeUndefined();
  });

  it('lists lanes and marks exactly the selected lane, with the add control locked when needed', () => {
    const active = lanes[1]!;
    const html = renderToStaticMarkup(
      createElement(TransitionLaneList, {
        definition,
        lanes,
        activeLaneId: active.id,
        locked: 'Resolve conflict first',
        onSelectLane: () => {},
        onAddLane: () => {},
      }),
    );
    expect(html).toContain('aria-label="Transition lanes"');
    expect(html).toContain(`title="${active.name}"`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('disabled=""');
    expect(html).toContain('+ Add lane');
  });
});
