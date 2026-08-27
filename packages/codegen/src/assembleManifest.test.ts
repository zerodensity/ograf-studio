import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createComposition,
  createCustomActionDefinition,
  createFieldDefinition,
  createKeyframe,
  createProject,
  createTransition,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import { assembleManifest } from './assembleManifest';
import { compileDescriptor } from './compileDescriptor';

const schemaFile = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../fixtures/ograf-schema/${name}`, import.meta.url)),
      'utf8',
    ),
  );

/**
 * Validates against the REAL vendored EBU schema, not our hand-authored
 * packages/validation/src/ografManifestSchema.ts. That distinction is the whole point: in Phase 5a
 * both our emitter and our local validator shared the same wrong assumption about
 * `renderRequirements` (raw numbers instead of constraint objects), so the local validator passed
 * manifests the real spec rejects. This is the independent check that catches that class of drift.
 */
let validateAgainstRealSchema: (manifest: unknown) => { valid: boolean; errors: string[] };

beforeAll(() => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  // Register the $ref closure by its canonical spec URL so the main schema resolves offline.
  const BASE = 'https://ograf.ebu.io/v1/specification/json-schemas';
  ajv.addSchema(schemaFile('number.json'), `${BASE}/lib/constraints/number.json`);
  ajv.addSchema(schemaFile('boolean.json'), `${BASE}/lib/constraints/boolean.json`);
  ajv.addSchema(schemaFile('gdd-basic-types.json'), `${BASE}/gdd/basic-types.json`);
  ajv.addSchema(schemaFile('gdd-types.json'), `${BASE}/gdd/gdd-types.json`);
  ajv.addSchema(schemaFile('gdd-object.json'), `${BASE}/gdd/object.json`);
  ajv.addSchema(schemaFile('action.json'), `${BASE}/lib/action.json`);
  const validate = ajv.compile(schemaFile('graphics-schema.json'));
  validateAgainstRealSchema = (manifest) => ({
    valid: validate(manifest) as boolean,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'}: ${e.message}`),
  });
});

function build(composition: Composition, project: Project = createProject()) {
  return assembleManifest(project, composition, compileDescriptor(composition));
}

/** A realistic template: bound text, an animated outro, a custom action, non-default format. */
function realisticComposition(): Composition {
  const start = createKeyframe({ name: 'Start', role: 'start' });
  const step = createKeyframe({ name: 'Step 1', role: 'step' });
  const end = createKeyframe({ name: 'End', role: 'end' });
  const field = createFieldDefinition('text', {
    key: 'headline',
    label: 'Headline',
    required: true,
  });
  return createComposition({
    width: 1280,
    height: 720,
    frameRate: 50,
    keyframes: [start, step, end],
    transitions: [
      createTransition(start.id, step.id, { durationFrames: 10 }),
      createTransition(step.id, end.id, { durationFrames: 25 }),
    ],
    dataFields: [field],
    customActions: [createCustomActionDefinition({ actionId: 'pulse', name: 'Pulse' })],
  });
}

describe('assembleManifest — conformance to the real EBU schema', () => {
  it('produces a schema-valid manifest for a minimal composition', () => {
    const result = validateAgainstRealSchema(build(createComposition()));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('produces a schema-valid manifest for a realistic composition', () => {
    const result = validateAgainstRealSchema(build(realisticComposition()));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects the pre-Phase-5a raw-number renderRequirements shape', () => {
    // Regression guard: this is exactly what we used to emit, and what ograf-devtool rejected.
    const manifest = build(createComposition()) as unknown as Record<string, unknown>;
    manifest.renderRequirements = [
      { resolution: { width: 1920, height: 1080 }, frameRate: 25, accessToPublicInternet: false },
    ];
    expect(validateAgainstRealSchema(manifest).valid).toBe(false);
  });
});

describe('assembleManifest — content', () => {
  it('emits renderRequirements as constraint objects carrying composition settings', () => {
    const manifest = build(realisticComposition());
    expect(manifest.renderRequirements).toEqual([
      {
        resolution: { width: { exact: 1280 }, height: { exact: 720 } },
        frameRate: { exact: 50 },
        accessToPublicInternet: { exact: false },
      },
    ]);
  });

  it('sets stepCount from the step count (outro excluded) and points main at main.js', () => {
    const manifest = build(realisticComposition());
    // intro + outro = one pausable step, per the spec's play-then-stop definition.
    expect(manifest.stepCount).toBe(1);
    expect(manifest.main).toBe('main.js');
    expect(manifest.supportsRealTime).toBe(true);
    expect(manifest.supportsNonRealTime).toBe(true);
  });

  it('publishes actionDurations derived from real transition timings', () => {
    // 25 frames @ 50fps = 500ms into the outro.
    const manifest = build(realisticComposition());
    const byType = Object.fromEntries((manifest.actionDurations ?? []).map((d) => [d.type, d]));
    expect(byType.stopAction).toEqual({ type: 'stopAction', duration: 500 });
    expect(byType.updateAction).toEqual({ type: 'updateAction', duration: 0 });
    expect(byType.customAction).toEqual({
      type: 'customAction',
      customActionId: 'pulse',
      duration: 0,
    });
    expect(byType.playAction!.type).toBe('playAction');
  });

  it('gives each playAction step its own duration from the inbound transition', () => {
    const start = createKeyframe({ name: 'Start', role: 'start' });
    const a = createKeyframe({ name: 'A', role: 'step' });
    const b = createKeyframe({ name: 'B', role: 'step' });
    const end = createKeyframe({ name: 'End', role: 'end' });
    const composition = createComposition({
      frameRate: 25,
      keyframes: [start, a, b, end],
      transitions: [
        createTransition(start.id, a.id, { durationFrames: 25 }), // 1000ms
        createTransition(a.id, b.id, { durationFrames: 5 }), //   200ms
        createTransition(b.id, end.id, { durationFrames: 10 }),
      ],
    });
    const playAction = build(composition).actionDurations?.find((d) => d.type === 'playAction');
    expect(playAction).toEqual({
      type: 'playAction',
      duration: 0,
      steps: [
        { step: 0, duration: 1000 },
        { step: 1, duration: 200 },
      ],
    });
  });

  it('includes the compiled data schema and custom actions', () => {
    const manifest = build(realisticComposition());
    expect(manifest.schema).toMatchObject({
      type: 'object',
      properties: { headline: { type: 'string', title: 'Headline' } },
      required: ['headline'],
    });
    expect(manifest.customActions).toEqual([{ id: 'pulse', name: 'Pulse' }]);
  });

  it('omits optional fields rather than emitting empty ones', () => {
    const manifest = build(createComposition());
    expect(manifest.schema).toBeUndefined();
    expect(manifest.customActions).toBeUndefined();
    expect(manifest.description).toBeUndefined();
  });

  it('carries project identity through', () => {
    const project = createProject({ name: 'Lower Third', version: '2.1.0', description: 'Test' });
    const manifest = build(createComposition(), project);
    expect(manifest.id).toBe(project.id);
    expect(manifest.name).toBe('Lower Third');
    expect(manifest.version).toBe('2.1.0');
    expect(manifest.description).toBe('Test');
  });
});
