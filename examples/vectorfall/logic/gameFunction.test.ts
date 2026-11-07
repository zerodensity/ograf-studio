import { beforeAll, describe, expect, it } from 'vitest';
import { buildVectorfallFunctionSource } from './build-source';
import type { VectorfallContext, VectorfallResult } from './gameFunction';

let source = '';
let run: (ctx: VectorfallContext) => VectorfallResult;
beforeAll(async () => {
  source = await buildVectorfallFunctionSource();
  // Unit-only Node evaluation verifies the exact expression stored in a template. Studio
  // executes user-authored functions in its worker sandbox, never in its main page.
  run = new Function(`return (${source});`)() as typeof run;
});
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function execute(
  previous: VectorfallResult | null,
  event: VectorfallContext['event'],
  nowMs = 0,
  settings: Record<string, unknown> = {},
) {
  const ctx: VectorfallContext = {
    state: copy(previous?.state ?? null),
    data: { settings },
    event,
    nowMs,
  };
  const before = copy(ctx);
  const result = run(ctx);
  expect(ctx).toEqual(before);
  expect(copy(result)).toEqual(result);
  const finite = (value: unknown) => {
    if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    else if (value && typeof value === 'object')
      for (const child of Object.values(value)) finite(child);
  };
  finite(result);
  return copy(result);
}
const action = (
  previous: VectorfallResult,
  actionId: string,
  nowMs = 0,
  settings: Record<string, unknown> = {},
) => execute(previous, { type: 'custom-action', actionId: `game.${actionId}` }, nowMs, settings);
const startsAudio = (result: VectorfallResult) =>
  result.media.filter((entry) => ['play', 'restart', 'resume'].includes(entry.command));

describe('editable bundled VECTORFALL template function', () => {
  it('round-trips a dependency-free expression and publishes only ready state on load/play', () => {
    expect(typeof run).toBe('function');
    expect(new TextEncoder().encode(source).byteLength).toBeLessThan(64 * 1024);
    expect(source).not.toMatch(/^\s*(?:import|export)\s/m);
    const loaded = execute(null, { type: 'load' });
    expect(loaded.data.stats.status).toBe('ready');
    expect(loaded.wakeAt).toBeNull();
    expect(startsAudio(loaded)).toEqual([]);
    expect(loaded.actions).toEqual([]);
    expect(loaded.data.board).toHaveLength(20);
    expect(Object.keys(loaded.data.board[0]!)).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
      'c9',
    ]);
    const played = execute(loaded, { type: 'play' }, 25);
    expect(played.data.stats.status).toBe('ready');
    expect(startsAudio(played)).toEqual([]);
    const started = action(played, 'start', 30);
    expect(started.data.stats.status).toBe('playing');
    expect(started.wakeAt).toBe(1030);
    expect(startsAudio(started)).toEqual([
      { name: 'music', command: 'restart', gain: 0.18, muted: false },
    ]);
  });

  it('uses engine input edges, emits only successful events, and mute does not replay old effects', () => {
    let game = action(execute(null, { type: 'load' }), 'start');
    game.state.game.active = { kind: 6, rotation: 0, x: 0, y: 3 };
    const blocked = action(game, 'left-down');
    expect(blocked.actions).toEqual([]);
    expect(startsAudio(blocked)).toEqual([]);
    let moved = action(blocked, 'right-down');
    expect(moved.actions).toEqual([
      { name: 'move', payload: { count: 1, score: 0, lines: 0, level: 1 } },
    ]);
    expect(startsAudio(moved)).toEqual([
      { name: 'move', command: 'restart', gain: 0.45, muted: false },
    ]);
    const repeated = action(moved, 'right-down');
    expect(repeated.actions).toEqual([]);
    moved = action(repeated, 'mute');
    expect(moved.data.stats.muted).toBe(true);
    expect(moved.media.every((entry) => entry.command === 'controls' && entry.muted === true)).toBe(
      true,
    );
    const rotated = action(moved, 'rotate-cw');
    expect(rotated.actions.map((entry) => entry.name)).toEqual(['rotate']);
    expect(startsAudio(rotated)).toEqual([]);
    const unmuted = action(rotated, 'mute');
    expect(unmuted.actions).toEqual([]);
    expect(startsAudio(unmuted)).toEqual([]);
    expect(execute(unmuted, { type: 'tick' }).actions).toEqual([]);
  });

  it('pauses and releases held controls on blur/out and requires a user action to resume music', () => {
    let game = action(execute(null, { type: 'load' }), 'start');
    game = action(game, 'left-down');
    game = execute(game, { type: 'blur' }, 20);
    expect(game.data.stats.status).toBe('paused');
    expect(game.state.game.input.direction).toBe(0);
    expect(game.wakeAt).toBeNull();
    expect(game.media).toContainEqual({ name: 'music', command: 'pause' });
    const paused = execute(game, { type: 'tick' }, 5000);
    expect(paused.data).toEqual(game.data);
    expect(startsAudio(paused)).toEqual([]);
    game = execute(paused, { type: 'play' }, 5001);
    expect(startsAudio(game)).toEqual([]);
    game = action(game, 'pause', 5002);
    expect(game.data.stats.status).toBe('playing');
    expect(game.media).toContainEqual({
      name: 'music',
      command: 'resume',
      gain: 0.18,
      muted: false,
    });
    game = execute(game, { type: 'out' }, 5003);
    expect(game.data.stats.status).toBe('paused');
    expect(game.media).toContainEqual({ name: 'music', command: 'stop' });
    game = execute(game, { type: 'play' }, 5004);
    expect(startsAudio(game)).toEqual([]);
    game = action(game, 'pause', 5005);
    expect(game.media).toContainEqual({
      name: 'music',
      command: 'restart',
      gain: 0.18,
      muted: false,
    });
  });

  it('publishes a simultaneous clear once and preserves best score while restarting the private game', () => {
    let game = action(execute(null, { type: 'load' }), 'start');
    game.state.game.active = { kind: 1, rotation: 1, x: 2, y: 16 };
    for (let y = 20; y < 24; y++)
      game.state.game.board[y] = Array.from({ length: 10 }, (_, x) => (x === 4 ? 0 : 2));
    game = action(game, 'hard-drop');
    expect(game.data.stats.status).toBe('clearing');
    expect(game.wakeAt).toBe(50);
    expect(game.actions.map((entry) => entry.name)).toEqual(['drop', 'lock', 'clear']);
    expect(game.media.filter((entry) => entry.name === 'clear')).toEqual([
      { name: 'clear', command: 'restart', gain: 0.45, muted: false },
    ]);
    game = execute(game, { type: 'tick' }, 150);
    expect(game.data.stats.score).toBe(800);
    expect(game.data.stats.bestScore).toBe(800);
    expect(game.data.stats.comboText).toBe('4-LINE CLEAR');
    expect(game.actions).toEqual([]);
    game = action(game, 'restart', 151);
    expect(game.data.stats.score).toBe(0);
    expect(game.data.stats.bestScore).toBe(800);
    expect(game.actions).toEqual([]);
    expect(game.media).toContainEqual({
      name: 'music',
      command: 'restart',
      gain: 0.18,
      muted: false,
    });
  });

  it('applies settings as presentation controls without resetting the game and returns colored preview matrices', () => {
    let game = action(execute(null, { type: 'load' }), 'start');
    game.state.game.active = { kind: 1, rotation: 0, x: 3, y: 0 };
    const settings = {
      ghost: false,
      musicGain: 4,
      sfxGain: -2,
      palette: { I: '#ABCDEF', empty: '#010203', ghost: '#040506' },
    };
    const changed = execute(game, { type: 'data' }, 1, settings);
    expect(changed.state.game.active).toEqual(game.state.game.active);
    expect(
      changed.data.board.flatMap(Object.values).filter((color) => color === '#abcdef'),
    ).toHaveLength(4);
    expect(changed.data.board.flatMap(Object.values)).not.toContain('#040506');
    expect(changed.media.find((entry) => entry.name === 'music')).toMatchObject({
      command: 'controls',
      gain: 1,
    });
    expect(changed.media.find((entry) => entry.name === 'move')).toMatchObject({
      command: 'controls',
      gain: 0,
    });
    const holdObject = changed.data.stats.holdCells as Record<string, string>,
      nextObject = changed.data.stats.nextCells as Record<string, Record<string, string>>;
    expect(Object.keys(holdObject)).toEqual(Array.from({ length: 16 }, (_, index) => `c${index}`));
    expect(Object.keys(nextObject)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(Object.keys(nextObject.p0!)).toEqual(Object.keys(holdObject));
    const hold = Object.values(holdObject),
      next = Object.values(nextObject).map(Object.values);
    expect(hold).toHaveLength(16);
    expect(next).toHaveLength(5);
    expect(hold).toEqual(Array(16).fill('#00000000'));
    expect(next.every((cells) => cells.filter((color) => color !== '#00000000').length === 4)).toBe(
      true,
    );
    expect(
      [...hold, ...next.flat()].every(
        (color) => color === '#00000000' || /^#[\da-f]{6}$/.test(color),
      ),
    ).toBe(true);
    expect(changed.data.board.flatMap(Object.values)).toContain('#010203');
  });
});
