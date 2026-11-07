import { describe, expect, it } from 'vitest';
import {
  assertComponentGraphProjectUpdate,
  buildComponentDefinition,
  createComponentGraphContext,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  linkExistingComponentLayers,
  type ComponentGraphContext,
  type Project,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { applyAuthoringOperations } from './operations';
import { AuthoringSession } from './session';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const [panel, detail, addition] = ['Panel', 'Detail', 'Added part'].map((name) => {
    const layer = createLayerOfKind('rectangle');
    layer.name = name;
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    return layer;
  });
  composition.layers.push(panel!, detail!, addition!);
  const component = buildComponentDefinition(composition, [panel!.id, detail!.id], 'Shared panel');
  component.scope = 'set';
  composition.components.push(component);
  linkExistingComponentLayers(composition, component, [panel!.id, detail!.id]);
  const graph = (sourceLayerId: string): TransitionLogicDefinition => ({
    version: 3,
    id: 'news',
    name: 'News',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [{ id: 'headline', name: 'Headline', slotId: 'main', templateId: 'template-main' }],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 12,
        outgoingFrames: 12,
        incomingStartFrame: 0,
        incomingFrames: 12,
        sharedFrames: 12,
        easing: 'linear',
      },
    ],
    routes: [],
    defaultTransitionId: 'fade',
    sharedInstances: [
      {
        id: 'panel',
        name: 'Panel',
        componentAssetId: component.id,
        continuityKey: 'panel',
        slotId: 'main',
      },
    ],
    initialSharedValues: [{ instanceId: 'panel', sourceLayerId, property: 'height', value: 100 }],
  });
  const context = (sourceLayerId: string, candidate = project): ComponentGraphContext =>
    createComponentGraphContext(
      project.id,
      ['template-main'],
      graph(sourceLayerId),
      candidate.compositions[0]!.components,
    );
  const operation = (layerIds: string[]) => ({
    type: 'update_component_from_layers' as const,
    compositionId: composition.id,
    componentId: component.id,
    layerIds,
  });
  return {
    project,
    panel: panel!,
    detail: detail!,
    addition: addition!,
    component,
    context,
    operation,
  };
}

function unchanged(
  session: AuthoringSession,
  snapshot: ReturnType<AuthoringSession['snapshot']>,
  changes: ReturnType<AuthoringSession['getChanges']>,
) {
  expect(session.snapshot()).toEqual(snapshot);
  expect(session.getChanges(0)).toEqual(changes);
}

describe('authoring session component graph precommit guard', () => {
  it.each([false, true])('rejects unsafe apply before publication (dryRun=%s)', (dryRun) => {
    const f = fixture();
    const session = new AuthoringSession(f.project);
    const context = f.context(f.detail.id);
    session.setMutationValidator((previous, candidate) =>
      assertComponentGraphProjectUpdate(previous, candidate, context),
    );
    const before = session.snapshot();
    const events: unknown[] = [];
    session.subscribe((event) => events.push(event));
    expect(() =>
      session.apply({ expectedRevision: 0, dryRun, operations: [f.operation([f.panel.id])] }),
    ).toThrow(/blocked by playout transitions/);
    unchanged(session, before, []);
    expect(events).toEqual([]);
    expect(() => session.undo(0)).toThrow('Nothing to undo');
  });

  it.each(['reset', 'replaceExternal'] as const)(
    'guards %s before changing existing undo history',
    (method) => {
      const f = fixture();
      const session = new AuthoringSession(f.project);
      const context = f.context(f.detail.id);
      session.setMutationValidator((previous, candidate) =>
        assertComponentGraphProjectUpdate(previous, candidate, context),
      );
      const legal = session.apply({
        expectedRevision: 0,
        operations: [f.operation([f.panel.id, f.detail.id, f.addition.id])],
      });
      const unsafe = applyAuthoringOperations(legal.project, [f.operation([f.panel.id])]).project;
      const before = session.snapshot();
      const changes = session.getChanges(0);
      expect(() =>
        method === 'reset' ? session.reset(unsafe, 1) : session.replaceExternal(unsafe),
      ).toThrow(/blocked by playout transitions/);
      unchanged(session, before, changes);
      expect(session.undo(1).project).toEqual(new AuthoringSession(f.project).snapshot().project);
    },
  );

  it('keeps a rejected undo entry when a newly referenced child would be removed', () => {
    const f = fixture();
    const session = new AuthoringSession(f.project);
    let context = f.context(f.detail.id);
    session.setMutationValidator((previous, candidate) =>
      assertComponentGraphProjectUpdate(previous, candidate, context),
    );
    const legal = session.apply({
      expectedRevision: 0,
      operations: [f.operation([f.panel.id, f.detail.id, f.addition.id])],
    });
    context = f.context(f.addition.id, legal.project);
    const before = session.snapshot();
    const changes = session.getChanges(0);
    expect(() => session.undo(1)).toThrow(/unknown shared source layer/);
    unchanged(session, before, changes);
    context = f.context(f.detail.id, legal.project);
    expect(session.undo(1).revision).toBe(2);
    expect(session.redo(2).project).toEqual(legal.project);
  });

  it('keeps a rejected redo entry when the graph has since referenced a removed child', () => {
    const f = fixture();
    const session = new AuthoringSession(f.project);
    let context = f.context(f.panel.id);
    session.setMutationValidator((previous, candidate) =>
      assertComponentGraphProjectUpdate(previous, candidate, context),
    );
    const removed = session.apply({ expectedRevision: 0, operations: [f.operation([f.panel.id])] });
    const restored = session.undo(1);
    context = f.context(f.detail.id, restored.project);
    const before = session.snapshot();
    const changes = session.getChanges(0);
    expect(() => session.redo(2)).toThrow(/unknown shared source layer/);
    unchanged(session, before, changes);
    context = f.context(f.panel.id, restored.project);
    expect(session.redo(2).project).toEqual(removed.project);
  });

  it('leaves independent sessions unrestricted when no host validator is installed', () => {
    const f = fixture();
    const session = new AuthoringSession(f.project);
    expect(
      session.apply({ expectedRevision: 0, operations: [f.operation([f.panel.id])] }).revision,
    ).toBe(1);
  });

  it('guards source deletion even when no scene instance remains', () => {
    const f = fixture();
    const previous = structuredClone(f.project);
    previous.compositions[0]!.layers = [];
    const candidate: Project = structuredClone(previous);
    candidate.compositions[0]!.components = [];
    expect(() =>
      assertComponentGraphProjectUpdate(previous, candidate, f.context(f.detail.id)),
    ).toThrow(/references missing component/);
  });
});
