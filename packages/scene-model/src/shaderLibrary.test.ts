import { describe, expect, it } from 'vitest';
import { createProject, createShaderResource } from './factory';
import { createShaderPaint } from './shader';
import { migrateProject } from './migrations';
import { validateProject } from '@ograf-editor/validation';

describe('project shader library', () => {
  it('creates unused shader resources without generating objects or data fields', () => {
    const project = createProject();
    expect(project.shaders).toEqual([]);
    const shader = createShaderResource({
      paint: createShaderPaint({
        name: '  Independent shader  ',
        parameters: { waveFrequency: 3 },
      }),
    });
    project.shaders.push(shader);
    expect(shader.id).toMatch(/^shader-/);
    expect(shader.paint.name).toBe('Independent shader');
    expect(project.compositions[0]!.layers).toEqual([]);
    expect(project.compositions[0]!.dataFields).toEqual([]);
    expect(validateProject(project).errors).toEqual([]);
    expect(createProject().shaders).toEqual([]);
  });

  it('defaults legacy documents and preserves named resources and exact source through JSON/migration', () => {
    const project = createProject();
    const legacy = { ...project, documentVersion: 32 } as Partial<typeof project>;
    delete legacy.shaders;
    expect(migrateProject(legacy as typeof project).shaders).toEqual([]);
    const shader = createShaderResource({
      paint: createShaderPaint({
        name: 'Saved',
        speed: 0.7,
        resolutionScale: 0.5,
        parameters: { waveFrequency: 4, backgroundColor: [0.013, 0.21, 0.47] },
      }),
    });
    shader.paint.fragmentSource = `// Keep source formatting\r\n${shader.paint.fragmentSource}\n`;
    project.shaders = [shader];
    const snapshot = JSON.stringify(project);
    const migrated = migrateProject(JSON.parse(snapshot));
    expect(migrated.documentVersion).toBe(33);
    expect(migrated.shaders).toEqual(project.shaders);
    expect(JSON.stringify(project)).toBe(snapshot);
    migrated.shaders[0]!.paint.parameters.waveFrequency = 9;
    expect(project.shaders[0]!.paint.parameters.waveFrequency).toBe(4);
    expect(() => migrateProject({ ...project, shaders: {} } as never)).toThrow(/must be an array/);
  });

  it('validates resource identity and each paint while reporting malformed entries without throwing', () => {
    const project = createProject();
    const resource = createShaderResource();
    project.shaders = [resource, structuredClone(resource)];
    expect(validateProject(project).errors.join(' ')).toContain('Duplicate shader resource id');
    project.shaders = [
      { id: '', paint: createShaderPaint({ parameters: { unknown: 2 }, name: 'x'.repeat(129) }) },
    ];
    const errors = validateProject(project).errors.join(' ');
    expect(errors).toContain('non-empty id');
    expect(errors).toContain('Unknown shader parameter');
    expect(errors).toContain('at most 128');
    project.shaders = [
      { id: 'invalid-source', paint: { ...createShaderPaint(), fragmentSource: 'not GLSL' } },
    ];
    expect(validateProject(project).errors.join(' ')).toContain('mainImage');
    project.shaders = [null, { id: 'wrong-paint', paint: '#ffffff' }] as never;
    expect(() => validateProject(project)).not.toThrow();
    expect(validateProject(project).errors).toHaveLength(2);
    project.shaders = {} as never;
    expect(validateProject(project).errors).toContain('Project shader library must be an array.');
  });
});
