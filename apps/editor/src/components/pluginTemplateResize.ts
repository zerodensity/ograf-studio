export const PLUGIN_TEMPLATE_DETAIL_STORAGE_KEY = 'ograf-studio:plugin-template-detail-width:v1';
export const DEFAULT_TEMPLATE_DETAIL_WIDTH = 320;
export const MIN_TEMPLATE_DETAIL_WIDTH = 180;
export const MAX_TEMPLATE_DETAIL_WIDTH = 640;
export const MIN_TEMPLATE_GALLERY_WIDTH = 160;
export const TEMPLATE_SPLITTER_WIDTH = 8;
export const TEMPLATE_STACK_WIDTH = 560;

export function templateDetailBounds(containerWidth?: number): { min: number; max: number } {
  const available =
    containerWidth !== undefined && Number.isFinite(containerWidth) && containerWidth > 0
      ? containerWidth - MIN_TEMPLATE_GALLERY_WIDTH - TEMPLATE_SPLITTER_WIDTH
      : MAX_TEMPLATE_DETAIL_WIDTH;
  return {
    min: MIN_TEMPLATE_DETAIL_WIDTH,
    max: Math.floor(
      Math.max(MIN_TEMPLATE_DETAIL_WIDTH, Math.min(MAX_TEMPLATE_DETAIL_WIDTH, available)),
    ),
  };
}

export function clampTemplateDetailWidth(width: number, containerWidth?: number): number {
  const { min, max } = templateDetailBounds(containerWidth);
  return Math.round(
    Math.min(max, Math.max(min, Number.isFinite(width) ? width : DEFAULT_TEMPLATE_DETAIL_WIDTH)),
  );
}

export function storedTemplateDetailWidth(raw: string | null): number {
  return raw !== null && raw.trim()
    ? clampTemplateDetailWidth(Number(raw))
    : DEFAULT_TEMPLATE_DETAIL_WIDTH;
}

export function draggedTemplateDetailWidth(
  startWidth: number,
  deltaX: number,
  containerWidth?: number,
): number {
  return clampTemplateDetailWidth(startWidth - deltaX, containerWidth);
}

export function keyedTemplateDetailWidth(
  width: number,
  key: string,
  shift: boolean,
  containerWidth?: number,
): number | undefined {
  const step = shift ? 50 : 10;
  if (key === 'ArrowLeft') return clampTemplateDetailWidth(width + step, containerWidth);
  if (key === 'ArrowRight') return clampTemplateDetailWidth(width - step, containerWidth);
  if (key === 'Home') return templateDetailBounds(containerWidth).min;
  if (key === 'End') return templateDetailBounds(containerWidth).max;
  return undefined;
}
