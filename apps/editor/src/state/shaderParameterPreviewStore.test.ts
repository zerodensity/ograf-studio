import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';
import { useShaderParameterPreviewStore } from './shaderParameterPreviewStore';

describe('transient shader parameter previews', () => {
  beforeEach(() => useShaderParameterPreviewStore.getState().clearPreview());

  it('publishes drag-time uniforms without mutating the authored project', () => {
    const project = useProjectStore.getState().project;
    useShaderParameterPreviewStore
      .getState()
      .previewParameter('headline', 'fill', 'intensity', 0.42);

    expect(useShaderParameterPreviewStore.getState().preview).toEqual({
      layerId: 'headline',
      slot: 'fill',
      name: 'intensity',
      value: 0.42,
    });
    expect(useProjectStore.getState().project).toBe(project);

    useShaderParameterPreviewStore.getState().clearPreview();
    expect(useShaderParameterPreviewStore.getState().preview).toBeNull();
    expect(useProjectStore.getState().project).toBe(project);
  });
});
