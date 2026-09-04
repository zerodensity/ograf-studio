import type { EffectType } from '@ograf-editor/scene-model';

export const CANVAS_LAYOUT_HELP = {
  showRulers:
    'Show pixel rulers around the canvas to help position objects. Rulers are editor guides and are not exported.',
  showActionSafe:
    'Show the action-safe guide, inset 3.5% from each edge. Keep important visual action inside this editor-only guide.',
  showTitleSafe:
    'Show the title-safe guide, inset 5% from each edge. Keep essential text inside this editor-only guide.',
  showCenterMarker: 'Show the canvas center as an alignment reference. The marker is not exported.',
  dimOutsideCanvas:
    'Dim the area outside the canvas to distinguish the output frame from the surrounding workspace.',
  snappingEnabled:
    'Enable magnetic alignment while moving and resizing layers. The options below choose which targets attract the layer.',
  snapToGrid:
    'Snap layer edges and positions to the grid spacing set below when snapping is enabled.',
  snapToGuides:
    'Snap layers to your horizontal and vertical canvas guides when snapping is enabled.',
  snapToLayers:
    'Snap moving or resizing layers to the edges and centers of other layers when snapping is enabled.',
} as const;

export const TRANSFORM_HELP: Record<string, string> = {
  x: 'Horizontal position in composition pixels. Larger values move the layer right. Editing changes its pose at the current timeline frame.',
  y: 'Vertical position in composition pixels. Larger values move the layer down. Editing changes its pose at the current timeline frame.',
  width:
    'Layer width in composition pixels at the current timeline frame. Changing it resizes the layer horizontally.',
  height:
    'Layer height in composition pixels at the current timeline frame. Changing it resizes the layer vertically.',
  rotation:
    'Layer rotation in degrees at the current timeline frame. Positive values turn clockwise.',
};

export const PATTERN_NUMBER_HELP = {
  rows: 'Number of horizontal rows in the shared pattern. Every linked pattern layer uses the same row layout.',
  width:
    'Width of the shared pattern canvas in pixels. Sets its horizontal drawing area without changing the composition size.',
  height:
    'Height of the shared pattern canvas in pixels. Fit rows to height uses this area to calculate each row height.',
  rowHeight:
    'Height of each row in pattern pixels. Disable Fit rows to height to set this value manually.',
  rowGap: 'Vertical gap in pixels between neighboring pattern rows.',
  gap: 'Base horizontal gap in pixels between symbols. Sequence gap scales and spacing variation modify this spacing.',
  spacingVariation:
    'Seeded variation in the gaps between symbols, from 0 for uniform spacing to 1 for maximum variation. It remains repeatable during playback.',
  seed: 'Seed used to generate repeatable spacing and speed variation. Changing the seed produces a different arrangement without changing the source symbols.',
  cycleFrames:
    'Frames in one complete pattern loop. A shorter cycle moves rows faster; whole-cycle travel keeps the repeat seamless.',
  cyclesPerLoop:
    'Number of repeated strips each row travels during one full loop. Zero keeps rows still; larger values move them faster.',
  speedVariation:
    'Seeded variation in row travel counts, from 0 to 1. Rows keep whole-cycle travel so the complete pattern still loops seamlessly.',
  phase:
    'Starting offset of the repeated strip, measured in turns. A value of 0.5 shifts the pattern by half a strip.',
  rowPhaseStep:
    'Additional starting offset for each successive row, measured in strip turns. Use it to stagger the symbols vertically.',
  offsetX:
    'Horizontal offset of the pattern rows in pattern pixels. Positive values shift them right.',
  offsetY:
    'Vertical offset of the pattern rows in pattern pixels. Positive values shift them down.',
} as const;

export const LIGHTING_HELP = {
  cycleFrames:
    'Frames in one shared lighting cycle. Shorter cycles make sweeps faster. Procedural row motion keeps its own timing.',
  phase:
    'Starting phase of the shared lighting cycle, from 0 to 1. A value of 0.5 offsets every linked light by half a cycle.',
  intensity:
    'Multiplier for the opacity of linked light and glow layers. 1 keeps their authored strength; 0 hides their contribution.',
  glow: 'Additional strength multiplier for layers linked as Glow. 1 keeps authored glow; layers linked as Light are unaffected by this control.',
  softness:
    'Multiplier for blur, glow and shadow softness on linked layers. 1 keeps authored softness; larger values spread the light further.',
} as const;

export const SYMBOL_SIZE_HELP = {
  width:
    'Source symbol width used to size and space this tile in the row. Its aspect ratio is preserved when fitting the row height.',
  height:
    'Source symbol height used to scale this tile to the row height. Together with width, it defines the tile aspect ratio.',
  viewBoxWidth:
    'Width of the SVG coordinate system containing the symbol path. It maps the path coordinates into the symbol size.',
  viewBoxHeight:
    'Height of the SVG coordinate system containing the symbol path. It maps the path coordinates into the symbol size.',
} as const;

const EFFECT_HELP: Record<EffectType, Record<string, string>> = {
  blur: {
    radius:
      'Blur radius in pixels. Zero is sharp; larger values soften the layer and effects earlier in the stack.',
  },
  'drop-shadow': {
    offsetX:
      'Horizontal shadow offset in pixels. Positive values move the shadow right; negative values move it left.',
    offsetY:
      'Vertical shadow offset in pixels. Positive values move the shadow down; negative values move it up.',
    radius:
      'Shadow blur radius in pixels. Zero gives a hard edge; larger values make a softer shadow.',
    color:
      'Color of this shadow. Opacity is controlled separately, so you can change its tint without changing its strength.',
    opacity: 'Opacity of this shadow, from 0 for invisible to 1 for full strength.',
  },
  glow: {
    radius: 'Glow spread in pixels around the layer. Larger values create a wider, softer halo.',
    color: 'Color of this glow. Its intensity and spread are controlled separately.',
    opacity: 'Intensity of this glow, from 0 for invisible to 1 for full strength.',
  },
  brightness: {
    amount:
      'Brightness multiplier. 1 leaves brightness unchanged, 0 produces black, and values above 1 brighten the result.',
  },
  contrast: {
    amount:
      'Contrast multiplier. 1 leaves contrast unchanged, 0 produces flat gray, and values above 1 increase contrast.',
  },
  saturate: {
    amount:
      'Color saturation multiplier. 0 removes color, 1 keeps the original saturation, and larger values intensify colors.',
  },
  'hue-rotate': {
    angle:
      'Rotate the colors around the hue wheel in degrees. 0 keeps the original colors; 360 is one complete turn.',
  },
};

export function effectParameterHelp(type: EffectType, key: string): string {
  return `${EFFECT_HELP[type][key] ?? 'Adjust this effect parameter.'} Effects run from top to bottom; numeric parameters can be animated.`;
}
