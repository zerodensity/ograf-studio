import { describe, expect, it } from 'vitest';
import { createProject } from './factory';
import { migrateProject } from './migrations';
import {
  projectThumbnailFrame,
  templateBaseName,
  templateThumbnailName,
  thumbnailRenderProject,
} from './projectThumbnail';

describe('template thumbnails', () => {
  it('defaults to the first OGraf step and follows its timing', () => {
    const project = createProject();
    expect(projectThumbnailFrame(project)).toBe(12);
    project.compositions[0]!.transitions[0]!.durationFrames = 20;
    expect(projectThumbnailFrame(project)).toBe(20);
    project.compositions[0]!.keyframes = project.compositions[0]!.keyframes.filter(
      (key) => key.role !== 'step',
    );
    expect(projectThumbnailFrame(project)).toBe(0);
  });
  it('preserves a chosen frame including zero in the saved source and supports automatic reset', () => {
    const project = createProject({ thumbnailFrame: 0 });
    expect(projectThumbnailFrame(migrateProject(JSON.parse(JSON.stringify(project))))).toBe(0);
    project.thumbnailFrame = 18;
    expect(projectThumbnailFrame(migrateProject(JSON.parse(JSON.stringify(project))))).toBe(18);
    project.thumbnailFrame = null;
    expect(projectThumbnailFrame(project)).toBe(12);
    project.thumbnailFrame = -1;
    expect(projectThumbnailFrame(migrateProject(project))).toBe(12);
  });
  it('removes only the canvas background without modifying the source', () => {
    const project = createProject();
    project.compositions[0]!.backgroundColor = '#112233';
    const thumbnail = thumbnailRenderProject(project);
    expect(thumbnail.compositions[0]!.backgroundColor).toBe('transparent');
    expect(project.compositions[0]!.backgroundColor).toBe('#112233');
    expect(thumbnail.compositions[0]!.layers).toEqual(project.compositions[0]!.layers);
  });
  it('names thumbnails by project identity independently of the template name', () => {
    const project = createProject({ id: 'project-123', name: 'News' });
    expect(templateThumbnailName(project)).toBe('project-123_thumb.png');
    project.name = 'Renamed News';
    expect(templateThumbnailName(project)).toBe('project-123_thumb.png');
    expect(templateBaseName('News: Today/Live')).toBe('News- Today-Live');
    expect(templateBaseName('CON')).toBe('_CON');
  });
});
