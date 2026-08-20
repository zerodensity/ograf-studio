import { describe, expect, it } from 'vitest';
import { assembleManifest, compileDescriptor } from '@ograf-editor/codegen';
import { createComposition, createProject, createTransition } from '@ograf-editor/scene-model';
import { validateManifest } from './validateManifest';
import { validateProject } from './validateProject';

describe('canonical OGraf validation', () => {
  it('accepts an assembled project and rejects the legacy thumbnail shape', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const manifest = assembleManifest(project, composition, compileDescriptor(composition));
    expect(validateManifest(manifest)).toEqual({ valid: true, errors: [] });
    expect(validateManifest({ ...manifest, thumbnails: [{ url: 'thumb.png' }] }).valid).toBe(false);
  });
});

describe('project validation', () => {
  it('requires an ordered lifecycle, adjacent transitions, and complete poses', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    expect(validateProject(project).valid).toBe(true);

    composition.keyframes.reverse();
    const result = validateProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Start state|End state|transition/);
  });

  it('reports a zero-step graphic as valid with an operator-facing warning', () => {
    const project = createProject();
    const composition = createComposition();
    composition.keyframes = composition.keyframes.filter((keyframe) => keyframe.role !== 'step');
    composition.transitions = [
      createTransition(composition.keyframes[0]!.id, composition.keyframes[1]!.id),
    ];
    project.compositions = [composition];
    project.mainCompositionId = composition.id;
    const result = validateProject(project);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
