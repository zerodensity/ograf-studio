import { describe, expect, it } from 'vitest';
import {
  isProjectSourcePath,
  LEGACY_PROJECT_SOURCE_EXTENSIONS,
  PROJECT_SOURCE_EXTENSION,
} from './projectSource';

describe('OGraf Studio project source extension', () => {
  it('uses .ogs as the canonical extension', () => {
    expect(PROJECT_SOURCE_EXTENSION).toBe('.ogs');
    expect(isProjectSourcePath('News Package.OGS')).toBe(true);
    expect(isProjectSourcePath('news.ogs', false)).toBe(true);
  });

  it('retains legacy project extensions for reading only', () => {
    expect(LEGACY_PROJECT_SOURCE_EXTENSIONS).toEqual(['.ogeproj', '.ogeproj.json']);
    expect(isProjectSourcePath('legacy.ogeproj')).toBe(true);
    expect(isProjectSourcePath('legacy.ogeproj.json')).toBe(true);
    expect(isProjectSourcePath('legacy.ogeproj', false)).toBe(false);
  });

  it('does not confuse project source with JSON manifests or OGraf packages', () => {
    expect(isProjectSourcePath('graphic.ograf.json')).toBe(false);
    expect(isProjectSourcePath('graphic.ograf.zip')).toBe(false);
    expect(isProjectSourcePath('project.json')).toBe(false);
  });
});
