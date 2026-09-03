import { clipPathSvgForParentBounds } from './clipping';
import { effectStackToSvg, effectStackPadding } from './effectRendering';
import { getPaintAtFrame } from './layerAnimation';
import { relativeTransformMatrix } from './masking';
import { tilingSvgContent } from './tilingSvg';
import { escapeSvgAttribute as esc, svgMaskSourceContent } from './svgPaint';
import type {
  Element,
  LayerAnimationTracks,
  LayerEffects,
  LayerMask,
  LayerTransform,
} from './types';

export interface MaskRenderLayer {
  id: string;
  element: Element;
  isVisible: boolean;
  mask?: LayerMask | null;
  clipParentId?: string | null;
}
export interface MaskRenderState {
  transform: LayerTransform;
  effects: LayerEffects;
  paintTracks: LayerAnimationTracks;
  paintFrame: number;
  patternFrame?: number;
}

/** One self-contained SVG mask definition, including nested sources and clipping dependencies. */
export function layerMaskSvg(
  targetId: string,
  layers: ReadonlyMap<string, MaskRenderLayer>,
  states: ReadonlyMap<string, MaskRenderState>,
  id: string,
): string {
  const active = new Set<string>();
  const definition = (layerId: string, maskId: string): string => {
    const target = layers.get(layerId),
      targetState = states.get(layerId);
    if (!target?.mask || !targetState || active.has(layerId)) return '';
    active.add(layerId);
    const { width, height } = targetState.transform,
      mask = target.mask;
    const source = layers.get(mask.sourceLayerId),
      state = states.get(mask.sourceLayerId);
    let content = '',
      defs = '';
    if (source?.isVisible && state && !active.has(source.id)) {
      const element = source.element;
      const resolved =
        element.type === 'path' || element.type === 'rectangle' || element.type === 'ellipse'
          ? { ...element, fill: getPaintAtFrame(element.fill, state.paintTracks, state.paintFrame) }
          : element;
      content =
        source.element.type === 'pattern' && source.element.definition
          ? `<svg data-ograf-pattern-source="${esc(source.id)}" width="${state.transform.width}" height="${state.transform.height}" viewBox="0 0 ${source.element.definition.width} ${source.element.definition.height}" preserveAspectRatio="none">${tilingSvgContent({ ...source.element, fill: getPaintAtFrame(source.element.fill, state.paintTracks, state.paintFrame) }, `${maskId}-pattern`, state.patternFrame ?? 0, mask.mode === 'path')}</svg>`
          : svgMaskSourceContent(
              resolved,
              state.transform.width,
              state.transform.height,
              `${maskId}-source`,
              mask.mode === 'path',
            );
      if (mask.mode === 'alpha') {
        const fx = state.effects;
        const filters = effectStackToSvg(fx);
        if (filters) {
          const pad = effectStackPadding(fx);
          defs += `<filter id="${maskId}-fx" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${state.transform.width + 2 * pad}" height="${state.transform.height + 2 * pad}">${filters}</filter>`;
          content = `<g filter="url(#${maskId}-fx)">${content}</g>`;
        }
        if (source.mask) {
          defs += definition(source.id, `${maskId}-nested`);
          content = `<g mask="url(#${maskId}-nested)">${content}</g>`;
        }
        if (source.clipParentId) {
          const parent = layers.get(source.clipParentId),
            parentState = states.get(source.clipParentId);
          if (!parent || !parentState) content = '';
          else {
            const clip = clipPathSvgForParentBounds(
              state.transform,
              parentState.transform,
              parent.element.type === 'rectangle' ? parent.element.borderRadius : 0,
            );
            defs += `<clipPath id="${maskId}-clip"><path d="${esc(clip)}"/></clipPath>`;
            content = `<g clip-path="url(#${maskId}-clip)">${content}</g>`;
          }
        }
      }
      content = `<g transform="matrix(${relativeTransformMatrix(state.transform, targetState.transform).join(' ')})" opacity="${mask.mode === 'path' ? 1 : state.transform.opacity}">${content}</g>`;
    }
    active.delete(layerId);
    if (mask.inverted) {
      defs += `<filter id="${maskId}-black" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>`;
      content = `<rect width="${width}" height="${height}" fill="white"/><g filter="url(#${maskId}-black)">${content}</g>`;
    }
    return `${defs}<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" style="mask-type:${mask.inverted ? 'luminance' : 'alpha'}">${content}</mask>`;
  };
  return definition(targetId, id);
}
