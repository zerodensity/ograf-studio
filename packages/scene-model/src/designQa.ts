import { computeKeyframeFrames } from './keyframeTiming';
import {
  getLayerPropertyValueAtFrame,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
} from './layerAnimation';
import { intersectConvexPolygons, polygonBounds, transformBoundsPolygon } from './clipping';
import { fieldDefinitionAtPath } from './fieldSchema';
import type { Composition, Layer, LayerTransform } from './types';

export type DesignQaSeverity = 'error' | 'warning' | 'info';
export type DesignQaCategory =
  'semantics' | 'layout' | 'typography' | 'colour' | 'motion' | 'loop' | 'data';

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

const CRAFT_MOTION_PROPERTIES = ['x', 'y', 'width', 'height', 'opacity'] as const;

function approximately(left: number, right: number, tolerance = 0.001): boolean {
  return Math.abs(left - right) <= tolerance;
}

function movingProperties(layer: Layer, from: number, to: number) {
  return CRAFT_MOTION_PROPERTIES.filter(
    (property) =>
      !approximately(
        getLayerPropertyValueAtFrame(layer, property, from),
        getLayerPropertyValueAtFrame(layer, property, to),
      ),
  );
}

function changedKeys(
  layer: Layer,
  property: (typeof CRAFT_MOTION_PROPERTIES)[number],
  from: number,
  to: number,
) {
  const track = getResolvedLayerAnimationTracks(layer)[property] ?? [];
  return track.filter((key, index) => {
    const previous = track[index - 1];
    return (
      Boolean(previous) &&
      key.frame > from &&
      key.frame <= to &&
      !approximately(key.value, previous!.value)
    );
  });
}

function arrivalFrame(layer: Layer, from: number, to: number): number | null {
  const properties = movingProperties(layer, from, to);
  if (properties.length === 0) return null;
  const candidates = [
    ...new Set([
      to,
      ...properties.flatMap((property) =>
        (getResolvedLayerAnimationTracks(layer)[property] ?? [])
          .filter((key) => key.frame > from && key.frame <= to)
          .map((key) => key.frame),
      ),
    ]),
  ].sort((left, right) => left - right);
  return (
    candidates.find((frame) =>
      properties.every((property) =>
        approximately(
          getLayerPropertyValueAtFrame(layer, property, frame),
          getLayerPropertyValueAtFrame(layer, property, to),
        ),
      ),
    ) ?? null
  );
}

function isAccelerating(easing: string): boolean {
  return easing === 'ease-in' || (easing.endsWith('-in') && !easing.endsWith('-in-out'));
}

function isDecelerating(easing: string): boolean {
  return easing === 'ease-out' || (easing.endsWith('-out') && !easing.endsWith('-in-out'));
}

function isClippedChild(layer: Layer, composition: Composition): boolean {
  return Boolean(
    layer.parentId &&
    composition.layers.some(
      (candidate) => candidate.id === layer.parentId && candidate.clipChildren,
    ),
  );
}

function relatedGroups(layers: Layer[]): Map<string, Layer[]> {
  const groups = new Map<string, Layer[]>();
  for (const layer of layers) {
    if (!layer.groupId) continue;
    groups.set(layer.groupId, [...(groups.get(layer.groupId) ?? []), layer]);
  }
  return groups;
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
  const visibleText = visibleLayers.filter((layer) => layer.element.type === 'text');
  for (const layer of visibleLayers) {
    const pose = getLayerTransformAtFrame(layer, onAirFrame);
    if (
      !layer.semantics.tags.includes('qa:allow-offcanvas') &&
      (pose.x < 0 ||
        pose.y < 0 ||
        pose.x + pose.width > composition.width ||
        pose.y + pose.height > composition.height)
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
      if (layer.bindings.length === 0 && !layer.semantics.tags.includes('qa:static-text')) {
        add(
          `data.unbound-text.${layer.id}`,
          'info',
          'data',
          `“${layer.name}” is visible text but has no editable data binding.`,
          [layer.id],
          [onAirFrame],
        );
      } else {
        const contentBinding = layer.bindings.find(
          (binding) => binding.targetProperty === 'content',
        );
        const field = contentBinding
          ? composition.dataFields.find((candidate) => candidate.id === contentBinding.fieldId)
          : undefined;
        const leaf =
          field && contentBinding
            ? fieldDefinitionAtPath(field, contentBinding.sourcePath ?? [], {
                fromArrayItem: field.type === 'array',
              })
            : field;
        if (
          leaf &&
          (leaf.type === 'text' || leaf.type === 'textarea') &&
          leaf.constraints.maxLength === undefined
        ) {
          add(
            `data.missing-max-length.${layer.id}.${leaf.id}`,
            'info',
            'data',
            `“${leaf.label || leaf.key}” has no maxLength for operator-side text validation.`,
            [layer.id],
            [onAirFrame],
          );
        }
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

      const phase =
        composition.keyframes.find((keyframe) => keyframe.id === transition.fromKeyframeId)
          ?.role === 'start'
          ? 'entrance'
          : composition.keyframes.find((keyframe) => keyframe.id === transition.toKeyframeId)
                ?.role === 'end'
            ? 'exit'
            : null;
      if (phase) {
        const wrongKeys = movingProperties(layer, from, to)
          .flatMap((property) => changedKeys(layer, property, from, to))
          .filter((key) =>
            phase === 'entrance' ? isAccelerating(key.easing) : isDecelerating(key.easing),
          );
        if (wrongKeys.length > 0) {
          add(
            `motion.easing-direction.${transition.id}.${layer.id}`,
            'warning',
            'motion',
            `“${layer.name}” uses ${wrongKeys[0]!.easing} while ${phase === 'entrance' ? 'entering; entrances should decelerate' : 'exiting; exits should accelerate'}.`,
            [layer.id],
            [from, to],
          );
        }
      }
    }

    for (const [groupId, layers] of relatedGroups(visibleLayers)) {
      const clusters = new Map<string, Layer[]>();
      for (const layer of layers) {
        if (layer.semantics.tags.includes('qa:allow-lockstep')) continue;
        const first = getLayerTransformAtFrame(layer, from);
        const last = getLayerTransformAtFrame(layer, to);
        const dx = last.x - first.x;
        const dy = last.y - first.y;
        if (Math.hypot(dx, dy) <= 1) continue;
        const signature = [
          ...new Set(
            (['x', 'y'] as const).flatMap((property) =>
              changedKeys(layer, property, from, to).map((key) => key.frame),
            ),
          ),
        ].join(',');
        const key = `${dx.toFixed(3)}:${dy.toFixed(3)}:${signature}`;
        clusters.set(key, [...(clusters.get(key) ?? []), layer]);
      }
      for (const cluster of clusters.values()) {
        if (cluster.length < 3) continue;
        add(
          `motion.lockstep.${transition.id}.${groupId}`,
          'warning',
          'motion',
          `${cluster.length} related layers share the same translation and key timing; review whether the motion needs hierarchy or stagger.`,
          cluster.map((layer) => layer.id),
          [from, to],
        );
      }
    }
  }

  const entranceTransition = composition.transitions.find(
    (transition) =>
      composition.keyframes.find((keyframe) => keyframe.id === transition.fromKeyframeId)?.role ===
        'start' &&
      composition.keyframes.find((keyframe) => keyframe.id === transition.toKeyframeId)?.role ===
        'step',
  );
  if (entranceTransition) {
    const from = frameById.get(entranceTransition.fromKeyframeId) ?? startFrame;
    const to = frameById.get(entranceTransition.toKeyframeId) ?? onAirFrame;
    for (const [groupId, layers] of relatedGroups(visibleLayers)) {
      const entrants = layers
        .filter(
          (layer) =>
            !layer.clipChildren &&
            !isClippedChild(layer, composition) &&
            !layer.semantics.tags.includes('qa:allow-no-stagger'),
        )
        .map((layer) => ({ layer, arrival: arrivalFrame(layer, from, to) }))
        .filter((entry): entry is { layer: Layer; arrival: number } => entry.arrival !== null);
      if (entrants.length < 3 || new Set(entrants.map((entry) => entry.arrival)).size !== 1)
        continue;
      add(
        `motion.no-stagger.${entranceTransition.id}.${groupId}`,
        'info',
        'motion',
        `${entrants.length} related layers arrive on the same frame; consider a short cascade or mask reveal.`,
        entrants.map((entry) => entry.layer.id),
        [from, to],
      );
    }
  }

  const headlines = visibleLayers.filter((layer) => layer.semantics.role === 'headline');
  const subheadlines = visibleLayers.filter((layer) => layer.semantics.role === 'subheadline');
  for (const headline of headlines) {
    if (headline.element.type !== 'text') continue;
    for (const subheadline of subheadlines) {
      if (subheadline.element.type !== 'text') continue;
      if (headline.groupId && subheadline.groupId && headline.groupId !== subheadline.groupId)
        continue;
      const ratio = headline.element.fontSize / Math.max(1, subheadline.element.fontSize);
      if (ratio < 1.2) {
        add(
          `typography.scale-ratio.${headline.id}.${subheadline.id}`,
          'warning',
          'typography',
          `Headline/subheadline type ratio is ${ratio.toFixed(2)}; use at least 1.20 for a clear hierarchy.`,
          [headline.id, subheadline.id],
          [onAirFrame],
        );
      }
    }
  }

  for (const [, layers] of relatedGroups(visibleText)) {
    for (let index = 0; index < layers.length; index++) {
      const left = layers[index]!;
      if (left.semantics.tags.includes('optical-offset')) continue;
      const leftX = getLayerTransformAtFrame(left, onAirFrame).x;
      for (const right of layers.slice(index + 1)) {
        if (right.semantics.tags.includes('optical-offset')) continue;
        const rightX = getLayerTransformAtFrame(right, onAirFrame).x;
        const difference = Math.abs(leftX - rightX);
        if (difference < 1 || difference > 8) continue;
        add(
          `layout.edge-alignment.${left.id}.${right.id}`,
          'warning',
          'layout',
          `“${left.name}” and “${right.name}” left edges differ by ${difference.toFixed(1)} px; align them or tag an intentional optical-offset.`,
          [left.id, right.id],
          [onAirFrame],
        );
      }
    }
  }

  const containers = visibleLayers
    .filter((layer) => layer.semantics.role === 'container')
    .map((container) => {
      const bounds = getLayerTransformAtFrame(container, onAirFrame);
      const children = visibleLayers.filter((layer) => layer.parentId === container.id);
      if (children.length === 0) return null;
      const poses = children.map((layer) => getLayerTransformAtFrame(layer, onAirFrame));
      const content = {
        left: Math.min(...poses.map((pose) => pose.x)),
        top: Math.min(...poses.map((pose) => pose.y)),
        right: Math.max(...poses.map((pose) => pose.x + pose.width)),
        bottom: Math.max(...poses.map((pose) => pose.y + pose.height)),
      };
      return {
        container,
        siblingKey: container.parentId ?? 'root',
        padding: [
          content.left - bounds.x,
          content.top - bounds.y,
          bounds.x + bounds.width - content.right,
          bounds.y + bounds.height - content.bottom,
        ],
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const containerGroups = new Map<string, typeof containers>();
  for (const entry of containers) {
    containerGroups.set(entry.siblingKey, [
      ...(containerGroups.get(entry.siblingKey) ?? []),
      entry,
    ]);
  }
  for (const [siblingKey, entries] of containerGroups) {
    if (entries.length < 2) continue;
    const inconsistent = [0, 1, 2, 3].some((edge) => {
      const values = entries.map((entry) => entry.padding[edge]!);
      return Math.max(...values) - Math.min(...values) > 4;
    });
    if (!inconsistent) continue;
    add(
      `layout.padding-rhythm.${siblingKey}`,
      'info',
      'layout',
      'Sibling containers use inconsistent inner padding; review the spacing rhythm.',
      entries.map((entry) => entry.container.id),
      [onAirFrame],
    );
  }

  for (const layer of composition.layers) {
    if (!layer.loop) continue;
    if (layer.semantics.tags.includes('qa:allow-loop-seam')) continue;
    for (const [property, keys] of Object.entries(layer.loop.tracks)) {
      if (!keys || keys.length < 2) continue;
      if (approximately(keys[0]!.value, keys.at(-1)!.value)) continue;
      add(
        `loop.seam.${layer.id}.${property}`,
        'warning',
        'loop',
        `“${layer.name}” loop property ${property} does not return to its starting value at the seam.`,
        [layer.id],
        [0, layer.loop.durationFrames],
      );
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
  const editableTextCoverage =
    visibleText.length === 0
      ? 1
      : visibleText.filter((layer) => layer.bindings.length > 0).length / visibleText.length;
  const summary = {
    error: findings.filter((finding) => finding.severity === 'error').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
  const score = Math.max(0, 100 - summary.error * 20 - summary.warning * 5 - summary.info);
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
