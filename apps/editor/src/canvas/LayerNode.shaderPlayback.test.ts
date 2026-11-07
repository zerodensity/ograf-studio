import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  addEffect,
  createLayerOfKind,
  createShaderPaint,
  effectEnabled,
  getEffectStack,
  getLayerEffectsAtFrame,
  type Layer,
  type LayerEffects,
} from '@ograf-editor/scene-model';
import { ShaderPreviewClock } from './shaderPreviewClock';

/** Run the actual layout-effect body without simulating React, the DOM or WebGL. */
function compileShaderEffectHook() {
  const source = ts.createSourceFile(
    'LayerNode.tsx',
    readFileSync(new URL('./LayerNode.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const candidates: ts.ArrowFunction[] = [];
  const containsFilterCall = (node: ts.Node): boolean => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'applyLayerEffectsFilter'
    )
      return true;
    return ts.forEachChild(node, containsFilterCall) === true;
  };
  const containsClockSubscription = (node: ts.Node): boolean => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'shaderPreviewClock' &&
      node.expression.name.text === 'subscribe'
    )
      return true;
    return ts.forEachChild(node, containsClockSubscription) === true;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useLayoutEffect' &&
      node.arguments[0] &&
      ts.isArrowFunction(node.arguments[0]) &&
      containsFilterCall(node.arguments[0]) &&
      containsClockSubscription(node.arguments[0])
    )
      candidates.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (candidates.length !== 1 || !ts.isBlock(candidates[0]!.body))
    throw new Error('Expected one actual LayerNode shader-stack layout effect.');
  let callback = candidates[0]!;
  // Test-only mutation switch proves the same behavior assertions detect the original omission.
  // The production source is never edited; normal test runs always execute it unchanged.
  if (process.env.OGRAF_SHADER_EFFECT_REGRESSION_BASELINE === '1') {
    const body = callback.body as ts.Block;
    const statements = body.statements.filter(
      (statement) =>
        !(
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          ts.isIdentifier(statement.expression.expression) &&
          statement.expression.expression.text === 'sync'
        ),
    );
    callback = ts.factory.updateArrowFunction(
      callback,
      callback.modifiers,
      callback.typeParameters,
      callback.parameters,
      callback.type,
      callback.equalsGreaterThanToken,
      ts.factory.updateBlock(body, statements),
    );
  }
  const printed = ts.createPrinter().printNode(ts.EmitHint.Expression, callback, source);
  const compiled = ts.transpileModule(`const mount = ${printed}; return mount();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(
    'context',
    `
    const { contentRef, layer, getLayerEffectsAtFrame, useTimelineStore, resolveEffectiveEffects,
      testValues, dataFields, ruleEffect, getEffectStack, effectEnabled, applyLayerEffectsFilter,
      shaderPreviewClock, performance, requestAnimationFrame, cancelAnimationFrame, hasMediaPaint, renderActive,
      canvasFrame, compositionRef } = context;
    ${compiled}
  `,
  ) as (context: Record<string, unknown>) => (() => void) | undefined;
}

function shaderLayer() {
  const layer = createLayerOfKind('rectangle');
  layer.effects.stack = [];
  addEffect(layer, 'shader', {
    blendMode: 'normal',
    shader: createShaderPaint({
      fragmentSource:
        '#pragma ograf gain slider min(0) max(1)\nconst float gain=0.5;\nvoid mainImage(out vec4 c,in vec2 p){c=vec4(gain,sin(iTime),0.0,1.0);}',
      parameters: { gain: 0.5 },
    }),
  });
  return layer;
}

function harness({ playing = false, media = false } = {}) {
  const mount = compileShaderEffectHook();
  const clock = new ShaderPreviewClock(250);
  const frames = new Map<number, () => void>();
  const apply = vi.fn();
  const cancel = vi.fn((id: number) => frames.delete(id));
  const transport = { currentFrame: 12, isPlaying: playing };
  const host = {};
  let now = 1000;
  let nextId = 1;
  const run = (layer: Layer, renderActive = true) =>
    mount({
      contentRef: { current: { parentElement: host } },
      layer,
      renderActive,
      canvasFrame: () => transport.currentFrame,
      compositionRef: { current: {} },
      getLayerEffectsAtFrame,
      useTimelineStore: { getState: () => transport },
      resolveEffectiveEffects: (_layer: Layer, effects: LayerEffects) => effects,
      testValues: {},
      dataFields: [],
      ruleEffect: undefined,
      getEffectStack,
      effectEnabled,
      applyLayerEffectsFilter: apply,
      shaderPreviewClock: clock,
      performance: { now: () => now },
      requestAnimationFrame: (callback: () => void) => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: cancel,
      hasMediaPaint: media,
      transform: { width: 100, height: 60 },
    });
  const tick = (time: number) => {
    now = time;
    const next = frames.entries().next().value;
    if (!next) throw new Error('Shader effect did not schedule its next frame.');
    frames.delete(next[0]);
    next[1]();
  };
  return {
    clock,
    frames,
    apply,
    cancel,
    transport,
    host,
    run,
    tick,
    time: (value: number) => {
      now = value;
    },
  };
}

describe('LayerNode shader-effect playback after Properties edits', () => {
  it('suspends obscured painting and resumes from the unchanged content clock', () => {
    const h = harness();
    h.clock.play(1000);
    const layer = shaderLayer();
    const cleanup = h.run(layer)!;
    cleanup();
    h.apply.mockClear();
    expect(h.run(layer, false)).toBeUndefined();
    h.time(2000);
    expect(h.frames.size).toBe(0);
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.clock.running).toBe(true);
    const resume = h.run(layer)!;
    expect(h.apply.mock.calls.at(-1)![2]).toBe(1250);
    expect(h.frames.size).toBe(1);
    resume();
  });

  it.each([true, false])(
    'rearms rendering after effect replacement while the clock already runs and transport playing=%s',
    (playing) => {
      const h = harness({ playing });
      h.clock.play(1000); // Subscribe only afterwards: Play does not notify an already-running clock.
      h.time(1500);
      const layer = shaderLayer();
      const oldCleanup = h.run(layer)!;
      expect(h.frames.size, 'mount must immediately arm the shader frame loop').toBe(1);
      h.tick(1516);
      expect(h.apply.mock.calls.at(-1)![2]).toBe(766);
      oldCleanup();
      expect(h.frames.size).toBe(0);

      const edited = structuredClone(layer);
      edited.effects.stack![0]!.shader!.parameters.gain = 0.75;
      h.time(1600);
      const cleanup = h.run(edited)!;
      expect(h.frames.size, 'Properties edits must rearm the existing content clock').toBe(1);
      expect(h.apply.mock.calls.at(-1)![2]).toBe(850);
      h.tick(1616);
      h.tick(1632);
      expect(h.apply.mock.calls.at(-1)![2]).toBe(882);
      expect(h.apply.mock.calls.at(-1)![1].stack[0].shader.parameters.gain).toBe(0.75);
      expect(h.transport).toEqual({ currentFrame: 12, isPlaying: playing });
      expect(h.clock.running).toBe(true);
      cleanup();
    },
  );

  it('keeps paused edits deterministic and responds to seek, resume and manual pause', () => {
    const h = harness();
    h.clock.seek(480);
    const cleanup = h.run(shaderLayer())!;
    expect(h.apply.mock.calls.at(-1)![2]).toBe(480);
    expect(h.frames.size).toBe(0);
    h.clock.seek(200);
    expect(h.apply.mock.calls.at(-1)![2]).toBe(200);
    h.time(3000);
    h.clock.play(3000);
    expect(h.frames.size).toBe(1);
    h.tick(3250);
    expect(h.apply.mock.calls.at(-1)![2]).toBe(450);
    h.clock.pause(3250);
    expect(h.frames.size).toBe(0);
    h.clock.seek(80);
    expect(h.apply.mock.calls.at(-1)![2]).toBe(80);
    cleanup();
    const edited = shaderLayer();
    edited.effects.stack![0]!.shader!.parameters.gain = 0.8;
    const editedCleanup = h.run(edited)!;
    expect(h.apply.mock.calls.at(-1)![2]).toBe(80);
    expect(h.frames.size).toBe(0);
    editedCleanup();
  });

  it('cancels outstanding frames and unsubscribes from clock changes on cleanup', () => {
    const h = harness();
    h.clock.play(1000);
    const cleanup = h.run(shaderLayer())!;
    expect(h.frames.size).toBe(1);
    const before = h.apply.mock.calls.length;
    cleanup();
    expect(h.frames.size).toBe(0);
    expect(h.cancel).toHaveBeenCalled();
    h.clock.pause(1250);
    h.clock.seek(0);
    h.clock.play(2000);
    expect(h.apply.mock.calls).toHaveLength(before);
    expect(h.frames.size).toBe(0);
  });

  it('does not schedule or subscribe for a bypassed shader effect', () => {
    const h = harness();
    const layer = shaderLayer();
    layer.effects.stack![0]!.enabled = false;
    expect(h.run(layer)).toBeUndefined();
    expect(h.apply).toHaveBeenCalledOnce();
    h.clock.play(1000);
    expect(h.frames.size).toBe(0);
    expect(h.apply).toHaveBeenCalledOnce();
  });

  it('continues refreshing live Media input while paused without advancing shader time', () => {
    const h = harness({ media: true });
    h.clock.seek(480);
    const cleanup = h.run(shaderLayer())!;
    expect(h.frames.size).toBe(1);
    h.tick(1500);
    h.tick(1516);
    expect(h.apply.mock.calls.at(-1)![2]).toBe(480);
    expect(h.frames.size).toBe(1);
    cleanup();
  });
});
