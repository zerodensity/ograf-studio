import {
  createProject,
  getStylePack,
  resolveStylePackMotion,
  stylePackIdForComposition,
  type Composition,
  type Project,
  type StylePackId,
} from '@ograf-editor/scene-model';

export function isUntouchedBlankTiming(composition: Composition): boolean {
  const [start, step, end] = composition.keyframes;
  if (
    !start ||
    !step ||
    !end ||
    composition.keyframes.length !== 3 ||
    composition.transitions.length !== 2
  )
    return false;
  if (
    composition.layers.length ||
    composition.dataFields.length ||
    composition.assets.length ||
    composition.patterns.length ||
    composition.components.length ||
    composition.mediaCues.length ||
    composition.customActions.length ||
    composition.runtimeCollections.length ||
    composition.dataConnections.length ||
    composition.functions?.length
  )
    return false;
  const first = composition.transitions.find(
    (item) => item.fromKeyframeId === start.id && item.toKeyframeId === step.id,
  );
  const last = composition.transitions.find(
    (item) => item.fromKeyframeId === step.id && item.toKeyframeId === end.id,
  );
  return Boolean(
    first &&
    last &&
    start.role === 'start' &&
    step.role === 'step' &&
    end.role === 'end' &&
    first.durationFrames === Math.max(1, Math.round(composition.frameRate * 0.5)) &&
    first.durationFrames + last.durationFrames === Math.ceil(composition.frameRate * 5),
  );
}

/** UI-created templates have space for an entrance and an extended on-air/out span. */
export function setNewCompositionTiming(composition: Composition): void {
  const [start, step, end] = composition.keyframes;
  if (!start || !step || !end) return;
  const first = composition.transitions.find(
    (transition) => transition.fromKeyframeId === start.id && transition.toKeyframeId === step.id,
  );
  const last = composition.transitions.find(
    (transition) => transition.fromKeyframeId === step.id && transition.toKeyframeId === end.id,
  );
  if (!first || !last) return;
  first.durationFrames = Math.max(1, Math.round(composition.frameRate * 0.5));
  last.durationFrames = Math.max(1, Math.ceil(composition.frameRate * 5) - first.durationFrames);
  composition.shortOutFrames = Math.max(1, Math.round(composition.frameRate * 0.5));
}

/**
 * A Step already holds on air until the operator advances. For a new recipe, keep the
 * authored entrance but start Out at that Step instead of inserting a four-second hold.
 * Only the untouched UI default is eligible; existing or deliberately edited timelines
 * retain their own timing. The caller must also establish that this is a fresh UI template.
 */
export function compactFreshRecipeTiming(
  composition: Composition,
  fallbackPack: StylePackId,
): boolean {
  if (!isUntouchedBlankTiming(composition)) return false;
  const [start, step, end] = composition.keyframes;
  if (!start || !step || !end) return false;
  const first = composition.transitions.find(
    (transition) => transition.fromKeyframeId === start.id && transition.toKeyframeId === step.id,
  );
  const last = composition.transitions.find(
    (transition) => transition.fromKeyframeId === step.id && transition.toKeyframeId === end.id,
  );
  if (
    !first ||
    !last ||
    start.name !== 'Start' ||
    step.name !== 'Step 1' ||
    end.name !== 'End' ||
    first.easing !== 'linear' ||
    last.easing !== 'linear' ||
    composition.shortOutFrames !== Math.max(1, Math.round(composition.frameRate * 0.5))
  )
    return false;

  const appliedPack = stylePackIdForComposition(composition);
  // A recipe selects its fallback pack when none is applied, refreshing that pack's
  // tokens. A selected pack retains the designer's token values, including custom motion.
  const motion = appliedPack
    ? resolveStylePackMotion(composition, appliedPack)
    : getStylePack(fallbackPack).motion;
  first.durationFrames = Math.max(first.durationFrames, motion.entranceFrames);
  last.durationFrames = motion.exitFrames;
  // The exit now starts at the Step, so a separate static-hold skip is unnecessary.
  delete composition.shortOutFrames;
  return true;
}

export function setNewTemplateTiming(project: Project): Project {
  for (const composition of project.compositions) setNewCompositionTiming(composition);
  return project;
}

export function createUiProject(): Project {
  return setNewTemplateTiming(createProject());
}
