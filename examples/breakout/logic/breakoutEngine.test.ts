import { describe, expect, it } from 'vitest';
import {
  advanceBreakoutGame,
  applyBreakoutCommand,
  breakoutBrickBounds,
  breakoutNextWakeMs,
  createBreakoutGame,
  projectBreakoutGame,
  setBreakoutPointer,
  type BreakoutCommand,
  type BreakoutGame,
} from './breakoutEngine';

const cmd = (game: BreakoutGame, name: BreakoutCommand, at = game.timeUs / 1000) =>
  applyBreakoutCommand(game, name, at).game;
const advance = (game: BreakoutGame, at: number) => advanceBreakoutGame(game, at).game;
const playing = () => cmd(createBreakoutGame(), 'start');
function onlyBrick(game: BreakoutGame, id: number, hp: number) {
  game.bricks = game.bricks.map((brick) => ({ ...brick, hp: brick.id === id ? hp : 0 }));
  return game;
}

describe('PRISM BREAKER physics and control', () => {
  it('holds neutral when both arrows are down and restores mouse control only after both are released', () => {
    let game = setBreakoutPointer(playing(), 1320, 0).game;
    game = cmd(game, 'left-down');
    game = advance(game, 100);
    const leftPosition = game.paddle.x;
    game = cmd(game, 'right-down');
    game = advance(game, 200);
    expect(game.paddle.x).toBe(leftPosition);
    game = cmd(game, 'left-up');
    game = advance(game, 300);
    expect(game.paddle.x).toBeGreaterThan(leftPosition);
    expect(game.paddle.x).not.toBe(1246);
    game = cmd(game, 'right-up');
    game = advance(game, 304);
    expect(game.paddle.x).toBe(1246);
  });

  it('publishes bounded stable brick slots and does no idle catch-up work before the first launch', () => {
    const game = createBreakoutGame(),
      output = projectBreakoutGame(game);
    expect(output.bricks).toHaveLength(72);
    expect(new Set(output.bricks.map((brick) => brick.key)).size).toBe(72);
    expect(
      output.bricks.every(
        (brick) =>
          brick.x >= 120 &&
          brick.x + brick.width <= 1440 &&
          brick.y >= 200 &&
          brick.y + brick.height < 865,
      ),
    ).toBe(true);
    expect(output.bricks.filter((brick) => brick.hp === 2)).toHaveLength(12);
    expect(advance(game, 3_600_000)).toMatchObject({ status: 'ready', elapsedUs: 0, revision: 0 });
    expect(game.timeUs).toBe(0);
  });

  it('clamps the pointer paddle, lets held keys override it, and releases movement on pause', () => {
    let game = setBreakoutPointer(createBreakoutGame(), 3000, 0).game;
    expect(game.paddle.x).toBe(1292);
    game = cmd(game, 'left-down');
    game = advance(game, 100);
    expect(game.paddle.x).toBeCloseTo(1200, 8);
    game = cmd(game, 'left-up');
    game = advance(game, 104);
    expect(game.paddle.x).toBe(1292);
    game = cmd(game, 'left-down');
    game = cmd(game, 'pause');
    const frozen = game.paddle.x;
    game = advance(game, 10000);
    expect(game.paddle.x).toBe(frozen);
    expect(game.input).toEqual({ left: false, right: false, pointerX: null });
    expect(breakoutNextWakeMs(game)).toBeNull();
  });

  it('uses swept brick collisions at high speed without tunneling and only counts successful armor/destroy hits', () => {
    let game = onlyBrick(playing(), 0, 2);
    game.ball = { x: 186, y: 306, vx: 0, vy: -1040 };
    game = advance(game, 40);
    expect(game.bricks[0]!.hp).toBe(1);
    expect(game.events.armor).toBe(1);
    expect(game.events.brick).toBe(0);
    expect(game.ball.vy).toBeGreaterThan(0);
    game.ball = { x: 186, y: 306, vx: 0, vy: -1040 };
    game = advance(game, 80);
    expect(game.bricks[0]!.hp).toBe(0);
    expect(game.events.brick).toBe(1);
    expect(game.events.armor).toBe(1);
    expect(game.status).toBe('level-clear');
    expect(game.score).toBe(60);
  });

  it('resolves side-wall and corner contacts without leaving the field or repeating a hit while separating', () => {
    let game = playing();
    game.ball = { x: 132, y: 600, vx: -1040, vy: 0 };
    game = advance(game, 40);
    expect(game.ball.x).toBeGreaterThan(130);
    expect(game.ball.vx).toBeGreaterThan(0);
    expect(game.events.bounce).toBe(1);
    game = advance(game, 80);
    expect(game.events.bounce).toBe(1);
    expect(Number.isFinite(game.ball.x)).toBe(true);
  });

  it('steers paddle rebounds by impact offset while keeping an upward component and resetting combo', () => {
    const rebound = (offset: number) => {
      let game = playing();
      game.combo = 4;
      game.ball = { x: game.paddle.x + game.paddle.width * offset, y: 850, vx: 0, vy: 1000 };
      return advance(game, 16);
    };
    const left = rebound(0.1),
      center = rebound(0.5),
      right = rebound(0.9);
    expect(left.ball.vx).toBeLessThan(-200);
    expect(right.ball.vx).toBeGreaterThan(200);
    expect(center.ball.vx).toBeCloseTo(0, 8);
    for (const game of [left, center, right]) {
      expect(game.ball.vy).toBeLessThan(-100);
      expect(game.events.bounce).toBe(1);
      expect(game.combo).toBe(0);
      expect(game.lives).toBe(3);
    }
  });

  it('loses exactly one life per missed ball, serves again, and ends after the third loss', () => {
    let game = playing();
    for (let life = 0; life < 3; life++) {
      game.ball = { x: 1300, y: 932, vx: 0, vy: 520 };
      game = advance(game, game.timeUs / 1000 + 4);
      expect(game.lives).toBe(2 - life);
      expect(game.events.life).toBe(life + 1);
      expect(game.status).toBe(life < 2 ? 'serve' : 'game-over');
      if (life < 2) game = cmd(game, 'launch');
    }
    const final = advance(game, 100000);
    expect(final.events.life).toBe(3);
    expect(final.events.gameOver).toBe(1);
    expect(final.score).toBe(game.score);
    expect(breakoutNextWakeMs(final)).toBeNull();
  });

  it('advances through three authored patterns and wins without creating an extra level', () => {
    let game = playing();
    const patterns: string[] = [];
    for (let level = 1; level <= 3; level++) {
      patterns.push(game.bricks.map((brick) => brick.hp).join(''));
      game = onlyBrick(game, 60, 1);
      const brick = breakoutBrickBounds(60);
      game.ball = { x: brick.x + 48, y: brick.y + 50, vx: 0, vy: -520 };
      game = advance(game, game.timeUs / 1000 + 40);
      expect(game.events.level).toBe(level);
      if (level < 3) {
        expect(game.status).toBe('level-clear');
        game = advance(game, game.timeUs / 1000 + 752);
        expect(game.level).toBe(level + 1);
        expect(game.status).toBe('serve');
        expect(game.nextLevelAtUs).toBeNull();
        game = cmd(game, 'launch');
      }
    }
    expect(new Set(patterns).size).toBe(3);
    expect(game.level).toBe(3);
    expect(game.status).toBe('won');
  });

  it('collects all three power types, expires timed effects and consumes a shield on the next save', () => {
    let game = playing();
    game.ball = { x: 1000, y: 700, vx: 0, vy: -520 };
    game.pickups = ['wide', 'slow', 'shield'].map((kind) => ({
      kind: kind as 'wide' | 'slow' | 'shield',
      x: 780,
      y: 860,
      ageUs: 0,
      active: true,
    }));
    game = advance(game, 8);
    expect(game.events.power).toBe(3);
    expect(game.paddle.width).toBe(228);
    expect(game.slowUntilUs).toBeGreaterThan(game.elapsedUs);
    expect(game.shield).toBe(true);
    expect(game.pickups.every((pickup) => !pickup.active)).toBe(true);
    game.ball = { x: 1300, y: 884, vx: 0, vy: 520 };
    game = advance(game, 24);
    expect(game.shield).toBe(false);
    expect(game.ball.vy).toBeLessThan(0);
    expect(game.lives).toBe(3);
    game.status = 'serve';
    game = advance(game, 12020);
    expect(game.paddle.width).toBe(148);
    expect(projectBreakoutGame(game).stats.slow).toBe(false);
  });

  it('drops only bounded deterministic pickups and expires missed ones', () => {
    const drop = () => {
      let game = playing();
      game.destroyed = 6;
      game.ball = { x: 186, y: 496, vx: 0, vy: -520 };
      return advance(game, 40);
    };
    const first = drop(),
      second = drop();
    expect(first.pickups).toEqual(second.pickups);
    expect(first.pickups.filter((pickup) => pickup.active)).toHaveLength(1);
    expect(first.pickups).toHaveLength(3);
    first.pickups[0]!.x = 1300;
    first.pickups[0]!.y = 939;
    expect(advance(first, 56).pickups[0]!.active).toBe(false);
  });

  it('applies slow ball as a velocity multiplier without corrupting its restored base velocity', () => {
    const normal = playing();
    normal.ball = { x: 1000, y: 700, vx: 200, vy: -200 };
    const slow = { ...normal, slowUntilUs: 10_000_000 };
    const a = advance(normal, 100),
      b = advance(slow, 100);
    expect(b.ball.x - 1000).toBeCloseTo((a.ball.x - 1000) * 0.68, 8);
    expect(b.ball.vx).toBe(200);
    expect(b.ball.vy).toBe(-200);
  });

  it('restarts cleanly while preserving mute and monotonic event counts, without mutating its input', () => {
    const initial = playing(),
      snapshot = structuredClone(initial);
    let game = advance(initial, 1000);
    expect(initial).toEqual(snapshot);
    game = cmd(game, 'mute');
    game.score = 100;
    const oldEvents = { ...game.events };
    game = cmd(game, 'restart');
    expect(game).toMatchObject({
      status: 'serve',
      score: 0,
      lives: 3,
      level: 1,
      muted: true,
      run: 1,
    });
    expect(game.events).toEqual(oldEvents);
    expect(game.bricks).toEqual(createBreakoutGame().bricks);
    expect(game.input).toEqual({ left: false, right: false, pointerX: null });
  });

  it('produces identical physics and event state at 25/30/50/60/120 fps with the same timed controls', () => {
    function simulate(fps: number) {
      let game = playing();
      const events: Array<[number, BreakoutCommand]> = [
        [300, 'right-down'],
        [700, 'right-up'],
        [1200, 'pause'],
        [1600, 'pause'],
        [2400, 'left-down'],
        [2800, 'left-up'],
      ];
      let next = 0;
      for (let frame = 1; frame <= fps * 6; frame++) {
        const at = (frame * 1000) / fps;
        while (next < events.length && events[next]![0] <= at) {
          const [time, event] = events[next++]!;
          game = cmd(game, event, time);
        }
        game = advance(game, at);
      }
      return game;
    }
    const reference = simulate(25);
    for (const fps of [30, 50, 60, 120]) expect(simulate(fps)).toEqual(reference);
  });
});
