import { useEffect, useMemo, useState } from 'react';
import {
  createVisualRuleCondition,
  createFieldDefinition,
  isVisualRuleMouseFieldId,
  VISUAL_RULE_MOUSE_X_FIELD_ID,
  VISUAL_RULE_MOUSE_Y_FIELD_ID,
  visualRuleScopeLayerIds,
  isVisualRuleState,
  isVisualRuleStateAction,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  fieldDefinitionAtPath,
  visualRuleConditionsHold,
  visualRuleList,
  visualRuleRange,
  visualRuleTrigger,
  VISUAL_RULE_EVENT_OPERATORS,
  VISUAL_RULE_UNARY_OPERATORS,
  VISUAL_RULE_VISIBILITY_KEY,
  type FieldDefinition,
  type Layer,
  type LayerVisualRule,
  type VisualRuleAction,
  type VisualRuleCondition,
  type VisualRuleOperator,
  type VisualRuleTrigger,
  clockTimerActionId,
  isLayerRuleProperty,
  LAYER_RULE_PROPERTIES,
  parseClockTimerActionId,
  visualRuleActionTargets,
  visualRuleGroupMembers,
  type ClockTimerCommand,
  type LayerRuleProperty,
  layerRuleGeometryProperty,
  canonicalLayerRuleProperty,
  getLayerTransformAtFrame,
  type VisualRuleSetDataMode,
} from '@ograf-editor/scene-model';
import { coordinatedVisualRuleIssues } from '@ograf-editor/codegen';
import { ColorInput } from '../components/ColorInput';
import { editorVisualRuleEngine, ruleProperties } from '../state/dataBinding';
import { useProjectStore, useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTestDataStore } from '../state/testDataStore';
import { isSoundEventCue, soundEventSource } from '../state/soundEvents';
import { Panel } from './Panel';
import { RuleEditorItem, RuleEditorSection } from './RuleEditorItem';
import { RulesWorkspace } from './RulesWorkspace';
import { RuleTargetPicker, type RuleTargetOption } from './RuleTargetPicker';
import { RulePlayoutActionEditor } from './RulePlayoutActionEditor';
import { createRulePlayoutAction, RULE_PLAYOUT_ACTIONS } from '../state/rulePlayoutActions';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { clearBehaviorPreview, requestRulePlayoutPreview } from '../state/behaviorPreviewStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useTimelineStore } from '../state/timelineStore';
import { formatTimerAlarmThreshold, nextTimerAlarm } from '../state/timerAlarmRules';
import { TimerAlarmThresholdInput } from './TimerAlarmThresholdInput';
import { RuleKeyboardTriggerEditor } from './RuleKeyboardTriggerEditor';
import { ruleKeyboardShortcutLabel } from './ruleKeyboardControls';
import { FrameDurationControl } from './FrameDurationControl';
import { lifecycleLabel } from './lifecycleLabels';
import './RulesPanel.css';

/** Menu choices: show/hide split visibility; clock commands are built-in custom actions. */
type ActionChoice =
  | Exclude<VisualRuleAction['type'], 'visibility' | 'playout'>
  | 'show'
  | 'hide'
  | 'clock'
  | `playout-${Extract<VisualRuleAction, { type: 'playout' }>['operation']}`;

const actionChoice = (action: VisualRuleAction): ActionChoice =>
  action.type === 'playout'
    ? `playout-${action.operation}`
    : action.type === 'visibility'
      ? action.visible
        ? 'show'
        : 'hide'
      : action.type === 'custom-action' && parseClockTimerActionId(action.actionId)
        ? 'clock'
        : action.type;

const SET_DATA_MODES: Array<[VisualRuleSetDataMode, string]> = [
  ['set', 'Set to'],
  ['toggle', 'Switch on/off'],
  ['increase', 'Increase by'],
  ['decrease', 'Decrease by'],
];

const CLOCK_COMMANDS: Array<[ClockTimerCommand, string]> = [
  ['start', 'Start'],
  ['pause', 'Pause'],
  ['reset', 'Reset'],
  ['restart', 'Restart'],
];

/** A visible starting value when a layer property is picked, rather than a no-op. */
const LAYER_PROPERTY_STARTS: Partial<Record<LayerRuleProperty, number>> = {
  'layer.offsetX': 20,
  'layer.offsetY': -20,
  'layer.rotation': 10,
  'layer.scale': 1.1,
  'layer.opacity': 0.5,
};

const TRIGGER_GROUPS: Array<{ label: string; options: Array<[VisualRuleTrigger, string]> }> = [
  { label: 'Data', options: [['data', 'Data condition']] },
  { label: 'Timers', options: [['timer-alarm', 'Timer alarm']] },
  {
    label: 'Keyboard',
    options: [
      ['key-down', 'Key pressed'],
      ['key-up', 'Key released'],
    ],
  },
  // A state undoes its changes by itself; an event's changes stay until another rule changes them.
  { label: 'Mouse: while true', options: [['hover', 'While hovered']] },
  {
    label: 'Mouse: happens once',
    options: [
      ['pointer-enter', 'Mouse enters'],
      ['pointer-leave', 'Mouse leaves'],
      ['pointer-down', 'Mouse pressed'],
      ['pointer-up', 'Mouse released'],
      ['click', 'Clicked'],
      ['double-click', 'Double-clicked'],
    ],
  },
  {
    label: 'Playout',
    options: [
      ['play', 'Played in'],
      ['step', 'Step reached'],
      ['stop', 'Taken out'],
      ['custom-action', 'Custom action ran'],
    ],
  },
];

const OPERATOR_OPTIONS: Array<[VisualRuleOperator, string]> = [
  ['equals', 'Equals'],
  ['not-equals', 'Does not equal'],
  ['greater-than', 'Greater than'],
  ['greater-or-equal', 'At least'],
  ['less-than', 'Less than'],
  ['less-or-equal', 'At most'],
  ['between', 'Between'],
  ['contains', 'Contains'],
  ['not-contains', 'Does not contain'],
  ['starts-with', 'Starts with'],
  ['ends-with', 'Ends with'],
  ['one-of', 'Is one of'],
  ['not-one-of', 'Is not one of'],
  ['empty', 'Is empty'],
  ['not-empty', 'Is not empty'],
  ['changed', 'Changed'],
  ['increased', 'Increased'],
  ['decreased', 'Decreased'],
];

const TEXT_OPERATORS = new Set<VisualRuleOperator>([
  'equals',
  'not-equals',
  'contains',
  'not-contains',
  'starts-with',
  'ends-with',
  'one-of',
  'not-one-of',
]);
const NUMERIC_OPERATORS = new Set<VisualRuleOperator>([
  'greater-than',
  'less-than',
  'greater-or-equal',
  'less-or-equal',
]);
const LIST_OPERATORS = new Set<VisualRuleOperator>(['between', 'one-of', 'not-one-of']);
const NUMERIC_FIELD_TYPES = new Set(['number', 'integer', 'percentage', 'duration-ms']);
const MOUSE_RULE_FIELDS = (
  [
    [VISUAL_RULE_MOUSE_X_FIELD_ID, 'Mouse X'],
    [VISUAL_RULE_MOUSE_Y_FIELD_ID, 'Mouse Y'],
  ] as const
).map(([id, label]) =>
  createFieldDefinition('number', {
    id,
    key: id,
    label,
    description: 'Mouse position in composition pixels during interactive preview.',
  }),
);
const MOUSE_OPERATORS = new Set<VisualRuleOperator>([
  'equals',
  'not-equals',
  'greater-than',
  'greater-or-equal',
  'less-than',
  'less-or-equal',
  'between',
  'one-of',
  'not-one-of',
  'empty',
  'not-empty',
  'changed',
  'increased',
  'decreased',
]);

function replaceAction(
  rule: LayerVisualRule,
  index: number,
  action: VisualRuleAction,
): VisualRuleAction[] {
  return rule.actions.map((candidate, candidateIndex) =>
    candidateIndex === index ? action : candidate,
  );
}

/** The value a set-data action writes, or its step, edited in the field's own terms. */
function SetDataValueInput({
  action,
  field,
  onChange,
}: {
  action: Extract<VisualRuleAction, { type: 'set-data' }>;
  field: FieldDefinition | undefined;
  onChange: (value: unknown) => void;
}) {
  if (action.mode !== 'set')
    return (
      <input
        aria-label="Change by"
        type="number"
        step="any"
        value={String(action.value ?? 1)}
        onChange={(event) =>
          onChange(event.currentTarget.value === '' ? '' : event.currentTarget.valueAsNumber)
        }
      />
    );
  if (field?.type === 'boolean')
    return (
      <select
        aria-label="New value"
        value={String(action.value === true || action.value === 'true')}
        onChange={(event) => onChange(event.target.value === 'true')}
      >
        <option value="true">On / yes</option>
        <option value="false">Off / no</option>
      </select>
    );
  if (field?.type === 'select' && field.options?.length)
    return (
      <select
        aria-label="New value"
        value={String(action.value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose value</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label || option.value}
          </option>
        ))}
      </select>
    );
  if (field && NUMERIC_FIELD_TYPES.has(field.type))
    return (
      <input
        aria-label="New value"
        type="number"
        step="any"
        value={String(action.value ?? '')}
        onChange={(event) =>
          onChange(event.currentTarget.value === '' ? '' : event.currentTarget.valueAsNumber)
        }
      />
    );
  if (field?.type === 'color')
    return (
      <ColorInput
        label="New value"
        value={String(action.value ?? '')}
        alpha={field.generatedShaderParameter?.glslType === 'vec4'}
        onChange={onChange}
      />
    );
  return (
    <input
      aria-label="New value"
      value={String(action.value ?? '')}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function isColorPropertyAction(action: Extract<VisualRuleAction, { type: 'property' }>): boolean {
  return (
    action.targetProperty === 'fill' ||
    action.targetProperty === 'color' ||
    action.targetProperty === 'strokeColor' ||
    action.targetProperty === 'dropShadowColor' ||
    /(?:color|\.color|\.r|\.g|\.b|\.a)$/i.test(action.targetProperty) ||
    /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(action.value ?? ''))
  );
}

/**
 * Stores typed values: numbers for numeric fields and comparisons, booleans for switches. The
 * engine also coerces when comparing, so older text values keep matching.
 */
function typedConditionValue(
  field: FieldDefinition | undefined,
  condition: VisualRuleCondition,
  raw: string,
): unknown {
  const numericField =
    condition.sourcePath.length === 0 && field !== undefined && NUMERIC_FIELD_TYPES.has(field.type);
  if (
    NUMERIC_OPERATORS.has(condition.operator) ||
    (numericField && (condition.operator === 'equals' || condition.operator === 'not-equals'))
  ) {
    const parsed = Number(raw);
    return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw;
  }
  if (field && fieldDefinitionAtPath(field, condition.sourcePath)?.type === 'boolean')
    return raw === 'true' ? true : raw === 'false' ? false : raw;
  return raw;
}

/** A patch that may clear optional keys by setting them to `undefined`. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

interface ConditionEditorProps {
  condition: VisualRuleCondition;
  fields: FieldDefinition[];
  allowChangeOperators: boolean;
  onChange: (patch: Loose<VisualRuleCondition>) => void;
  labelPrefix?: string;
}

function ConditionEditor({
  condition,
  fields,
  allowChangeOperators,
  onChange,
  labelPrefix = 'Condition',
}: ConditionEditorProps) {
  const allFields = [...fields, ...MOUSE_RULE_FIELDS];
  const mouse = isVisualRuleMouseFieldId(condition.fieldId);
  const field = allFields.find((candidate) => candidate.id === condition.fieldId);
  const comparisonField = field ? fieldDefinitionAtPath(field, condition.sourcePath) : undefined;
  const unary = VISUAL_RULE_UNARY_OPERATORS.has(condition.operator);
  const list = LIST_OPERATORS.has(condition.operator);
  const range = condition.operator === 'between' ? visualRuleRange(condition.value) : null;
  return (
    <>
      <select
        aria-label={`${labelPrefix} field`}
        value={condition.fieldId}
        title={
          mouse
            ? 'Mouse position in composition pixels; available during interactive preview.'
            : undefined
        }
        onChange={(event) => {
          const fieldId = event.target.value;
          const pointer = isVisualRuleMouseFieldId(fieldId);
          const operator =
            pointer && !MOUSE_OPERATORS.has(condition.operator)
              ? 'greater-or-equal'
              : condition.operator;
          onChange({
            fieldId,
            sourcePath: [],
            operator,
            ...(pointer ? { ignoreCase: undefined } : {}),
            ...(pointer &&
            !Number.isFinite(Number(condition.value)) &&
            !LIST_OPERATORS.has(operator)
              ? { value: 0 }
              : {}),
          });
        }}
      >
        {!field && <option value={condition.fieldId}>Missing field</option>}
        <optgroup label="Data">
          {fields.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label || candidate.key}
            </option>
          ))}
        </optgroup>
        <optgroup label="Mouse">
          {MOUSE_RULE_FIELDS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </optgroup>
      </select>
      <select
        aria-label={`${labelPrefix} operator`}
        value={condition.operator}
        onChange={(event) => {
          const operator = event.target.value as VisualRuleOperator;
          onChange({
            operator,
            ...(LIST_OPERATORS.has(operator) ? { compareFieldId: undefined } : {}),
          });
        }}
      >
        {OPERATOR_OPTIONS.filter(
          ([operator]) =>
            (allowChangeOperators || !VISUAL_RULE_EVENT_OPERATORS.has(operator)) &&
            (!mouse || MOUSE_OPERATORS.has(operator)),
        ).map(([operator, label]) => (
          <option key={operator} value={operator}>
            {label}
          </option>
        ))}
      </select>
      {unary ? null : (
        <>
          {list ? null : (
            <select
              className="rules-compare-source"
              aria-label={`${labelPrefix} compares with`}
              title="Compare with a value, data field or mouse coordinate"
              value={condition.compareFieldId ?? ''}
              onChange={(event) =>
                onChange({
                  compareFieldId: event.target.value || undefined,
                  compareSourcePath: undefined,
                })
              }
            >
              <option value="">value</option>
              {allFields
                .filter((candidate) => candidate.id !== condition.fieldId)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    ▸ {candidate.label || candidate.key}
                  </option>
                ))}
            </select>
          )}
          {condition.compareFieldId ? null : condition.operator === 'between' ? (
            <span className="rules-range">
              <input
                aria-label={`${labelPrefix} minimum`}
                type="number"
                value={range ? range[0] : ''}
                onChange={(event) =>
                  onChange({ value: [Number(event.target.value), range ? range[1] : 0] })
                }
              />
              <input
                aria-label={`${labelPrefix} maximum`}
                type="number"
                value={range ? range[1] : ''}
                onChange={(event) =>
                  onChange({ value: [range ? range[0] : 0, Number(event.target.value)] })
                }
              />
            </span>
          ) : comparisonField?.type === 'boolean' &&
            (condition.operator === 'equals' || condition.operator === 'not-equals') ? (
            <input
              type="checkbox"
              aria-label="Comparison value"
              title="Checked means enabled; unchecked means disabled"
              checked={
                condition.value == null || condition.value === true || condition.value === 'true'
              }
              onChange={(event) => onChange({ value: event.currentTarget.checked })}
            />
          ) : comparisonField?.type === 'color' &&
            (condition.operator === 'equals' || condition.operator === 'not-equals') ? (
            <ColorInput
              label="Comparison value"
              value={String(condition.value ?? '')}
              alpha={comparisonField.generatedShaderParameter?.glslType === 'vec4'}
              onChange={(value) => onChange({ value })}
            />
          ) : (
            <input
              aria-label="Comparison value"
              type={mouse && !list ? 'number' : 'text'}
              step={mouse ? 'any' : undefined}
              placeholder={list ? 'A, B, C' : undefined}
              value={
                list && Array.isArray(condition.value)
                  ? visualRuleList(condition.value).join(', ')
                  : String(condition.value ?? '')
              }
              onChange={(event) =>
                onChange({
                  value: list
                    ? event.target.value
                    : typedConditionValue(field, condition, event.target.value),
                })
              }
            />
          )}
          {!mouse && TEXT_OPERATORS.has(condition.operator) ? (
            <button
              type="button"
              className={`rules-ignore-case ${condition.ignoreCase ? 'active' : ''}`}
              aria-pressed={Boolean(condition.ignoreCase)}
              aria-label="Ignore letter case"
              title={condition.ignoreCase ? 'Ignoring letter case' : 'Matching letter case'}
              onClick={() => onChange({ ignoreCase: !condition.ignoreCase || undefined })}
            >
              Aa
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

/** Pulls optional keys set to `undefined` out so they don't linger in the document. */
function withoutUndefined<T extends object>(value: Loose<T>): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function RulesPanel() {
  const composition = useActiveComposition();
  const project = useProjectStore((state) => state.project);
  const selectedLayerId = useSelectionStore((state) => state.selectedLayerId);
  const testValues = useTestDataStore((state) => state.values);
  const simulateRule = useTestDataStore((state) => state.simulateVisualRule);
  const resetSimulation = useTestDataStore((state) => state.resetVisualRuleSimulation);
  const simulated = useTestDataStore(
    (state) => Object.keys(state.visualRuleStateOverrides).length > 0,
  );
  const addRule = useProjectStore((state) => state.addLayerVisualRule);
  const updateRule = useProjectStore((state) => state.updateLayerVisualRule);
  const replaceRule = useProjectStore((state) => state.replaceLayerVisualRule);
  const retargetRule = useProjectStore((state) => state.retargetLayerVisualRule);
  const moveRule = useProjectStore((state) => state.moveLayerVisualRule);
  const duplicateRule = useProjectStore((state) => state.duplicateLayerVisualRule);
  const removeRule = useProjectStore((state) => state.removeLayerVisualRule);
  const addRuleSound = useProjectStore((state) => state.addRuleSoundFromAsset);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const ruleRequest = usePaneRequestStore((state) => state.ruleRequest);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const newRuleOwner =
    composition.layers.find(
      (layer) => layer.id === selectedLayerId && !layer.isLocked && !layer.isGuide,
    ) ?? composition.layers.find((layer) => !layer.isLocked && !layer.isGuide);
  useEffect(() => {
    setExpandedId(null);
    setSearch('');
  }, [composition.id]);
  useEffect(() => {
    setPreviewError('');
  }, [composition.id, expandedId]);

  const createRule = () => {
    if (!newRuleOwner) return;
    // The existing factory creates a condition field when the composition has none.
    const ruleId = runDiscreteHistoryStep(() => addRule(newRuleOwner.id), 'Add rule');
    if (!ruleId) return;
    setExpandedId(`object:${newRuleOwner.id}:${ruleId}`);
    setSearch('');
    if (newRuleOwner.id !== selectedLayerId) setSelectedOnly(false);
  };

  const duplicateListedRule = (layerId: string, ruleId: string) => {
    const id = runDiscreteHistoryStep(() => duplicateRule(layerId, ruleId), 'Duplicate rule');
    if (!id) return;
    setExpandedId(`object:${layerId}:${id}`);
    setSearch('');
  };

  const changeRuleObject = (layerId: string, ruleId: string, value: string) => {
    const hostGroupId = value.startsWith('group:') ? value.slice(6) : undefined;
    const targetLayerId = hostGroupId
      ? (
          composition.layers.find(
            (candidate) =>
              candidate.id === layerId &&
              candidate.groupId === hostGroupId &&
              !candidate.isLocked &&
              !candidate.isGuide,
          ) ??
          composition.layers.find(
            (candidate) =>
              candidate.groupId === hostGroupId && !candidate.isLocked && !candidate.isGuide,
          )
        )?.id
      : value.startsWith('layer:')
        ? value.slice(6)
        : undefined;
    if (!targetLayerId) return;
    const moved = runDiscreteHistoryStep(
      () => retargetRule(layerId, ruleId, targetLayerId, hostGroupId),
      'Change rule target',
    );
    if (!moved) return;
    setExpandedId(`object:${targetLayerId}:${ruleId}`);
    setSelectedOnly(false);
    setSearch('');
  };

  const entries = useMemo(
    () =>
      composition.layers.flatMap((layer) =>
        (layer.visualRules ?? []).map((rule, index) => ({ layer, rule, index })),
      ),
    [composition.layers],
  );
  const engine = useMemo(
    () => editorVisualRuleEngine(composition.layers, composition.dataFields),
    [composition.layers, composition.dataFields],
  );
  const layerById = useMemo(
    () => new Map(composition.layers.map((layer) => [layer.id, layer])),
    [composition.layers],
  );
  const groupMembers = useMemo(
    () => visualRuleGroupMembers(composition.layers),
    [composition.layers],
  );
  const groupLabels = useMemo(
    () =>
      new Map(
        [...groupMembers].map(([id, members]) => {
          const names = members.map((member) => layerById.get(member)?.name ?? 'Missing object');
          return [
            id,
            names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : ''),
          ];
        }),
      ),
    [groupMembers, layerById],
  );

  // Which matched state rules lose a property to a later rule on the same target.
  const overriddenBy = useMemo(() => {
    const lastWriter = new Map<string, { ruleId: string; name: string }>();
    const losers = new Map<string, string[]>();
    for (const { layer, rule } of entries) {
      if (!rule.enabled || !isVisualRuleState(rule) || visualRuleTrigger(rule) === 'hover')
        continue;
      if (!visualRuleConditionsHold(engine.reader, rule, layer.id, testValues)) continue;
      for (const action of rule.actions) {
        if (!isVisualRuleStateAction(action) || action.type === 'toggle-visibility') continue;
        for (const target of visualRuleActionTargets(engine, action, layer.id, rule)) {
          const key = `${target}\u0000${action.type === 'property' ? action.targetProperty : VISUAL_RULE_VISIBILITY_KEY}`;
          const previous = lastWriter.get(key);
          if (previous && previous.ruleId !== rule.id) {
            const targetName = layerById.get(target)?.name ?? 'object';
            losers.set(previous.ruleId, [
              ...(losers.get(previous.ruleId) ?? []),
              `"${rule.name}" sets the same ${action.type === 'property' ? action.targetProperty : 'visibility'} on ${targetName}`,
            ]);
          }
          lastWriter.set(key, { ruleId: rule.id, name: rule.name });
        }
      }
    }
    return losers;
  }, [engine, entries, layerById, testValues]);

  const visibleEntries = selectedOnly
    ? entries.filter(
        (entry) =>
          entry.layer.id === selectedLayerId ||
          (entry.rule.hostGroupId &&
            visualRuleScopeLayerIds(engine, entry.layer.id, entry.rule).includes(
              selectedLayerId ?? '',
            )) ||
          entry.rule.actions.some(
            (action) =>
              isVisualRuleStateAction(action) &&
              visualRuleActionTargets(engine, action, entry.layer.id, entry.rule).includes(
                selectedLayerId ?? '',
              ),
          ),
      )
    : entries;
  // Coordinated playout reports unsupported rule features before preview or export.
  const coordinated = Boolean(
    projectSet?.transitionLogic?.states.some((state) => state.templateId === activeTemplateId),
  );
  const listItems = useMemo(() => {
    const objectItems = visibleEntries.map(({ layer, rule }) => {
      const trigger = visualRuleTrigger(rule);
      const event =
        trigger === 'timer-alarm' && rule.timerAlarm
          ? `Timer alarm · ${formatTimerAlarmThreshold(rule.timerAlarm.thresholdMs)}`
          : (TRIGGER_GROUPS.flatMap((group) => group.options).find(
              ([value]) => value === trigger,
            )?.[1] ?? trigger);
      const field = [...composition.dataFields, ...MOUSE_RULE_FIELDS].find(
        (candidate) => candidate.id === rule.fieldId,
      );
      const ownerName = rule.hostGroupId
        ? (groupLabels.get(rule.hostGroupId) ?? 'Missing group')
        : layer.name;
      const shortcut =
        trigger === 'key-down' || trigger === 'key-up'
          ? ` · ${ruleKeyboardShortcutLabel(rule.keyboard)}`
          : '';
      const detail = `${ownerName} · ${event}${shortcut}${trigger === 'data' && field ? ` · ${field.label || field.key}` : ''} · ${rule.actions.length} ${rule.actions.length === 1 ? 'action' : 'actions'}`;
      return {
        id: `object:${layer.id}:${rule.id}`,
        layerId: layer.id,
        ruleId: rule.id,
        locked: layer.isLocked,
        title: rule.name,
        detail,
        status: !rule.enabled
          ? 'Paused'
          : coordinated && coordinatedVisualRuleIssues(rule).length
            ? 'Blocks playout'
            : 'Active',
        active: rule.enabled,
        search:
          `${rule.name} ${detail} ${rule.actions.map((action) => action.type).join(' ')}`.toLocaleLowerCase(),
      };
    });
    return objectItems;
  }, [visibleEntries, coordinated, composition.dataFields, groupLabels]);
  const filteredListItems = listItems.filter(
    (item) => !search.trim() || item.search.includes(search.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (!listItems.some((item) => item.id === expandedId)) setExpandedId(listItems[0]?.id ?? null);
  }, [listItems, expandedId]);
  useEffect(() => {
    if (!ruleRequest || ruleRequest.compositionId !== composition.id) return;
    setSelectedOnly(false);
    setSearch('');
    setExpandedId(`object:${ruleRequest.layerId}:${ruleRequest.ruleId}`);
  }, [ruleRequest, composition.id]);
  const mediaCues = (composition.mediaCues ?? []).filter((cue) => !isSoundEventCue(cue));
  // Rules can play any audio cue, including manual ones that never play from the timeline.
  const ruleSounds = (composition.mediaCues ?? []).filter(
    (cue) => isSoundEventCue(cue) || soundEventSource(cue) !== null,
  );
  // Imported audio without a cue yet; choosing one creates a rule-only sound for it.
  const uncuedAudio = composition.assets.filter(
    (asset) =>
      asset.kind === 'audio' &&
      !(composition.mediaCues ?? []).some((cue) =>
        cue.sources.some((source) => source.kind === 'clip' && source.src === `asset:${asset.id}`),
      ),
  );
  const steps = composition.keyframes.filter((keyframe) => keyframe.role === 'step');
  const shaderActionIds = new Set(
    composition.layers.flatMap((layer) => {
      const activation = layer.loop?.activation;
      if (
        activation?.type !== 'customAction' ||
        !Object.keys(layer.loop?.tracks ?? {}).some((property) =>
          Boolean(parseShaderAnimationProperty(property)),
        )
      ) {
        return [];
      }
      return [activation.customActionId];
    }),
  );
  const shaderActions = composition.customActions.filter((action) =>
    shaderActionIds.has(action.actionId),
  );
  // Clock and timer layers expose built-in start/pause/reset/restart commands.
  const clockLayers = composition.layers.filter(
    (candidate) =>
      !candidate.isGuide && candidate.element.type === 'text' && !!candidate.element.clock,
  );
  // Editor groups (Edit > Group) can be rule targets; they're named by their members.
  const targetOptions = (hostLayer: Layer, rule: LayerVisualRule): RuleTargetOption[] => [
    {
      value: '',
      label: `${rule.hostGroupId ? (groupLabels.get(rule.hostGroupId) ?? 'Missing group') : hostLayer.name} (this)`,
      kind: rule.hostGroupId ? 'group' : 'object',
    },
    ...composition.layers
      .filter(
        (candidate) => !candidate.isGuide && (rule.hostGroupId || candidate.id !== hostLayer.id),
      )
      .map((candidate) => ({
        value: `layer:${candidate.id}`,
        label: candidate.name,
        kind: 'object' as const,
      })),
    ...[...groupMembers].map(([groupId, memberIds]) => {
      const names = memberIds.map((id) => layerById.get(id)?.name ?? 'Missing object');
      return {
        value: `group:${groupId}`,
        label: names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : ''),
        kind: 'group' as const,
        detail: `${memberIds.length} ${memberIds.length === 1 ? 'object' : 'objects'}`,
      };
    }),
  ];
  const ownerTargetOptions: RuleTargetOption[] = [
    ...composition.layers
      .filter((candidate) => !candidate.isGuide)
      .map((candidate) => ({
        value: `layer:${candidate.id}`,
        label: candidate.name,
        kind: 'object' as const,
        disabled: candidate.isLocked,
      })),
    ...[...groupMembers].map(([groupId, members]) => ({
      value: `group:${groupId}`,
      label: groupLabels.get(groupId) ?? groupId,
      kind: 'group' as const,
      detail: `${members.length} ${members.length === 1 ? 'object' : 'objects'}`,
      disabled: !members.some((member) => {
        const layer = layerById.get(member);
        return layer && !layer.isLocked && !layer.isGuide;
      }),
    })),
  ];
  const clockActions = clockLayers.flatMap((clock) =>
    CLOCK_COMMANDS.map(([command, label]) => ({
      id: clockTimerActionId(clock.id, command),
      name: `${clock.name}: ${label}`,
    })),
  );

  const renderTriggerOptions = () => (
    <>
      {TRIGGER_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map(([value, label]) => (
            <option
              key={value}
              value={value}
              disabled={value === 'timer-alarm' && !clockLayers.length}
            >
              {label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  return (
    <Panel title="Rules">
      <div className="rules-panel">
        <RulesWorkspace
          sidebar={
            <aside className="rules-sidebar" aria-label="Rule navigation">
              <div className="rules-sidebar-top">
                <div className="rules-sidebar-title">
                  <span className="rules-count" aria-label={`${listItems.length} rules`}>
                    {listItems.length} {listItems.length === 1 ? 'rule' : 'rules'}
                  </span>
                  <button
                    className="rules-new-button"
                    type="button"
                    onClick={createRule}
                    disabled={!newRuleOwner}
                    title={
                      newRuleOwner
                        ? `Create a rule on ${newRuleOwner.name}`
                        : 'Add or unlock a scene object to create a rule'
                    }
                  >
                    + New rule
                  </button>
                </div>
                <div className="rules-sidebar-tools">
                  <input
                    type="search"
                    aria-label="Search rules"
                    placeholder="Search rules…"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                  />
                  <div className="rules-scope" role="group" aria-label="Show rules">
                    <button
                      type="button"
                      aria-pressed={!selectedOnly}
                      onClick={() => setSelectedOnly(false)}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      aria-pressed={selectedOnly}
                      onClick={() => setSelectedOnly(true)}
                    >
                      Selected object
                    </button>
                  </div>
                </div>
              </div>
              <nav className="rules-navigation" aria-label="Rules">
                {filteredListItems.map((item) => {
                  const tone =
                    item.status === 'Needs attention' || item.status === 'Blocks playout'
                      ? 'warn'
                      : item.active
                        ? 'ok'
                        : 'muted';
                  return (
                    <div
                      key={item.id}
                      className="rules-navigation-item"
                      data-selected={expandedId === item.id || undefined}
                    >
                      <button
                        type="button"
                        className="rules-navigation-select"
                        title={item.detail}
                        aria-current={expandedId === item.id ? 'true' : undefined}
                        onClick={() => setExpandedId(item.id)}
                      >
                        <span
                          className={`rules-navigation-dot rules-tone-${tone}`}
                          aria-hidden="true"
                        />
                        <span className="rules-navigation-copy">
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        {/* Healthy rules show only the green dot; pills flag what needs a look. */}
                        <span
                          className={
                            tone === 'ok' ? 'rules-sr-only' : `rules-status rules-tone-${tone}`
                          }
                        >
                          {item.status}
                        </span>
                      </button>
                      <div
                        className="rules-navigation-controls"
                        role="group"
                        aria-label={`${item.title} controls`}
                      >
                        <label
                          className="rules-list-active"
                          title={item.active ? 'Active' : 'Paused'}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Active: ${item.title}`}
                            checked={item.active}
                            disabled={item.locked}
                            onChange={(event) =>
                              runDiscreteHistoryStep(
                                () =>
                                  updateRule(item.layerId, item.ruleId, {
                                    enabled: event.currentTarget.checked,
                                  }),
                                event.currentTarget.checked ? 'Enable rule' : 'Pause rule',
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          title="Duplicate rule"
                          aria-label={`Duplicate ${item.title}`}
                          disabled={item.locked}
                          onClick={() => duplicateListedRule(item.layerId, item.ruleId)}
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          className="rules-remove"
                          title="Delete rule"
                          aria-label={`Delete ${item.title}`}
                          disabled={item.locked}
                          onClick={() =>
                            runDiscreteHistoryStep(
                              () => removeRule(item.layerId, item.ruleId),
                              'Delete rule',
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </nav>
              {search && !filteredListItems.length && (
                <p className="rules-empty-note">No rules match “{search}”.</p>
              )}
              {simulated && (
                <details className="rules-sidebar-options">
                  <summary>More</summary>
                  <button type="button" onClick={resetSimulation}>
                    Reset canvas test
                  </button>
                </details>
              )}
            </aside>
          }
        >
          <div className="rules-detail" aria-label="Selected rule">
            {previewError && (
              <p className="rule-editor-error" role="alert">
                {previewError}
              </p>
            )}
            {listItems.length === 0 && !search && (
              <div className="rules-empty">
                <span className="rules-empty-mark" aria-hidden="true">
                  ◇
                </span>
                <strong>
                  {selectedOnly ? 'No rules for this object' : 'No rules in this template'}
                </strong>
                <p>
                  {!newRuleOwner
                    ? 'Add or unlock a scene object to create a rule.'
                    : selectedOnly
                      ? 'Select a different object, or create a rule that targets this one.'
                      : 'Rules react to data, pointer input and playout. Create one to start.'}
                </p>
                <button
                  type="button"
                  className="rules-new-button"
                  onClick={createRule}
                  disabled={!newRuleOwner}
                  title={
                    newRuleOwner
                      ? `Create a rule on ${newRuleOwner.name}`
                      : 'Add or unlock a scene object to create a rule'
                  }
                >
                  + New rule
                </button>
              </div>
            )}
            <div className="rules-detail-editors">
              {visibleEntries.map(({ layer, rule, index }) => {
                const hasPlayoutAction = rule.actions.some((action) => action.type === 'playout');
                const openRulePreview = () => {
                  setPreviewError('');
                  if (hasPlayoutAction) {
                    void requestRulePlayoutPreview().catch((cause) =>
                      setPreviewError(cause instanceof Error ? cause.message : String(cause)),
                    );
                  } else {
                    clearBehaviorPreview();
                    usePaneRequestStore.getState().reveal('export');
                  }
                };
                const trigger = visualRuleTrigger(rule);
                const isData = trigger === 'data';
                const state = isVisualRuleState(rule);
                const matches =
                  trigger !== 'data'
                    ? null
                    : state
                      ? visualRuleConditionsHold(engine.reader, rule, layer.id, testValues)
                      : null;
                const overridden = overriddenBy.get(rule.id);
                const coordinatedIssues =
                  coordinated && rule.enabled ? coordinatedVisualRuleIssues(rule) : [];
                const guards = rule.conditions ?? [];
                const conditionCount = (isData ? 1 : 0) + guards.length;
                const setGuard = (guardIndex: number, patch: Loose<VisualRuleCondition>) =>
                  updateRule(layer.id, rule.id, {
                    conditions: guards.map((guard, candidate) =>
                      candidate === guardIndex
                        ? withoutUndefined<VisualRuleCondition>({ ...guard, ...patch })
                        : guard,
                    ),
                  });
                // Show and hide are separate choices; both are stored as a visibility action.
                const actionTypes: Array<[ActionChoice, string]> = [
                  ['show', 'Show object'],
                  ['hide', 'Hide object'],
                  ...(state
                    ? []
                    : ([['toggle-visibility', 'Toggle object visibility']] as Array<
                        [ActionChoice, string]
                      >)),
                  ['property', 'Change object property'],
                  ['set-data', 'Change data field'],
                  ...(
                    [
                      ['play-sound', 'Play Sound Event', ruleSounds.length + uncuedAudio.length],
                      ['take-media', 'Start video / live source', mediaCues.length],
                      ['shader-animation', 'Play Shader Animation', shaderActions.length],
                      ['clock', 'Control clock / timer', clockActions.length],
                      ['custom-action', 'Trigger Custom Action', composition.customActions.length],
                    ] as Array<[ActionChoice, string, number]>
                  )
                    // Offer these only when there is something to pick, or the rule already uses
                    // one; an empty choice would save an action that points at nothing.
                    .filter(
                      ([choice, , available]) =>
                        available > 0 ||
                        rule.actions.some((candidate) => actionChoice(candidate) === choice),
                    )
                    .map(([choice, label]) => [choice, label] as [ActionChoice, string]),
                ];
                const rowId = `object:${layer.id}:${rule.id}`;
                const triggerLabel =
                  TRIGGER_GROUPS.flatMap((group) => group.options).find(
                    ([value]) => value === trigger,
                  )?.[1] ?? trigger;
                const field = [...composition.dataFields, ...MOUSE_RULE_FIELDS].find(
                  (entry) => entry.id === rule.fieldId,
                );
                const conditionLabel =
                  trigger === 'timer-alarm' && rule.timerAlarm
                    ? `${layerById.get(rule.timerAlarm.sourceLayerId)?.name ?? 'Missing timer'} reaches ${formatTimerAlarmThreshold(rule.timerAlarm.thresholdMs)}`
                    : isData
                      ? `${field?.label || field?.key || 'Data'} ${OPERATOR_OPTIONS.find(([value]) => value === rule.operator)?.[1]?.toLowerCase() ?? rule.operator}`
                      : trigger === 'key-down' || trigger === 'key-up'
                        ? `${triggerLabel} · ${ruleKeyboardShortcutLabel(rule.keyboard)}`
                        : triggerLabel;
                const actionSummary = rule.actions
                  .map((action) => {
                    if (action.type === 'visibility')
                      return action.visible ? 'Show object' : 'Hide object';
                    if (action.type === 'property')
                      return (
                        LAYER_RULE_PROPERTIES.find(
                          (entry) =>
                            entry.value === canonicalLayerRuleProperty(action.targetProperty),
                        )?.label ?? `Set ${action.targetProperty}`
                      );
                    if (action.type === 'set-data') {
                      const target = composition.dataFields.find(
                        (entry) => entry.id === action.fieldId,
                      );
                      return `${SET_DATA_MODES.find(([mode]) => mode === action.mode)?.[1] ?? 'Change'} ${target?.label || target?.key || 'field'}`;
                    }
                    if (action.type === 'playout') {
                      const slot = projectSet?.transitionLogic?.slots.find(
                        (entry) => entry.id === action.slotId,
                      );
                      const targetState = projectSet?.transitionLogic?.states.find(
                        (entry) => entry.id === action.stateId,
                      );
                      const operation =
                        RULE_PLAYOUT_ACTIONS.find(([value]) => value === action.operation)?.[1] ??
                        action.operation;
                      return `${operation} ${targetState?.name ?? slot?.name ?? action.slotId}`;
                    }
                    if (actionChoice(action) === 'clock' && action.type === 'custom-action')
                      return (
                        clockActions.find((entry) => entry.id === action.actionId)?.name ??
                        'Control clock'
                      );
                    return actionTypes.find(([type]) => type === action.type)?.[1] ?? action.type;
                  })
                  .join(', ');
                const summary = `${conditionLabel} → ${actionSummary}`;
                return (
                  <RuleEditorItem
                    key={rowId}
                    id={rowId}
                    title={rule.name}
                    target={layer.name}
                    targetEditor={
                      <RuleTargetPicker
                        ariaLabel="Rule target"
                        value={rule.hostGroupId ? `group:${rule.hostGroupId}` : `layer:${layer.id}`}
                        options={ownerTargetOptions}
                        disabled={layer.isLocked || layer.isGuide}
                        onChange={(value) => changeRuleObject(layer.id, rule.id, value)}
                      />
                    }
                    summary={summary}
                    open={expandedId === rowId}
                    onOpenChange={(open) => setExpandedId(open ? rowId : null)}
                    status={
                      !rule.enabled
                        ? 'Off'
                        : coordinatedIssues.length
                          ? 'Blocks playout'
                          : overridden
                            ? 'Overridden'
                            : matches
                              ? 'Matched'
                              : undefined
                    }
                    preview={{
                      onClick: openRulePreview,
                      label: 'Open Preview & Export',
                    }}
                    nameEditor={
                      <input
                        className="rules-detail-name"
                        aria-label="Rule name"
                        value={rule.name}
                        disabled={layer.isLocked}
                        onChange={(event) =>
                          updateRule(layer.id, rule.id, { name: event.currentTarget.value })
                        }
                      />
                    }
                    menu={
                      <>
                        <button
                          type="button"
                          disabled={layer.isLocked || index === 0}
                          onClick={() => moveRule(layer.id, rule.id, -1)}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          disabled={layer.isLocked || index === layer.visualRules.length - 1}
                          onClick={() => moveRule(layer.id, rule.id, 1)}
                        >
                          Move down
                        </button>
                        {hasPlayoutAction || trigger === 'timer-alarm' ? (
                          <button type="button" onClick={openRulePreview}>
                            Open Preview & Export
                          </button>
                        ) : (
                          (!state || trigger === 'hover') && (
                            <button
                              type="button"
                              onClick={() =>
                                simulateRule(
                                  layer.id,
                                  rule,
                                  composition.layers,
                                  composition.dataFields,
                                )
                              }
                            >
                              Try on canvas
                            </button>
                          )
                        )}
                      </>
                    }
                  >
                    <fieldset className="rule-editor-form" disabled={layer.isLocked}>
                      {coordinatedIssues.length > 0 && (
                        <p className="rule-editor-error" role="note">
                          {coordinatedIssues.join(' ')} Change this rule or switch it off to enable
                          coordinated preview and export.
                        </p>
                      )}
                      {overridden && (
                        <p className="rule-editor-note">Overridden: {overridden.join('; ')}</p>
                      )}
                      <div className="rules-editor-row">
                        <RuleEditorSection label="WHEN" title="Trigger" inline>
                          <label
                            className={`rule-editor-inline-field${isData ? ' rules-trigger-compact' : ''}`}
                          >
                            <select
                              className="rules-trigger"
                              aria-label="Rule trigger"
                              value={trigger}
                              onChange={(event) => {
                                const next = event.target.value as VisualRuleTrigger;
                                const becomesState = next === 'data' || next === 'hover';
                                replaceRule(
                                  layer.id,
                                  rule.id,
                                  withoutUndefined<LayerVisualRule>({
                                    ...rule,
                                    trigger: next,
                                    keyboard:
                                      next === 'key-down' || next === 'key-up'
                                        ? (rule.keyboard ?? { key: 'Enter' })
                                        : undefined,
                                    timerAlarm:
                                      next === 'timer-alarm'
                                        ? (rule.timerAlarm ??
                                          (() => {
                                            const source =
                                              clockLayers.find((clock) => clock.id === layer.id) ??
                                              clockLayers[0];
                                            return source?.element.type === 'text' &&
                                              source.element.clock
                                              ? nextTimerAlarm(
                                                  composition.layers,
                                                  source.id,
                                                  source.element.clock,
                                                )
                                              : undefined;
                                          })())
                                        : undefined,
                                    eventId:
                                      next === 'custom-action'
                                        ? (composition.customActions[0]?.actionId ?? '')
                                        : undefined,
                                    delayFrames: becomesState ? undefined : rule.delayFrames,
                                    actions: becomesState
                                      ? rule.actions.map((action) =>
                                          action.type === 'toggle-visibility'
                                            ? withoutUndefined<VisualRuleAction>({
                                                type: 'visibility' as const,
                                                visible: true,
                                                targetLayerId: action.targetLayerId,
                                                transitionFrames: action.transitionFrames,
                                              })
                                            : action,
                                        )
                                      : rule.actions,
                                  }),
                                );
                              }}
                            >
                              {renderTriggerOptions()}
                            </select>
                          </label>
                          {/* A data rule's comparison is what starts it: "When Name is not empty". */}
                          {trigger === 'key-down' || trigger === 'key-up' ? (
                            <RuleKeyboardTriggerEditor
                              key={`${rule.id}:${trigger}`}
                              trigger={trigger}
                              value={rule.keyboard}
                              onChange={(keyboard) => updateRule(layer.id, rule.id, { keyboard })}
                            />
                          ) : null}
                          {isData ? (
                            <div className="rules-condition-grid rules-when-condition">
                              <ConditionEditor
                                condition={rule}
                                fields={composition.dataFields}
                                allowChangeOperators
                                onChange={(patch) =>
                                  replaceRule(
                                    layer.id,
                                    rule.id,
                                    withoutUndefined<LayerVisualRule>({ ...rule, ...patch }),
                                  )
                                }
                              />
                            </div>
                          ) : null}
                          {trigger === 'timer-alarm' ? (
                            <div className="rules-timer-alarm">
                              <select
                                aria-label="Alarm source timer"
                                value={rule.timerAlarm?.sourceLayerId ?? ''}
                                onChange={(event) => {
                                  const source = clockLayers.find(
                                    (clock) => clock.id === event.currentTarget.value,
                                  );
                                  if (source?.element.type !== 'text' || !source.element.clock)
                                    return;
                                  updateRule(layer.id, rule.id, {
                                    timerAlarm: rule.timerAlarm
                                      ? { ...rule.timerAlarm, sourceLayerId: source.id }
                                      : nextTimerAlarm(
                                          composition.layers,
                                          source.id,
                                          source.element.clock,
                                        ),
                                  });
                                }}
                              >
                                {!rule.timerAlarm ||
                                !clockLayers.some(
                                  (clock) => clock.id === rule.timerAlarm?.sourceLayerId,
                                ) ? (
                                  <option value={rule.timerAlarm?.sourceLayerId ?? ''}>
                                    Choose timer
                                  </option>
                                ) : null}
                                {clockLayers.map((clock) => (
                                  <option key={clock.id} value={clock.id}>
                                    {clock.name}
                                  </option>
                                ))}
                              </select>
                              {rule.timerAlarm ? (
                                <>
                                  <span>At</span>
                                  <TimerAlarmThresholdInput
                                    value={rule.timerAlarm.thresholdMs}
                                    onChange={(thresholdMs) =>
                                      updateRule(layer.id, rule.id, {
                                        timerAlarm: { ...rule.timerAlarm!, thresholdMs },
                                      })
                                    }
                                  />
                                  <select
                                    aria-label="Alarm crossing direction"
                                    value={rule.timerAlarm.direction}
                                    onChange={(event) =>
                                      updateRule(layer.id, rule.id, {
                                        timerAlarm: {
                                          ...rule.timerAlarm!,
                                          direction: event.currentTarget.value as 'up' | 'down',
                                        },
                                      })
                                    }
                                  >
                                    <option value="down">Counting down</option>
                                    <option value="up">Counting up</option>
                                  </select>
                                </>
                              ) : null}
                              {clockLayers.some(
                                (clock) =>
                                  clock.id === rule.timerAlarm?.sourceLayerId &&
                                  clock.element.type === 'text' &&
                                  clock.element.clock?.mode === 'clock',
                              ) ? (
                                <small className="rule-editor-note">
                                  Select Count up or Count down in the timer’s Properties to run
                                  alarms.
                                </small>
                              ) : null}
                            </div>
                          ) : null}
                          {trigger === 'step' ? (
                            <select
                              aria-label="Step"
                              value={rule.eventId ?? ''}
                              onChange={(event) =>
                                replaceRule(
                                  layer.id,
                                  rule.id,
                                  withoutUndefined<LayerVisualRule>({
                                    ...rule,
                                    eventId: event.target.value || undefined,
                                  }),
                                )
                              }
                            >
                              <option value="">Any step</option>
                              {steps.map((step) => (
                                <option key={step.id} value={step.id}>
                                  {lifecycleLabel(step, composition.keyframes)}
                                </option>
                              ))}
                            </select>
                          ) : trigger === 'custom-action' ? (
                            <select
                              aria-label="Custom action"
                              value={rule.eventId ?? ''}
                              onChange={(event) =>
                                updateRule(layer.id, rule.id, { eventId: event.target.value })
                              }
                            >
                              <option value="">Choose action</option>
                              {composition.customActions.map((candidate) => (
                                <option key={candidate.id} value={candidate.actionId}>
                                  {candidate.name}
                                </option>
                              ))}
                              {clockActions.length ? (
                                <optgroup label="Clocks & timers">
                                  {clockActions.map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>
                                      {candidate.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                            </select>
                          ) : null}
                        </RuleEditorSection>
                        <RuleEditorSection
                          label="IF"
                          title="Conditions"
                          inline={guards.length === 0}
                        >
                          {guards.length === 0 ? (
                            <span className="rule-editor-readonly">Always</span>
                          ) : null}
                          <div className="rules-guard-list">
                            {guards.map((guard, guardIndex) => (
                              <div
                                className="rules-condition-grid rules-extra-condition"
                                key={`${rule.id}:condition:${guardIndex}`}
                              >
                                {guardIndex === 0 && !isData ? null : (
                                  <select
                                    className="rules-match-mode"
                                    aria-label="Combine conditions"
                                    value={rule.match ?? 'all'}
                                    onChange={(event) =>
                                      updateRule(layer.id, rule.id, {
                                        match: event.target.value as 'all' | 'any',
                                      })
                                    }
                                  >
                                    <option value="all">and</option>
                                    <option value="any">or</option>
                                  </select>
                                )}
                                <ConditionEditor
                                  condition={guard}
                                  fields={composition.dataFields}
                                  allowChangeOperators={isData}
                                  labelPrefix={`Condition ${guardIndex + 2}`}
                                  onChange={(patch) => setGuard(guardIndex, patch)}
                                />
                                <button
                                  type="button"
                                  aria-label="Remove condition"
                                  onClick={() => {
                                    const conditions = guards.filter(
                                      (_, candidate) => candidate !== guardIndex,
                                    );
                                    replaceRule(
                                      layer.id,
                                      rule.id,
                                      withoutUndefined<LayerVisualRule>({
                                        ...rule,
                                        conditions: conditions.length ? conditions : undefined,
                                        match: conditions.length ? rule.match : undefined,
                                      }),
                                    );
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="rules-add-condition"
                              title={
                                conditionCount === 0
                                  ? 'Only run when a data or mouse condition holds'
                                  : 'Add another condition'
                              }
                              onClick={() =>
                                updateRule(layer.id, rule.id, {
                                  conditions: [
                                    ...guards,
                                    createVisualRuleCondition({
                                      fieldId:
                                        composition.dataFields[0]?.id ??
                                        VISUAL_RULE_MOUSE_X_FIELD_ID,
                                      operator: 'not-empty',
                                    }),
                                  ],
                                })
                              }
                            >
                              + Add condition
                            </button>
                          </div>
                        </RuleEditorSection>

                        <RuleEditorSection label="THEN" title="Actions">
                          {rule.actions.map((action, actionIndex) => {
                            // A group's property list follows its first member.
                            const actionTarget = isVisualRuleStateAction(action)
                              ? (layerById.get(
                                  (action.targetGroupId
                                    ? groupMembers.get(action.targetGroupId)?.[0]
                                    : undefined) ??
                                    (action.targetLayerId ||
                                      (rule.hostGroupId
                                        ? groupMembers.get(rule.hostGroupId)?.[0]
                                        : undefined) ||
                                      layer.id),
                                ) ?? layer)
                              : layer;
                            const setAction = (next: Loose<VisualRuleAction>) =>
                              updateRule(layer.id, rule.id, {
                                actions: replaceAction(
                                  rule,
                                  actionIndex,
                                  withoutUndefined<VisualRuleAction>(next),
                                ),
                              });
                            const moveAction = (direction: -1 | 1) => {
                              const target = actionIndex + direction;
                              if (target < 0 || target >= rule.actions.length) return;
                              const actions = [...rule.actions];
                              const [moved] = actions.splice(actionIndex, 1);
                              actions.splice(target, 0, moved!);
                              updateRule(layer.id, rule.id, { actions });
                            };
                            return (
                              <div
                                className={`rule-action-step${rule.actions.length === 1 ? ' rule-action-step-single' : ''}`}
                                key={`${rule.id}:action:${actionIndex}`}
                              >
                                {rule.actions.length > 1 && (
                                  <span className="rule-action-step-number">{actionIndex + 1}</span>
                                )}
                                <div className="rule-action-step-body">
                                  <div className="rules-action">
                                    <label className="rule-editor-inline-field">
                                      <select
                                        aria-label="Rule action type"
                                        value={actionChoice(action)}
                                        onChange={(event) => {
                                          const choice = event.target.value as ActionChoice;
                                          if (choice.startsWith('playout-')) {
                                            setAction(
                                              createRulePlayoutAction(
                                                choice.slice('playout-'.length) as Extract<
                                                  VisualRuleAction,
                                                  { type: 'playout' }
                                                >['operation'],
                                                projectSet,
                                                activeTemplateId,
                                                action.type === 'playout' ? action : undefined,
                                              ),
                                            );
                                            return;
                                          }
                                          const type: VisualRuleAction['type'] =
                                            choice === 'show' || choice === 'hide'
                                              ? 'visibility'
                                              : choice === 'clock'
                                                ? 'custom-action'
                                                : (choice as Exclude<
                                                    VisualRuleAction['type'],
                                                    'playout'
                                                  >);
                                          const keep = isVisualRuleStateAction(action)
                                            ? {
                                                targetLayerId: action.targetLayerId,
                                                transitionFrames: action.transitionFrames,
                                              }
                                            : {};
                                          const next: Loose<VisualRuleAction> =
                                            type === 'property'
                                              ? {
                                                  type,
                                                  // Every layer has this, unlike fill or colour.
                                                  targetProperty: 'layer.scale',
                                                  value: LAYER_PROPERTY_STARTS['layer.scale'],
                                                  ...keep,
                                                }
                                              : type === 'visibility'
                                                ? { type, visible: choice === 'show', ...keep }
                                                : type === 'toggle-visibility'
                                                  ? { type, ...keep }
                                                  : type === 'play-sound'
                                                    ? { type, cueId: ruleSounds[0]?.id ?? '' }
                                                    : type === 'take-media'
                                                      ? { type, cueId: mediaCues[0]?.id ?? '' }
                                                      : type === 'shader-animation'
                                                        ? {
                                                            type,
                                                            actionId:
                                                              shaderActions[0]?.actionId ?? '',
                                                          }
                                                        : type === 'set-data'
                                                          ? {
                                                              type,
                                                              fieldId:
                                                                composition.dataFields[0]?.id ?? '',
                                                              mode: 'set',
                                                              value: '',
                                                            }
                                                          : {
                                                              type: 'custom-action',
                                                              actionId:
                                                                choice === 'clock'
                                                                  ? (clockActions[0]?.id ?? '')
                                                                  : (composition.customActions[0]
                                                                      ?.actionId ?? ''),
                                                            };
                                          setAction(next);
                                          const options = event.currentTarget
                                            .closest('.rules-action')
                                            ?.querySelector<HTMLDetailsElement>(
                                              '.rules-object-action-details',
                                            );
                                          if (options) options.open = true;
                                        }}
                                      >
                                        {actionTypes.map(([type, label]) => (
                                          <option key={type} value={type}>
                                            {label}
                                          </option>
                                        ))}
                                        <optgroup label="Playout">
                                          {RULE_PLAYOUT_ACTIONS.map(([operation, label]) => (
                                            <option
                                              key={operation}
                                              value={`playout-${operation}`}
                                              disabled={!projectSet?.transitionLogic?.slots.length}
                                            >
                                              {label}
                                            </option>
                                          ))}
                                        </optgroup>
                                      </select>
                                    </label>

                                    {action.type === 'playout' ? (
                                      <RulePlayoutActionEditor
                                        action={action}
                                        projectSet={projectSet}
                                        activeTemplateId={activeTemplateId}
                                        activeProject={project}
                                        onChange={setAction}
                                      />
                                    ) : (
                                      <label className="rule-editor-field">
                                        <span>
                                          {action.type === 'set-data'
                                            ? 'Field'
                                            : actionChoice(action) === 'clock'
                                              ? 'Clock'
                                              : isVisualRuleStateAction(action)
                                                ? 'Target'
                                                : action.type === 'play-sound'
                                                  ? 'Sound'
                                                  : action.type === 'take-media'
                                                    ? 'Source'
                                                    : 'Action'}
                                        </span>
                                        {isVisualRuleStateAction(action) ? (
                                          <RuleTargetPicker
                                            ariaLabel="Action target object"
                                            value={
                                              action.targetGroupId
                                                ? `group:${action.targetGroupId}`
                                                : action.targetLayerId
                                                  ? `layer:${action.targetLayerId}`
                                                  : ''
                                            }
                                            options={targetOptions(layer, rule)}
                                            disabled={layer.isLocked}
                                            onChange={(value) =>
                                              setAction({
                                                ...action,
                                                targetLayerId: value.startsWith('layer:')
                                                  ? value.slice('layer:'.length)
                                                  : undefined,
                                                targetGroupId: value.startsWith('group:')
                                                  ? value.slice('group:'.length)
                                                  : undefined,
                                              })
                                            }
                                          />
                                        ) : action.type === 'play-sound' ? (
                                          <select
                                            aria-label="Sound"
                                            value={action.cueId}
                                            onChange={(event) => {
                                              const value = event.target.value;
                                              setAction({
                                                ...action,
                                                cueId: value.startsWith('asset:')
                                                  ? addRuleSound(value.slice('asset:'.length))
                                                  : value,
                                              });
                                            }}
                                          >
                                            <option value="">
                                              {ruleSounds.length || uncuedAudio.length
                                                ? 'Choose sound'
                                                : 'Import audio in Resources'}
                                            </option>
                                            {ruleSounds.map((cue) => (
                                              <option key={cue.id} value={cue.id}>
                                                {cue.name}
                                              </option>
                                            ))}
                                            {uncuedAudio.length ? (
                                              <optgroup label="Imported audio">
                                                {uncuedAudio.map((asset) => (
                                                  <option
                                                    key={asset.id}
                                                    value={`asset:${asset.id}`}
                                                  >
                                                    {asset.name}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ) : null}
                                          </select>
                                        ) : action.type === 'take-media' ? (
                                          <select
                                            value={action.cueId}
                                            onChange={(event) =>
                                              setAction({ ...action, cueId: event.target.value })
                                            }
                                          >
                                            <option value="">Choose video/live cue</option>
                                            {mediaCues.map((cue) => (
                                              <option key={cue.id} value={cue.id}>
                                                {cue.name}
                                              </option>
                                            ))}
                                          </select>
                                        ) : action.type === 'set-data' ? (
                                          <select
                                            aria-label="Data field to change"
                                            value={action.fieldId}
                                            onChange={(event) =>
                                              setAction({
                                                ...action,
                                                fieldId: event.target.value,
                                                ...(action.mode === 'set' ? { value: '' } : {}),
                                              })
                                            }
                                          >
                                            <option value="">
                                              {composition.dataFields.length
                                                ? 'Choose field'
                                                : 'Add a data field first'}
                                            </option>
                                            {composition.dataFields.map((candidate) => (
                                              <option key={candidate.id} value={candidate.id}>
                                                {candidate.label || candidate.key}
                                              </option>
                                            ))}
                                          </select>
                                        ) : action.type === 'custom-action' &&
                                          actionChoice(action) === 'clock' ? (
                                          <RuleTargetPicker
                                            ariaLabel="Clock or timer"
                                            value={
                                              parseClockTimerActionId(action.actionId)?.layerId ??
                                              ''
                                            }
                                            options={clockLayers.map((clock) => ({
                                              value: clock.id,
                                              label: clock.name,
                                              kind: 'object' as const,
                                            }))}
                                            onChange={(layerId) =>
                                              setAction({
                                                ...action,
                                                actionId: clockTimerActionId(
                                                  layerId,
                                                  parseClockTimerActionId(action.actionId)
                                                    ?.command ?? 'start',
                                                ),
                                              })
                                            }
                                          />
                                        ) : (
                                          <select
                                            value={action.actionId}
                                            onChange={(event) =>
                                              setAction({ ...action, actionId: event.target.value })
                                            }
                                          >
                                            <option value="">Choose action</option>
                                            {(action.type === 'shader-animation'
                                              ? shaderActions
                                              : composition.customActions
                                            ).map((candidate) => (
                                              <option key={candidate.id} value={candidate.actionId}>
                                                {candidate.name}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                      </label>
                                    )}
                                    {action.type === 'set-data' && (
                                      <>
                                        <label className="rule-editor-field">
                                          <span>Change</span>
                                          <select
                                            aria-label="How to change the field"
                                            value={action.mode}
                                            onChange={(event) => {
                                              const mode = event.target
                                                .value as VisualRuleSetDataMode;
                                              setAction({
                                                ...action,
                                                mode,
                                                value:
                                                  mode === 'toggle'
                                                    ? undefined
                                                    : mode === 'set'
                                                      ? ''
                                                      : 1,
                                              });
                                            }}
                                          >
                                            {SET_DATA_MODES.map(([mode, label]) => (
                                              <option key={mode} value={mode}>
                                                {label}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                        {action.mode !== 'toggle' && (
                                          <label className="rule-editor-field">
                                            <span>{action.mode === 'set' ? 'Value' : 'By'}</span>
                                            <SetDataValueInput
                                              action={action}
                                              field={composition.dataFields.find(
                                                (candidate) => candidate.id === action.fieldId,
                                              )}
                                              onChange={(value) => setAction({ ...action, value })}
                                            />
                                          </label>
                                        )}
                                      </>
                                    )}
                                    {action.type === 'custom-action' &&
                                      actionChoice(action) === 'clock' && (
                                        <label className="rule-editor-field">
                                          <span>Command</span>
                                          <select
                                            aria-label="Clock command"
                                            value={
                                              parseClockTimerActionId(action.actionId)?.command
                                            }
                                            onChange={(event) =>
                                              setAction({
                                                ...action,
                                                actionId: clockTimerActionId(
                                                  parseClockTimerActionId(action.actionId)
                                                    ?.layerId ?? '',
                                                  event.target.value as ClockTimerCommand,
                                                ),
                                              })
                                            }
                                          >
                                            {CLOCK_COMMANDS.map(([command, label]) => (
                                              <option key={command} value={command}>
                                                {label}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                      )}
                                    {action.type === 'property' && (
                                      <>
                                        <label className="rule-editor-field">
                                          <span>Property</span>
                                          <select
                                            aria-label="Action property"
                                            value={canonicalLayerRuleProperty(
                                              action.targetProperty,
                                            )}
                                            onChange={(event) => {
                                              const targetProperty = event.target.value;
                                              setAction({
                                                ...action,
                                                targetProperty,
                                                // Layer properties take numbers; start from a
                                                // visible change instead of a leftover colour.
                                                ...(isLayerRuleProperty(targetProperty)
                                                  ? {
                                                      value: layerRuleGeometryProperty(
                                                        targetProperty,
                                                      )
                                                        ? getLayerTransformAtFrame(
                                                            actionTarget,
                                                            useTimelineStore.getState()
                                                              .currentFrame,
                                                          )[
                                                            layerRuleGeometryProperty(
                                                              targetProperty,
                                                            )!
                                                          ]
                                                        : (LAYER_PROPERTY_STARTS[targetProperty] ??
                                                          0),
                                                    }
                                                  : isLayerRuleProperty(action.targetProperty)
                                                    ? { value: '' }
                                                    : {}),
                                              });
                                            }}
                                          >
                                            {!ruleProperties(
                                              actionTarget.element,
                                              actionTarget.effects,
                                            )
                                              .flatMap((group) => group.options)
                                              .some(
                                                (property) =>
                                                  property.value ===
                                                  canonicalLayerRuleProperty(action.targetProperty),
                                              ) ? (
                                              // Never let the list fall back to its first entry
                                              // while the rule still holds another property.
                                              <option value={action.targetProperty}>
                                                {action.targetProperty} (not available on this
                                                target)
                                              </option>
                                            ) : null}
                                            {ruleProperties(
                                              actionTarget.element,
                                              actionTarget.effects,
                                            ).map((group) => (
                                              <optgroup key={group.label} label={group.label}>
                                                {group.options.map((property) => (
                                                  <option
                                                    key={property.value}
                                                    value={property.value}
                                                  >
                                                    {property.label}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ))}
                                          </select>
                                        </label>
                                        <label className="rule-editor-field">
                                          <span>Value</span>
                                          <span className="rules-action-settings">
                                            {isLayerRuleProperty(action.targetProperty) ? (
                                              <span className="rules-layer-value">
                                                <input
                                                  aria-label="Action value"
                                                  type="number"
                                                  step={
                                                    action.targetProperty === 'layer.scale' ||
                                                    action.targetProperty === 'layer.opacity'
                                                      ? 0.05
                                                      : 1
                                                  }
                                                  min={
                                                    action.targetProperty === 'layer.scale' ||
                                                    action.targetProperty === 'layer.opacity' ||
                                                    layerRuleGeometryProperty(
                                                      action.targetProperty,
                                                    ) === 'width' ||
                                                    layerRuleGeometryProperty(
                                                      action.targetProperty,
                                                    ) === 'height'
                                                      ? 0
                                                      : undefined
                                                  }
                                                  max={
                                                    action.targetProperty === 'layer.opacity'
                                                      ? 1
                                                      : undefined
                                                  }
                                                  value={String(action.value ?? '')}
                                                  onChange={(event) =>
                                                    setAction({
                                                      ...action,
                                                      value:
                                                        event.currentTarget.value === ''
                                                          ? ''
                                                          : event.currentTarget.valueAsNumber,
                                                    })
                                                  }
                                                />
                                                <small>
                                                  {
                                                    LAYER_RULE_PROPERTIES.find(
                                                      (entry) =>
                                                        entry.value ===
                                                        canonicalLayerRuleProperty(
                                                          action.targetProperty,
                                                        ),
                                                    )?.unit
                                                  }
                                                </small>
                                              </span>
                                            ) : shaderAnimationPropertySpec(
                                                actionTarget.element,
                                                action.targetProperty,
                                              )?.glslType === 'bool' ? (
                                              <input
                                                aria-label="Action value"
                                                title="Enable shader parameter"
                                                type="checkbox"
                                                checked={
                                                  action.value === true || action.value === 'true'
                                                }
                                                onChange={(event) =>
                                                  setAction({
                                                    ...action,
                                                    value: event.currentTarget.checked,
                                                  })
                                                }
                                              />
                                            ) : isColorPropertyAction(action) ? (
                                              <ColorInput
                                                label="Action color"
                                                value={String(action.value ?? '')}
                                                onChange={(value) =>
                                                  setAction({
                                                    ...action,
                                                    value,
                                                  })
                                                }
                                              />
                                            ) : (
                                              <input
                                                aria-label="Action value"
                                                value={String(action.value ?? '')}
                                                onChange={(event) =>
                                                  setAction({
                                                    ...action,
                                                    value: event.target.value,
                                                  })
                                                }
                                              />
                                            )}
                                            {parseShaderAnimationProperty(action.targetProperty) ? (
                                              <small>Shader parameter</small>
                                            ) : null}
                                          </span>
                                        </label>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="rule-action-step-controls">
                                  <button
                                    type="button"
                                    title="Move action up"
                                    aria-label={`Move action ${actionIndex + 1} up`}
                                    disabled={actionIndex === 0}
                                    onClick={() => moveAction(-1)}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    title="Move action down"
                                    aria-label={`Move action ${actionIndex + 1} down`}
                                    disabled={actionIndex === rule.actions.length - 1}
                                    onClick={() => moveAction(1)}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    title="Duplicate action"
                                    aria-label={`Duplicate action ${actionIndex + 1}`}
                                    onClick={() => {
                                      const actions = [...rule.actions];
                                      actions.splice(actionIndex + 1, 0, structuredClone(action));
                                      updateRule(layer.id, rule.id, { actions });
                                    }}
                                  >
                                    ⧉
                                  </button>
                                  <button
                                    type="button"
                                    title="Remove action"
                                    aria-label={`Remove action ${actionIndex + 1}`}
                                    disabled={rule.actions.length === 1}
                                    onClick={() =>
                                      updateRule(layer.id, rule.id, {
                                        actions: rule.actions.filter((_, i) => i !== actionIndex),
                                      })
                                    }
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            className="rules-add-action"
                            title="Add another action"
                            onClick={() =>
                              updateRule(layer.id, rule.id, {
                                actions: [...rule.actions, { type: 'visibility', visible: true }],
                              })
                            }
                          >
                            + Add action
                          </button>
                          {!projectSet?.transitionLogic?.slots.length &&
                            !rule.actions.some((action) => action.type === 'playout') && (
                              <p className="rules-playout-hint">
                                To use Take, Update, Out or Clear, configure lanes and templates in
                                Transitions.
                              </p>
                            )}
                        </RuleEditorSection>
                        {(!state || rule.actions.some(isVisualRuleStateAction)) && (
                          <details className="rule-editor-options">
                            <summary>Timing</summary>
                            <div className="rule-editor-timing">
                              {!state && (
                                <FrameDurationControl
                                  compact
                                  label="Start after"
                                  minFrames={0}
                                  frameRate={composition.frameRate}
                                  frames={rule.delayFrames ?? 0}
                                  onChange={(frames) =>
                                    replaceRule(
                                      layer.id,
                                      rule.id,
                                      withoutUndefined<LayerVisualRule>({
                                        ...rule,
                                        delayFrames: frames || undefined,
                                      }),
                                    )
                                  }
                                />
                              )}
                              {rule.actions.map((action, actionIndex) =>
                                isVisualRuleStateAction(action) ? (
                                  <FrameDurationControl
                                    key={actionIndex}
                                    compact
                                    minFrames={0}
                                    frameRate={composition.frameRate}
                                    label={`${rule.actions.length > 1 ? `Action ${actionIndex + 1} ` : ''}${action.type === 'property' ? 'Animate over' : 'Fade over'}`}
                                    frames={action.transitionFrames ?? 0}
                                    onChange={(frames) =>
                                      updateRule(layer.id, rule.id, {
                                        actions: replaceAction(rule, actionIndex, {
                                          ...action,
                                          transitionFrames: frames || undefined,
                                        }),
                                      })
                                    }
                                  />
                                ) : null,
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    </fieldset>
                  </RuleEditorItem>
                );
              })}
            </div>
          </div>
        </RulesWorkspace>
      </div>
    </Panel>
  );
}
