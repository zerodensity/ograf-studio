import { buildComponentDefinition } from './components';
import { adoptComponentSourceLayers } from './componentInheritance';
import { addEffect } from './effectStack';
import { createShaderPaint } from './shader';
import { readColor } from './stylePackColorLinks';
import { normalizeTextAnimation } from './textAnimation';
import { layerMotionWindows } from './layerMotion';
import { ensureRecipeFonts } from './recipeFonts';
import { finishRecipePanelMotion } from './recipePanelMotion';
import { finishRecipeBackground } from './recipeBackgrounds';
import { createLayerKeyframe } from './factory';
import { createId } from './id';
import { getLayerTransformAtFrame, getResolvedLayerAnimationTracks } from './layerAnimation';
import type { MotionDirection } from './motionPresets';
import type {
  Composition,
  DesignTokenTargetProperty,
  GradientPaint,
  Layer,
  ShaderPaint,
} from './types';

/** Native paint avoids rasterizing and uploading the whole effect input on every frame. */
const ACCENT_SHEEN = `#pragma ograf ink color
vec4 ink = vec4(1.0);

void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy;
  float phase = fract(iTime / 7.0);
  float distance = abs(uv.y * 0.18 + uv.x - mix(-0.35, 1.35, phase));
  float sheen = pow(max(0.0, 1.0 - distance / 0.24), 3.0) * 0.30;
  color = vec4(mix(ink.rgb, vec3(1.0), sheen), ink.a);
}`;

/** Built-in solid accents only; arbitrary custom paints and unrecognized CSS colors stay intact. */
export function createRecipeAccentSheen(base: string): ShaderPaint | undefined {
  const color = readColor(base);
  if (!color) return undefined;
  return createShaderPaint({
    name: 'Recipe accent sheen',
    fragmentSource: ACCENT_SHEEN,
    parameters: {
      ink: [
        ...color.rgb.map((channel) => Math.max(0, Math.min(1, channel / 255))),
        Math.max(0, Math.min(1, color.alpha)),
      ],
    },
  });
}

function gradientBindings(layer: Layer, property: 'fill' | 'color', stops: number[]) {
  const bindings = layer.designTokenBindings.filter(
    (binding) => binding.targetProperty === property,
  );
  layer.designTokenBindings = layer.designTokenBindings.filter(
    (binding) => binding.targetProperty !== property,
  );
  for (const binding of bindings)
    for (const index of stops)
      layer.designTokenBindings.push({
        ...binding,
        targetProperty: `fill.stops[${index}].color` as DesignTokenTargetProperty,
      });
}

/** Rich but restrained defaults. Everything remains ordinary editable paints/effects. */
export function finishRecipeMaterials(
  composition: Composition,
  layers: Record<string, Layer>,
  motion?: { exit: MotionDirection },
  hideOpeningFrame = true,
): void {
  finishRecipePanelMotion(composition, layers, motion);
  // A zero-width wipe can still draw strokes/effects at its edge. Children are clipped
  // independently, so every generated layer must be transparent on the opening frame.
  // Restore the original sampled opacity on the next frame without retiming the motion.
  for (const layer of hideOpeningFrame ? Object.values(layers) : []) {
    const start = getLayerTransformAtFrame(layer, 0);
    const next = getLayerTransformAtFrame(layer, 1);
    const opacity = getResolvedLayerAnimationTracks(layer).opacity ?? [];
    layer.animationTracks.opacity = [
      { id: createId('key'), frame: 0, value: 0, easing: 'linear' },
      { id: createId('key'), frame: 1, value: next.opacity, easing: 'linear' },
      ...opacity.filter((key) => key.frame > 1),
    ];
    const legacy = new Map(layer.keyframes.map((key) => [key.frame, key]));
    const firstKey = legacy.get(0) ?? createLayerKeyframe(0, start);
    legacy.set(0, { ...firstKey, transform: { ...start, opacity: 0 } });
    if (!legacy.has(1)) legacy.set(1, createLayerKeyframe(1, next));
    layer.keyframes = [...legacy.values()].sort((a, b) => a.frame - b.frame);
  }
  const scale = Math.max(0.25, composition.height / 1080);
  const entranceFrames = layerMotionWindows(composition)?.inFrames ?? 12;
  const panel = layers.panel ?? layers.window;
  let shaderPanel = false;
  if (panel?.element.type === 'rectangle') {
    shaderPanel = finishRecipeBackground(composition, panel);
    panel.element.strokeColor = '#ffffff26';
    panel.element.strokeWidth = Math.max(0.5, scale);
    addEffect(panel, 'drop-shadow', {
      name: 'Panel separation',
      enabled: true,
      blendMode: 'normal',
      params: {
        offsetX: 0,
        offsetY: 5 * scale,
        radius: 12 * scale,
        color: '#000000',
        opacity: 0.28,
      },
    });
  }
  const accent = layers.accent ?? layers.labelPlate ?? layers.divider;
  if (accent?.element.type === 'rectangle') {
    if (typeof accent.element.fill === 'string') {
      if (shaderPanel) {
        // The panel already contains the moving reflection. A native gradient accent avoids
        // doubling WebGL contexts when all six starters are visible in editor and preview.
        const base = accent.element.fill;
        accent.element.fill = {
          type: 'linear',
          angle: 180,
          stops: [
            { offset: 0, color: base, opacity: 1 },
            { offset: 1, color: base, opacity: 0.84 },
          ],
        };
        gradientBindings(accent, 'fill', [0, 1]);
      } else {
        const sheen = createRecipeAccentSheen(accent.element.fill);
        if (sheen) {
          accent.element.fill = sheen;
          for (const binding of accent.designTokenBindings)
            if (binding.targetProperty === 'fill') binding.targetProperty = 'fill.parameters.ink';
        }
      }
    }
    addEffect(accent, 'glow', {
      name: 'Accent edge light',
      enabled: true,
      blendMode: 'normal',
      params: { radius: 4 * scale, color: '#ffffff', opacity: 0.14 },
    });
  }
  for (const [key, layer] of Object.entries(layers)) {
    if (layer.element.type !== 'text') continue;
    const text = layer.element;
    const primaryFamily = text.fontFamily
      .split(',')[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '');
    if (primaryFamily === 'Roboto Condensed') {
      text.lineHeight = layer.semantics.role === 'subheadline' ? 1.05 : 1;
      if (text.letterSpacing === 0) {
        if (layer.semantics.role === 'subheadline') text.letterSpacing = 0.3;
        else if (
          layer.semantics.role === 'label' &&
          text.content.length <= 24 &&
          text.content === text.content.toUpperCase()
        )
          text.letterSpacing = 0.7;
      }
    }
    const base = typeof text.fill === 'string' ? text.fill : text.color;
    if (!text.fill || typeof text.fill === 'string') {
      const paint: GradientPaint = {
        type: 'linear',
        angle: 180,
        stops: [
          { offset: 0, color: base, opacity: 1 },
          { offset: 1, color: base, opacity: 0.86 },
        ],
      };
      text.fill = paint;
      gradientBindings(layer, 'color', [0, 1]);
      gradientBindings(layer, 'fill', [0, 1]);
    }
    if (!text.textAnimation || text.textAnimation.type === 'none')
      text.textAnimation = normalizeTextAnimation({
        type: /score/i.test(key) ? 'roll-up' : key === 'headline' ? 'word-reveal' : 'fade',
        split: /score/i.test(key) ? 'grapheme' : 'word',
        durationFrames: Math.max(
          1,
          Math.min(entranceFrames, Math.round(composition.frameRate * 0.22)),
        ),
        replayOnUpdate: true,
      });
  }
  ensureRecipeFonts(composition, Object.values(layers));
}

/** Keep source and first scene instance linked without changing returned layer/field IDs. */
export function finishRecipeComponent(
  composition: Composition,
  layerIds: string[],
  name: string,
  enabled = true,
): { componentId: string; instanceId: string } | undefined {
  if (!enabled) return undefined;
  const definition = buildComponentDefinition(composition, layerIds, name);
  composition.components.push(definition);
  const instanceId = adoptComponentSourceLayers(composition, definition, layerIds);
  return { componentId: definition.id, instanceId };
}
