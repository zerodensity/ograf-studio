import { describe, expect, it } from 'vitest';
import { createFieldDefinition, createProject } from '@ograf-editor/scene-model';
import { addProjectSetTemplate, createProjectSet } from '../state/projectSet';
import { boardCapturePlan } from './boardCapturePlan';

describe('multi-template Board capture plan', () => {
  it('captures unsaved active edits and every saved row for each template, without leaking active preview data', () => {
    const first = createProject({ name: 'Headline' });
    const second = createProject({ name: 'Score' });
    const f = createFieldDefinition('text', { key: 'headline' });
    const g = createFieldDefinition('text', { key: 'score' });
    first.compositions[0]!.dataFields.push(f);
    second.compositions[0]!.dataFields.push(g);
    second.compositions[0]!.testRundowns = [
      { id: 'scores', name: 'Scores', rows: [{ id: 's1', values: { [g.id]: '3–1' } }] },
    ];
    const set = addProjectSetTemplate(createProjectSet('News', first), second);
    const active = set.templates[0]!.id;
    const editing = structuredClone(first);
    editing.compositions[0]!.testRundowns = [
      {
        id: 'news',
        name: 'News rows',
        rows: [
          { id: 'n1', values: { [f.id]: 'First' } },
          { id: 'n2', values: { [f.id]: 'Second' } },
        ],
      },
    ];
    const before = structuredClone(set);
    const plan = boardCapturePlan(editing, editing.mainCompositionId, set, active, {
      [f.id]: 'Unsaved live value',
    });
    expect(plan).toHaveLength(13);
    expect(plan.filter((item) => item.template === 'Headline' && item.dataOverrides)).toMatchObject(
      [
        { label: 'Update · News rows · row 1', dataOverrides: { headline: 'First' } },
        { label: 'Update · News rows · row 2', dataOverrides: { headline: 'Second' } },
      ],
    );
    expect(plan.filter((item) => item.template === 'Score' && item.dataOverrides)).toMatchObject([
      { label: 'Update · Scores · row 1', dataOverrides: { score: '3–1' } },
    ]);
    expect(plan.map((item) => item.template)).toEqual([
      ...Array(7).fill('Headline'),
      ...Array(6).fill('Score'),
    ]);
    expect(set).toEqual(before);
  });

  it('uses active preview values only for the active template when no saved rows exist', () => {
    const first = createProject({ name: 'First' }),
      second = createProject({ name: 'Second' });
    const f = createFieldDefinition('text', { key: 'label' }),
      g = createFieldDefinition('text', { key: 'label' });
    first.compositions[0]!.dataFields.push(f);
    second.compositions[0]!.dataFields.push(g);
    const set = addProjectSetTemplate(createProjectSet('Set', first), second);
    const plan = boardCapturePlan(first, first.mainCompositionId, set, set.templates[0]!.id, {
      [f.id]: 'Preview only',
    });
    expect(plan.filter((item) => item.dataOverrides)).toMatchObject([
      {
        template: 'First',
        label: 'Update · preview data',
        dataOverrides: { label: 'Preview only' },
      },
      { template: 'Second', label: 'Update · preview data', dataOverrides: {} },
    ]);
  });
});
