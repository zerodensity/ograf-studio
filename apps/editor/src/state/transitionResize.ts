import {
  createId,
  getLayerTransformAtFrame,
  TRANSITION_LOGIC_VERSION,
  transitionLogicErrors,
  type ComponentDefinition,
  type TransitionLogicDefinition,
  type TransitionLogicReferences,
  type TransitionLogicSharedValue,
} from '@ograf-editor/scene-model';
import { elementOwner } from './transitionChoreography';
import { sharedValueFor } from './transitionsDesign';

export type ResizeAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export const RESIZE_ANCHORS: ReadonlyArray<{ value: ResizeAnchor; label: string }> = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'center-left', label: 'Center left' },
  { value: 'center', label: 'Center' },
  { value: 'center-right', label: 'Center right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export interface TransitionResizeTarget {
  key: string;
  instanceId: string;
  sourceLayerId: string;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** The unoccupied pose from which these absolute dimensions were read. */
  stateId?: string | null;
  /** Off/resting values, kept separate from the selected template's pose for new tracks. */
  initialValues?: { x: number; y: number; width: number; height: number };
  disabledReason?: string;
}

export interface TransitionResizeSetting {
  width: number;
  height: number;
  anchor: ResizeAnchor;
  configured: boolean;
  issue?: string;
}

type ResizeProperty = 'x' | 'y' | 'width' | 'height';
const PROPERTIES: readonly ResizeProperty[] = ['x', 'y', 'width', 'height'];
const anchorPosition: Record<ResizeAnchor, readonly [number, number]> = {
  'top-left': [0, 0],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  'center-left': [0, 0.5],
  center: [0.5, 0.5],
  'center-right': [1, 0.5],
  'bottom-left': [0, 1],
  'bottom-center': [0.5, 1],
  'bottom-right': [1, 1],
};
/** The anchor as fractions of the box: [0, 0] is the top left, [1, 1] the bottom right. */
export function resizeAnchorFraction(anchor: ResizeAnchor): readonly [number, number] {
  return anchorPosition[anchor];
}
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-3;
const identityMatches = (
  value: Pick<TransitionLogicSharedValue, 'instanceId' | 'sourceLayerId'>,
  target: TransitionResizeTarget,
) => value.instanceId === target.instanceId && value.sourceLayerId === target.sourceLayerId;
const resizeMatches = (value: TransitionLogicSharedValue, target: TransitionResizeTarget) =>
  identityMatches(value, target) && PROPERTIES.includes(value.property as ResizeProperty);

/** Explicit objects in the affected lane, using the selected template's unoccupied pose. */
export function resizeTargets(
  definition: TransitionLogicDefinition,
  components: readonly ComponentDefinition[],
  affectedSlotId: string,
  stateId: string | null,
): TransitionResizeTarget[] {
  if (!definition.slots.some((slot) => slot.id === affectedSlotId)) return [];
  if (
    stateId !== null &&
    !definition.states.some((state) => state.id === stateId && state.slotId === affectedSlotId)
  )
    return [];
  return definition.sharedInstances
    .filter((instance) => elementOwner(definition, instance) === affectedSlotId)
    .flatMap((instance) => {
      const component = components.find((asset) => asset.id === instance.componentAssetId);
      return (component?.layers ?? []).flatMap((layer): TransitionResizeTarget[] => {
        const pose = getLayerTransformAtFrame(layer, 0);
        const value = (property: ResizeProperty | 'rotation') =>
          sharedValueFor(definition, stateId, {
            instanceId: instance.id,
            sourceLayerId: layer.id,
            property,
          }) ?? pose[property];
        const [x, y, width, height, rotation] = [
          value('x'),
          value('y'),
          value('width'),
          value('height'),
          value('rotation'),
        ];
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
        // Parent transforms and rotation need world-space anchor compensation. Do not pretend
        // additive axis-aligned offsets preserve a visual anchor in those cases.
        const rotated = [
          rotation,
          ...definition.states
            .filter((state) => state.slotId === affectedSlotId)
            .map(
              (state) =>
                sharedValueFor(definition, state.id, {
                  instanceId: instance.id,
                  sourceLayerId: layer.id,
                  property: 'rotation',
                }) ?? pose.rotation,
            ),
        ].some((angle) => !Number.isFinite(angle) || !same(angle % 360, 0));
        const disabledReason = layer.parentId
          ? 'Resize anchors require an object without a transform parent.'
          : rotated
            ? 'Resize anchors require an unrotated object in every template in this layer.'
            : undefined;
        return [
          {
            key: JSON.stringify([instance.id, layer.id]),
            instanceId: instance.id,
            sourceLayerId: layer.id,
            label: `${instance.name} / ${layer.name}`,
            x,
            y,
            width,
            height,
            stateId,
            initialValues: Object.fromEntries(
              PROPERTIES.map((property) => [
                property,
                sharedValueFor(definition, null, {
                  instanceId: instance.id,
                  sourceLayerId: layer.id,
                  property,
                }) ?? pose[property],
              ]),
            ) as NonNullable<TransitionResizeTarget['initialValues']>,
            ...(disabledReason ? { disabledReason } : {}),
          },
        ];
      });
    });
}

/** Decode existing offsets without silently converting a manually positioned layout. */
export function readResizeSetting(
  definition: TransitionLogicDefinition,
  triggerSlotId: string,
  affectedSlotId: string,
  target: TransitionResizeTarget,
): TransitionResizeSetting {
  const offsets = (definition.layoutRules ?? [])
    .filter((rule) => rule.whenSlotId === triggerSlotId && rule.slotId === affectedSlotId)
    .flatMap((rule) => rule.sharedOffsets.filter((value) => resizeMatches(value, target)));
  const values: Record<string, number> = {};
  for (const entry of offsets)
    if (typeof entry.value === 'number')
      values[entry.property] = (values[entry.property] ?? 0) + entry.value;
  const numeric = (property: ResizeProperty) =>
    typeof values[property] === 'number' ? (values[property] as number) : 0;
  const width = target.width + numeric('width');
  const height = target.height + numeric('height');
  const matchesAnchor = (value: ResizeAnchor) => {
    const [anchorX, anchorY] = anchorPosition[value];
    return (
      same(numeric('x'), (target.width - width) * anchorX) &&
      same(numeric('y'), (target.height - height) * anchorY)
    );
  };
  const savedAnchor = offsets.find((entry) => entry.property === 'width')?.resizeAnchor;
  const anchor =
    savedAnchor && Object.hasOwn(anchorPosition, savedAnchor) && matchesAnchor(savedAnchor)
      ? savedAnchor
      : RESIZE_ANCHORS.find(({ value }) => matchesAnchor(value))?.value;
  let issue = target.disabledReason;
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    issue = 'Existing layout offsets do not produce a positive, finite size.';
  else if (!anchor)
    issue =
      'This object has custom position offsets. Choose an anchor to replace its position and size offsets.';
  return {
    width,
    height,
    anchor: anchor ?? 'top-left',
    configured: offsets.length > 0,
    ...(issue ? { issue } : {}),
  };
}

function validateTarget(
  definition: TransitionLogicDefinition,
  triggerSlotId: string,
  affectedSlotId: string,
  target: TransitionResizeTarget,
  references: TransitionLogicReferences,
) {
  if (!definition.slots.some((slot) => slot.id === triggerSlotId))
    throw new Error('The triggering layer was removed.');
  if (!definition.slots.some((slot) => slot.id === affectedSlotId))
    throw new Error('The affected layer was removed.');
  if (triggerSlotId === affectedSlotId) throw new Error('Choose another layer to resize.');
  const instance = definition.sharedInstances.find((entry) => entry.id === target.instanceId);
  if (!instance || elementOwner(definition, instance) !== affectedSlotId)
    throw new Error('Choose an object belonging to the affected layer.');
  if (!references.componentLayers?.[instance.componentAssetId]?.includes(target.sourceLayerId))
    throw new Error('The selected source object was removed. Refresh the resize targets.');
  if (
    target.stateId != null &&
    !definition.states.some(
      (state) => state.id === target.stateId && state.slotId === affectedSlotId,
    )
  )
    throw new Error('The selected template was removed or moved. Refresh the resize targets.');
  if (
    ![target.width, target.height, target.x, target.y].every(Number.isFinite) ||
    target.width <= 0 ||
    target.height <= 0
  )
    throw new Error('The selected object needs a positive, finite size.');
}

function validate(definition: TransitionLogicDefinition, references: TransitionLogicReferences) {
  const errors = transitionLogicErrors(definition, references);
  if (errors.length) throw new Error(errors.join(' '));
  return definition;
}

/** Set an absolute destination size. Repeated edits always use the original unoccupied pose. */
export function applyResize(
  source: TransitionLogicDefinition,
  triggerSlotId: string,
  affectedSlotId: string,
  target: TransitionResizeTarget,
  setting: { width: number; height: number; anchor: ResizeAnchor },
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  validateTarget(source, triggerSlotId, affectedSlotId, target, references);
  if (target.disabledReason) throw new Error(target.disabledReason);
  if (
    ![setting.width, setting.height].every(Number.isFinite) ||
    setting.width <= 0 ||
    setting.height <= 0
  )
    throw new Error('Enter a positive, finite width and height.');
  if (!Object.hasOwn(anchorPosition, setting.anchor))
    throw new Error('Choose a valid resize anchor.');
  for (const state of source.states.filter((entry) => entry.slotId === affectedSlotId)) {
    for (const property of ['width', 'height'] as const) {
      const current =
        sharedValueFor(source, state.id, {
          instanceId: target.instanceId,
          sourceLayerId: target.sourceLayerId,
          property,
        }) ??
        target.initialValues?.[property] ??
        target[property];
      const resized = current + setting[property] - target[property];
      if (!Number.isFinite(resized) || resized <= 0)
        throw new Error(
          `This resize would give ${state.name} a non-positive ${property}. Choose a larger size.`,
        );
    }
  }
  const definition = structuredClone(source);
  const rules = (definition.layoutRules ??= []);
  const pairRules = rules.filter(
    (rule) => rule.whenSlotId === triggerSlotId && rule.slotId === affectedSlotId,
  );
  let rule =
    pairRules.find((entry) => entry.sharedOffsets.some((value) => resizeMatches(value, target))) ??
    pairRules[0];
  if (!rule) {
    rule = {
      id: createId('room'),
      name: `Resize for ${definition.slots.find((slot) => slot.id === triggerSlotId)!.name}`.slice(
        0,
        256,
      ),
      slotId: affectedSlotId,
      whenSlotId: triggerSlotId,
      sharedOffsets: [],
    };
    rules.push(rule);
  }
  const existing = pairRules.flatMap((entry) =>
    entry.sharedOffsets.filter((value) => resizeMatches(value, target)),
  );
  const touched = new Set<string>();
  for (const entry of pairRules) {
    if (entry.sharedOffsets.some((value) => resizeMatches(value, target))) touched.add(entry.id);
    entry.sharedOffsets = entry.sharedOffsets.filter((value) => !resizeMatches(value, target));
  }
  const [anchorX, anchorY] = anchorPosition[setting.anchor];
  const offsets: Record<ResizeProperty, number> = {
    x: (target.width - setting.width) * anchorX,
    y: (target.height - setting.height) * anchorY,
    width: setting.width - target.width,
    height: setting.height - target.height,
  };
  for (const property of PROPERTIES) {
    const identity = {
      instanceId: target.instanceId,
      sourceLayerId: target.sourceLayerId,
      property,
    };
    if (
      !definition.initialSharedValues.some(
        (entry) => identityMatches(entry, target) && entry.property === property,
      )
    )
      definition.initialSharedValues.push({
        ...identity,
        value: target.initialValues?.[property] ?? target[property],
      });
    rule.sharedOffsets.push({
      ...existing.find((entry) => entry.property === property),
      ...identity,
      value: offsets[property],
      ...(property === 'width' ? { resizeAnchor: setting.anchor } : {}),
    });
  }
  definition.layoutRules = rules.filter(
    (entry) => entry === rule || !touched.has(entry.id) || entry.sharedOffsets.length > 0,
  );
  definition.version = TRANSITION_LOGIC_VERSION;
  return validate(definition, references);
}

/** Remove only this object's resize/position offsets; its authored pose is restored at runtime. */
export function clearResize(
  source: TransitionLogicDefinition,
  triggerSlotId: string,
  affectedSlotId: string,
  target: TransitionResizeTarget,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  validateTarget(source, triggerSlotId, affectedSlotId, target, references);
  const definition = structuredClone(source);
  definition.layoutRules = (definition.layoutRules ?? []).filter((rule) => {
    if (rule.whenSlotId !== triggerSlotId || rule.slotId !== affectedSlotId) return true;
    const before = rule.sharedOffsets.length;
    rule.sharedOffsets = rule.sharedOffsets.filter((value) => !resizeMatches(value, target));
    return rule.sharedOffsets.length > 0 || rule.sharedOffsets.length === before;
  });
  if (!definition.layoutRules.length) delete definition.layoutRules;
  return validate(definition, references);
}
