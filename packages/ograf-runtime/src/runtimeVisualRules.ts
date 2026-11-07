import {
  applyElementDataValue,
  applyVisualRuleEventActions,
  collectVisualRuleStates,
  effectParameterValue,
  firedVisualRuleDataRules,
  firedVisualRuleEventRules,
  interpolateVisualRuleValue,
  isVisualRuleEdgeDataRule,
  isLayerRuleProperty,
  isVisualRuleSideEffectAction,
  isVisualRuleStateAction,
  layerRuleModifiers,
  layerRuleNeutralValue,
  layerRuleGeometryProperty,
  mergeVisualRuleEffects,
  parseEffectProperty,
  readElementDataValue,
  releaseVisualRuleOverrides,
  visualRuleConditions,
  visualRuleConditionsHold,
  visualRuleMouseData,
  isVisualRuleMouseFieldId,
  visualRuleScopeLayerIds,
  visualRuleActionTargets,
  visualRuleTrigger,
  visualRuleValue,
  withEffectParameter,
  VISUAL_RULE_POINTER_TRIGGERS,
  VISUAL_RULE_VISIBILITY_KEY,
  type Element,
  type LayerEffects,
  type LayerRuleModifiers,
  type LayerTransform,
  type VisualRuleDataReader,
  type VisualRuleEffect,
  type VisualRuleEngine,
  type VisualRuleSideEffectAction,
  type VisualRuleTrigger,
} from '@ograf-editor/scene-model';
import type {
  CompiledLayer,
  CompiledLayerVisualRule,
  CompiledVisualRuleCondition,
} from '@ograf-editor/ograf-types';
import { runtimeCollectionItemSelection } from './runtimeCollections';
import { resolveLayerBindingEffects, resolveLayerBindingElement } from './runtimeBindings';
import type { RuntimePointerPosition } from './runtimePointer';

type RuntimeData = Record<string, unknown>;

export type RuntimeVisualRuleEngine = VisualRuleEngine<
  CompiledVisualRuleCondition,
  CompiledLayerVisualRule,
  RuntimeData
>;

/** Rule output as rendered. While visibility fades, the layer stays shown at `contentOpacity`. */
export interface RuntimeVisualRuleEffect extends VisualRuleEffect {
  contentOpacity?: number;
}

export interface FiredRuntimeVisualRule {
  hostLayerId: string;
  rule: CompiledLayerVisualRule;
  /** A data state rule that just started matching runs only its sounds, media and actions. */
  sideEffectsOnly?: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * Per-instance effect registry
 *
 * Several renderers resolve one compiled layer at a time (loop sampling, timeline paint, auto
 * layout). Rules can drive other layers, so a GraphicElement publishes each layer's current rule
 * output here, keyed by its own copy of the layer. Layers it doesn't manage fall back to their own
 * data rules, which is what one-off captures and unit tests use.
 * --------------------------------------------------------------------------------------------- */

const publishedEffects = new WeakMap<CompiledLayer, RuntimeVisualRuleEffect | null>();

export function publishRuntimeVisualRuleEffect(
  layer: CompiledLayer,
  effect: RuntimeVisualRuleEffect | null,
): void {
  publishedEffects.set(layer, effect);
}

export function compiledVisualRuleReader(
  layers: readonly CompiledLayer[],
): VisualRuleDataReader<CompiledVisualRuleCondition, RuntimeData> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  // Inside a runtime collection row, the collection's own field reads that row's item.
  const root = (dataKey: string, hostLayerId: string, data: RuntimeData) => {
    const value = data[dataKey];
    const host = byId.get(hostLayerId);
    if (!host?.collectionItem || host.collectionItem.dataKey !== dataKey) return value;
    const selection = runtimeCollectionItemSelection(host, data);
    return selection && Array.isArray(value) ? value[selection.index] : undefined;
  };
  return {
    read: (condition, hostLayerId, data) =>
      visualRuleValue(root(condition.dataKey, hostLayerId, data), condition.sourcePath),
    readCompare: (condition, hostLayerId, data) =>
      condition.compareDataKey === undefined
        ? null
        : {
            value: visualRuleValue(
              root(condition.compareDataKey, hostLayerId, data),
              condition.compareSourcePath ?? [],
            ),
          },
  };
}

export function createRuntimeVisualRuleEngine(
  layers: readonly CompiledLayer[],
): RuntimeVisualRuleEngine {
  const rendered = new Set(layers.map((layer) => layer.id));
  const rowsByPrototype = new Map<string, string[]>();
  for (const layer of layers) {
    const prototypeId = layer.collectionItem?.prototypeLayerId;
    if (prototypeId)
      rowsByPrototype.set(prototypeId, [...(rowsByPrototype.get(prototypeId) ?? []), layer.id]);
  }
  return {
    hosts: layers
      .filter((layer) => layer.visualRules?.length)
      .map((layer) => ({ layerId: layer.id, rules: layer.visualRules! })),
    reader: compiledVisualRuleReader(layers),
    resolveTarget: (target) =>
      rendered.has(target) ? [target] : (rowsByPrototype.get(target) ?? []),
  };
}

/** A layer's own data rules, for layers no GraphicElement manages. */
function ownRuleEffect(layer: CompiledLayer, data: RuntimeData): VisualRuleEffect | undefined {
  if (!layer.visualRules?.length) return undefined;
  const engine: RuntimeVisualRuleEngine = {
    hosts: [{ layerId: layer.id, rules: layer.visualRules }],
    reader: compiledVisualRuleReader([layer]),
    resolveTarget: (target) => (target === layer.id ? [target] : []),
  };
  return collectVisualRuleStates(engine, data).get(layer.id);
}

export function visualRuleEffectFor(
  layer: CompiledLayer,
  data: RuntimeData,
): RuntimeVisualRuleEffect | undefined {
  return publishedEffects.has(layer)
    ? (publishedEffects.get(layer) ?? undefined)
    : ownRuleEffect(layer, data);
}

function isEffectProperty(property: string): boolean {
  return property === 'dropShadowColor' || Boolean(parseEffectProperty(property));
}

export function resolveVisualRuleElement(
  layer: CompiledLayer,
  data: RuntimeData,
  element: Element = layer.element,
  effect: RuntimeVisualRuleEffect | null | undefined = visualRuleEffectFor(layer, data),
): Element {
  let resolved = element;
  for (const [property, value] of Object.entries(effect?.properties ?? {})) {
    if (isEffectProperty(property)) continue;
    try {
      resolved = applyElementDataValue(resolved, property, value);
    } catch {
      // A rule aimed at a shader parameter the paint no longer declares leaves the paint alone.
    }
  }
  return resolved;
}

export function resolveVisualRuleEffects(
  layer: CompiledLayer,
  data: RuntimeData,
  effects: LayerEffects,
  effect: RuntimeVisualRuleEffect | null | undefined = visualRuleEffectFor(layer, data),
): LayerEffects {
  let resolved = effects;
  for (const [property, value] of Object.entries(effect?.properties ?? {})) {
    if (property === 'dropShadowColor') resolved = { ...resolved, dropShadowColor: String(value) };
    else if (parseEffectProperty(property)) {
      try {
        resolved = withEffectParameter(resolved, property, value);
      } catch {
        // Effect removed after the rule was written.
      }
    }
  }
  return resolved;
}

export function visualRuleLayerVisible(layer: CompiledLayer, data: RuntimeData): boolean {
  return visualRuleEffectFor(layer, data)?.visibility ?? layer.isVisible;
}

/** Whether a layer's own rules move, rotate, scale or fade it. */
function ownsLayerRuleProperty(layer: CompiledLayer): boolean {
  return (layer.visualRules ?? []).some((rule) =>
    rule.actions.some(
      (action) =>
        action.type === 'property' &&
        (!action.targetLayerId || action.targetLayerId === layer.id) &&
        isLayerRuleProperty(action.targetProperty),
    ),
  );
}

/**
 * Rule offsets for a layer's pose. Published output covers rules on any layer; without it only the
 * layer's own data rules apply, and layers without such rules skip evaluation entirely.
 */
export function visualRuleLayerModifiers(
  layer: CompiledLayer,
  data: RuntimeData,
): LayerRuleModifiers | null {
  const effect = publishedEffects.has(layer)
    ? publishedEffects.get(layer)
    : ownsLayerRuleProperty(layer)
      ? ownRuleEffect(layer, data)
      : undefined;
  return layerRuleModifiers(effect?.properties);
}

/** Whether runtime data can change this layer's rendered content or visibility. */
export function layerHasRuntimeVisualInputs(layer: CompiledLayer): boolean {
  const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
  return (
    bindings.length > 0 || (layer.visualRules?.length ?? 0) > 0 || Boolean(layer.collectionItem)
  );
}

/** Pointer triggers a layer answers; its element needs pointer events for these. */
export function pointerVisualRuleTriggers(
  layer: CompiledLayer,
  engine?: RuntimeVisualRuleEngine,
): Set<VisualRuleTrigger> {
  return new Set(
    (engine
      ? engine.hosts.flatMap((host) =>
          host.rules.filter((rule) =>
            visualRuleScopeLayerIds(engine, host.layerId, rule).includes(layer.id),
          ),
        )
      : (layer.visualRules ?? [])
    )
      .filter((rule) => rule.enabled && VISUAL_RULE_POINTER_TRIGGERS.has(visualRuleTrigger(rule)))
      .map(visualRuleTrigger),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Controller
 * --------------------------------------------------------------------------------------------- */

interface RuleTransition {
  from: unknown;
  to: unknown;
  start: number;
  duration: number;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rule state for one GraphicElement: event overrides, hover, transitions and the effect published
 * for every layer. Times are milliseconds on the caller's clock — `performance.now()` in real time,
 * the scheduled OGraf timestamp during non-real-time replay — so transitions are exact either way.
 */
export class RuntimeVisualRules {
  readonly engine: RuntimeVisualRuleEngine;
  /** Layers some other layer's rule can change. */
  readonly targeted: ReadonlySet<string>;
  /** Data keys that data rules read. */
  readonly dataKeys: ReadonlySet<string>;
  /** The pointer is runtime context, never an editorial field or retained data patch. */
  readonly hasMouseConditions: boolean;
  readonly #layers: Map<string, CompiledLayer>;
  readonly #frameRate: number;
  readonly #baseTransform: ((layer: CompiledLayer, at: number) => LayerTransform) | undefined;
  readonly #dataKeysByTarget = new Map<string, Set<string>>();
  #overrides = new Map<string, VisualRuleEffect>();
  #hovered = new Set<string>();
  #hoverEntries = new Set<CompiledLayerVisualRule>();
  #shown = new Map<string, VisualRuleEffect>();
  #transitions = new Map<string, Map<string, RuleTransition>>();
  #pointer: RuntimePointerPosition | null = null;

  constructor(
    layers: readonly CompiledLayer[],
    frameRate: number,
    baseTransform?: (layer: CompiledLayer, at: number) => LayerTransform,
  ) {
    this.engine = createRuntimeVisualRuleEngine(layers);
    this.#layers = new Map(layers.map((layer) => [layer.id, layer]));
    this.#frameRate = frameRate;
    this.#baseTransform = baseTransform;
    const targeted = new Set<string>();
    const dataKeys = new Set<string>();
    for (const host of this.engine.hosts) {
      for (const rule of host.rules) {
        const keys =
          visualRuleTrigger(rule) === 'data'
            ? visualRuleConditions(rule).flatMap((condition) => [
                condition.dataKey,
                ...(condition.compareDataKey === undefined ? [] : [condition.compareDataKey]),
              ])
            : [];
        for (const key of keys) dataKeys.add(key);
        for (const action of rule.actions) {
          if (!isVisualRuleStateAction(action)) continue;
          for (const target of visualRuleActionTargets(this.engine, action, host.layerId, rule)) {
            if (target !== host.layerId) targeted.add(target);
            const byTarget = this.#dataKeysByTarget.get(target) ?? new Set<string>();
            for (const key of keys) byTarget.add(key);
            this.#dataKeysByTarget.set(target, byTarget);
          }
        }
      }
    }
    this.targeted = targeted;
    this.dataKeys = dataKeys;
    this.hasMouseConditions = this.engine.hosts.some((host) =>
      host.rules.some(
        (rule) =>
          rule.enabled &&
          visualRuleConditions(rule).some(
            (condition) =>
              isVisualRuleMouseFieldId(condition.dataKey) ||
              isVisualRuleMouseFieldId(condition.compareDataKey),
          ),
      ),
    );
  }

  /** Data keys whose rules can change this layer. */
  dataKeysFor(layerId: string): ReadonlySet<string> {
    return this.#dataKeysByTarget.get(layerId) ?? new Set();
  }

  reset(): void {
    this.#overrides.clear();
    this.#hovered.clear();
    this.#hoverEntries.clear();
    this.#shown.clear();
    this.#transitions.clear();
    this.#pointer = null;
  }

  #withPointer(data: RuntimeData): RuntimeData {
    return visualRuleMouseData(data, this.#pointer);
  }

  /** Actual coordinate changes fire edge rules once; leaving merely releases pointer state. */
  pointerChanged(
    pointer: RuntimePointerPosition | null,
    data: RuntimeData,
  ): FiredRuntimeVisualRule[] {
    if (!pointer) {
      this.#hovered.clear();
      this.#hoverEntries.clear();
    }
    if (this.#pointer?.x === pointer?.x && this.#pointer?.y === pointer?.y) return [];
    const previous = this.#withPointer(data);
    this.#pointer = pointer;
    const current = this.#withPointer(data);
    this.#overrides = releaseVisualRuleOverrides(
      this.engine,
      this.#overrides,
      { data: previous, hovered: this.#hovered },
      { data: current, hovered: this.#hovered },
    );
    if (!pointer) return [];
    const fired: FiredRuntimeVisualRule[] = firedVisualRuleDataRules(
      this.engine,
      current,
      previous,
    ).map((fired) => ({
      hostLayerId: fired.hostLayerId,
      rule: fired.rule,
      ...(fired.entered ? { sideEffectsOnly: true } : {}),
    }));
    // A guarded hover rule can become true while moving inside the same object/group.
    for (const host of this.engine.hosts) {
      for (const rule of host.rules) {
        if (
          rule.enabled &&
          visualRuleTrigger(rule) === 'hover' &&
          !this.#hoverEntries.has(rule) &&
          visualRuleScopeLayerIds(this.engine, host.layerId, rule).some((id) =>
            this.#hovered.has(id),
          ) &&
          visualRuleConditionsHold(this.engine.reader, rule, host.layerId, current) &&
          !visualRuleConditionsHold(this.engine.reader, rule, host.layerId, previous)
        )
          fired.push({ hostLayerId: host.layerId, rule, sideEffectsOnly: true });
      }
    }
    return fired;
  }

  /** Same-instance data updates keep event overrides, but not pointer or hover state. */
  inheritEventOverrides(
    previous: RuntimeVisualRules,
    previousData: RuntimeData,
    currentData: RuntimeData,
  ): void {
    const overrides = new Map(
      [...previous.#overrides]
        .filter(([layerId]) => this.#layers.has(layerId))
        .map(([layerId, effect]) => [layerId, structuredClone(effect)] as const),
    );
    this.#overrides = releaseVisualRuleOverrides(
      this.engine,
      overrides,
      { data: previousData, hovered: new Set() },
      { data: currentData, hovered: new Set() },
    );
  }

  delayMs(fired: FiredRuntimeVisualRule): number {
    return fired.sideEffectsOnly ? 0 : ((fired.rule.delayFrames ?? 0) / this.#frameRate) * 1000;
  }

  /** Visibility as the viewer sees it, used by toggles. */
  visible(layerId: string): boolean {
    return this.#shown.get(layerId)?.visibility ?? this.#layers.get(layerId)?.isVisible ?? true;
  }

  /** Data moved from `previous` to `current`: returns the change rules that fire. */
  dataChanged(previous: RuntimeData, current: RuntimeData): FiredRuntimeVisualRule[] {
    previous = this.#withPointer(previous);
    current = this.#withPointer(current);
    this.#overrides = releaseVisualRuleOverrides(
      this.engine,
      this.#overrides,
      { data: previous, hovered: this.#hovered },
      { data: current, hovered: this.#hovered },
    );
    return firedVisualRuleDataRules(this.engine, current, previous).map((fired) => ({
      hostLayerId: fired.hostLayerId,
      rule: fired.rule,
      ...(fired.entered ? { sideEffectsOnly: true } : {}),
    }));
  }

  /** A coordinated template starts Off: matching data actions become active on its first Take. */
  dataEntered(data: RuntimeData): FiredRuntimeVisualRule[] {
    data = this.#withPointer(data);
    return this.engine.hosts.flatMap((host) =>
      host.rules
        .filter(
          (rule) =>
            rule.enabled &&
            visualRuleTrigger(rule) === 'data' &&
            !isVisualRuleEdgeDataRule(rule) &&
            visualRuleConditionsHold(this.engine.reader, rule, host.layerId, data),
        )
        .map((rule) => ({ hostLayerId: host.layerId, rule, sideEffectsOnly: true })),
    );
  }

  /** Hover side effects run on entry, rather than once for every rendered frame. */
  hoverEntered(layerId: string, data: RuntimeData): FiredRuntimeVisualRule[] {
    data = this.#withPointer(data);
    return this.engine.hosts.flatMap((host) =>
      host.rules.flatMap((rule) => {
        if (
          !visualRuleScopeLayerIds(this.engine, host.layerId, rule).includes(layerId) ||
          !this.#hoverEntries.delete(rule)
        )
          return [];
        return rule.enabled &&
          visualRuleTrigger(rule) === 'hover' &&
          visualRuleConditionsHold(this.engine.reader, rule, host.layerId, data)
          ? [{ hostLayerId: host.layerId, rule, sideEffectsOnly: true }]
          : [];
      }),
    );
  }

  hoverChanged(
    layerId: string,
    hovered: boolean,
    data: RuntimeData,
    relatedHostLayerId?: string,
  ): void {
    data = this.#withPointer(data);
    const before = new Set(this.#hovered);
    if (hovered) {
      if (relatedHostLayerId) this.#hovered.delete(relatedHostLayerId);
      this.#hovered.add(layerId);
    } else {
      this.#hovered.delete(layerId);
      if (relatedHostLayerId) this.#hovered.add(relatedHostLayerId);
    }
    for (const host of this.engine.hosts) {
      for (const rule of host.rules) {
        if (!rule.enabled || visualRuleTrigger(rule) !== 'hover') continue;
        const members = visualRuleScopeLayerIds(this.engine, host.layerId, rule);
        const wasHovered = members.some((id) => before.has(id));
        const isHovered = members.some((id) => this.#hovered.has(id));
        if (!isHovered) this.#hoverEntries.delete(rule);
        else if (!wasHovered) this.#hoverEntries.add(rule);
      }
    }
    this.#overrides = releaseVisualRuleOverrides(
      this.engine,
      this.#overrides,
      { data, hovered: before },
      { data, hovered: this.#hovered },
    );
  }

  eventFired(
    trigger: Exclude<VisualRuleTrigger, 'data' | 'hover'>,
    data: RuntimeData,
    scope: {
      hostLayerId?: string;
      relatedHostLayerId?: string;
      eventId?: string;
      timerAlarmOwnerLayerId?: string;
      keyboard?: import('@ograf-editor/scene-model').VisualRuleKeyboardInput;
    } = {},
  ): FiredRuntimeVisualRule[] {
    return firedVisualRuleEventRules(this.engine, trigger, this.#withPointer(data), scope);
  }

  /** Runs a fired rule's visibility and property actions; returns the rest for the caller. */
  run(fired: FiredRuntimeVisualRule): VisualRuleSideEffectAction[] {
    if (!fired.sideEffectsOnly)
      this.#overrides = applyVisualRuleEventActions(
        this.engine,
        this.#overrides,
        fired.rule.actions,
        fired.hostLayerId,
        (layerId) => this.visible(layerId),
        fired.rule,
      );
    return fired.rule.actions.filter(isVisualRuleSideEffectAction);
  }

  #baseValue(
    layer: CompiledLayer,
    property: string,
    data: RuntimeData,
    at: number,
    baseTransform = this.#baseTransform,
  ): unknown {
    if (isLayerRuleProperty(property))
      return layerRuleNeutralValue(
        property,
        layerRuleGeometryProperty(property)
          ? (baseTransform?.(layer, at) ??
              [...layer.keyframes].sort((a, b) => a.frame - b.frame)[0]?.transform)
          : undefined,
      );
    if (property === 'dropShadowColor')
      return resolveLayerBindingEffects(layer, data).dropShadowColor;
    if (parseEffectProperty(property))
      return effectParameterValue(resolveLayerBindingEffects(layer, data), property);
    return readElementDataValue(resolveLayerBindingElement(layer, data), property);
  }

  #sample(layerId: string, key: string, at: number): { value: unknown } | null {
    const transition = this.#transitions.get(layerId)?.get(key);
    if (!transition || at >= transition.start + transition.duration) return null;
    return {
      value: interpolateVisualRuleValue(
        transition.from,
        transition.to,
        (at - transition.start) / transition.duration,
      ),
    };
  }

  #setTransition(layerId: string, key: string, transition: RuleTransition | null): void {
    const layerTransitions = this.#transitions.get(layerId) ?? new Map<string, RuleTransition>();
    if (transition) layerTransitions.set(key, transition);
    else layerTransitions.delete(key);
    if (layerTransitions.size) this.#transitions.set(layerId, layerTransitions);
    else this.#transitions.delete(layerId);
  }

  /** Recomputes rule output and starts transitions for values that changed. */
  update(data: RuntimeData, at: number, baseTransform = this.#baseTransform): void {
    const states = collectVisualRuleStates(this.engine, this.#withPointer(data), this.#hovered);
    const next = new Map<string, VisualRuleEffect>();
    for (const layerId of new Set([...states.keys(), ...this.#overrides.keys()])) {
      const merged = mergeVisualRuleEffects(states.get(layerId), this.#overrides.get(layerId));
      if (merged) next.set(layerId, merged);
    }
    for (const layerId of new Set([...next.keys(), ...this.#shown.keys()])) {
      const layer = this.#layers.get(layerId);
      if (!layer) continue;
      const before = this.#shown.get(layerId);
      const after = next.get(layerId);
      const properties = new Set([
        ...Object.keys(before?.properties ?? {}),
        ...Object.keys(after?.properties ?? {}),
      ]);
      for (const property of properties) {
        const had = before !== undefined && property in before.properties;
        const has = after !== undefined && property in after.properties;
        const target = has
          ? after!.properties[property]
          : this.#baseValue(layer, property, data, at, baseTransform);
        const shown =
          this.#sample(layerId, property, at)?.value ??
          (had
            ? before!.properties[property]
            : this.#baseValue(layer, property, data, at, baseTransform));
        if (sameValue(shown, target)) continue;
        const frames =
          (has ? after!.transitionFrames[property] : before?.transitionFrames[property]) ?? 0;
        this.#setTransition(
          layerId,
          property,
          frames > 0
            ? { from: shown, to: target, start: at, duration: (frames / this.#frameRate) * 1000 }
            : null,
        );
      }
      const wasVisible = before?.visibility ?? layer.isVisible;
      const isVisible = after?.visibility ?? layer.isVisible;
      if (wasVisible !== isVisible) {
        const frames =
          (after?.visibility !== undefined
            ? after.transitionFrames[VISUAL_RULE_VISIBILITY_KEY]
            : before?.transitionFrames[VISUAL_RULE_VISIBILITY_KEY]) ?? 0;
        const from =
          this.#sample(layerId, VISUAL_RULE_VISIBILITY_KEY, at)?.value ?? (wasVisible ? 1 : 0);
        this.#setTransition(
          layerId,
          VISUAL_RULE_VISIBILITY_KEY,
          frames > 0
            ? {
                from,
                to: isVisible ? 1 : 0,
                start: at,
                duration: (frames / this.#frameRate) * 1000,
              }
            : null,
        );
      }
    }
    this.#shown = next;
  }

  /** Publishes every layer's rendered effect at `at`; returns whether a transition is running. */
  publish(at: number): boolean {
    let running = false;
    for (const layer of this.#layers.values()) {
      const shown = this.#shown.get(layer.id);
      const transitions = this.#transitions.get(layer.id);
      if (!transitions) {
        publishRuntimeVisualRuleEffect(layer, shown ?? null);
        continue;
      }
      const effect: RuntimeVisualRuleEffect = {
        properties: { ...shown?.properties },
        ...(shown?.visibility === undefined ? {} : { visibility: shown.visibility }),
        transitionFrames: { ...shown?.transitionFrames },
      };
      for (const [key, transition] of transitions) {
        if (at >= transition.start + transition.duration) {
          transitions.delete(key);
          continue;
        }
        running = true;
        const value = interpolateVisualRuleValue(
          transition.from,
          transition.to,
          (at - transition.start) / transition.duration,
        );
        if (key === VISUAL_RULE_VISIBILITY_KEY) {
          effect.visibility = true;
          effect.contentOpacity = Number(value);
        } else effect.properties[key] = value;
      }
      if (transitions.size === 0) this.#transitions.delete(layer.id);
      publishRuntimeVisualRuleEffect(layer, effect);
    }
    return running;
  }
}
