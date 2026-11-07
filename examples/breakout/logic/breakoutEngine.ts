/** Original PRISM BREAKER simulation. No DOM, sound, Studio state or external dependencies. */
export const BREAKOUT_FIELD = { x: 120, y: 200, width: 1320, height: 720 } as const;
export const BREAKOUT_BRICKS = {
  x: 138,
  y: 246,
  columns: 12,
  rows: 6,
  width: 96,
  height: 28,
  gapX: 12,
  gapY: 12,
} as const;
export const BREAKOUT_PADDLE = { y: 865, width: 148, height: 18 } as const;
export const BREAKOUT_BALL_RADIUS = 10;
const STEP_US = 4000;
const MAX_SPEED = 1040;
const EPSILON = 0.001;
export type BreakoutStatus =
  'ready' | 'serve' | 'playing' | 'paused' | 'level-clear' | 'game-over' | 'won';
export type BreakoutCommand =
  | 'start'
  | 'launch'
  | 'pause'
  | 'restart'
  | 'mute'
  | 'left-down'
  | 'left-up'
  | 'right-down'
  | 'right-up'
  | 'release-inputs';
export type BreakoutPower = 'wide' | 'slow' | 'shield';
export interface BreakoutEvents {
  bounce: number;
  brick: number;
  armor: number;
  launch: number;
  life: number;
  level: number;
  gameOver: number;
  power: number;
}
export interface BreakoutBrick {
  id: number;
  hp: number;
  maxHp: number;
}
export interface BreakoutPickup {
  kind: BreakoutPower;
  x: number;
  y: number;
  ageUs: number;
  active: boolean;
}
export interface BreakoutGame {
  version: 1;
  seed: number;
  rng: number;
  run: number;
  status: BreakoutStatus;
  resumeStatus: Exclude<BreakoutStatus, 'paused'>;
  timeUs: number;
  remainderUs: number;
  elapsedUs: number;
  revision: number;
  level: number;
  lives: number;
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  destroyed: number;
  bricks: BreakoutBrick[];
  paddle: { x: number; width: number; velocity: number };
  ball: { x: number; y: number; vx: number; vy: number };
  trail: Array<{ x: number; y: number }>;
  trailUs: number;
  pickups: BreakoutPickup[];
  wideUntilUs: number;
  slowUntilUs: number;
  shield: boolean;
  nextLevelAtUs: number | null;
  input: { left: boolean; right: boolean; pointerX: number | null };
  muted: boolean;
  events: BreakoutEvents;
}
export interface BreakoutUpdate {
  game: BreakoutGame;
  changed: boolean;
  nextWakeMs: number | null;
}
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const blankPickup = (): BreakoutPickup => ({ kind: 'wide', x: 0, y: 0, ageUs: 0, active: false });
const copy = (game: BreakoutGame): BreakoutGame => ({
  ...game,
  bricks: game.bricks.map((brick) => ({ ...brick })),
  paddle: { ...game.paddle },
  ball: { ...game.ball },
  trail: game.trail.map((point) => ({ ...point })),
  pickups: game.pickups.map((pickup) => ({ ...pickup })),
  input: { ...game.input },
  events: { ...game.events },
});
function levelBricks(level: number): BreakoutBrick[] {
  return Array.from({ length: 72 }, (_, id) => {
    const row = Math.floor(id / 12),
      column = id % 12;
    const hp =
      level === 1
        ? row === 0
          ? 2
          : 1
        : level === 2
          ? (row + column) % 5 === 0
            ? 0
            : row < 3
              ? 2
              : 1
          : (row === 0 && (column === 0 || column === 11)) ||
              (row === 5 && (column < 2 || column > 9))
            ? 0
            : column >= 4 && column <= 7 && row < 4
              ? 3
              : (row + column) % 2 === 0
                ? 2
                : 1;
    return { id, hp, maxHp: hp };
  });
}
export function breakoutBrickBounds(id: number) {
  return {
    x: BREAKOUT_BRICKS.x + (id % 12) * 108,
    y: BREAKOUT_BRICKS.y + Math.floor(id / 12) * 40,
    width: 96,
    height: 28,
  };
}
function park(game: BreakoutGame) {
  game.ball = {
    x: game.paddle.x + game.paddle.width / 2,
    y: BREAKOUT_PADDLE.y - BREAKOUT_BALL_RADIUS - 2,
    vx: 0,
    vy: 0,
  };
  game.trail = Array.from({ length: 4 }, () => ({ x: game.ball.x, y: game.ball.y }));
  game.trailUs = 0;
}
export function createBreakoutGame(options: { seed?: number } = {}): BreakoutGame {
  const seed =
    Number.isInteger(options.seed) && Number.isFinite(options.seed)
      ? options.seed! >>> 0
      : 0x42524943;
  const game: BreakoutGame = {
    version: 1,
    seed,
    rng: seed,
    run: 0,
    status: 'ready',
    resumeStatus: 'ready',
    timeUs: 0,
    remainderUs: 0,
    elapsedUs: 0,
    revision: 0,
    level: 1,
    lives: 3,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    destroyed: 0,
    bricks: levelBricks(1),
    paddle: { x: 706, width: 148, velocity: 0 },
    ball: { x: 780, y: 853, vx: 0, vy: 0 },
    trail: [],
    trailUs: 0,
    pickups: Array.from({ length: 3 }, blankPickup),
    wideUntilUs: 0,
    slowUntilUs: 0,
    shield: false,
    nextLevelAtUs: null,
    input: { left: false, right: false, pointerX: null },
    muted: false,
    events: { bounce: 0, brick: 0, armor: 0, launch: 0, life: 0, level: 0, gameOver: 0, power: 0 },
  };
  park(game);
  return game;
}
function random(game: BreakoutGame): number {
  game.rng = (Math.imul(game.rng, 1664525) + 1013904223) >>> 0;
  return game.rng / 0x100000000;
}
function speed(game: BreakoutGame) {
  return Math.min(MAX_SPEED, 520 + (game.level - 1) * 95 + game.hits * 2);
}
function launch(game: BreakoutGame) {
  game.status = 'playing';
  const angle = (game.run % 2 === 0 ? 1 : -1) * 0.23,
    magnitude = speed(game);
  game.ball.vx = Math.sin(angle) * magnitude;
  game.ball.vy = -Math.cos(angle) * magnitude;
  game.events.launch++;
  game.revision++;
}
function clampPaddle(game: BreakoutGame) {
  game.paddle.x = clamp(
    game.paddle.x,
    BREAKOUT_FIELD.x,
    BREAKOUT_FIELD.x + BREAKOUT_FIELD.width - game.paddle.width,
  );
}
function paddleStep(game: BreakoutGame) {
  const old = game.paddle.x,
    width = game.elapsedUs < game.wideUntilUs ? 228 : 148;
  if (game.paddle.width !== width) {
    game.paddle.x += (game.paddle.width - width) / 2;
    game.paddle.width = width;
  }
  const direction = Number(game.input.right) - Number(game.input.left);
  if (direction) game.paddle.x += (direction * 920 * STEP_US) / 1e6;
  else if (!game.input.left && !game.input.right && game.input.pointerX !== null)
    game.paddle.x = game.input.pointerX - game.paddle.width / 2;
  clampPaddle(game);
  game.paddle.velocity = clamp((game.paddle.x - old) / (STEP_US / 1e6), -920, 920);
  if (game.paddle.x !== old) game.revision++;
  if (game.status === 'ready' || game.status === 'serve') park(game);
}
interface Collision {
  time: number;
  nx: number;
  ny: number;
  brick?: number;
  kind: 'wall' | 'paddle' | 'shield' | 'brick';
}
/** Swept point against a brick expanded by the ball radius. Never steps through thin bricks. */
function sweptBrick(
  x: number,
  y: number,
  vx: number,
  vy: number,
  seconds: number,
  id: number,
): Collision | null {
  const rect = breakoutBrickBounds(id),
    r = BREAKOUT_BALL_RADIUS;
  let near = -Infinity,
    far = Infinity,
    nx = 0,
    ny = 0;
  for (const axis of ['x', 'y'] as const) {
    const position = axis === 'x' ? x : y,
      velocity = axis === 'x' ? vx : vy;
    const min = rect[axis] - r,
      max = min + (axis === 'x' ? rect.width : rect.height) + 2 * r;
    if (Math.abs(velocity) < 1e-9) {
      if (position < min || position > max) return null;
      continue;
    }
    const first = (min - position) / velocity,
      second = (max - position) / velocity;
    const entry = Math.min(first, second),
      exit = Math.max(first, second);
    if (entry > near) {
      near = entry;
      nx = axis === 'x' ? (velocity > 0 ? -1 : 1) : 0;
      ny = axis === 'y' ? (velocity > 0 ? -1 : 1) : 0;
    }
    far = Math.min(far, exit);
  }
  if (near > far || far < 0 || near < -1e-8 || near > seconds) return null;
  return { time: Math.max(0, near), nx, ny, kind: 'brick', brick: id };
}
function powerDrop(game: BreakoutGame, id: number) {
  if (game.destroyed % 7 !== 0) return;
  const slot = game.pickups.find((pickup) => !pickup.active);
  if (!slot) return;
  const rect = breakoutBrickBounds(id);
  Object.assign(slot, {
    active: true,
    kind: (['wide', 'slow', 'shield'] as const)[Math.floor(random(game) * 3)]!,
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    ageUs: 0,
  });
}
function hitBrick(game: BreakoutGame, id: number) {
  const brick = game.bricks[id]!;
  if (brick.hp <= 0) return;
  brick.hp--;
  game.hits++;
  if (brick.hp > 0) {
    game.score += 10 * game.level;
    game.events.armor++;
  } else {
    game.combo++;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
    game.destroyed++;
    game.score += (50 + Math.min(game.combo - 1, 9) * 10) * game.level;
    game.events.brick++;
    powerDrop(game, id);
  }
  if (game.bricks.every((entry) => entry.hp === 0)) {
    game.events.level++;
    game.combo = 0;
    game.pickups = Array.from({ length: 3 }, blankPickup);
    game.status = game.level === 3 ? 'won' : 'level-clear';
    game.nextLevelAtUs = game.status === 'level-clear' ? game.elapsedUs + 750000 : null;
    game.ball.vx = 0;
    game.ball.vy = 0;
  }
}
function loseBall(game: BreakoutGame) {
  game.lives--;
  game.events.life++;
  game.combo = 0;
  game.wideUntilUs = 0;
  game.slowUntilUs = 0;
  game.shield = false;
  game.pickups = Array.from({ length: 3 }, blankPickup);
  game.status = game.lives > 0 ? 'serve' : 'game-over';
  if (!game.lives) game.events.gameOver++;
  park(game);
}
function ballStep(game: BreakoutGame) {
  const ball = game.ball,
    r = BREAKOUT_BALL_RADIUS;
  let left = STEP_US / 1e6;
  const multiplier = game.elapsedUs < game.slowUntilUs ? 0.68 : 1;
  const magnitude = Math.hypot(ball.vx, ball.vy);
  if (magnitude > MAX_SPEED) {
    ball.vx *= MAX_SPEED / magnitude;
    ball.vy *= MAX_SPEED / magnitude;
  }
  for (let contact = 0; contact < 5 && left > 1e-8 && game.status === 'playing'; contact++) {
    const vx = ball.vx * multiplier,
      vy = ball.vy * multiplier;
    const hits: Collision[] = [];
    const plane = (time: number, nx: number, ny: number, kind: Collision['kind'] = 'wall') => {
      if (time >= -1e-8 && time <= left + 1e-8)
        hits.push({ time: Math.max(0, time), nx, ny, kind });
    };
    if (vx < 0) plane((BREAKOUT_FIELD.x + r - ball.x) / vx, 1, 0);
    if (vx > 0) plane((BREAKOUT_FIELD.x + BREAKOUT_FIELD.width - r - ball.x) / vx, -1, 0);
    if (vy < 0) plane((BREAKOUT_FIELD.y + r - ball.y) / vy, 0, 1);
    if (vy > 0) {
      const paddleTime = (BREAKOUT_PADDLE.y - r - ball.y) / vy,
        atX = ball.x + vx * paddleTime;
      if (atX >= game.paddle.x - r && atX <= game.paddle.x + game.paddle.width + r)
        plane(paddleTime, 0, -1, 'paddle');
      if (game.shield)
        plane((BREAKOUT_FIELD.y + BREAKOUT_FIELD.height - 24 - r - ball.y) / vy, 0, -1, 'shield');
    }
    for (const brick of game.bricks) {
      if (!brick.hp) continue;
      const hit = sweptBrick(ball.x, ball.y, vx, vy, left, brick.id);
      if (hit) hits.push(hit);
    }
    hits.sort((a, b) => a.time - b.time);
    const hit = hits[0];
    if (!hit) {
      ball.x += vx * left;
      ball.y += vy * left;
      break;
    }
    ball.x += vx * hit.time;
    ball.y += vy * hit.time;
    left -= hit.time;
    if (hit.kind === 'paddle') {
      const offset = clamp(
        (ball.x - game.paddle.x - game.paddle.width / 2) / (game.paddle.width / 2),
        -1,
        1,
      );
      const angle = offset * Math.PI * 0.36,
        magnitude = speed(game);
      ball.vx = clamp(
        Math.sin(angle) * magnitude + game.paddle.velocity * 0.1,
        -magnitude * 0.92,
        magnitude * 0.92,
      );
      ball.vy = -Math.sqrt(Math.max(1, magnitude * magnitude - ball.vx * ball.vx));
      game.combo = 0;
      game.events.bounce++;
    } else {
      if (hit.nx) ball.vx = -ball.vx;
      if (hit.ny) ball.vy = -ball.vy;
      if (hit.kind === 'brick') hitBrick(game, hit.brick!);
      else {
        game.events.bounce++;
        if (hit.kind === 'shield') game.shield = false;
      }
    }
    ball.x += hit.nx * EPSILON;
    ball.y += hit.ny * EPSILON;
  }
  if (game.status === 'playing' && ball.y - r > BREAKOUT_FIELD.y + BREAKOUT_FIELD.height)
    loseBall(game);
}
function pickupStep(game: BreakoutGame) {
  for (const pickup of game.pickups) {
    if (!pickup.active) continue;
    pickup.y += (185 * STEP_US) / 1e6;
    pickup.ageUs += STEP_US;
    if (
      pickup.y + 14 >= BREAKOUT_PADDLE.y &&
      pickup.y - 14 <= BREAKOUT_PADDLE.y + BREAKOUT_PADDLE.height &&
      pickup.x + 14 >= game.paddle.x &&
      pickup.x - 14 <= game.paddle.x + game.paddle.width
    ) {
      pickup.active = false;
      game.events.power++;
      game.score += 25;
      if (pickup.kind === 'wide') game.wideUntilUs = game.elapsedUs + 12_000_000;
      else if (pickup.kind === 'slow') game.slowUntilUs = game.elapsedUs + 10_000_000;
      else game.shield = true;
    } else if (pickup.y > 940 || pickup.ageUs > 8_000_000) pickup.active = false;
  }
}
function step(game: BreakoutGame) {
  if (game.status === 'paused' || game.status === 'game-over' || game.status === 'won') return;
  if (game.status !== 'ready') game.elapsedUs += STEP_US;
  paddleStep(game);
  if (game.status === 'level-clear') {
    if (game.nextLevelAtUs !== null && game.elapsedUs >= game.nextLevelAtUs) {
      game.level++;
      game.bricks = levelBricks(game.level);
      game.status = 'serve';
      game.hits = 0;
      game.nextLevelAtUs = null;
      game.wideUntilUs = 0;
      game.slowUntilUs = 0;
      game.shield = false;
      park(game);
    }
  } else if (game.status === 'playing') {
    ballStep(game);
    pickupStep(game);
    game.trailUs += STEP_US;
    if (game.trailUs >= 24000) {
      game.trailUs -= 24000;
      game.trail.unshift({ x: game.ball.x, y: game.ball.y });
      game.trail.length = 4;
    }
  }
  game.revision++;
}
function moveTo(game: BreakoutGame, atMs: number) {
  const target = Number.isFinite(atMs)
    ? Math.max(game.timeUs, Math.round(atMs * 1000))
    : game.timeUs;
  const delta = target - game.timeUs;
  game.timeUs = target;
  if (game.status === 'paused' || game.status === 'game-over' || game.status === 'won') return;
  // A loaded ready screen has no simulation clock. In particular, loading late in an existing
  // preview session must not replay minutes of idle physics before the first user gesture.
  if (game.status === 'ready' && game.input.left === game.input.right) {
    paddleStep(game);
    game.remainderUs = 0;
    return;
  }
  game.remainderUs += delta;
  while (game.remainderUs >= STEP_US) {
    game.remainderUs -= STEP_US;
    step(game);
    if (['game-over', 'won'].includes(game.status)) {
      game.remainderUs = 0;
      break;
    }
  }
}
export function breakoutNextWakeMs(game: BreakoutGame): number | null {
  return ['paused', 'game-over', 'won'].includes(game.status) ? null : game.timeUs / 1000 + 16;
}
function result(game: BreakoutGame, revision: number): BreakoutUpdate {
  return { game, changed: game.revision !== revision, nextWakeMs: breakoutNextWakeMs(game) };
}
export function advanceBreakoutGame(previous: BreakoutGame, atMs: number): BreakoutUpdate {
  const game = copy(previous);
  moveTo(game, atMs);
  return result(game, previous.revision);
}
export function setBreakoutPointer(
  previous: BreakoutGame,
  x: number | null,
  atMs: number,
): BreakoutUpdate {
  const game = copy(previous);
  moveTo(game, atMs);
  game.input.pointerX = x !== null && Number.isFinite(x) ? clamp(x, 120, 1440) : null;
  if (game.status === 'ready' || game.status === 'serve') paddleStep(game);
  return result(game, previous.revision);
}
export function applyBreakoutCommand(
  previous: BreakoutGame,
  command: BreakoutCommand,
  atMs: number,
): BreakoutUpdate {
  let game = copy(previous);
  moveTo(game, atMs);
  if (
    command === 'restart' ||
    ((command === 'start' || command === 'launch') && ['won', 'game-over'].includes(game.status))
  ) {
    const old = game;
    game = createBreakoutGame({ seed: old.seed });
    game.run = old.run + 1;
    game.muted = old.muted;
    game.timeUs = old.timeUs;
    game.events = { ...old.events };
    game.revision = old.revision + 1;
    game.status = 'serve';
    if (command !== 'restart') launch(game);
  } else if (command === 'mute') game.muted = !game.muted;
  else if (command === 'release-inputs') {
    game.input.left = false;
    game.input.right = false;
    game.input.pointerX = null;
  } else if (command === 'pause') {
    if (game.status === 'paused') game.status = game.resumeStatus;
    else if (!['game-over', 'won'].includes(game.status)) {
      game.resumeStatus = game.status;
      game.status = 'paused';
      game.input.left = false;
      game.input.right = false;
      game.input.pointerX = null;
    }
  } else if (command === 'start' || command === 'launch') {
    if (game.status === 'paused') game.status = game.resumeStatus;
    else if (game.status === 'ready' || game.status === 'serve') launch(game);
  } else if (!['paused', 'game-over', 'won'].includes(game.status)) {
    if (command === 'left-down') game.input.left = true;
    if (command === 'left-up') game.input.left = false;
    if (command === 'right-down') game.input.right = true;
    if (command === 'right-up') game.input.right = false;
  }
  game.revision++;
  return result(game, previous.revision);
}
export function projectBreakoutGame(game: BreakoutGame) {
  return {
    bricks: game.bricks.map((brick) => ({
      key: `brick-${brick.id}`,
      ...breakoutBrickBounds(brick.id),
      hp: brick.hp,
      maxHp: brick.maxHp,
    })),
    paddle: { x: game.paddle.x, y: 865, width: game.paddle.width, height: 18 },
    ball: { x: game.ball.x - 10, y: game.ball.y - 10, width: 20, height: 20 },
    trail: game.trail.map((point) => ({ x: point.x - 10, y: point.y - 10, width: 20, height: 20 })),
    pickups: game.pickups.map((pickup) => ({
      x: pickup.x - 14,
      y: pickup.y - 14,
      width: 28,
      height: 28,
      active: pickup.active,
      kind: pickup.kind,
    })),
    stats: {
      status: game.status,
      score: game.score,
      level: game.level,
      lives: game.lives,
      combo: game.combo,
      maxCombo: game.maxCombo,
      elapsedSeconds: Math.floor(game.elapsedUs / 1e6),
      bricksLeft: game.bricks.filter((brick) => brick.hp > 0).length,
      wide: game.elapsedUs < game.wideUntilUs,
      slow: game.elapsedUs < game.slowUntilUs,
      shield: game.shield,
      muted: game.muted,
      run: game.run,
      events: { ...game.events },
    },
  };
}
