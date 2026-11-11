import { computeKeyframeFrames } from './keyframeTiming';
import { getResolvedLayerAnimationTracks } from './layerAnimation';
import { getElementFill } from './shader';
import type { Composition } from './types';

/** Conservative, authoring-time assessment for a proposed tail-only exit. This does not change playback. */
export function assessStaticExitHold(
  composition: Composition,
  exitFrames: number,
): { startFrame: number; reason?: string } {
  const frames = computeKeyframeFrames(composition);
  const at = (id: string) => frames.find((entry) => entry.keyframeId === id)?.frame;
  const steps = composition.keyframes.filter((key) => key.role === 'step');
  const step = steps.at(-1);
  const end = composition.keyframes.find((key) => key.role === 'end');
  const stepFrame = step && at(step.id),
    endFrame = end && at(end.id);
  const startFrame = (endFrame ?? 0) - exitFrames;
  const fail = (reason: string) => ({ startFrame, reason });
  if (
    steps.length !== 1 ||
    stepFrame === undefined ||
    endFrame === undefined ||
    !Number.isInteger(exitFrames) ||
    exitFrames < 1 ||
    startFrame < stepFrame
  )
    return fail('The exit window must fit after the final Step.');
  if (
    composition.mediaCues.length ||
    composition.functions?.length ||
    composition.customActions.length ||
    composition.runtimeCollections.length ||
    composition.dataConnections.length ||
    (composition.backgroundPaint !== undefined && typeof composition.backgroundPaint !== 'string')
  )
    return fail(
      'Timed media, functions, actions, collections or connections require authored timing.',
    );
  if (
    Array.isArray(composition.frameCues) &&
    composition.frameCues.some((cue) => cue?.frame > stepFrame && cue.frame <= startFrame)
  )
    return fail('Frame cues in the proposed hold require authored timing.');
  for (const layer of composition.layers) {
    if (layer.isGuide) continue;
    const element = layer.element;
    const staticText =
      element.type === 'text' &&
      element.textAnimation.type === 'none' &&
      !element.textAnimation.animators?.some((animator) => animator.enabled) &&
      !element.clock &&
      !element.crawl &&
      !element.strokePaint;
    if (
      (!['rectangle', 'ellipse', 'path'].includes(element.type) && !staticText) ||
      typeof getElementFill(element) !== 'string'
    )
      return fail(`Layer "${layer.name}" has content that has not been proven static.`);
    if (
      layer.loop ||
      layer.lighting ||
      layer.motionBlur?.enabled ||
      layer.visualRules.length ||
      layer.bindings.length ||
      layer.modifiers?.length ||
      layer.motionPath ||
      layer.textPath ||
      layer.effects.stack?.length ||
      layer.parentId ||
      layer.clipChildren ||
      layer.mask ||
      layer.autoLayout.direction !== 'none'
    )
      return fail(
        `Layer "${layer.name}" has timed or data-driven behavior that requires authored timing.`,
      );
    for (const keys of Object.values(getResolvedLayerAnimationTracks(layer))) {
      if (!keys) continue;
      if (keys.some((key) => key.frame > startFrame && key.frame < endFrame))
        return fail(`Layer "${layer.name}" has staged exit keys requiring authored timing.`);
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1]!,
          b = keys[i]!;
        if (a.frame < startFrame && b.frame > stepFrame && a.value !== b.value)
          return fail(`Layer "${layer.name}" animates during the proposed hold.`);
      }
    }
  }
  return { startFrame };
}
