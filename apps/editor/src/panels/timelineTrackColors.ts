import {
  gradientStopIndexForProperty,
  type AnimatableLayerProperty,
  type GradientStopOffsetProperty,
} from '@ograf-editor/scene-model';

type FixedTimelineProperty = Exclude<AnimatableLayerProperty, GradientStopOffsetProperty>;

/** Parent layer summaries use one consistent colour; property meaning owns child-track colour. */
export const TIMELINE_LAYER_TRACK_COLOR = '#8a8f99';

export const TIMELINE_PROPERTY_TRACK_COLORS: Record<FixedTimelineProperty, string> = {
  x: '#ff5c7a',
  y: '#58d68d',
  width: '#ffb454',
  height: '#4dd0e1',
  rotation: '#c792ea',
  opacity: '#f2d15d',
  transformOriginX: '#ff7f50',
  transformOriginY: '#2ec4b6',
  strokeWidth: '#ff6ac1',
  blur: '#64b5f6',
  dropShadowOpacity: '#b0bec5',
  dropShadowOffsetX: '#ef6c75',
  dropShadowOffsetY: '#74c69d',
  dropShadowBlur: '#8c9eff',
};

const GRADIENT_STOP_TRACK_COLORS = [
  '#ff8a65',
  '#ffd166',
  '#66d9a5',
  '#5bc0eb',
  '#b388eb',
  '#f06292',
] as const;

export function timelineTrackColorForProperty(property: AnimatableLayerProperty): string {
  const stopIndex = gradientStopIndexForProperty(property);
  if (stopIndex !== null) {
    return GRADIENT_STOP_TRACK_COLORS[stopIndex % GRADIENT_STOP_TRACK_COLORS.length]!;
  }
  return TIMELINE_PROPERTY_TRACK_COLORS[property as FixedTimelineProperty];
}
