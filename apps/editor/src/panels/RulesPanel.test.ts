import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createLayerOfKind,
  createProject,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { useProjectStore } from '../state/projectStore';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('dockable Rules pane', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('creates a rule for an explicit target without requiring canvas selection', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    const field = createFieldDefinition('integer', { key: 'score', defaultValue: 0 });
    composition.layers.push(layer);
    composition.dataFields.push(field);
    useProjectStore.getState().loadProject(project);

    const ruleId = useProjectStore.getState().addLayerVisualRule(layer.id);
    expect(ruleId).toBeTruthy();
    const duplicatedId = useProjectStore.getState().duplicateLayerVisualRule(layer.id, ruleId!);
    const rules = useProjectStore.getState().project.compositions[0]!.layers[0]!.visualRules;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ id: ruleId, name: 'Rule #1' });
    expect(duplicatedId).not.toBe(ruleId);
    expect(rules[1]).toMatchObject({ id: duplicatedId, name: 'Rule #2' });
    expect(rules[1]!.actions).not.toBe(rules[0]!.actions);
  });

  it('creates a condition field together with the first rule when none exists', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    composition.layers.push(layer);
    useProjectStore.getState().loadProject(project);

    const ruleId = useProjectStore.getState().addLayerVisualRule(layer.id);
    const updated = useProjectStore.getState().project.compositions[0]!;
    const field = updated.dataFields[0]!;
    const rule = updated.layers[0]!.visualRules[0]!;

    expect(ruleId).toBeTruthy();
    expect(updated.dataFields).toHaveLength(1);
    expect(field).toMatchObject({ key: 'ruleCondition1', type: 'text', defaultValue: '' });
    expect(rule).toMatchObject({ id: ruleId, fieldId: field.id, operator: 'not-empty' });

    useProjectStore.getState().addLayerVisualRule(layer.id);
    const afterSecondRule = useProjectStore.getState().project.compositions[0]!;
    expect(afterSecondRule.dataFields).toHaveLength(1);
    expect(afterSecondRule.layers[0]!.visualRules).toHaveLength(2);
  });

  it('does not create a field or rule for a locked layer', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    layer.isLocked = true;
    composition.layers.push(layer);
    useProjectStore.getState().loadProject(project);

    expect(useProjectStore.getState().addLayerVisualRule(layer.id)).toBeNull();
    const updated = useProjectStore.getState().project.compositions[0]!;
    expect(updated.dataFields).toHaveLength(0);
    expect(updated.layers[0]!.visualRules).toHaveLength(0);
  });

  it('creates pointer rules without a data field and can switch one back to data', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    composition.layers.push(layer);
    useProjectStore.getState().loadProject(project);

    const ruleId = useProjectStore.getState().addLayerVisualRule(layer.id, 'click');
    expect(ruleId).toBeTruthy();
    expect(useProjectStore.getState().project.compositions[0]!.dataFields).toHaveLength(0);
    expect(
      useProjectStore.getState().project.compositions[0]!.layers[0]!.visualRules[0],
    ).toMatchObject({
      id: ruleId,
      trigger: 'click',
      fieldId: '',
    });

    useProjectStore.getState().updateLayerVisualRule(layer.id, ruleId!, { trigger: 'data' });
    const updated = useProjectStore.getState().project.compositions[0]!;
    expect(updated.dataFields).toHaveLength(1);
    expect(updated.layers[0]!.visualRules[0]).toMatchObject({
      trigger: 'data',
      fieldId: updated.dataFields[0]!.id,
      operator: 'not-empty',
    });
  });

  it('turns imported audio into a sound only rules start', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    composition.layers.push(layer);
    composition.assets.push(
      createAsset({
        id: 'click-sound',
        name: 'click.mp3',
        kind: 'audio',
        mimeType: 'audio/mpeg',
        dataUri: 'data:audio/mpeg;base64,AAAA',
      }),
    );
    useProjectStore.getState().loadProject(project);

    const cueId = useProjectStore.getState().addRuleSoundFromAsset('click-sound');
    const ruleId = useProjectStore.getState().addLayerVisualRule(layer.id, 'click')!;
    useProjectStore.getState().updateLayerVisualRule(layer.id, ruleId, {
      actions: [{ type: 'play-sound', cueId }],
    });
    const updated = useProjectStore.getState().project;
    expect(updated.compositions[0]!.mediaCues).toEqual([
      expect.objectContaining({ id: cueId, name: 'click', trigger: { type: 'manual' } }),
    ]);
    expect(validateProject(updated).errors).toEqual([]);
  });

  it('creates a rule directly in the compact editor with an editable object or group target', () => {
    const panel = source('./RulesPanel.tsx');
    const css = source('./RulesPanel.css');
    expect(panel).toContain('onClick={createRule}');
    expect(panel).toContain('addRule(newRuleOwner.id)');
    expect(panel).toContain('setExpandedId(`object:${newRuleOwner.id}:${ruleId}`)');
    expect(panel).toContain('ariaLabel="Rule target"');
    expect(panel).toContain('options={ownerTargetOptions}');
    expect(panel).not.toContain('aria-label="New rule target object"');
    expect(panel).toContain('className="rules-editor-row"');
    expect(panel).toContain('<ColorInput');
    expect(panel).toContain('aria-label={`Duplicate action ${actionIndex + 1}`}');
    expect(panel).toContain('title="Duplicate rule"');
    expect(panel).toContain('actions.splice(actionIndex + 1, 0, structuredClone(action))');
    expect(css).toMatch(/\.rules-editor-row,[\s\S]*display:\s*flex;/);
    expect(css).toMatch(/\.rules-actions\s*\{[^}]*display:\s*grid;/s);
    expect(css).toMatch(/\.rules-action\s*\{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.rules-owner\s*\{[^}]*max-width:\s*none;[^}]*white-space:\s*nowrap;/s);
  });

  it('authors alarm rules in the existing editor and exposes linked Properties rows without a separate dialog', () => {
    const rules = source('./RulesPanel.tsx');
    const alarms = source('./ClockTimerAlarms.tsx');
    expect(rules).toContain("{ label: 'Timers', options: [['timer-alarm', 'Timer alarm']] }");
    expect(rules).toContain('aria-label="Alarm source timer"');
    expect(rules).toContain('aria-label="Alarm crossing direction"');
    expect(rules).toContain('setExpandedId(`object:${ruleRequest.layerId}:${ruleRequest.ruleId}`)');
    expect(alarms).toContain('sortedTimerAlarmRules(composition.layers, layerId, clock.mode)');
    expect(alarms).toContain('checked={rule.enabled}');
    expect(alarms).toContain('.revealRule(composition.id, owner.id, rule.id)');
    expect(alarms).toContain('removeRule(owner.id, rule.id)');
    expect(alarms).not.toContain('<dialog');
    expect(alarms).not.toContain('clock.alarms');
  });
});
