import { describe, expect, it } from 'vitest';
import {
  applyFallingBlocksCommand,
  advanceFallingBlocksGame,
  createFallingBlocksGame,
  fallingBlocksNextWakeMs,
  fallingBlocksPieceCells,
  projectFallingBlocksGame,
  type FallingBlocksGame,
  type FallingBlocksGameCommand,
  type FallingBlocksOptions,
  type FallingBlocksPiece,
} from './fallingBlocksEngine';

const empty = () => Array.from({ length: 24 }, () => Array<number>(10).fill(0));
function playing(
  kind: FallingBlocksPiece = 6,
  x = 3,
  y = 3,
  rotation = 0,
  options: FallingBlocksOptions = {},
): FallingBlocksGame {
  const game = applyFallingBlocksCommand(createFallingBlocksGame(options), 'start', 0).game;
  return {
    ...game,
    board: empty(),
    active: { kind, x, y, rotation },
    lockAtUs: null,
    lockResets: 0,
    touchedGround: false,
  } satisfies FallingBlocksGame;
}
const command = (
  game: FallingBlocksGame,
  action: FallingBlocksGameCommand,
  at = game.timeUs / 1000,
) => applyFallingBlocksCommand(game, action, at).game;
const advance = (game: FallingBlocksGame, at: number) => advanceFallingBlocksGame(game, at).game;

describe('VECTORFALL piece generation and geometry', () => {
  it('creates a deterministic seven-bag stream and five previews without mutable projection aliases', () => {
    const draws = (seed: number) => {
      let game = command(createFallingBlocksGame({ seed }), 'start');
      const result: number[] = [];
      for (let index = 0; index < 35; index++) {
        result.push(game.active!.kind);
        game.board = empty();
        game = command(game, 'hard-drop');
      }
      return result;
    };
    const first = draws(17);
    expect(draws(17)).toEqual(first);
    expect(draws(18)).not.toEqual(first);
    for (let index = 0; index < first.length; index += 7)
      expect(first.slice(index, index + 7).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const game = playing();
    const output = projectFallingBlocksGame(game);
    expect(output.boardRows).toHaveLength(20);
    expect(output.boardRows.every((row) => row.length === 10)).toBe(true);
    expect(output.stats.nextCells).toHaveLength(5);
    expect(
      output.stats.nextCells.every(
        (cells) => cells.length === 16 && cells.filter(Boolean).length === 4,
      ),
    ).toBe(true);
    output.boardRows[0]![0] = 7;
    output.stats.events.move = 999;
    expect(game.board[4]![0]).toBe(0);
    expect(game.events.move).toBe(0);
  });

  it('uses SRS left-wall kicks and distinct I-piece kick offsets', () => {
    const tee = command(playing(6, -1, 5, 1), 'rotate-cw');
    expect(tee.active).toMatchObject({ rotation: 2, x: 0, y: 5 });
    const line = command(playing(1, -2, 5, 1), 'rotate-cw');
    expect(line.active).toMatchObject({ rotation: 2, x: 0, y: 5 });
    expect(tee.events.rotate).toBe(1);
    expect(line.events.rotate).toBe(1);
    expect(command(playing(6, 8, 5, 3), 'rotate-cw').active).toMatchObject({
      rotation: 0,
      x: 7,
      y: 5,
    });
    expect(command(playing(1, 8, 5, 3), 'rotate-cw').active).toMatchObject({
      rotation: 0,
      x: 6,
      y: 5,
    });
  });

  it('uses SRS floor kicks in both rotation directions and keeps O geometry unchanged', () => {
    expect(command(playing(6, 3, 18), 'rotate-cw').active).toMatchObject({
      rotation: 1,
      x: 2,
      y: 17,
    });
    expect(command(playing(6, 3, 18), 'rotate-ccw').active).toMatchObject({
      rotation: 3,
      x: 4,
      y: 17,
    });
    expect(command(playing(1, 3, 18), 'rotate-cw').active).toMatchObject({
      rotation: 1,
      x: 4,
      y: 16,
    });
    expect(command(playing(1, 3, 18), 'rotate-ccw').active).toMatchObject({
      rotation: 3,
      x: 2,
      y: 16,
    });
    const square = playing(4, 3, 18),
      rotated = command(square, 'rotate-cw');
    expect(fallingBlocksPieceCells(rotated.active!)).toEqual(
      fallingBlocksPieceCells(square.active!),
    );
  });

  it('rejects blocked rotations and wall movement without producing success events or mutating its input', () => {
    const game = playing(6, 3, 5);
    game.board = Array.from({ length: 24 }, () => Array<number>(10).fill(2));
    for (const [x, y] of fallingBlocksPieceCells(game.active!)) game.board[y + 4]![x] = 0;
    const before = structuredClone(game);
    const blocked = command(game, 'rotate-cw');
    expect(blocked.active).toEqual(game.active);
    expect(blocked.events.rotate).toBe(0);
    expect(game).toEqual(before);
    const wall = playing(4, -1, 5);
    const failedMove = applyFallingBlocksCommand(wall, 'left-down', 0);
    expect(failedMove.game.events.move).toBe(0);
    expect(failedMove.changed).toBe(false);
  });

  it('holds only once per piece, resets a held orientation, and unlocks hold after a piece locks', () => {
    const game = playing(6, 3, 5, 2);
    const held = command(game, 'hold');
    expect(held.hold).toBe(6);
    expect(held.active!.rotation).toBe(0);
    expect(held.holdUsed).toBe(true);
    expect(command(held, 'hold')).toEqual(held);
    const locked = command(held, 'hard-drop');
    expect(locked.holdUsed).toBe(false);
    const nextKind = locked.active!.kind;
    const swap = command(locked, 'hold');
    expect(swap.active).toMatchObject({ kind: 6, rotation: 0, x: 3, y: -1 });
    expect(swap.hold).toBe(nextKind);
    expect(projectFallingBlocksGame(swap).stats.holdCells.filter(Boolean)).toHaveLength(4);
  });
});

describe('VECTORFALL movement, locking and scoring', () => {
  it.each([
    [1, 100],
    [2, 300],
    [3, 500],
    [4, 800],
  ])('awards %s-line clear points as one simultaneous clear', (rows, score) => {
    let game = playing(1, 2, 16, 1);
    for (let y = 20 - rows!; y < 20; y++)
      game.board[y + 4] = Array.from({ length: 10 }, (_, x) => (x === 4 ? 0 : 2));
    game = command(game, 'hard-drop');
    expect(game.lastClearCount).toBe(rows);
    game = advance(game, 150);
    expect(game.lines).toBe(rows);
    expect(game.score).toBe(score);
    expect(game.events.clear).toBe(1);
  });
  it('projects a ghost at the hard-drop landing and awards soft/hard drop distance points', () => {
    let game = playing(4, 3, 0);
    const projection = projectFallingBlocksGame(game);
    expect(projection.boardRows[18]![4]).toBe(11);
    expect(projection.boardRows[19]![5]).toBe(11);
    expect(projection.boardRows[0]![4]).toBe(4);
    game = command(game, 'soft-down');
    game = advance(game, 105);
    expect(game.score).toBe(4);
    expect(game.active!.y).toBe(4);
    game = command(game, 'soft-up');
    const beforeScore = game.score;
    game = command(game, 'hard-drop');
    expect(game.score).toBe(beforeScore + (18 - 4) * 2);
    expect(game.events.drop).toBe(1);
    expect(game.events.lock).toBe(1);
    expect(game.piecesLocked).toBe(1);
    expect(game.board[22]![4]).toBe(4);
    expect(game.board[23]![5]).toBe(4);
  });

  it('clears four full rows simultaneously after the flash delay, with no invented intermediate line totals', () => {
    let game = playing(1, 2, 16, 1);
    for (let y = 16; y < 20; y++)
      game.board[y + 4] = Array.from({ length: 10 }, (_, x) => (x === 4 ? 0 : 2));
    game = command(game, 'hard-drop');
    expect(game.status).toBe('clearing');
    expect(game.clearRows).toEqual([20, 21, 22, 23]);
    expect(game.lines).toBe(0);
    expect(game.events.clear).toBe(1);
    expect(game.active).toBeNull();
    expect(projectFallingBlocksGame(game).stats.flashOn).toBe(true);
    expect(fallingBlocksNextWakeMs(game)).toBe(50);
    game = advance(game, 50);
    expect(projectFallingBlocksGame(game).boardRows[19]).toEqual(Array(10).fill(0));
    game = advance(game, 100);
    expect(projectFallingBlocksGame(game).boardRows[19]!.every(Boolean)).toBe(true);
    expect(game.lines).toBe(0);
    game = advance(game, 150);
    expect(game.status).toBe('playing');
    expect(game.lines).toBe(4);
    expect(game.score).toBe(800);
    expect(game.board.every((row) => row.every((cell) => cell === 0))).toBe(true);
    expect(game.events.clear).toBe(1);
    expect(game.lastClearCount).toBe(4);
  });

  it('scores with the pre-clear level and accelerates gravity when ten lines are reached', () => {
    let game = playing(4, 3, 18);
    game.lines = 8;
    for (let y = 18; y < 20; y++)
      game.board[y + 4] = Array.from({ length: 10 }, (_, x) => (x === 4 || x === 5 ? 0 : 3));
    game = command(game, 'hard-drop');
    game = advance(game, 150);
    expect(game.score).toBe(300);
    expect(game.lines).toBe(10);
    expect(game.level).toBe(2);
    expect(game.events.level).toBe(1);
    expect(game.gravityAtUs! - game.elapsedUs).toBe(793000);
  });

  it('honors lock delay and caps grounded manipulation resets', () => {
    let game = playing(4, 3, 18, 0, { maxLockResets: 2 });
    game = command(game, 'soft-down'); // Ground contact starts the ordinary 500 ms lock timer.
    expect(game.lockAtUs).toBe(500000);
    game = command(game, 'rotate-cw', 100);
    expect(game.lockAtUs).toBe(600000);
    game = command(game, 'rotate-ccw', 200);
    expect(game.lockAtUs).toBe(700000);
    game = command(game, 'rotate-cw', 300);
    expect(game.lockAtUs).toBe(700000);
    expect(game.lockResets).toBe(2);
    game = advance(game, 699);
    expect(game.events.lock).toBe(0);
    game = advance(game, 700);
    expect(game.events.lock).toBe(1);
  });

  it('ends on a blocked spawn or a piece locked above the visible playfield', () => {
    let blocked = createFallingBlocksGame();
    blocked.board[4]!.fill(2);
    blocked = command(blocked, 'start');
    expect(blocked.status).toBe('game-over');
    expect(blocked.events.gameOver).toBe(1);
    expect(advance(blocked, 10000).events.gameOver).toBe(1);
    let hidden = playing(4, 3, -1);
    hidden.board[5]![4] = 2;
    hidden.board[5]![5] = 2;
    hidden = command(hidden, 'hard-drop');
    expect(hidden.status).toBe('game-over');
    expect(hidden.events.lock).toBe(1);
  });

  it('counts grounded moves that leave a ledge toward the reset limit and locks on the next landing', () => {
    let game = playing(4, 3, 17, 0, { maxLockResets: 2 });
    game.board[23]![4] = 2;
    game.board[23]![5] = 2;
    game = command(game, 'soft-down');
    game = command(game, 'right-down', 100);
    expect(game.lockResets).toBe(1);
    expect(game.lockAtUs).toBe(600000);
    game = command(game, 'right-up', 101);
    game = command(game, 'right-down', 200);
    expect(game.lockResets).toBe(2);
    expect(game.lockAtUs).toBeNull();
    game = advance(game, 209);
    expect(game.events.lock).toBe(0);
    game = advance(game, 210);
    expect(game.events.lock).toBe(1);
  });
});

describe('VECTORFALL clocks and input', () => {
  it('owns DAS/ARR repeat independently of OS repeat and releases held inputs without delaying gravity', () => {
    let game = playing(6, 3, 3, 0, { gravityMs: 60000 });
    game = command(game, 'left-down');
    expect(game.active!.x).toBe(2);
    game = command(game, 'left-down', 20);
    expect(game.active!.x).toBe(2);
    game = advance(game, 149);
    expect(game.active!.x).toBe(2);
    game = advance(game, 150);
    expect(game.active!.x).toBe(1);
    game = advance(game, 190);
    expect(game.active!.x).toBe(0);
    const gravity = game.gravityAtUs;
    game = command(game, 'release-inputs', 191);
    game = advance(game, 2000);
    expect(game.active!.x).toBe(0);
    expect(game.input.direction).toBe(0);
    expect(game.gravityAtUs).toBe(gravity);
    game = command(game, 'right-down');
    expect(game.active!.x).toBe(1);
    game = command(game, 'left-down');
    expect(game.active!.x).toBe(0);
    game = command(game, 'left-up');
    expect(game.active!.x).toBe(1);
    expect(game.input.direction).toBe(1);
    game = command(game, 'right-up');
    expect(game.input.repeatAtUs).toBeNull();
  });

  it('pauses clocks and a pending line clear without catch-up, and restart is reproducible', () => {
    let game = playing(4, 3, 18);
    for (let y = 18; y < 20; y++)
      game.board[y + 4] = Array.from({ length: 10 }, (_, x) => (x === 4 || x === 5 ? 0 : 3));
    game = command(game, 'hard-drop');
    game = command(game, 'pause', 50);
    const paused = projectFallingBlocksGame(game);
    game = advance(game, 10000);
    expect(projectFallingBlocksGame(game)).toEqual(paused);
    expect(fallingBlocksNextWakeMs(game)).toBeNull();
    game = command(game, 'pause');
    expect(game.status).toBe('clearing');
    game = advance(game, 10099);
    expect(game.lines).toBe(0);
    game = advance(game, 10100);
    expect(game.lines).toBe(2);
    game = command(game, 'mute');
    const counters = { ...game.events };
    const restarted = command(game, 'restart');
    const fresh = command(createFallingBlocksGame(game.options), 'start');
    expect(restarted.active).toEqual(fresh.active);
    expect(restarted.queue).toEqual(fresh.queue);
    expect(restarted.score).toBe(0);
    expect(restarted.elapsedUs).toBe(0);
    expect(restarted.muted).toBe(true);
    expect(restarted.events).toEqual(counters);
    expect(restarted.run).toBe(game.run + 1);
  });

  it('reports no visible change before its next wake and never mutates input or accepts backward time', () => {
    const game = playing();
    const before = structuredClone(game);
    expect(advanceFallingBlocksGame(game, 100)).toMatchObject({ changed: false, nextWakeMs: 1000 });
    expect(game).toEqual(before);
    const later = advance(game, 100);
    expect(() => advance(later, 99)).toThrow('backward');
    expect(() => advance(game, Number.NaN)).toThrow();
    expect(() => createFallingBlocksGame({ arrMs: 0 })).toThrow();
  });

  it('sleeps through failed wall repeats while preserving the same phase and state as dense sampling', () => {
    const initial = command(playing(6, 0, 3, 0, { arrMs: 1 }), 'left-down');
    expect(fallingBlocksNextWakeMs(initial)).toBe(1000);
    let dense = initial;
    for (let time = 1; time <= 5000; time++) dense = advance(dense, time);
    let scheduled = initial;
    for (;;) {
      const next = fallingBlocksNextWakeMs(scheduled);
      if (next === null || next > 5000) break;
      scheduled = advance(scheduled, next);
    }
    scheduled = advance(scheduled, 5000);
    expect(scheduled).toEqual(dense);
  });

  it('produces identical state at 25/30/50/60/120 FPS for timestamped play, hold, drops, pause and held releases', () => {
    const script: Array<[number, FallingBlocksGameCommand]> = [
      [0, 'start'],
      [90, 'left-down'],
      [550, 'left-up'],
      [600, 'rotate-cw'],
      [650, 'soft-down'],
      [1050, 'soft-up'],
      [1100, 'hard-drop'],
      [1200, 'hold'],
      [1250, 'right-down'],
      [1600, 'right-up'],
      [1700, 'rotate-ccw'],
      [1800, 'hard-drop'],
      [2000, 'pause'],
      [2700, 'resume'],
      [3200, 'left-down'],
      [3800, 'release-inputs'],
      [4000, 'hard-drop'],
      [4500, 'hold'],
      [5000, 'rotate-cw'],
      [5500, 'hard-drop'],
      [9000, 'hard-drop'],
    ];
    const run = (fps: number) => {
      let game = createFallingBlocksGame({ seed: 123456 }),
        next = 0;
      for (let index = 0; index <= fps * 20; index++) {
        const at = Math.min(20000, (index * 1000) / fps);
        while (next < script.length && script[next]![0] <= at) {
          const [time, action] = script[next++]!;
          game = command(game, action, time);
        }
        game = advance(game, at);
      }
      return game;
    };
    const expected = run(25);
    for (const fps of [30, 50, 60, 120]) expect(run(fps)).toEqual(expected);
  });
});
