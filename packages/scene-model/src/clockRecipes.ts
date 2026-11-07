import {
  context,
  fieldKeyAllocator,
  finish,
  pose,
  recipeLayer,
  requireStep,
  staticRecipeLayer,
  type ClockRecipeOptions,
  type MaterializedBroadcastRecipe,
} from './broadcastRecipeShared';
import {
  clockTimerActionId,
  formatClockTimerValue,
  MAX_TIMER_VALUE_MS,
  normalizeClockTimerSettings,
} from './clockTimer';
import { createFieldDefinition } from './factory';
import { createCornerRadii } from './cornerRadii';
import { finishRecipeComponent, finishRecipeMaterials } from './recipeFinishing';
import { STYLE_TOKEN_KEYS } from './stylePacks';
import { createLayerVisualRule } from './visualRules';
import type { Composition, Layer, VisualRuleAction } from './types';

function finalizeClock(
  composition: Composition,
  result: MaterializedBroadcastRecipe,
  layers: Record<string, Layer>,
  options: ClockRecipeOptions,
): MaterializedBroadcastRecipe {
  finishRecipeMaterials(
    composition,
    layers,
    undefined,
    options.motion?.style !== 'none' && options.motion?.entrance !== 'none',
  );
  const valueWindow = layers.valueWindow;
  if (valueWindow?.element.type === 'rectangle') {
    // This is an editable geometry-only viewport, independent of the panel's materials.
    valueWindow.element.fill = 'transparent';
    valueWindow.element.strokeColor = 'transparent';
    valueWindow.element.strokeWidth = 0;
    valueWindow.element.borderRadius = createCornerRadii(0);
    valueWindow.designTokenBindings = [];
  }
  const component = finishRecipeComponent(
    composition,
    Object.values(layers).map((layer) => layer.id),
    result.name,
    options.asComponent !== false,
  );
  return { ...result, ...component };
}

/** Explicit hours/minutes inputs retain the original externally driven clock recipe. */
function materializeLegacyClock(
  composition: Composition,
  options: ClockRecipeOptions,
): MaterializedBroadcastRecipe {
  requireStep(composition, 'clock');
  const name = options.name?.trim() || 'Clock';
  const ctx = context(composition, options.stylePack, 'news', options.motion, {
    style: 'slide',
    entrance: 'right',
    exit: 'right',
  });
  const width = Math.max(220, Math.round(options.placement?.width ?? composition.width * 0.15));
  const height = Math.max(72, Math.round(options.placement?.height ?? composition.height * 0.09));
  const x = Math.round(
    options.placement?.x ?? composition.width - width - composition.width * 0.045,
  );
  // Reserve the top-right corner for the channel bug when the starters share a scene.
  const y = Math.round(options.placement?.y ?? composition.height * 0.17);
  const panel = recipeLayer(
    composition,
    'clock',
    `${name} · Panel`,
    ctx.groupId,
    'rectangle',
    'container',
    ['panel'],
    pose(x, y, width, height),
    ctx.motion,
    0,
    4,
  );
  panel.clipChildren = true;
  const digitWidth = (width - 36) / 2;
  const hours = staticRecipeLayer(
    composition,
    'clock',
    `${name} · Hours`,
    ctx.groupId,
    'text',
    'value',
    ['hours', 'editable'],
    pose(x + 10, y + 8, digitWidth, height - 16),
  );
  const separator = staticRecipeLayer(
    composition,
    'clock',
    `${name} · Separator`,
    ctx.groupId,
    'text',
    'value',
    ['separator', 'qa:static-text'],
    pose(x + 10 + digitWidth, y + 8, 16, height - 16),
  );
  const minutes = staticRecipeLayer(
    composition,
    'clock',
    `${name} · Minutes`,
    ctx.groupId,
    'text',
    'value',
    ['minutes', 'editable'],
    pose(x + 26 + digitWidth, y + 8, digitWidth, height - 16),
  );
  for (const text of [hours, separator, minutes]) {
    text.parentId = panel.id;
    if (text.element.type !== 'text') continue;
    text.element.textAlign = 'center';
    text.element.verticalAlign = 'middle';
    text.element.autoFit = 'shrink-to-fit';
    text.element.overflowPolicy = 'clip';
  }
  if (hours.element.type === 'text') hours.element.content = options.content?.hours ?? '18';
  if (separator.element.type === 'text') separator.element.content = ':';
  if (minutes.element.type === 'text') minutes.element.content = options.content?.minutes ?? '42';
  const nextKey = fieldKeyAllocator(composition);
  const hoursField = createFieldDefinition('text', {
    key: nextKey(options.fieldKeys?.hours ?? 'clock_hours', 'clock_hours'),
    label: `${name} Hours`,
    description: 'Two-digit 24-hour clock hour.',
    defaultValue: hours.element.type === 'text' ? hours.element.content : '18',
    constraints: { maxLength: 2, pattern: '^([01][0-9]|2[0-3])$' },
  });
  const minutesField = createFieldDefinition('text', {
    key: nextKey(options.fieldKeys?.minutes ?? 'clock_minutes', 'clock_minutes'),
    label: `${name} Minutes`,
    description: 'Two-digit clock minute.',
    defaultValue: minutes.element.type === 'text' ? minutes.element.content : '42',
    constraints: { maxLength: 2, pattern: '^[0-5][0-9]$' },
  });
  hours.bindings = [{ fieldId: hoursField.id, targetProperty: 'content' }];
  minutes.bindings = [{ fieldId: minutesField.id, targetProperty: 'content' }];
  const layers = { panel, hours, separator, minutes };
  return finalizeClock(
    composition,
    finish(composition, ctx, 'clock', name, layers, { hours: hoursField, minutes: minutesField }),
    layers,
    options,
  );
}

function materializeNativeClock(
  composition: Composition,
  options: ClockRecipeOptions,
  recipe: 'clock' | 'countdown',
): MaterializedBroadcastRecipe {
  requireStep(composition, recipe);
  const mode = options.mode ?? (recipe === 'countdown' ? 'count-down' : 'clock');
  const name = options.name?.trim() || (recipe === 'countdown' ? 'Countdown' : 'Clock');
  const ctx = context(
    composition,
    options.stylePack,
    recipe === 'countdown' ? 'sports' : 'news',
    options.motion,
    {
      style: 'slide',
      entrance: 'right',
      exit: 'right',
    },
  );
  const hasAlarms = mode !== 'clock' && (options.alarms ?? recipe === 'countdown');
  const width = Math.max(240, Math.round(options.placement?.width ?? composition.width * 0.18));
  const height = Math.max(
    96,
    Math.round(
      options.placement?.height ??
        composition.height * (hasAlarms || recipe === 'countdown' ? 0.23 : 0.16),
    ),
  );
  const x = Math.round(
    options.placement?.x ?? composition.width - width - composition.width * 0.045,
  );
  // Separate the bug, clock, and countdown instead of stacking their default panels.
  const y = Math.round(
    options.placement?.y ?? composition.height * (recipe === 'countdown' ? 0.36 : 0.17),
  );
  const panel = recipeLayer(
    composition,
    recipe,
    `${name} · Panel`,
    ctx.groupId,
    'rectangle',
    'container',
    ['panel', 'primary'],
    pose(x, y, width, height),
    ctx.motion,
    0,
    4,
  );
  panel.clipChildren = true;
  const accent = staticRecipeLayer(
    composition,
    recipe,
    `${name} · Accent`,
    ctx.groupId,
    'rectangle',
    'accent',
    ['accent'],
    pose(x, y, Math.max(4, height * 0.04), height),
  );
  const label = staticRecipeLayer(
    composition,
    recipe,
    `${name} · Label`,
    ctx.groupId,
    'text',
    'label',
    ['identity', 'qa:static-text'],
    pose(x + 22, y + height * 0.08, width - 44, height * 0.22),
  );
  const valuePose = pose(x + 20, y + height * 0.34, width - 40, height * (hasAlarms ? 0.43 : 0.55));
  const valueWindow = staticRecipeLayer(
    composition,
    recipe,
    `${name} · Digit window`,
    ctx.groupId,
    'rectangle',
    'mask',
    ['value-window', 'clip'],
    valuePose,
  );
  valueWindow.clipChildren = true;
  const value = staticRecipeLayer(
    composition,
    recipe,
    `${name} · ${mode === 'clock' ? 'Time' : 'Timer'}`,
    ctx.groupId,
    'clock',
    'value',
    ['clock', 'editable', ...(mode === 'clock' ? [] : ['timer', mode])],
    valuePose,
  );
  const requestedDuration = options.durationSeconds;
  const durationMs = Math.min(
    MAX_TIMER_VALUE_MS,
    Math.max(
      0,
      Math.round(
        (typeof requestedDuration === 'number' && Number.isFinite(requestedDuration)
          ? requestedDuration
          : 30) * 1000,
      ),
    ),
  );
  const referenceTimeMs = options.referenceTimeMs ?? Date.now();
  const settings = normalizeClockTimerSettings({
    mode,
    source: options.source ?? 'automatic',
    format: options.format ?? (mode === 'clock' ? 'hh:mm:ss' : 'mm:ss'),
    hourCycle: options.hourCycle ?? '24',
    timeZone: options.timeZone ?? 'local',
    showAmPm: options.hourCycle === '12',
    initialValueMs: mode === 'count-down' ? durationMs : 0,
    limitMs:
      mode === 'count-up' && (requestedDuration !== undefined || hasAlarms) ? durationMs : null,
    manualValue: mode === 'clock' ? referenceTimeMs : mode === 'count-down' ? durationMs : 0,
    autoStart: true,
    pauseWhenOffAir: true,
    referenceTimeMs,
  });
  if (value.element.type === 'text') {
    value.element.clock = settings;
    value.element.content = formatClockTimerValue(
      settings,
      mode === 'clock' ? referenceTimeMs : settings.initialValueMs,
    );
    value.element.textAlign = 'center';
    value.element.verticalAlign = 'middle';
    value.element.autoFit = 'shrink-to-fit';
    value.element.overflowPolicy = 'clip';
    value.element.direction = 'ltr';
    value.element.textAnimation = {
      ...value.element.textAnimation,
      type: mode === 'count-down' ? 'roll-down' : 'roll-up',
      split: 'grapheme',
      durationFrames: Math.max(1, Math.round(composition.frameRate * 0.2)),
      cursor: 'none',
      replayOnUpdate: true,
      customActionId: null,
    };
  }
  if (label.element.type === 'text') {
    label.element.content =
      mode === 'clock'
        ? settings.timeZone === 'local'
          ? 'LOCAL TIME'
          : settings.timeZone.toUpperCase()
        : mode === 'count-down'
          ? 'TIME REMAINING'
          : 'ELAPSED TIME';
    label.element.textAlign = 'center';
    label.element.verticalAlign = 'middle';
    label.element.autoFit = 'shrink-to-fit';
    label.element.overflowPolicy = 'clip';
    label.element.letterSpacing = 1.5;
  }
  const layers: Record<string, Layer> = { panel, accent, label, valueWindow, value };
  const fields: Record<string, ReturnType<typeof createFieldDefinition>> = {};
  if (settings.source === 'manual') {
    const nextKey = fieldKeyAllocator(composition);
    const field = createFieldDefinition('number', {
      key: nextKey(options.fieldKeys?.value ?? `${recipe}_value`, `${recipe}_value`),
      label: `${name} Value (ms)`,
      description:
        mode === 'clock'
          ? 'Externally supplied Unix epoch time in milliseconds. Formatting and time zone are set on the clock.'
          : 'Externally supplied timer value in milliseconds. Alarms detect threshold crossings when this value changes.',
      defaultValue: settings.manualValue,
      constraints: {
        minimum: 0,
        maximum: mode === 'clock' ? 8.64e15 : MAX_TIMER_VALUE_MS,
        step: 1,
      },
    });
    fields.value = field;
    value.bindings = [{ fieldId: field.id, targetProperty: 'clock.manualValue' }];
  }
  if (hasAlarms) {
    const warning = staticRecipeLayer(
      composition,
      recipe,
      `${name} · Five-second warning`,
      ctx.groupId,
      'text',
      'label',
      ['alarm', 'warning', 'qa:static-text'],
      pose(x + 20, y + height * 0.8, width - 40, height * 0.16),
    );
    const finished = staticRecipeLayer(
      composition,
      recipe,
      `${name} · Time up`,
      ctx.groupId,
      'text',
      'label',
      ['alarm', 'finished', 'qa:static-text'],
      pose(x + 20, y + height * 0.8, width - 40, height * 0.16),
    );
    for (const status of [warning, finished]) {
      status.isVisible = false;
      if (status.element.type !== 'text') continue;
      status.element.content =
        status === warning
          ? mode === 'count-down'
            ? 'FINAL FIVE SECONDS'
            : 'APPROACHING LIMIT'
          : 'TIME UP';
      status.element.textAlign = 'center';
      status.element.verticalAlign = 'middle';
      status.element.autoFit = 'shrink-to-fit';
      status.element.overflowPolicy = 'clip';
    }
    layers.warning = warning;
    layers.finished = finished;
    const hideStatus = (): VisualRuleAction[] => [
      { type: 'visibility', targetLayerId: warning.id, visible: false },
      { type: 'visibility', targetLayerId: finished.id, visible: false },
    ];
    const alarmDirection = mode === 'count-down' ? 'down' : 'up';
    value.visualRules = [
      createLayerVisualRule({
        name: mode === 'count-down' ? 'Five seconds remaining' : 'Five seconds before limit',
        trigger: 'timer-alarm',
        timerAlarm: {
          sourceLayerId: value.id,
          thresholdMs:
            mode === 'count-down' ? Math.min(5000, durationMs) : Math.max(0, durationMs - 5000),
          direction: alarmDirection,
        },
        actions: [{ type: 'visibility', targetLayerId: warning.id, visible: true }],
      }),
      createLayerVisualRule({
        name: 'Time up',
        trigger: 'timer-alarm',
        timerAlarm: {
          sourceLayerId: value.id,
          thresholdMs: mode === 'count-down' ? 0 : durationMs,
          direction: alarmDirection,
        },
        actions: [
          { type: 'visibility', targetLayerId: warning.id, visible: false },
          { type: 'visibility', targetLayerId: finished.id, visible: true },
        ],
      }),
      createLayerVisualRule({
        name: 'Clear timer status on Take',
        trigger: 'play',
        actions: hideStatus(),
      }),
      ...(['reset', 'restart'] as const).map((command) =>
        createLayerVisualRule({
          name: `Clear timer status on ${command}`,
          trigger: 'custom-action',
          eventId: clockTimerActionId(value.id, command),
          actions: hideStatus(),
        }),
      ),
    ];
  }
  for (const layer of Object.values(layers)) {
    if (layer !== panel) layer.parentId = layer === value ? valueWindow.id : panel.id;
  }
  const result = finish(composition, ctx, recipe, name, layers, fields);
  // Alarm states retain intentionally distinct colours after Brand Kit application.
  for (const [key, colour] of [
    ['warning', '#ffbd4a'],
    ['finished', '#ff5b65'],
  ] as const) {
    const status = layers[key];
    if (!status || status.element.type !== 'text') continue;
    status.element.color = colour;
    status.designTokenBindings = status.designTokenBindings.filter(
      (binding) => binding.targetProperty !== 'color',
    );
  }
  if (accent.element.type === 'rectangle')
    accent.element.fill = ctx.color(STYLE_TOKEN_KEYS.accent, '#31b7d4');
  return finalizeClock(composition, result, layers, options);
}

/** Native system clock by default; explicit legacy hour/minute controls remain supported. */
export function materializeClock(
  composition: Composition,
  options: ClockRecipeOptions = {},
): MaterializedBroadcastRecipe {
  const legacy =
    options.content?.hours !== undefined ||
    options.content?.minutes !== undefined ||
    options.fieldKeys?.hours !== undefined ||
    options.fieldKeys?.minutes !== undefined;
  return legacy
    ? materializeLegacyClock(composition, options)
    : materializeNativeClock(composition, options, 'clock');
}

/** A reusable countdown with linked five-second and zero-time Rules. */
export function materializeCountdown(
  composition: Composition,
  options: ClockRecipeOptions = {},
): MaterializedBroadcastRecipe {
  return materializeNativeClock(composition, options, 'countdown');
}
