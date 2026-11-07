import {
  computeKeyframeFrames,
  getLayerTransformAtFrame,
  type ComponentDefinition,
  type Composition,
  type LayerTransform,
  type Project,
  type TransitionLogicDefinition,
  type TransitionLogicRecipe,
  type TransitionLogicReferences,
  type TransitionLogicSharedValue,
  type TransitionLogicUpdateMode,
} from '@ograf-editor/scene-model';
import { resolveProjectSetTemplate, type ProjectSetDocument } from './projectSet';
import { sharedComponentInitialValues } from './transitionLogicEditing';
import {
  addElement,
  addLayer,
  addPhaseException,
  addRoomRule,
  elementCellStatus,
  elementOwner,
  elementTemplateLayout,
  holdFrames,
  layerStates,
  layersTopFirst,
  moveTemplateToLayer,
  phaseEnd,
  removePhaseException,
  removeRoomRule,
  renameLayer,
  resolveTransition,
  roomRules,
  setElementValue,
  setPhaseTiming,
  setRoomOffset,
  syncElementToTemplates,
  type ChoreographyPhase,
  type TemplateLookup,
  type ElementPropertyIdentity,
  type TimingPatch,
} from './transitionChoreography';

/**
 * The designer-first view of Transition Logic used by the Transitions pane: every lane is a
 * From × To grid, timings are picked as a style and a speed, and template layouts drive checks,
 * lane proposals and shared-element values. Every edit goes through the choreography operations,
 * so the stored definition stays the one the runtime and the Transition Logic pane already use.
 */

/** One cell of a lane's grid. `null` is Off: from Off is a take in, to Off a take out. */
export interface TransitionCell {
  slotId: string;
  from: string | null;
  to: string | null;
}

export function cellPhase(cell: Pick<TransitionCell, 'from' | 'to'>): ChoreographyPhase {
  if (cell.from === null) return 'enter';
  if (cell.to === null) return 'exit';
  return cell.from === cell.to ? 'update' : 'switch';
}

export function sameCell(a: TransitionCell | null, b: TransitionCell | null): boolean {
  return !!a && !!b && a.slotId === b.slotId && a.from === b.from && a.to === b.to;
}

export interface CellTiming {
  phase: ChoreographyPhase;
  recipe: TransitionLogicRecipe | null;
  issue?: string;
  /** Set when this exact pair (or template) has its own timing instead of the lane's. */
  routeId?: string;
  custom: boolean;
}

export function cellTiming(
  definition: TransitionLogicDefinition,
  cell: TransitionCell,
): CellTiming {
  const phase = cellPhase(cell);
  const resolved = resolveTransition(definition, cell.slotId, cell.from, cell.to);
  const route = resolved.route;
  const custom = !!route && route.from === cell.from && route.to === cell.to;
  return {
    phase,
    recipe: resolved.recipe,
    ...(resolved.issue ? { issue: resolved.issue } : {}),
    ...(custom ? { routeId: route.id } : {}),
    custom,
  };
}

/** Every grid cell of a lane: rows are Off then each template, columns each template then Off. */
export function laneCells(definition: TransitionLogicDefinition, slotId: string) {
  const states = layerStates(definition, slotId);
  const rows = [null, ...states.map((state) => state.id)];
  const columns = [...states.map((state) => state.id), null];
  return rows.map((from) =>
    columns.map((to) =>
      from === null && to === null ? null : ({ slotId, from, to } satisfies TransitionCell),
    ),
  );
}

/* Styles, speeds and feels: the designer's words for recipe timing */

export type TransitionStyle =
  'morph' | 'slide' | 'wipe' | 'sequence' | 'dissolve' | 'cut' | 'authored';
export type TransitionSpeed = 'snappy' | 'natural' | 'gentle';

export const TRANSITION_STYLES: ReadonlyArray<{
  style: TransitionStyle;
  label: string;
  hint: string;
}> = [
  { style: 'morph', label: 'Morph', hint: 'Elements glide, content crossfades' },
  {
    style: 'authored',
    label: 'Authored animation',
    hint: 'Play layer tracks without an additional fade',
  },
  { style: 'slide', label: 'Slide', hint: 'Content slides up out and in' },
  { style: 'wipe', label: 'Wipe', hint: 'New content wipes in from the left' },
  { style: 'sequence', label: 'Sequence', hint: 'Elements first, then content' },
  { style: 'dissolve', label: 'Dissolve', hint: 'Everything fades together' },
  { style: 'cut', label: 'Cut', hint: 'Instant change' },
];

export const TRANSITION_SPEEDS: ReadonlyArray<{
  speed: TransitionSpeed;
  label: string;
  seconds: number;
}> = [
  { speed: 'snappy', label: 'Snappy', seconds: 0.45 },
  { speed: 'natural', label: 'Natural', seconds: 0.64 },
  { speed: 'gentle', label: 'Gentle', seconds: 0.9 },
];

/** A lane's answer to "When its content changes". Update transition is the default. */
export const LANE_UPDATE_MODES: ReadonlyArray<{
  mode: TransitionLogicUpdateMode;
  label: string;
  hint: string;
}> = [
  {
    mode: 'transition',
    label: 'Update transition',
    hint: 'Mounts the template again with the new data and plays this lane’s Update timing.',
  },
  {
    mode: 'in-place',
    label: 'In place',
    hint: 'Keeps the template on air. Only layers whose data changed animate, and nothing else dips.',
  },
];

export const TRANSITION_FEELS: ReadonlyArray<{
  easing: TransitionLogicRecipe['easing'];
  label: string;
}> = [
  { easing: 'ease-in-out', label: 'Smooth' },
  { easing: 'ease-out', label: 'Settle' },
  { easing: 'linear', label: 'Even' },
];

/** Frames before the motion starts: a take in that opens room first reveals after it. */
function roomLead(recipe: TransitionLogicRecipe, phase: ChoreographyPhase): number {
  const layout = recipe.layoutPhase;
  if (!layout || phase !== 'enter' || layout.startFrame !== 0) return 0;
  const end = layout.startFrame + layout.durationFrames;
  return recipe.incomingStartFrame >= end ? end : 0;
}

/** The motion's own length, without a hold or a make-room lead. */
export function motionFrames(recipe: TransitionLogicRecipe, phase: ChoreographyPhase): number {
  const lead = roomLead(recipe, phase);
  return Math.max(
    phase === 'enter' ? 0 : recipe.outgoingFrames,
    phase === 'exit' ? 0 : recipe.incomingStartFrame - lead + recipe.incomingFrames,
    recipe.sharedFrames,
  );
}

export function styleOf(recipe: TransitionLogicRecipe, phase: ChoreographyPhase): TransitionStyle {
  if (recipe.contentMotion === 'authored') return 'authored';
  const end = motionFrames(recipe, phase);
  if (end <= 1) return 'cut';
  if (recipe.contentMotion === 'slide' || recipe.contentMotion === 'wipe')
    return recipe.contentMotion;
  if (phase === 'exit') {
    if (recipe.outgoingFrames >= 0.9 * end) return 'dissolve';
    return recipe.outgoingFrames <= 0.5 * end ? 'sequence' : 'morph';
  }
  const start = recipe.incomingStartFrame - roomLead(recipe, phase);
  if (start === 0 && (phase === 'enter' || recipe.outgoingFrames >= 0.9 * end)) return 'dissolve';
  return start >= 0.55 * end ? 'sequence' : 'morph';
}

/** The nearest named speed, or null when the timing is clearly custom. */
export function speedOf(
  recipe: TransitionLogicRecipe,
  phase: ChoreographyPhase,
  frameRate: number,
): TransitionSpeed | null {
  const seconds = motionFrames(recipe, phase) / frameRate;
  if (seconds <= 0) return null;
  let best: { speed: TransitionSpeed; distance: number } | null = null;
  for (const entry of TRANSITION_SPEEDS) {
    const distance = Math.abs(Math.log(seconds / entry.seconds));
    if (!best || distance < best.distance) best = { speed: entry.speed, distance };
  }
  return best && best.distance <= Math.log(1.18) ? best.speed : null;
}

export function speedFrames(speed: TransitionSpeed, frameRate: number): number {
  const seconds = TRANSITION_SPEEDS.find((entry) => entry.speed === speed)!.seconds;
  return Math.max(2, Math.round(seconds * frameRate));
}

/** Recipe timing for a style at a length. Make-room timing and the hold are kept as they are. */
export function stylePatch(
  phase: ChoreographyPhase,
  style: TransitionStyle,
  frames: number,
  current?: TransitionLogicRecipe,
): TimingPatch {
  const total = Math.max(1, Math.round(frames));
  const at = (fraction: number) => Math.round(total * fraction);
  let patch: Required<
    Pick<TimingPatch, 'outgoingFrames' | 'incomingStartFrame' | 'incomingFrames' | 'sharedFrames'>
  >;
  const hasOut = phase !== 'enter';
  const hasIn = phase !== 'exit';
  if (style === 'cut') {
    patch = {
      outgoingFrames: hasOut ? 1 : 0,
      incomingStartFrame: 0,
      incomingFrames: hasIn ? 1 : 0,
      sharedFrames: 1,
    };
  } else if (style === 'dissolve' || style === 'authored') {
    patch = {
      outgoingFrames: hasOut ? total : 0,
      incomingStartFrame: 0,
      incomingFrames: hasIn ? total : 0,
      sharedFrames: total,
    };
  } else {
    const fractions: Record<
      ChoreographyPhase,
      Record<
        'morph' | 'slide' | 'wipe' | 'sequence',
        [out: number, inStart: number, shared: number]
      >
    > = {
      enter: {
        morph: [0, 0.375, 1],
        slide: [0, 0.3, 1],
        wipe: [0, 0.2, 1],
        sequence: [0, 0.6, 0.6],
      },
      exit: { morph: [0.6, 0, 1], slide: [0.6, 0, 1], wipe: [0.7, 0, 1], sequence: [0.4, 0, 1] },
      update: {
        morph: [0.5, 0.3, 1],
        slide: [0.45, 0.4, 1],
        wipe: [0.6, 0.1, 1],
        sequence: [0.45, 0.55, 1],
      },
      switch: {
        morph: [0.375, 0.44, 1],
        slide: [0.4, 0.42, 1],
        wipe: [0.6, 0.1, 1],
        sequence: [0.4, 0.6, 0.6],
      },
    };
    const [out, inStart, shared] = fractions[phase][style];
    const start = hasIn ? at(inStart) : 0;
    patch = {
      outgoingFrames: hasOut ? Math.max(1, at(out)) : 0,
      incomingStartFrame: start,
      incomingFrames: hasIn ? Math.max(1, total - start) : 0,
      sharedFrames: Math.max(1, at(shared)),
    };
  }
  const lead = current ? roomLead(current, phase) : 0;
  if (lead) patch.incomingStartFrame += lead;
  const motion: TimingPatch = {
    contentMotion: style === 'slide' || style === 'wipe' || style === 'authored' ? style : null,
  };
  const layout = current?.layoutPhase;
  if (layout && phase === 'exit' && layout.startFrame === current!.outgoingFrames)
    return { ...patch, ...motion, layoutPhase: { ...layout, startFrame: patch.outgoingFrames } };
  return { ...patch, ...motion };
}

function cellStates(cell: TransitionCell): [string, string | undefined] {
  const phase = cellPhase(cell);
  if (phase === 'enter') return [cell.to!, undefined];
  if (phase === 'switch') return [cell.from!, cell.to!];
  return [cell.from!, undefined];
}

/**
 * Change one cell's timing. A lane edit moves every cell that follows the lane; a pair edit gives
 * this cell its own timing first. A cell that already has its own timing is always edited alone.
 */
export function applyCellTiming(
  definition: TransitionLogicDefinition,
  cell: TransitionCell,
  patch: TimingPatch,
  scope: 'lane' | 'pair',
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  const timing = cellTiming(definition, cell);
  if (!timing.custom && scope === 'lane')
    return setPhaseTiming(
      definition,
      { kind: 'layer', slotId: cell.slotId, phase: timing.phase },
      patch,
      references,
    );
  let next = definition;
  let routeId = timing.routeId;
  if (!routeId) {
    const [stateId, otherId] = cellStates(cell);
    const added = addPhaseException(
      definition,
      cell.slotId,
      timing.phase,
      stateId,
      otherId,
      references,
    );
    next = added.definition;
    routeId = added.routeId;
  }
  return setPhaseTiming(next, { kind: 'route', routeId, phase: timing.phase }, patch, references);
}

/** Give a pair its own timing without changing how it looks yet. */
export function makeCellCustom(
  definition: TransitionLogicDefinition,
  cell: TransitionCell,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  const timing = cellTiming(definition, cell);
  if (timing.custom) return definition;
  const [stateId, otherId] = cellStates(cell);
  return addPhaseException(definition, cell.slotId, timing.phase, stateId, otherId, references)
    .definition;
}

export function resetCell(
  definition: TransitionLogicDefinition,
  cell: TransitionCell,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  const timing = cellTiming(definition, cell);
  return timing.routeId ? removePhaseException(definition, timing.routeId, references) : definition;
}

/* Template layouts */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateLayerPose {
  layerId: string;
  name: string;
  /** Moves on its own (a loop such as a crawl) or is clipped by a parent: may extend past the frame. */
  free?: boolean;
  /** Authored size of a text layer, in composition pixels. */
  fontSize?: number;
  componentId?: string;
  sourceLayerId?: string;
  pose: LayerTransform;
}

export interface TemplateLayout {
  templateId: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  layers: TemplateLayerPose[];
  bounds: Box | null;
}

/** The pose a template holds on air: its first step, else its start. */
export function onAirFrame(composition: Composition): number {
  const frames = computeKeyframeFrames(composition);
  const keyframe =
    composition.keyframes.find((entry) => entry.role === 'step') ??
    composition.keyframes.find((entry) => entry.role === 'start');
  return frames.find((entry) => entry.keyframeId === keyframe?.id)?.frame ?? 0;
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function intersectBox(a: Box, b: Box): Box | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

function area(box: Box | null): number {
  return box ? box.width * box.height : 0;
}

function poseBox(pose: LayerTransform): Box {
  return { x: pose.x, y: pose.y, width: pose.width, height: pose.height };
}

function clipToFrame(box: Box, width: number, height: number): Box | null {
  return intersectBox(box, { x: 0, y: 0, width, height });
}

export function templateLayout(set: ProjectSetDocument, templateId: string): TemplateLayout {
  const project = resolveProjectSetTemplate(set, templateId);
  const composition =
    project.compositions.find((entry) => entry.id === project.mainCompositionId) ??
    project.compositions[0]!;
  const frame = onAirFrame(composition);
  const layers = composition.layers
    .filter((layer) => layer.isVisible && !layer.isGuide && !layer.isMaskOnly)
    .map((layer) => ({
      layerId: layer.id,
      name: layer.name,
      ...(layer.element.type === 'text' ? { fontSize: layer.element.fontSize } : {}),
      ...(layer.loop ||
      composition.layers.some((parent) => parent.id === layer.parentId && parent.clipChildren)
        ? { free: true }
        : {}),
      ...(layer.componentLink
        ? {
            componentId: layer.componentLink.componentId,
            sourceLayerId: layer.componentLink.sourceLayerId,
          }
        : {}),
      pose: getLayerTransformAtFrame(layer, frame),
    }));
  const visible = layers
    .filter((layer) => layer.pose.opacity > 0 && layer.pose.width > 0 && layer.pose.height > 0)
    .map((layer) => clipToFrame(poseBox(layer.pose), composition.width, composition.height))
    .filter((box): box is Box => !!box);
  return {
    templateId,
    name: set.templates.find((template) => template.id === templateId)?.name ?? 'Template',
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    layers,
    bounds: unionBox(visible),
  };
}

export function templateLayouts(set: ProjectSetDocument): Map<string, TemplateLayout> {
  const layouts = new Map<string, TemplateLayout>();
  for (const template of set.templates) {
    try {
      layouts.set(template.id, templateLayout(set, template.id));
    } catch {
      // A broken template is reported by validation; it simply has no layout here.
    }
  }
  return layouts;
}

export function transitionReferences(
  set: ProjectSetDocument,
  components: ComponentDefinition[],
): TransitionLogicReferences {
  return {
    templateIds: set.templates.map((template) => template.id),
    componentLayers: Object.fromEntries(
      components.map((component) => [component.id, component.layers.map((layer) => layer.id)]),
    ),
  };
}

/* First run: lanes and shared elements proposed from the templates */

export interface LaneProposal {
  name: string;
  templateIds: string[];
  /** Components placed in at least two of the lane's templates: they stay on screen and morph. */
  componentIds: string[];
}

/** Templates that cover much of the same area replace each other; the rest can share the air. */
export function proposeLanes(
  set: ProjectSetDocument,
  layouts: Map<string, TemplateLayout>,
): LaneProposal[] {
  const ids = set.templates.map((template) => template.id);
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    const next = parent.get(id)!;
    return next === id ? id : find(next);
  };
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = layouts.get(ids[i]!)?.bounds;
      const b = layouts.get(ids[j]!)?.bounds;
      // Without a measurable layout, keep templates together: one lane is the safe default.
      const together =
        !a || !b
          ? true
          : area(intersectBox(a, b)) / (area(a) + area(b) - area(intersectBox(a, b))) >= 0.3;
      if (together) parent.set(find(ids[j]!), find(ids[i]!));
    }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  const height = layouts.values().next().value?.height ?? 1080;
  const lanes = [...groups.values()].map((templateIds) => {
    const bounds = unionBox(
      templateIds.map((id) => layouts.get(id)?.bounds).filter((box): box is Box => !!box),
    );
    const center = bounds ? bounds.y + bounds.height / 2 : height / 2;
    const name =
      templateIds.length === 1
        ? (layouts.get(templateIds[0]!)?.name ?? 'Lane')
        : center > height * 0.6
          ? 'Lower third'
          : center < height * 0.33
            ? 'Top'
            : 'Main';
    const counts = new Map<string, number>();
    for (const id of templateIds) {
      const linked = new Set(
        (layouts.get(id)?.layers ?? []).flatMap((layer) =>
          layer.componentId ? [layer.componentId] : [],
        ),
      );
      for (const componentId of linked) counts.set(componentId, (counts.get(componentId) ?? 0) + 1);
    }
    return {
      name,
      templateIds,
      componentIds: [...counts].filter(([, count]) => count >= 2).map(([id]) => id),
      bottom: bounds ? bounds.y + bounds.height : 0,
    };
  });
  // Lanes lower on screen draw on top, so a ticker covers the lower third it meets.
  lanes.sort((a, b) => a.bottom - b.bottom);
  const used = new Set<string>();
  return lanes.map(({ bottom: _bottom, ...lane }) => {
    let name = lane.name;
    for (let index = 2; used.has(name); index += 1) name = `${lane.name} ${index}`;
    used.add(name);
    return { ...lane, name };
  });
}

/** Templates by id, resolved once per snapshot. */
export function templateLookup(set: ProjectSetDocument): TemplateLookup {
  const cache = new Map<string, Project | undefined>();
  return (templateId) => {
    if (!cache.has(templateId)) {
      try {
        cache.set(templateId, resolveProjectSetTemplate(set, templateId));
      } catch {
        cache.set(templateId, undefined);
      }
    }
    return cache.get(templateId);
  };
}

/** Keep a component on screen in a lane; each template's values come from its own layout. */
export function addLaneElement(
  source: TransitionLogicDefinition,
  set: ProjectSetDocument,
  slotId: string,
  component: ComponentDefinition,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  const draft = { name: component.name, componentAssetId: component.id, slotId };
  return addElement(
    source,
    draft,
    sharedComponentInitialValues(set, { ...draft, id: 'new', continuityKey: 'new' }),
    references,
    templates,
  ).definition;
}

export interface PlayoutSetupOptions {
  set: ProjectSetDocument;
  lanes: LaneProposal[];
  components: ComponentDefinition[];
  templates: TemplateLookup;
  references: TransitionLogicReferences;
  style: TransitionStyle;
  speed: TransitionSpeed;
  frameRate: number;
}

/** Build the proposed playout on top of the default definition (one lane holding every template). */
export function buildPlayoutSetup(
  base: TransitionLogicDefinition,
  options: PlayoutSetupOptions,
): TransitionLogicDefinition {
  const { references, templates } = options;
  let definition = base;
  const firstSlot = definition.slots[0];
  if (!firstSlot) throw new Error('The default playout has no lane.');
  const slotIds: string[] = [];
  options.lanes.forEach((lane, index) => {
    let slotId: string;
    if (index === 0) {
      definition = renameLayer(definition, firstSlot.id, lane.name, references);
      slotId = firstSlot.id;
    } else {
      const added = addLayer(definition, lane.name, references);
      definition = added.definition;
      slotId = added.slotId;
    }
    slotIds.push(slotId);
    for (const templateId of lane.templateIds) {
      const state = definition.states.find((entry) => entry.templateId === templateId);
      if (state && state.slotId !== slotId)
        definition = moveTemplateToLayer(definition, state.id, slotId, references, templates);
    }
  });
  options.lanes.forEach((lane, index) => {
    for (const componentId of lane.componentIds) {
      const component = options.components.find((entry) => entry.id === componentId);
      if (component)
        definition = addLaneElement(
          definition,
          options.set,
          slotIds[index]!,
          component,
          templates,
          references,
        );
    }
  });
  const frames = speedFrames(options.speed, options.frameRate);
  for (const slotId of slotIds) {
    const phases: ChoreographyPhase[] =
      layerStates(definition, slotId).length > 1
        ? ['enter', 'update', 'switch', 'exit']
        : ['enter', 'update', 'exit'];
    for (const phase of phases)
      definition = setPhaseTiming(
        definition,
        { kind: 'layer', slotId, phase },
        {
          ...stylePatch(
            phase,
            options.style,
            phase === 'update' ? Math.round(frames * 0.65) : frames,
          ),
          easing: 'ease-in-out',
        },
        references,
      );
  }
  return definition;
}

/* What moves in a cell */

export interface ElementMotion {
  key: string;
  instanceName: string;
  layerName: string;
  property: string;
  from: number;
  to: number;
}

const PROPERTY_LABELS: Record<string, string> = {
  x: 'X',
  y: 'Y',
  width: 'Width',
  height: 'Height',
  rotation: 'Rotation',
  opacity: 'Opacity',
  transformOriginX: 'Origin X',
  transformOriginY: 'Origin Y',
};

export function propertyLabel(property: string): string {
  return PROPERTY_LABELS[property] ?? property;
}

const identityKey = (
  value: Pick<TransitionLogicSharedValue, 'instanceId' | 'sourceLayerId' | 'property'>,
) => JSON.stringify([value.instanceId, value.sourceLayerId, value.property]);

export function sharedValueFor(
  definition: TransitionLogicDefinition,
  stateId: string | null,
  identity: ElementPropertyIdentity,
): number | null {
  const key = identityKey(identity);
  const state = stateId ? definition.states.find((entry) => entry.id === stateId) : undefined;
  const own = state?.sharedValues?.find((entry) => identityKey(entry) === key)?.value;
  if (typeof own === 'number') return own;
  const base = definition.initialSharedValues.find((entry) => identityKey(entry) === key)?.value;
  return typeof base === 'number' ? base : null;
}

/** Shared-element properties whose value differs between the cell's two sides. */
export function cellElementMotions(
  definition: TransitionLogicDefinition,
  components: ComponentDefinition[],
  cell: TransitionCell,
): ElementMotion[] {
  const motions: ElementMotion[] = [];
  for (const instance of definition.sharedInstances) {
    if (elementOwner(definition, instance) !== cell.slotId) continue;
    const component = components.find((entry) => entry.id === instance.componentAssetId);
    const identities = new Map<string, ElementPropertyIdentity>();
    for (const value of [
      ...definition.initialSharedValues,
      ...definition.states.flatMap((state) => state.sharedValues ?? []),
    ])
      if (value.instanceId === instance.id) identities.set(identityKey(value), value);
    for (const [key, identity] of identities) {
      const from = sharedValueFor(definition, cell.from, identity);
      const to = sharedValueFor(definition, cell.to, identity);
      if (from === null || to === null || Math.abs(from - to) < 0.001) continue;
      motions.push({
        key,
        instanceName: instance.name,
        layerName:
          component?.layers.find((layer) => layer.id === identity.sourceLayerId)?.name ?? 'Layer',
        property: identity.property,
        from,
        to,
      });
    }
  }
  return motions;
}

/* Checks */

export interface TransitionCheck {
  id: string;
  tone: 'warning' | 'info' | 'ok';
  title: string;
  detail: string;
  room?: { triggerSlotId: string; affectedSlotId: string };
  cell?: TransitionCell;
  /** A shared element whose stored values no longer match where the templates place it. */
  drift?: { instanceId: string };
}

/** The deepest vertical overlap between any two templates of two lanes, in pixels. */
export function laneOverlap(
  definition: TransitionLogicDefinition,
  layouts: Map<string, TemplateLayout>,
  first: string,
  second: string,
): number {
  let deepest = 0;
  for (const a of layerStates(definition, first))
    for (const b of layerStates(definition, second)) {
      const boxA = layouts.get(a.templateId)?.bounds;
      const boxB = layouts.get(b.templateId)?.bounds;
      const shared = boxA && boxB ? intersectBox(boxA, boxB) : null;
      if (shared) deepest = Math.max(deepest, Math.round(shared.height));
    }
  return deepest;
}

export function transitionChecks(
  definition: TransitionLogicDefinition,
  layouts: Map<string, TemplateLayout>,
): TransitionCheck[] {
  const checks: TransitionCheck[] = [];
  const lanes = layersTopFirst(definition);
  for (let i = 0; i < lanes.length; i += 1)
    for (let j = i + 1; j < lanes.length; j += 1) {
      const top = lanes[i]!;
      const below = lanes[j]!;
      const overlap = laneOverlap(definition, layouts, top.id, below.id);
      if (!overlap) continue;
      const rule = (definition.layoutRules ?? []).find(
        (entry) =>
          (entry.whenSlotId === top.id && entry.slotId === below.id) ||
          (entry.whenSlotId === below.id && entry.slotId === top.id),
      );
      const room = { triggerSlotId: top.id, affectedSlotId: below.id };
      checks.push(
        rule && rule.sharedOffsets.length
          ? {
              id: `room:${top.id}:${below.id}`,
              tone: 'ok',
              title: `${below.name} makes room for ${top.name}`,
              detail: `They overlap by up to ${overlap} px; the room setting moves ${below.name}’s elements while both are on air.`,
              room,
            }
          : {
              id: `clash:${top.id}:${below.id}`,
              tone: 'warning',
              title: `${top.name} covers ${below.name}`,
              detail: `When both are on air they overlap by up to ${overlap} px.`,
              room,
            },
      );
    }
  for (const lane of lanes) {
    let custom = 0;
    for (const row of laneCells(definition, lane.id))
      for (const cell of row) {
        if (!cell) continue;
        const timing = cellTiming(definition, cell);
        if (timing.custom) custom += 1;
        if (!timing.recipe)
          checks.push({
            id: `issue:${lane.id}:${cell.from}:${cell.to}`,
            tone: 'warning',
            title: `${lane.name}: a moment has no timing`,
            detail: timing.issue ?? 'Pick a style for it.',
            cell,
          });
      }
    if (custom)
      checks.push({
        id: `custom:${lane.id}`,
        tone: 'info',
        title: `${lane.name}: ${custom} ${custom === 1 ? 'moment has its' : 'moments have their'} own timing`,
        detail: 'They are marked Custom in the grid. Everything else follows the lane.',
      });
  }
  return checks;
}

/* Shared elements that drifted from their template layouts */

interface ElementDriftEntry {
  stateId: string;
  identity: ElementPropertyIdentity;
  value: number;
}

function elementDriftEntries(
  definition: TransitionLogicDefinition,
  set: ProjectSetDocument,
  instanceId: string,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
): ElementDriftEntry[] {
  const instance = definition.sharedInstances.find((entry) => entry.id === instanceId);
  if (!instance) return [];
  const layout = elementTemplateLayout(definition, instanceId, templates, references);
  const canonical = sharedComponentInitialValues(set, instance);
  const entries: ElementDriftEntry[] = [];
  for (const [stateId, pose] of layout.poses)
    for (const value of pose.values()) {
      const identity = {
        instanceId,
        sourceLayerId: value.sourceLayerId,
        property: value.property,
      };
      // The Off value: saved, else the component's own pose (what the runtime falls back to).
      const resting =
        sharedValueFor(definition, null, identity) ??
        (canonical.find(
          (entry) =>
            entry.sourceLayerId === identity.sourceLayerId && entry.property === identity.property,
        )?.value as number | undefined) ??
        0;
      const status = elementCellStatus(definition, layout, identity, stateId, resting);
      if (status.kind === 'drift') entries.push({ stateId, identity, value: status.value });
    }
  return entries;
}

/** One check per shared element whose stored values differ from where its templates place it. */
export function elementDriftChecks(
  definition: TransitionLogicDefinition,
  set: ProjectSetDocument,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
): TransitionCheck[] {
  return definition.sharedInstances.flatMap((instance) => {
    const entries = elementDriftEntries(definition, set, instance.id, templates, references);
    if (!entries.length) return [];
    const names = [...new Set(entries.map((entry) => entry.stateId))].map(
      (stateId) => definition.states.find((state) => state.id === stateId)?.name ?? 'a template',
    );
    const properties = [...new Set(entries.map((entry) => propertyLabel(entry.identity.property)))];
    return [
      {
        id: `drift:${instance.id}`,
        tone: 'warning' as const,
        title: `${instance.name} doesn’t match its templates`,
        detail: `${properties.join(', ')} in ${names.join(', ')} ${properties.length === 1 ? 'differs' : 'differ'} from where ${
          names.length === 1 ? 'that template places' : 'those templates place'
        } it. Use the template values, or keep these as deliberate differences.`,
        drift: { instanceId: instance.id },
      },
    ];
  });
}

/** Put a drifted element back on its templates' layout. */
export function applyTemplateValues(
  definition: TransitionLogicDefinition,
  instanceId: string,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  return syncElementToTemplates(definition, instanceId, templates, references);
}

/** Keep a drifted element's values as deliberate overrides of its templates' layout. */
export function keepElementValues(
  source: TransitionLogicDefinition,
  set: ProjectSetDocument,
  instanceId: string,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  let definition = source;
  for (const entry of elementDriftEntries(source, set, instanceId, templates, references))
    definition = setElementValue(
      definition,
      entry.identity,
      entry.stateId,
      entry.value,
      sharedValueFor(definition, null, entry.identity) ?? entry.value,
      references,
      { override: true },
    );
  return definition;
}

/* Where shared elements land in a template, edited by dragging on the stage */

export interface LandingBox {
  key: string;
  label: string;
  instanceId: string;
  sourceLayerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Each shared element layer of a lane, at the pose it holds in one template. */
export function landingBoxes(
  definition: TransitionLogicDefinition,
  components: ComponentDefinition[],
  slotId: string,
  stateId: string,
): LandingBox[] {
  return definition.sharedInstances
    .filter((instance) => elementOwner(definition, instance) === slotId)
    .flatMap((instance) => {
      const component = components.find((entry) => entry.id === instance.componentAssetId);
      return (component?.layers ?? []).flatMap((layer) => {
        const pose = getLayerTransformAtFrame(layer, 0);
        const value = (property: 'x' | 'y' | 'width' | 'height' | 'opacity') =>
          sharedValueFor(definition, stateId, {
            instanceId: instance.id,
            sourceLayerId: layer.id,
            property,
          }) ?? pose[property];
        if (layer.isGuide || value('opacity') <= 0 || value('width') <= 0) return [];
        return [
          {
            key: JSON.stringify([instance.id, layer.id]),
            label: layer.name,
            instanceId: instance.id,
            sourceLayerId: layer.id,
            x: value('x'),
            y: value('y'),
            width: value('width'),
            height: value('height'),
          },
        ];
      });
    });
}

/** Store a dragged landing pose as a deliberate difference from the template's layout. */
export function setLanding(
  source: TransitionLogicDefinition,
  box: LandingBox,
  stateId: string,
  geometry: { x: number; y: number; width: number; height: number },
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  let definition = source;
  for (const property of ['x', 'y', 'width', 'height'] as const) {
    const next = Math.round(geometry[property] * 100) / 100;
    if (Math.abs(next - box[property]) < 0.01) continue;
    const identity = { instanceId: box.instanceId, sourceLayerId: box.sourceLayerId, property };
    definition = setElementValue(
      definition,
      identity,
      stateId,
      next,
      sharedValueFor(definition, null, identity) ?? box[property],
      references,
      { override: true },
    );
  }
  return definition;
}

/* Make room while two lanes are on air together */

export type RoomMode = 'move' | 'shrink';

export interface RoomSetting {
  ruleId: string | null;
  amount: number;
  mode: RoomMode;
}

export function roomSetting(
  definition: TransitionLogicDefinition,
  triggerSlotId: string,
  affectedSlotId: string,
): RoomSetting {
  const rule = roomRules(definition, triggerSlotId).find(
    (entry) => entry.slotId === affectedSlotId,
  );
  if (!rule) return { ruleId: null, amount: 0, mode: 'move' };
  const shrink = rule.sharedOffsets.find(
    (value) => value.property === 'height' && typeof value.value === 'number' && value.value < 0,
  );
  if (shrink) return { ruleId: rule.id, amount: -(shrink.value as number), mode: 'shrink' };
  const moved = rule.sharedOffsets.find(
    (value) => value.property === 'y' && typeof value.value === 'number',
  );
  return {
    ruleId: rule.id,
    amount: moved ? Math.max(0, -(moved.value as number)) : 0,
    mode: 'move',
  };
}

interface LaneElementLayer {
  identity: Omit<ElementPropertyIdentity, 'property'>;
  box: Box;
}

function laneElementLayers(
  definition: TransitionLogicDefinition,
  components: ComponentDefinition[],
  slotId: string,
  stateId: string | null,
): LaneElementLayer[] {
  return definition.sharedInstances
    .filter((instance) => elementOwner(definition, instance) === slotId)
    .flatMap((instance) => {
      const component = components.find((entry) => entry.id === instance.componentAssetId);
      return (component?.layers ?? []).map((layer) => {
        const value = (property: 'x' | 'y' | 'width' | 'height') =>
          sharedValueFor(definition, stateId, {
            instanceId: instance.id,
            sourceLayerId: layer.id,
            property,
          }) ?? getLayerTransformAtFrame(layer, 0)[property];
        return {
          identity: { instanceId: instance.id, sourceLayerId: layer.id },
          box: { x: value('x'), y: value('y'), width: value('width'), height: value('height') },
        };
      });
    });
}

/** Offsets for making room: move every element up, or shorten the tallest and lift what's below. */
export function roomOffsets(
  definition: TransitionLogicDefinition,
  components: ComponentDefinition[],
  affectedSlotId: string,
  stateId: string | null,
  amount: number,
  mode: RoomMode,
): Array<{ identity: ElementPropertyIdentity; value: number }> {
  const layers = laneElementLayers(definition, components, affectedSlotId, stateId);
  if (!amount || !layers.length) return [];
  if (mode === 'move')
    return layers.map((layer) => ({
      identity: { ...layer.identity, property: 'y' },
      value: -amount,
    }));
  const tallest = layers.reduce((best, layer) =>
    layer.box.height > best.box.height ? layer : best,
  );
  const cut = tallest.box.y + tallest.box.height - amount;
  return layers.flatMap((layer) =>
    layer === tallest
      ? [{ identity: { ...layer.identity, property: 'height' }, value: -amount }]
      : layer.box.y + layer.box.height > cut
        ? [{ identity: { ...layer.identity, property: 'y' }, value: -amount }]
        : [],
  );
}

export function applyRoom(
  source: TransitionLogicDefinition,
  components: ComponentDefinition[],
  triggerSlotId: string,
  affectedSlotId: string,
  stateId: string | null,
  amount: number,
  mode: RoomMode,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  let definition = source;
  let { ruleId } = roomSetting(definition, triggerSlotId, affectedSlotId);
  const offsets = roomOffsets(definition, components, affectedSlotId, stateId, amount, mode);
  if (!offsets.length) return ruleId ? removeRoomRule(definition, ruleId, references) : definition;
  if (!ruleId) {
    const added = addRoomRule(definition, triggerSlotId, affectedSlotId, references);
    definition = added.definition;
    ruleId = added.ruleId;
  }
  const rule = definition.layoutRules!.find((entry) => entry.id === ruleId)!;
  const wanted = new Set(offsets.map((offset) => identityKey(offset.identity)));
  for (const stale of rule.sharedOffsets.filter((value) => !wanted.has(identityKey(value))))
    definition = setRoomOffset(definition, ruleId, stale, undefined, 0, references);
  for (const offset of offsets)
    definition = setRoomOffset(
      definition,
      ruleId,
      offset.identity,
      offset.value,
      sharedValueFor(definition, null, offset.identity) ?? 0,
      references,
    );
  return definition;
}

/** How far a lane still overlaps another once its elements make room (negative: clear by). */
export function overlapWithRoom(
  definition: TransitionLogicDefinition,
  components: ComponentDefinition[],
  layouts: Map<string, TemplateLayout>,
  affectedStateId: string,
  triggerStateId: string,
  amount: number,
  mode: RoomMode,
): number | null {
  const affected = definition.states.find((state) => state.id === affectedStateId);
  const offsets = affected
    ? roomOffsets(definition, components, affected.slotId, affected.id, amount, mode)
    : [];
  return overlapWithOffsets(definition, layouts, affectedStateId, triggerStateId, offsets);
}

/** Compare the currently authored adjustments, including explicit width and anchored resize. */
export function overlapWithLayout(
  definition: TransitionLogicDefinition,
  layouts: Map<string, TemplateLayout>,
  affectedStateId: string,
  triggerStateId: string,
): number | null {
  const affected = definition.states.find((state) => state.id === affectedStateId);
  const trigger = definition.states.find((state) => state.id === triggerStateId);
  const offsets = (definition.layoutRules ?? [])
    .filter((rule) => rule.slotId === affected?.slotId && rule.whenSlotId === trigger?.slotId)
    .flatMap((rule) =>
      rule.sharedOffsets.map((offset) => ({
        identity: offset,
        value: offset.value as number,
      })),
    );
  return overlapWithOffsets(definition, layouts, affectedStateId, triggerStateId, offsets);
}

function overlapWithOffsets(
  definition: TransitionLogicDefinition,
  layouts: Map<string, TemplateLayout>,
  affectedStateId: string,
  triggerStateId: string,
  offsets: Array<{ identity: ElementPropertyIdentity; value: number }>,
): number | null {
  const affected = definition.states.find((state) => state.id === affectedStateId);
  const trigger = definition.states.find((state) => state.id === triggerStateId);
  const affectedLayout = affected && layouts.get(affected.templateId);
  const triggerBounds = trigger && layouts.get(trigger.templateId)?.bounds;
  if (!affected || !affectedLayout || !triggerBounds) return null;
  const instances = new Map(
    definition.sharedInstances.map((instance) => [instance.id, instance.componentAssetId]),
  );
  const boxes = affectedLayout.layers
    .filter((layer) => layer.pose.opacity > 0 && layer.pose.width > 0 && layer.pose.height > 0)
    .map((layer) => {
      const box = poseBox(layer.pose);
      for (const offset of offsets) {
        if (
          layer.componentId !== instances.get(offset.identity.instanceId) ||
          layer.sourceLayerId !== offset.identity.sourceLayerId
        )
          continue;
        if (offset.identity.property === 'x') box.x += offset.value;
        if (offset.identity.property === 'y') box.y += offset.value;
        if (offset.identity.property === 'width') box.width += offset.value;
        if (offset.identity.property === 'height') box.height += offset.value;
      }
      return box;
    });
  const bounds = unionBox(boxes);
  if (!bounds) return null;
  const top = Math.max(bounds.y, triggerBounds.y);
  const bottom = Math.min(bounds.y + bounds.height, triggerBounds.y + triggerBounds.height);
  const horizontal =
    Math.min(bounds.x + bounds.width, triggerBounds.x + triggerBounds.width) -
    Math.max(bounds.x, triggerBounds.x);
  if (horizontal <= 0) return -Infinity;
  return Math.round(bottom - top);
}

/* Stage schedules for the non-real-time preview */

export const STAGE_LEAD_FRAMES = 2;

export function stageLength(recipe: TransitionLogicRecipe | null): number {
  return recipe ? phaseEnd(recipe) + holdFrames(recipe) + 8 : 30;
}

type StageAction = {
  timestamp: number;
  action: {
    type: 'customAction';
    params: {
      id: 'transition.take' | 'transition.out';
      payload: Record<string, unknown>;
      skipAnimation?: boolean;
    };
  };
};

/** Settle the "from" side instantly, then run the cell's moment from STAGE_LEAD_FRAMES. */
export function stageSchedule(
  cell: TransitionCell,
  frameRate: number,
  updateData?: Record<string, unknown>,
  context: Array<{ slotId: string; stateId: string }> = [],
): StageAction[] {
  const lead = (STAGE_LEAD_FRAMES * 1000) / frameRate;
  const take = (
    slotId: string,
    stateId: string,
    timestamp: number,
    skipAnimation: boolean,
    data?: Record<string, unknown>,
  ): StageAction => ({
    timestamp,
    action: {
      type: 'customAction',
      params: {
        id: 'transition.take',
        payload: { slotId, stateId, ...(data ? { data } : {}) },
        ...(skipAnimation ? { skipAnimation: true } : {}),
      },
    },
  });
  const actions = context.map((entry) => take(entry.slotId, entry.stateId, 0, true));
  if (cell.from !== null) actions.push(take(cell.slotId, cell.from, 0, true));
  if (cell.to === null)
    actions.push({
      timestamp: lead,
      action: {
        type: 'customAction',
        params: { id: 'transition.out', payload: { slotId: cell.slotId } },
      },
    });
  else
    actions.push(
      take(cell.slotId, cell.to, lead, false, cell.from === cell.to ? updateData : undefined),
    );
  return actions;
}

/* Rehearsing a whole rundown */

/** One rundown step: take a template in its lane, or take the lane off (stateId null). */
export interface ShowStep {
  slotId: string;
  stateId: string | null;
}

/** A starting rundown: every template of the bottom lane in turn, other lanes on and off. */
export function defaultShow(definition: TransitionLogicDefinition): ShowStep[] {
  const lanes = [...layersTopFirst(definition)].reverse();
  const [main, ...others] = lanes.filter((lane) => layerStates(definition, lane.id).length);
  if (!main) return [];
  const states = layerStates(definition, main.id);
  const steps: ShowStep[] = [{ slotId: main.id, stateId: states[0]!.id }];
  for (const other of others)
    steps.push({ slotId: other.id, stateId: layerStates(definition, other.id)[0]!.id });
  for (const state of states.slice(1)) steps.push({ slotId: main.id, stateId: state.id });
  for (const other of others) steps.push({ slotId: other.id, stateId: null });
  steps.push({ slotId: main.id, stateId: null });
  return steps;
}

export interface ShowPlan {
  schedule: ReturnType<typeof stageSchedule>;
  totalFrames: number;
  /** The frame each step starts at, in stage frames; -1 for a step that changes nothing. */
  starts: number[];
}

/** Time a rundown with each step's real transition, holding a moment on air between steps. */
export function showPlan(
  definition: TransitionLogicDefinition,
  steps: ShowStep[],
  frameRate: number,
  holdSeconds = 1.2,
): ShowPlan {
  const onAir = new Map<string, string | null>();
  const schedule: ReturnType<typeof stageSchedule> = [];
  const starts: number[] = [];
  let frame = STAGE_LEAD_FRAMES;
  for (const step of steps) {
    const from = onAir.get(step.slotId) ?? null;
    if (from === null && step.stateId === null) {
      starts.push(-1);
      continue;
    }
    starts.push(frame);
    schedule.push({
      timestamp: (frame * 1000) / frameRate,
      action: {
        type: 'customAction',
        params:
          step.stateId === null
            ? { id: 'transition.out', payload: { slotId: step.slotId } }
            : { id: 'transition.take', payload: { slotId: step.slotId, stateId: step.stateId } },
      },
    });
    onAir.set(step.slotId, step.stateId);
    const recipe = resolveTransition(definition, step.slotId, from, step.stateId).recipe;
    frame += Math.max(1, recipe?.durationFrames ?? 1) + Math.round(holdSeconds * frameRate);
  }
  return { schedule, totalFrames: frame, starts };
}

/* Layout checks: content off the frame, elements a template doesn't place */

export function layoutChecks(
  definition: TransitionLogicDefinition,
  layouts: Map<string, TemplateLayout>,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
): TransitionCheck[] {
  const checks: TransitionCheck[] = [];
  for (const state of definition.states) {
    const layout = layouts.get(state.templateId);
    if (!layout) continue;
    const outside = layout.layers.flatMap((layer) => {
      if (layer.free) return [];
      const { x, y, width, height, opacity } = layer.pose;
      if (opacity <= 0 || width <= 0 || height <= 0) return [];
      const past = Math.max(-x, -y, x + width - layout.width, y + height - layout.height);
      return past > 2 ? [{ name: layer.name, past: Math.round(past) }] : [];
    });
    if (outside.length)
      checks.push({
        id: `frame:${state.id}`,
        tone: 'info',
        title: `${state.name}: content runs off the frame`,
        detail: `${outside
          .slice(0, 3)
          .map((entry) => `${entry.name} (${entry.past} px)`)
          .join(
            ', ',
          )}${outside.length > 3 ? ` and ${outside.length - 3} more` : ''} reach past the edge while on air.`,
      });
  }
  for (const state of definition.states) {
    const layout = layouts.get(state.templateId);
    if (!layout) continue;
    // Broadcast text under about 2% of the frame height (21 px at 1080) is hard to read on air.
    const minimum = Math.round(layout.height * 0.0185);
    const small = layout.layers.filter(
      (layer) => layer.fontSize !== undefined && layer.fontSize < minimum && layer.pose.opacity > 0,
    );
    if (small.length)
      checks.push({
        id: `small-text:${state.id}`,
        tone: 'info',
        title: `${state.name}: small text`,
        detail: `${small
          .slice(0, 3)
          .map((layer) => `${layer.name} (${layer.fontSize} px)`)
          .join(', ')}${small.length > 3 ? ` and ${small.length - 3} more` : ''} ${
          small.length === 1 ? 'is' : 'are'
        } under ${minimum} px and may be hard to read on air.`,
      });
  }
  for (const rule of definition.layoutRules ?? []) {
    if (!rule.sharedOffsets.length) continue;
    const trigger = definition.slots.find((slot) => slot.id === rule.whenSlotId);
    const affected = definition.slots.find((slot) => slot.id === rule.slotId);
    if (!trigger || !affected) continue;
    for (const state of layerStates(definition, trigger.id)) {
      const recipe = resolveTransition(definition, trigger.id, null, state.id).recipe;
      const room = recipe?.layoutPhase;
      if (!recipe || !room) continue;
      const roomEnd = room.startFrame + room.durationFrames;
      if (recipe.incomingStartFrame + 1 < roomEnd && room.startFrame === 0 && roomEnd > 0)
        checks.push({
          id: `room-late:${rule.id}:${state.id}`,
          tone: 'warning',
          title: `${state.name} appears before the room is ready`,
          detail: `${affected.name} is still making room for ${Math.max(
            0,
            roomEnd - recipe.incomingStartFrame,
          )} frames after ${state.name} starts to appear, so they overlap briefly.`,
          room: { triggerSlotId: trigger.id, affectedSlotId: affected.id },
        });
    }
  }
  for (const instance of definition.sharedInstances) {
    const slotId = elementOwner(definition, instance);
    if (!slotId) continue;
    const layout = elementTemplateLayout(definition, instance.id, templates, references);
    const missing = layerStates(definition, slotId).filter((state) => !layout.poses.has(state.id));
    if (missing.length && missing.length < layerStates(definition, slotId).length)
      checks.push({
        id: `unplaced:${instance.id}`,
        tone: 'info',
        title: `${instance.name} isn’t in every template`,
        detail: `${missing.map((state) => state.name).join(', ')} ${
          missing.length === 1 ? 'doesn’t' : 'don’t'
        } place it, so it uses its Off position there. Place it in ${
          missing.length === 1 ? 'that template' : 'those templates'
        } to control where it goes.`,
      });
  }
  return checks;
}

/** Lanes still on air after the last step of a rundown. */
export function showEndsOnAir(definition: TransitionLogicDefinition, steps: ShowStep[]): string[] {
  const onAir = new Map<string, string | null>();
  for (const step of steps) onAir.set(step.slotId, step.stateId);
  return [...onAir]
    .filter(([, stateId]) => stateId !== null)
    .map(([slotId]) => definition.slots.find((slot) => slot.id === slotId)?.name ?? 'A lane');
}
