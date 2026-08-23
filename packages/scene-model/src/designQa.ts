import { computeKeyframeFrames } from './keyframeTiming';
import { getLayerTransformAtFrame } from './layerAnimation';
import { intersectConvexPolygons, polygonBounds, transformBoundsPolygon } from './clipping';
import type { Composition, Layer, LayerTransform } from './types';

export type DesignQaSeverity = 'error' | 'warning' | 'info';
export type DesignQaCategory = 'semantics' | 'layout' | 'typography' | 'colour' | 'motion' | 'data';

export interface DesignQaFinding {
  id: string;
  severity: DesignQaSeverity;
  category: DesignQaCategory;
  message: string;
  layerIds: string[];
  frames: number[];
}

export interface DesignQaReport {
  score: number;
  summary: Record<DesignQaSeverity, number>;
  findings: DesignQaFinding[];
  previewFrames: number[];
  metrics: {
    visibleLayers: number;
    semanticCoverage: number;
    editableTextCoverage: number;
    solidColours: string[];
    fontFamilies: string[];
  };
}

function onCanvas(pose: LayerTransform, composition: Composition): boolean {
  return (
    pose.opacity > 0.01 &&
    pose.x + pose.width > 0 &&
    pose.y + pose.height > 0 &&
    pose.x < composition.width &&
    pose.y < composition.height
  );
}

function visiblyOnCanvas(layer: Layer, frame: number, composition: Composition): boolean {
  const pose = getLayerTransformAtFrame(layer, frame);
  if (!onCanvas(pose, composition)) return false;
  let polygon = transformBoundsPolygon(pose);
  let clipped = layer.clipChildren;
  let parentId = layer.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = composition.layers.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    if (parent.clipChildren) {
      clipped = true;
      polygon = intersectConvexPolygons(
        polygon,
        transformBoundsPolygon(getLayerTransformAtFrame(parent, frame)),
      );
      if (polygon.length === 0) return false;
    }
    parentId = parent.parentId;
  }
  const bounds = polygonBounds(polygon, pose);
  if (!bounds) return false;
  if (clipped && (bounds.width <= 1.01 || bounds.height <= 1.01)) return false;
  return (
    bounds.x + bounds.width > 0 &&
    bounds.y + bounds.height > 0 &&
    bounds.x < composition.width &&
    bounds.y < composition.height
  );
}

function solidColours(layer: Layer): string[] {
  if (layer.element.type === 'text') return [layer.element.color];
  if (layer.element.type === 'rectangle' || layer.element.type === 'ellipse') {
    return [
      ...(typeof layer.element.fill === 'string' ? [layer.element.fill] : []),
      layer.element.strokeColor,
    ];
  }
  if (layer.element.type === 'path') return [layer.element.fill, layer.element.strokeColor];
  return [];
}

export function reviewCompositionDesign(composition: Composition): DesignQaReport {
  const lifecycle = computeKeyframeFrames(composition);
  const frameById = new Map(lifecycle.map((item) => [item.keyframeId, item.frame]));
  const startFrame =
    frameById.get(composition.keyframes.find((keyframe) => keyframe.role === 'start')?.id ?? '') ??
    0;
  const stepFrames = composition.keyframes
    .filter((keyframe) => keyframe.role === 'step')
    .map((keyframe) => frameById.get(keyframe.id) ?? 0);
  const endFrame =
    frameById.get(composition.keyframes.find((keyframe) => keyframe.role === 'end')?.id ?? '') ??
    lifecycle.at(-1)?.frame ??
    0;
  const onAirFrame = stepFrames[0] ?? startFrame;
  const findings: DesignQaFinding[] = [];
  const add = (
    id: string,
    severity: DesignQaSeverity,
    category: DesignQaCategory,
    message: string,
    layerIds: string[] = [],
    frames: number[] = [],
  ) => findings.push({ id, severity, category, message, layerIds, frames });

  const visibleLayers = composition.layers.filter(
    (layer) =>
      layer.isVisible &&
      !layer.isGuide &&
      onCanvas(getLayerTransformAtFrame(layer, onAirFrame), composition),
  );
  for (const layer of visibleLayers) {
    const pose = getLayerTransformAtFrame(layer, onAirFrame);
    if (
      pose.x < 0 ||
      pose.y < 0 ||
      pose.x + pose.width > composition.width ||
      pose.y + pose.height > composition.height
    ) {
      add(
        `layout.outside.${layer.id}`,
        'warning',
        'layout',
        `“${layer.name}” extends outside the composition at the first Step.`,
        [layer.id],
        [onAirFrame],
      );
    }
    if (layer.semantics.role === 'none') {
      add(
        `semantics.missing-role.${layer.id}`,
        'info',
        'semantics',
        `“${layer.name}” has no semantic role, reducing reliable model selection.`,
        [layer.id],
        [onAirFrame],
      );
    }
    if (layer.element.type === 'text') {
      const minimum = Math.max(18, composition.height * 0.0185);
      if (layer.element.fontSize < minimum) {
        add(
          `typography.small.${layer.id}`,
          'warning',
          'typography',
          `“${layer.name}” uses ${layer.element.fontSize}px text; review legibility below ${minimum.toFixed(0)}px.`,
          [layer.id],
          [onAirFrame],
        );
      }
      if (layer.bindings.length === 0) {
        add(
          `data.unbound-text.${layer.id}`,
          'info',
          'data',
          `“${layer.name}” is visible text but has no editable data binding.`,
          [layer.id],
          [onAirFrame],
        );
      }
    }

    if (!['background', 'decorative', 'mask'].includes(layer.semantics.role)) {
      if (visiblyOnCanvas(layer, startFrame, composition)) {
        add(
          `motion.no-entrance.${layer.id}`,
          'info',
          'motion',
          `“${layer.name}” is already visible on canvas at Start.`,
          [layer.id],
          [startFrame, onAirFrame],
        );
      }
      if (visiblyOnCanvas(layer, endFrame, composition)) {
        add(
          `motion.no-exit.${layer.id}`,
          'warning',
          'motion',
          `“${layer.name}” remains visible on canvas at End.`,
          [layer.id],
          [onAirFrame, endFrame],
        );
      }
    }
  }

  for (const transition of composition.transitions) {
    if (transition.durationFrames < 2) {
      add(
        `motion.short-transition.${transition.id}`,
        'warning',
        'motion',
        'A lifecycle transition is shorter than two frames and may read as a pop.',
        [],
        [
          frameById.get(transition.fromKeyframeId) ?? 0,
          frameById.get(transition.toKeyframeId) ?? 0,
        ],
      );
    }
    const from = frameById.get(transition.fromKeyframeId);
    const to = frameById.get(transition.toKeyframeId);
    if (from === undefined || to === undefined || transition.durationFrames <= 0) continue;
    for (const layer of visibleLayers) {
      const first = getLayerTransformAtFrame(layer, from);
      const last = getLayerTransformAtFrame(layer, to);
      const distance = Math.hypot(last.x - first.x, last.y - first.y);
      if (distance / transition.durationFrames > composition.width * 0.12) {
        add(
          `motion.fast.${transition.id}.${layer.id}`,
          'warning',
          'motion',
          `“${layer.name}” travels very quickly during a ${transition.durationFrames}-frame transition.`,
          [layer.id],
          [from, to],
        );
      }
    }
  }

  const headlines = visibleLayers.filter((layer) => layer.semantics.role === 'headline');
  const subheadlines = visibleLayers.filter((layer) => layer.semantics.role === 'subheadline');
  for (const headline of headlines) {
    if (headline.element.type !== 'text') continue;
    for (const subheadline of subheadlines) {
      if (
        subheadline.element.type === 'text' &&
        headline.element.fontSize <= subheadline.element.fontSize
      ) {
        add(
          `typography.hierarchy.${headline.id}.${subheadline.id}`,
          'warning',
          'typography',
          'Headline type is not larger than subheadline type.',
          [headline.id, subheadline.id],
          [onAirFrame],
        );
      }
    }
  }

  const solidPalette = [
    ...new Set(
      visibleLayers.flatMap(solidColours).filter((colour) => /^#[0-9a-f]{6,8}$/i.test(colour)),
    ),
  ].sort();
  if (solidPalette.length > 10) {
    add(
      'colour.palette-size',
      'info',
      'colour',
      `The first Step uses ${solidPalette.length} solid colours; consider consolidating them into brand tokens.`,
    );
  }

  const repeaterGroups = new Map<number, Layer[]>();
  for (const layer of visibleLayers) {
    const tag = layer.semantics.tags.find((candidate) => /^repeater-index-\d+$/.test(candidate));
    if (!tag) continue;
    const index = Number(tag.slice('repeater-index-'.length));
    repeaterGroups.set(index, [...(repeaterGroups.get(index) ?? []), layer]);
  }
  if (repeaterGroups.size >= 3) {
    const centres = [...repeaterGroups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, layers]) => {
        const poses = layers.map((layer) => getLayerTransformAtFrame(layer, onAirFrame));
        const left = Math.min(...poses.map((pose) => pose.x));
        const top = Math.min(...poses.map((pose) => pose.y));
        const right = Math.max(...poses.map((pose) => pose.x + pose.width));
        const bottom = Math.max(...poses.map((pose) => pose.y + pose.height));
        return { index, x: (left + right) / 2, y: (top + bottom) / 2 };
      });
    const xSpan = Math.abs(centres.at(-1)!.x - centres[0]!.x);
    const ySpan = Math.abs(centres.at(-1)!.y - centres[0]!.y);
    const values = centres.map((centre) => (xSpan >= ySpan ? centre.x : centre.y));
    const distances = values.slice(1).map((value, index) => value - values[index]!);
    if (Math.max(...distances) - Math.min(...distances) > 2) {
      add(
        'layout.repeater-spacing',
        'warning',
        'layout',
        'Repeater item centres are not evenly spaced.',
        [...repeaterGroups.values()].flat().map((layer) => layer.id),
        [onAirFrame],
      );
    }
  }

  const semanticCoverage =
    visibleLayers.length === 0
      ? 1
      : visibleLayers.filter((layer) => layer.semantics.role !== 'none').length /
        visibleLayers.length;
  const visibleText = visibleLayers.filter((layer) => layer.element.type === 'text');
  const editableTextCoverage =
    visibleText.length === 0
      ? 1
      : visibleText.filter((layer) => layer.bindings.length > 0).length / visibleText.length;
  const summary = {
    error: findings.filter((finding) => finding.severity === 'error').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
  const score = Math.max(0, 100 - summary.error * 20 - summary.warning * 7 - summary.info * 2);
  return {
    score,
    summary,
    findings,
    previewFrames: [...new Set([startFrame, ...stepFrames, endFrame])],
    metrics: {
      visibleLayers: visibleLayers.length,
      semanticCoverage,
      editableTextCoverage,
      solidColours: solidPalette,
      fontFamilies: [
        ...new Set(
          visibleText.flatMap((layer) =>
            layer.element.type === 'text' ? [layer.element.fontFamily] : [],
          ),
        ),
      ].sort(),
    },
  };
}
