import { beforeAll, describe, expect, it } from 'vitest';
import { buildBreakoutFunctionSource } from './build-source';
import type { BreakoutContext, BreakoutData, BreakoutResult } from './gameFunction';
type Snapshot = Omit<BreakoutResult, 'data'> & { data: BreakoutData };

let source: string, run: (context: BreakoutContext) => BreakoutResult;
beforeAll(async () => {
  source = await buildBreakoutFunctionSource();
  // Node-only contract test. Studio evaluates this editable expression only in its sandbox.
  run = new Function(`return (${source});`)() as typeof run;
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function execute(
  previous: Snapshot | null,
  event: BreakoutContext['event'],
  nowMs = 0,
  settings: Record<string, unknown> = {},
  pointer: BreakoutContext['pointer'] = null,
) {
  const context = {
    state: clone(previous?.state ?? null),
    data: { settings },
    pointer,
    event,
    nowMs,
  };
  const original = clone(context),
    result = run(context);
  expect(context).toEqual(original);
  expect(clone(result)).toEqual(result);
  expect(JSON.stringify(result.data).length).toBeLessThan(64 * 1024);
  return clone({ ...result, data: { ...previous?.data, ...result.data } }) as Snapshot;
}
const command = (old: Snapshot, actionId: string, at = 0, settings: Record<string, unknown> = {}) =>
  execute(old, { type: 'custom-action', actionId: `game.${actionId}` }, at, settings);
const loaded = () => execute(null, { type: 'load' });
const onAir = () => execute(loaded(), { type: 'play' });
const started = () => command(onAir(), 'start');
const starts = (result: BreakoutResult) =>
  result.media.filter((cue) => ['restart', 'resume', 'play'].includes(cue.command));

describe('editable PRISM BREAKER template function', () => {
  it.each(['blur', 'out'] as const)(
    'does not simulate an unseen interval before a delayed %s',
    (event) => {
      const before = execute(started(), { type: 'tick' }, 64);
      const hidden = execute(before, { type: event }, 600_064);
      expect(hidden.state.game.ball).toEqual(before.state.game.ball);
      expect(hidden.state.game.trail).toEqual(before.state.game.trail);
      expect(hidden.state.game.elapsedUs).toBe(before.state.game.elapsedUs);
      expect(hidden.state.game.score).toBe(before.state.game.score);
      expect(hidden.state.game.lives).toBe(before.state.game.lives);
      expect(hidden.state.game.events).toEqual(before.state.game.events);
      expect(hidden.state.game.timeUs).toBe(600_064_000);
      expect(hidden.state.game.status).toBe('paused');
      expect(hidden.wakeAt).toBeNull();
      const focused = execute(hidden, { type: 'focus' }, 700_064);
      expect(focused.state.game.ball).toEqual(before.state.game.ball);
      expect(focused.state.game.elapsedUs).toBe(before.state.game.elapsedUs);
      expect(focused.state.game.status).toBe('paused');
      expect(starts(focused)).toEqual([]);
    },
  );

  it.each(['ready', 'playing'] as const)(
    'preserves the visible %s exit and republishes saved state on the next Play',
    (status) => {
      const previous = status === 'ready' ? onAir() : started();
      previous.state.game.bricks[0]!.hp = 0;
      previous.state.brickFades = [{ id: 0, atMs: 0 }];
      const out = run({ state: previous.state, data: {}, event: { type: 'out' }, nowMs: 20 });
      expect(out.data).toEqual({});
      expect(out.state.game.status).toBe(status === 'playing' ? 'paused' : 'ready');
      expect(out.state.onAir).toBe(false);
      expect(out.state.focused).toBe(false);
      expect(out.wakeAt).toBeNull();
      expect(out.state.lastBrickSignature).toBe('');
      expect(out.state.lastStatsSignature).toBe('');
      const played = run({ state: out.state, data: {}, event: { type: 'play' }, nowMs: 40 });
      expect(Object.keys(played.data)).toEqual(['bricks', 'actors', 'stats']);
      expect(played.data.stats!.status).toBe(status === 'playing' ? 'paused' : 'ready');
      expect(played.data.bricks![0]!.opacity).toBe(0);
      expect(starts(played)).toEqual([]);
    },
  );

  it('keeps Ready and Serve launchable with one gesture after focus loss while releasing held inputs', () => {
    let ready = command(onAir(), 'left-down');
    ready = execute(ready, { type: 'blur' }, 16);
    expect(ready.data.stats.status).toBe('ready');
    expect(ready.state.game.input).toEqual({ left: false, right: false, pointerX: null });
    expect(ready.wakeAt).toBeNull();
    ready = command(ready, 'start', 20);
    expect(ready.data.stats.status).toBe('playing');
    expect(ready.actions.some((action) => action.name === 'launch')).toBe(true);

    let serve = command(ready, 'restart', 20);
    serve = execute(serve, { type: 'blur' }, 24);
    expect(serve.data.stats.status).toBe('serve');
    expect(starts(serve)).toEqual([]);
    serve = command(serve, 'launch', 30);
    expect(serve.data.stats.status).toBe('playing');
    expect(serve.media).toContainEqual({
      name: 'music',
      command: 'resume',
      gain: 0.35,
      muted: false,
    });

    let off = execute(onAir(), { type: 'out' }, 40);
    expect(off.data.stats.status).toBe('ready');
    expect(off.wakeAt).toBeNull();
    off = execute(off, { type: 'play' }, 50);
    off = command(off, 'start', 50);
    expect(off.data.stats.status).toBe('playing');
  });

  it('restores only waiting-state pointer wakes on focus and never resumes gameplay or music passively', () => {
    let ready = execute(onAir(), { type: 'blur' }, 16);
    expect(ready.state.focused).toBe(false);
    expect(ready.wakeAt).toBeNull();
    ready = execute(ready, { type: 'focus' }, 1000);
    expect(ready.data.stats.status).toBe('ready');
    expect(ready.wakeAt).toBe(1016);
    expect(starts(ready)).toEqual([]);
    let serve = command(ready, 'restart', 1000);
    serve = execute(serve, { type: 'blur' }, 1016);
    const elapsed = serve.state.game.elapsedUs;
    serve = execute(serve, { type: 'focus' }, 3_601_016);
    expect(serve.state.game.elapsedUs).toBe(elapsed);
    expect(serve.data.stats.status).toBe('serve');
    expect(serve.wakeAt).toBe(3_601_032);
    expect(starts(serve)).toEqual([]);
    let playing = execute(started(), { type: 'blur' }, 16);
    playing = execute(playing, { type: 'focus' }, 1000);
    expect(playing.data.stats.status).toBe('paused');
    expect(playing.wakeAt).toBeNull();
    expect(starts(playing)).toEqual([]);
    playing = command(playing, 'start', 1000);
    expect(playing.data.stats.status).toBe('playing');
    expect(playing.wakeAt).toBe(1016);
    expect(playing.media).toContainEqual({
      name: 'music',
      command: 'resume',
      gain: 0.35,
      muted: false,
    });
  });

  it('publishes only changed aliases while retaining complete load, palette, clock and fade updates', () => {
    const initial = run({ state: null, data: {}, event: { type: 'load' }, nowMs: 0 });
    expect(Object.keys(initial.data)).toEqual(['bricks', 'actors', 'stats']);
    let state = run({ state: initial.state, data: {}, event: { type: 'play' }, nowMs: 0 });
    state = run({
      state: state.state,
      data: {},
      event: { type: 'custom-action', actionId: 'game.start' },
      nowMs: 0,
    });
    const steady = run({ state: state.state, data: {}, event: { type: 'tick' }, nowMs: 16 });
    expect(Object.keys(steady.data)).toEqual(['actors']);
    expect(JSON.stringify(steady.data).length).toBeLessThan(2000);
    const colored = run({
      state: steady.state,
      data: { settings: { palette: { row0: '#ABCDEF' } } },
      event: { type: 'data' },
      nowMs: 16,
    });
    expect(colored.data.bricks?.[0]!.color).toBe('#abcdef');
    expect(colored.data.stats).toBeUndefined();
    const elapsed = run({ state: steady.state, data: {}, event: { type: 'tick' }, nowMs: 1000 });
    expect(elapsed.data.stats?.timeText).toBe('00:01');
    const restarted = run({
      state: elapsed.state,
      data: {},
      event: { type: 'custom-action', actionId: 'game.restart' },
      nowMs: 1000,
    });
    expect(Object.keys(restarted.data)).toEqual(['bricks', 'actors', 'stats']);
  });

  it('settles a short destroyed-brick flash even after the final level is won', () => {
    let result = started();
    result.state.game.level = 3;
    result.state.game.bricks = result.state.game.bricks.map((brick) => ({
      ...brick,
      hp: brick.id === 60 ? 1 : 0,
    }));
    result.state.game.ball = { x: 186, y: 496, vx: 0, vy: -520 };
    result = execute(result, { type: 'tick' }, 40);
    expect(result.data.stats.status).toBe('won');
    expect(result.data.bricks[60]).toMatchObject({ hp: 0, opacity: 1, color: '#ffffff' });
    expect(Number(result.data.bricks[60]!.width)).toBeGreaterThan(96);
    expect(result.wakeAt).toBe(56);
    result = execute(result, { type: 'tick' }, 90);
    expect(result.data.bricks[60]!.opacity).toBe(0.5);
    expect(result.actions).toEqual([]);
    result = execute(result, { type: 'tick' }, 140);
    expect(result.data.bricks[60]!.opacity).toBe(0);
    expect(result.data.bricks[60]!.width).toBe(96);
    expect(result.wakeAt).toBeNull();
    expect(result.data.stats).toMatchObject({
      title: 'PRISM BREAKER',
      progressWidth: 288,
      progressText: '100% CLEAR',
      currentLevelLabel: '03 / 03',
    });
  });

  it('bundles standalone JSON-safe logic and publishes stable editable output paths without autoplay', () => {
    expect(new TextEncoder().encode(source).byteLength).toBeLessThan(128 * 1024);
    expect(source).not.toMatch(/^\s*(?:import|export)\s/m);
    const result = loaded();
    expect(result.data.stats).toMatchObject({
      progressWidth: 0,
      progressText: '0% CLEAR',
      currentLevelLabel: '01 / 03',
    });
    expect(result.wakeAt).toBeNull();
    expect(starts(result)).toEqual([]);
    expect(result.data.bricks).toHaveLength(72);
    expect(result.data.bricks[0]).toMatchObject({
      key: 'brick-0',
      x: 138,
      y: 246,
      width: 96,
      height: 28,
      hp: 2,
      armorOpacity: 1,
      label: '2',
    });
    expect(Object.keys(result.data.actors)).toEqual([
      'paddle',
      'ball',
      'shield',
      'trail0',
      'trail1',
      'trail2',
      'trail3',
      'pickup0',
      'pickup1',
      'pickup2',
    ]);
    for (const id of ['pickup0', 'pickup1', 'pickup2'])
      expect(result.data.actors[id]).toMatchObject({ x: 120, y: 200, opacity: 0 });
    const playing = execute(result, { type: 'play' });
    expect(playing.wakeAt).toBe(16);
    expect(playing.data.stats.status).toBe('ready');
    expect(starts(playing)).toEqual([]);
  });

  it('samples composition pointer only inside the game field and leaves the paddle still over HUD controls', () => {
    let result = execute(onAir(), { type: 'tick' }, 16, {}, { x: 1320, y: 800 });
    expect(result.data.actors.paddle!.x).toBe(1246);
    result = execute(result, { type: 'tick' }, 32, {}, { x: 1780, y: 800 });
    expect(result.data.actors.paddle!.x).toBe(1246);
    result = execute(result, { type: 'tick' }, 48, {}, { x: 780, y: 80 });
    expect(result.data.actors.paddle!.x).toBe(1246);
    result = command(result, 'left-down', 48);
    result = execute(result, { type: 'tick' }, 148, {}, { x: 1320, y: 800 });
    expect(Number(result.data.actors.paddle!.x)).toBeLessThan(1246);
  });

  it('starts music only with a gesture and handles pause, blur, Out and restart without stale sound replay', () => {
    let result = started();
    expect(result.data.stats.status).toBe('playing');
    expect(starts(result).map((cue) => cue.name)).toEqual(['music', 'launch']);
    result = command(result, 'left-down', 20);
    result = execute(result, { type: 'blur' }, 40);
    expect(result.data.stats.status).toBe('paused');
    expect(result.state.game.input).toEqual({ left: false, right: false, pointerX: null });
    expect(result.wakeAt).toBeNull();
    expect(starts(result)).toEqual([]);
    expect(result.media).toContainEqual({ name: 'music', command: 'pause' });
    result = command(result, 'pause', 1000);
    expect(result.media).toContainEqual({
      name: 'music',
      command: 'resume',
      gain: 0.35,
      muted: false,
    });
    result = execute(result, { type: 'out' }, 1100);
    expect(result.media).toContainEqual({ name: 'music', command: 'stop' });
    expect(result.wakeAt).toBeNull();
    result = execute(result, { type: 'play' }, 1200);
    expect(starts(result)).toEqual([]);
    result = command(result, 'restart', 1200);
    expect(result.data.stats.status).toBe('serve');
    expect(result.actions).toEqual([]);
    expect(starts(result).map((cue) => cue.name)).toEqual(['music']);
  });

  it('updates settings without resetting gameplay and preserves best score across explicit restart', () => {
    let result = started();
    result.state.game.score = 230;
    const settings = { musicGain: 2, sfxGain: -1, trail: false, palette: { paddle: '#ABCDEF' } };
    result = execute(result, { type: 'data' }, 200, settings);
    expect(result.data.stats.bestScore).toBe(230);
    expect(result.data.actors.paddle!.color).toBe('#abcdef');
    expect(result.data.actors.trail0!.opacity).toBe(0);
    expect(result.media).toContainEqual({
      name: 'music',
      command: 'controls',
      gain: 1,
      muted: false,
    });
    expect(result.media).toContainEqual({
      name: 'brick',
      command: 'controls',
      gain: 0,
      muted: false,
    });
    result = command(result, 'restart', 200, settings);
    expect(result.data.stats.score).toBe(0);
    expect(result.data.stats.bestScore).toBe(230);
  });

  it('emits one sound per successful hit group, consumes muted events, and keeps UI events available', () => {
    let result = command(onAir(), 'mute');
    result = command(result, 'launch');
    expect(result.actions.find((action) => action.name === 'launch')?.payload.count).toBe(1);
    expect(result.media.some((cue) => cue.name === 'launch' && cue.command === 'restart')).toBe(
      false,
    );
    result = command(result, 'mute');
    expect(result.media.some((cue) => cue.name === 'launch' && cue.command === 'restart')).toBe(
      false,
    );
    result = command(result, 'launch');
    expect(result.actions.some((action) => action.name === 'launch')).toBe(false);
  });
});
