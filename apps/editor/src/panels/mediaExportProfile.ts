import type { ExportProfileMode } from '@ograf-editor/codegen';
import type { RenderType } from '@ograf-editor/ograf-types';

export function mediaCompatibleRenderType(
  usesMediaPaint: boolean,
  requested: RenderType,
): RenderType {
  return usesMediaPaint ? 'realtime' : requested;
}

export function mediaCompatibleExportProfile(
  usesMediaPaint: boolean,
  requested: ExportProfileMode,
): ExportProfileMode {
  return usesMediaPaint ? 'realtime' : requested;
}
