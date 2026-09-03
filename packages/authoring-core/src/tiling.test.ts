import { expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { AuthoringSession } from './session';

it('updates linked pattern instances from one source and supports undo without retiming layers', () => {
  const s = new AuthoringSession(createProject());
  const created = s.apply({
    expectedRevision: 0,
    operations: [{ type: 'set_tiling_pattern', patch: { name: 'Shared O/D' } }],
  });
  expect(created.validation.valid).toBe(true);
  const p = created.project.compositions[0]!.patterns[0]!;
  expect(created.summary.generatedIds.map((i) => i.kind)).toEqual(['pattern', 'layer']);
  const linked = s.apply({
    expectedRevision: 1,
    operations: [
      {
        type: 'add_layer',
        kind: 'pattern',
        element: { patternId: p.id, fill: 'transparent', strokeColor: '#fff', strokeWidth: 2 },
      },
    ],
  });
  const before = structuredClone(linked.project.compositions[0]!.layers);
  const source = { ...p.symbols[0]!, d: 'M0 0 H100 V100 H0 Z' };
  const updated = s.apply({
    expectedRevision: 2,
    operations: [
      {
        type: 'set_tiling_pattern',
        patternId: p.id,
        patch: { symbols: [source, p.symbols[1]!], rows: 10, cycleFrames: 2000 },
      },
    ],
  });
  expect(updated.project.compositions[0]!.layers).toEqual(before);
  const descriptor = compileDescriptor(updated.project.compositions[0]!);
  for (const layer of descriptor.layers) {
    expect(layer.element).toMatchObject({
      type: 'pattern',
      definition: { rows: 10, cycleFrames: 2000, symbols: [source, p.symbols[1]!] },
    });
  }
  expect(s.undo(3).project).toEqual(linked.project);
});
