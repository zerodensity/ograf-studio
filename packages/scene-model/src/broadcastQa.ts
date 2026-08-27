import { computeKeyframeFrames } from './keyframeTiming';
import { getLayerTransformAtFrame } from './layerAnimation';
import { intersectConvexPolygons, polygonBounds, transformBoundsPolygon } from './clipping';
import type { Composition, Layer, Project } from './types';
import { getEbuR95SafeAreas } from './safeAreas';

export type BroadcastQaSeverity = 'info' | 'warning';
export type BroadcastQaCategory =
  'safe-area' | 'typography' | 'contrast' | 'interlace' | 'resources';

export interface BroadcastQaIssue {
  severity: BroadcastQaSeverity;
  category: BroadcastQaCategory;
  compositionId: string;
  layerId?: string;
  frame?: number;
  message: string;
}

function visibleBounds(composition: Composition, layer: Layer, frame: number) {
  const source = getLayerTransformAtFrame(layer, frame);
  let polygon = transformBoundsPolygon(source);
  let parentId = layer.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = composition.layers.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    if (parent.clipChildren) {
      polygon = intersectConvexPolygons(
        polygon,
        transformBoundsPolygon(getLayerTransformAtFrame(parent, frame)),
      );
      if (polygon.length === 0) return null;
    }
    parentId = parent.parentId;
  }
  return polygonBounds(polygon, source);
}

function contrastRatio(foreground: string, background: string): number | null {
  const luminance = (color: string) => {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match) return null;
    const value = Number.parseInt(match[1]!, 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return first === null || second === null
    ? null
    : (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Non-gating Step-frame preflight shared by the visual QA workflow. */
export function runBroadcastQa(
  project: Project,
  options: { interlacedOutput?: boolean } = {},
): BroadcastQaIssue[] {
  const issues: BroadcastQaIssue[] = [];
  for (const composition of project.compositions) {
    const lifecycle = computeKeyframeFrames(composition);
    const stepIds = new Set(
      composition.keyframes.filter((key) => key.role === 'step').map((key) => key.id),
    );
    const stepFrames = lifecycle
      .filter((item) => stepIds.has(item.keyframeId))
      .map((item) => item.frame);
    const frames = stepFrames.length > 0 ? stepFrames : lifecycle.map((item) => item.frame);
    const { titleSafe } = getEbuR95SafeAreas(composition);
    const recommendedFontSize = 24 * (composition.height / 1080);
    for (const [index, layer] of composition.layers.entries()) {
      if (!layer.isVisible || layer.isGuide) continue;
      for (const frame of frames) {
        const bounds = visibleBounds(composition, layer, frame);
        if (!bounds || bounds.opacity <= 0) continue;
        const fullWidth = bounds.x <= 0 && bounds.x + bounds.width >= composition.width;
        const fullHeight = bounds.y <= 0 && bounds.y + bounds.height >= composition.height;
        if (
          (!fullWidth &&
            (bounds.x < titleSafe.x || bounds.x + bounds.width > titleSafe.x + titleSafe.width)) ||
          (!fullHeight &&
            (bounds.y < titleSafe.y || bounds.y + bounds.height > titleSafe.y + titleSafe.height))
        ) {
          issues.push({
            severity: 'warning',
            category: 'safe-area',
            compositionId: composition.id,
            layerId: layer.id,
            frame,
            message: `${layer.name} crosses the EBU R 95 5% title-safe boundary at frame ${frame}.`,
          });
        }
      }
      if (layer.element.type === 'text') {
        if (
          layer.element.fontSize < recommendedFontSize ||
          layer.element.minFontSize < recommendedFontSize
        ) {
          issues.push({
            severity: layer.element.fontSize < recommendedFontSize ? 'warning' : 'info',
            category: 'typography',
            compositionId: composition.id,
            layerId: layer.id,
            message: `${layer.name} uses ${layer.element.fontSize}px text with a ${layer.element.minFontSize}px floor; the scaled recommendation is ${recommendedFontSize.toFixed(1)}px.`,
          });
        }
        const families = layer.element.fontFamily
          .split(',')
          .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'));
        const generic = families.some((family) =>
          /^(system-ui|sans-serif|serif|monospace)$/i.test(family),
        );
        const packaged = composition.assets.some(
          (asset) => asset.kind === 'font' && families.includes(asset.fontFamily || ''),
        );
        if (!generic && !packaged) {
          issues.push({
            severity: 'warning',
            category: 'resources',
            compositionId: composition.id,
            layerId: layer.id,
            message: `${layer.name} requests an un-packaged font (${layer.element.fontFamily}).`,
          });
        }
        for (const frame of frames) {
          const text = visibleBounds(composition, layer, frame);
          if (!text || text.opacity <= 0) continue;
          const backing = composition.layers
            .slice(0, index)
            .reverse()
            .find((candidate) => {
              if (
                candidate.element.type !== 'rectangle' ||
                typeof candidate.element.fill !== 'string'
              )
                return false;
              const bounds = getLayerTransformAtFrame(candidate, frame);
              return (
                bounds.opacity >= 0.999 &&
                bounds.rotation === 0 &&
                bounds.x <= text.x &&
                bounds.y <= text.y &&
                bounds.x + bounds.width >= text.x + text.width &&
                bounds.y + bounds.height >= text.y + text.height
              );
            });
          if (backing?.element.type === 'rectangle' && typeof backing.element.fill === 'string') {
            const ratio = contrastRatio(layer.element.color, backing.element.fill);
            if (ratio !== null && ratio < 4.5) {
              issues.push({
                severity: 'warning',
                category: 'contrast',
                compositionId: composition.id,
                layerId: layer.id,
                frame,
                message: `${layer.name} has ${ratio.toFixed(2)}:1 contrast against ${backing.name} at frame ${frame}; use at least 4.5:1.`,
              });
            }
          }
        }
      }
      if (options.interlacedOutput && ['rectangle', 'path'].includes(layer.element.type)) {
        const bounds = getLayerTransformAtFrame(layer, frames[0] ?? 0);
        const minimum = 3 * (composition.height / 1080);
        if (bounds.width > bounds.height * 4 && bounds.height < minimum) {
          issues.push({
            severity: 'warning',
            category: 'interlace',
            compositionId: composition.id,
            layerId: layer.id,
            message: `${layer.name} is ${bounds.height}px high; use at least ${minimum.toFixed(1)}px for interlaced output.`,
          });
        }
      }
    }
  }
  return issues.filter(
    (issue, index) =>
      issues.findIndex((candidate) => candidate.message === issue.message) === index,
  );
}
