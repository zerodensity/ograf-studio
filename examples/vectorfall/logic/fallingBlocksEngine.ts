/** VECTORFALL: original deterministic falling-blocks simulation, independent of DOM and audio. */
export const FALLING_BLOCKS_WIDTH = 10;
export const FALLING_BLOCKS_HEIGHT = 20;
export const FALLING_BLOCKS_HIDDEN_ROWS = 4;
export type FallingBlocksPiece = 1 | 2 | 3 | 4 | 5 | 6 | 7; // I J L O S T Z
export type FallingBlocksStatus = 'ready' | 'playing' | 'paused' | 'clearing' | 'game-over';
export type FallingBlocksGameCommand =
  | 'start'
  | 'restart'
  | 'pause'
  | 'resume'
  | 'toggle-pause'
  | 'left-down'
  | 'left-up'
  | 'right-down'
  | 'right-up'
  | 'soft-down'
  | 'soft-up'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'hard-drop'
  | 'hold'
  | 'mute'
  | 'release-inputs'
  | 'release-controls';
export interface FallingBlocksOptions {
  seed?: number;
  gravityMs?: number;
  dasMs?: number;
  arrMs?: number;
  softDropMs?: number;
  lockDelayMs?: number;
  maxLockResets?: number;
  clearDelayMs?: number;
  startLevel?: number;
}
export interface FallingBlocksActivePiece {
  kind: FallingBlocksPiece;
  rotation: number;
  x: number;
  y: number;
}
export interface FallingBlocksEvents {
  move: number;
  rotate: number;
  drop: number;
  lock: number;
  clear: number;
  level: number;
  gameOver: number;
}
export interface FallingBlocksGame {
  version: 1;
  options: Required<FallingBlocksOptions>;
  status: FallingBlocksStatus;
  resumeStatus: 'playing' | 'clearing';
  /** Four hidden spawn rows followed by twenty visible rows. */
  board: number[][];
  active: FallingBlocksActivePiece | null;
  hold: FallingBlocksPiece | null;
  holdUsed: boolean;
  queue: FallingBlocksPiece[];
  rng: number;
  /** Absolute caller clock and active simulation clock, in integer microseconds. */
  timeUs: number;
  elapsedUs: number;
  gravityAtUs: number | null;
  lockAtUs: number | null;
  lockResets: number;
  touchedGround: boolean;
  clearAtUs: number | null;
  clearStartUs: number | null;
  clearRows: number[];
  input: {
    left: boolean;
    right: boolean;
    soft: boolean;
    direction: -1 | 0 | 1;
    repeatAtUs: number | null;
  };
  score: number;
  lines: number;
  level: number;
  piecesLocked: number;
  lastClearCount: number;
  run: number;
  muted: boolean;
  revision: number;
  events: FallingBlocksEvents;
}
export interface FallingBlocksProjection {
  /** 0 empty; 1..7 active/locked I J L O S T Z; 8..14 their ghost cells. */
  boardRows: number[][];
  stats: {
    status: FallingBlocksStatus;
    score: number;
    lines: number;
    level: number;
    elapsedMs: number;
    elapsedSeconds: number;
    piecesLocked: number;
    lastClearCount: number;
    activePiece: number;
    holdPiece: number;
    canHold: boolean;
    nextPieces: FallingBlocksPiece[];
    holdCells: number[];
    nextCells: number[][];
    clearingRows: number[];
    flashOn: boolean;
    muted: boolean;
    run: number;
    events: FallingBlocksEvents;
  };
}
export interface FallingBlocksUpdate {
  game: FallingBlocksGame;
  changed: boolean;
  nextWakeMs: number | null;
}

type Cell = readonly [number, number];
const SHAPES: Record<FallingBlocksPiece, readonly Cell[]> = {
  1: [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ],
  2: [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  3: [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  4: [
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 1],
  ],
  5: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  6: [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  7: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
};
// SRS offsets are factual rotation data, expressed here with positive Y upwards.
// Reference: https://tetris.wiki/Super_Rotation_System (not copied implementation code).
const STANDARD_KICKS: Record<string, readonly Cell[]> = {
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};
const I_KICKS: Record<string, readonly Cell[]> = {
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};
const TOTAL_ROWS = FALLING_BLOCKS_HEIGHT + FALLING_BLOCKS_HIDDEN_ROWS;
const SCORE = [0, 100, 300, 500, 800];
const microseconds = (milliseconds: number) => Math.round(milliseconds * 1000);
const emptyInput = (): FallingBlocksGame['input'] => ({
  left: false,
  right: false,
  soft: false,
  direction: 0,
  repeatAtUs: null,
});
const emptyBoard = () => Array.from({ length: TOTAL_ROWS }, () => Array<number>(10).fill(0));
function option(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  integer = false,
) {
  const selected = value ?? fallback;
  if (
    !Number.isFinite(selected) ||
    selected < min ||
    selected > max ||
    (integer && !Number.isInteger(selected))
  )
    throw new RangeError(
      `Game option must be ${integer ? 'an integer ' : ''}from ${min} to ${max}.`,
    );
  return selected;
}
function normalize(options: FallingBlocksOptions): Required<FallingBlocksOptions> {
  const seed = option(options.seed, 0x56454354, 0, 0xffffffff, true) >>> 0;
  return {
    seed,
    gravityMs: option(options.gravityMs, 1000, 1, 60000),
    dasMs: option(options.dasMs, 150, 0, 2000),
    arrMs: option(options.arrMs, 40, 1, 1000),
    softDropMs: option(options.softDropMs, 35, 1, 1000),
    lockDelayMs: option(options.lockDelayMs, 500, 0, 5000),
    maxLockResets: option(options.maxLockResets, 15, 0, 100, true),
    clearDelayMs: option(options.clearDelayMs, 150, 0, 2000),
    startLevel: option(options.startLevel, 1, 1, 99, true),
  };
}
function random(game: FallingBlocksGame): number {
  // A fixed uint32 generator keeps bags identical in every renderer and frame-rate setting.
  game.rng = (Math.imul(game.rng, 1664525) + 1013904223) >>> 0;
  return game.rng / 0x100000000;
}
function refill(game: FallingBlocksGame) {
  while (game.queue.length < 7) {
    const bag: FallingBlocksPiece[] = [1, 2, 3, 4, 5, 6, 7];
    for (let index = bag.length - 1; index > 0; index--) {
      const other = Math.floor(random(game) * (index + 1));
      [bag[index], bag[other]] = [bag[other]!, bag[index]!];
    }
    game.queue.push(...bag);
  }
}
export function createFallingBlocksGame(options: FallingBlocksOptions = {}): FallingBlocksGame {
  const config = normalize(options);
  const game: FallingBlocksGame = {
    version: 1,
    options: config,
    status: 'ready',
    resumeStatus: 'playing',
    board: emptyBoard(),
    active: null,
    hold: null,
    holdUsed: false,
    queue: [],
    rng: config.seed,
    timeUs: 0,
    elapsedUs: 0,
    gravityAtUs: null,
    lockAtUs: null,
    lockResets: 0,
    touchedGround: false,
    clearAtUs: null,
    clearStartUs: null,
    clearRows: [],
    input: emptyInput(),
    score: 0,
    lines: 0,
    level: config.startLevel,
    piecesLocked: 0,
    lastClearCount: 0,
    run: 0,
    muted: false,
    revision: 0,
    events: { move: 0, rotate: 0, drop: 0, lock: 0, clear: 0, level: 0, gameOver: 0 },
  };
  refill(game);
  return game;
}
function copy(game: FallingBlocksGame): FallingBlocksGame {
  return {
    ...game,
    options: { ...game.options },
    board: game.board.map((row) => [...row]),
    active: game.active ? { ...game.active } : null,
    queue: [...game.queue],
    clearRows: [...game.clearRows],
    input: { ...game.input },
    events: { ...game.events },
  };
}
export function fallingBlocksPieceCells(piece: FallingBlocksActivePiece): Cell[] {
  let cells = SHAPES[piece.kind].map(([x, y]) => [x, y] as Cell);
  if (piece.kind !== 4) {
    const extent = piece.kind === 1 ? 3 : 2;
    for (let turn = 0; turn < piece.rotation; turn++)
      cells = cells.map(([x, y]) => [extent - y, x]);
  }
  return cells.map(([x, y]) => [piece.x + x, piece.y + y]);
}
function collides(game: FallingBlocksGame, piece: FallingBlocksActivePiece): boolean {
  return fallingBlocksPieceCells(piece).some(
    ([x, y]) =>
      x < 0 ||
      x >= 10 ||
      y < -FALLING_BLOCKS_HIDDEN_ROWS ||
      y >= 20 ||
      game.board[y + FALLING_BLOCKS_HIDDEN_ROWS]![x] !== 0,
  );
}
function grounded(game: FallingBlocksGame): boolean {
  return !!game.active && collides(game, { ...game.active, y: game.active.y + 1 });
}
function gravityUs(game: FallingBlocksGame): number {
  const level = Math.min(20, game.level) - 1;
  const milliseconds = Math.max(20, game.options.gravityMs * Math.pow(0.8 - level * 0.007, level));
  return microseconds(
    game.input.soft ? Math.min(milliseconds, game.options.softDropMs) : milliseconds,
  );
}
function groundChanged(game: FallingBlocksGame, reset: boolean, wasGrounded: boolean) {
  const resetAllowed = reset && wasGrounded && game.lockResets < game.options.maxLockResets;
  if (resetAllowed) game.lockResets++;
  if (!grounded(game)) {
    game.lockAtUs = null;
    return;
  }
  if (game.lockAtUs === null) {
    game.lockAtUs =
      game.elapsedUs +
      (game.touchedGround && game.lockResets >= game.options.maxLockResets
        ? 0
        : microseconds(game.options.lockDelayMs));
    game.touchedGround = true;
  } else if (resetAllowed) {
    game.lockAtUs = game.elapsedUs + microseconds(game.options.lockDelayMs);
  }
}
function gameOver(game: FallingBlocksGame) {
  game.status = 'game-over';
  game.active = null;
  game.input = emptyInput();
  game.gravityAtUs = null;
  game.lockAtUs = null;
  game.clearAtUs = null;
  game.events.gameOver++;
  game.revision++;
}
function spawn(game: FallingBlocksGame, kind?: FallingBlocksPiece) {
  refill(game);
  game.active = { kind: kind ?? game.queue.shift()!, rotation: 0, x: 3, y: -1 };
  refill(game);
  game.lockAtUs = null;
  game.lockResets = 0;
  game.touchedGround = false;
  game.gravityAtUs = game.elapsedUs + gravityUs(game);
  if (game.input.direction)
    game.input.repeatAtUs = Math.max(
      game.elapsedUs,
      game.input.repeatAtUs ?? game.elapsedUs + microseconds(game.options.dasMs),
    );
  game.revision++;
  if (collides(game, game.active)) {
    gameOver(game);
    return;
  }
  groundChanged(game, false, false);
}
function finishClear(game: FallingBlocksGame) {
  const count = game.clearRows.length;
  const remove = new Set(game.clearRows);
  game.board = [
    ...Array.from({ length: count }, () => Array<number>(10).fill(0)),
    ...game.board.filter((_row, index) => !remove.has(index)),
  ];
  game.score += (SCORE[count] ?? 0) * game.level;
  game.lines += count;
  const nextLevel = game.options.startLevel + Math.floor(game.lines / 10);
  game.events.level += Math.max(0, nextLevel - game.level);
  game.level = nextLevel;
  game.clearRows = [];
  game.clearAtUs = null;
  game.clearStartUs = null;
  game.status = 'playing';
  game.holdUsed = false;
  spawn(game);
}
function lock(game: FallingBlocksGame) {
  if (!game.active) return;
  const cells = fallingBlocksPieceCells(game.active),
    kind = game.active.kind;
  for (const [x, y] of cells) game.board[y + FALLING_BLOCKS_HIDDEN_ROWS]![x] = kind;
  game.events.lock++;
  game.piecesLocked++;
  game.revision++;
  game.active = null;
  game.lockAtUs = null;
  game.gravityAtUs = null;
  // VECTORFALL ends when a piece locks above the visible field, or its next spawn is blocked.
  if (cells.some(([, y]) => y < 0)) {
    gameOver(game);
    return;
  }
  game.clearRows = game.board.flatMap((row, index) =>
    index >= FALLING_BLOCKS_HIDDEN_ROWS && row.every(Boolean) ? [index] : [],
  );
  game.lastClearCount = game.clearRows.length;
  if (game.clearRows.length) {
    game.status = 'clearing';
    game.clearStartUs = game.elapsedUs;
    game.clearAtUs = game.elapsedUs + microseconds(game.options.clearDelayMs);
    game.events.clear++;
    if (game.options.clearDelayMs === 0) finishClear(game);
  } else {
    game.holdUsed = false;
    spawn(game);
  }
}
function horizontal(game: FallingBlocksGame, direction: -1 | 1): boolean {
  if (!game.active) return false;
  const before = grounded(game),
    next = { ...game.active, x: game.active.x + direction };
  if (collides(game, next)) return false;
  game.active = next;
  game.events.move++;
  game.revision++;
  groundChanged(game, true, before);
  return true;
}
function down(game: FallingBlocksGame): boolean {
  if (!game.active) return false;
  const next = { ...game.active, y: game.active.y + 1 };
  if (collides(game, next)) {
    groundChanged(game, false, true);
    return false;
  }
  game.active = next;
  if (game.input.soft) game.score++;
  game.revision++;
  groundChanged(game, false, false);
  return true;
}
function rotate(game: FallingBlocksGame, direction: -1 | 1) {
  if (!game.active) return;
  const before = grounded(game),
    rotation = (game.active.rotation + direction + 4) % 4;
  const offsets =
    game.active.kind === 4
      ? [[0, 0] as Cell]
      : (game.active.kind === 1 ? I_KICKS : STANDARD_KICKS)[`${game.active.rotation}>${rotation}`]!;
  for (const [x, yUp] of offsets) {
    const next = { ...game.active, rotation, x: game.active.x + x, y: game.active.y - yUp };
    if (!collides(game, next)) {
      game.active = next;
      game.events.rotate++;
      game.revision++;
      groundChanged(game, true, before);
      return;
    }
  }
}
function ghost(game: FallingBlocksGame): FallingBlocksActivePiece | null {
  if (!game.active) return null;
  let piece = { ...game.active };
  while (!collides(game, { ...piece, y: piece.y + 1 })) piece = { ...piece, y: piece.y + 1 };
  return piece;
}
function nextEvent(game: FallingBlocksGame, includeBlockedRepeat = true): number | null {
  if (game.status === 'clearing') return game.clearAtUs;
  if (game.status !== 'playing') return null;
  const canRepeat =
    game.input.direction !== 0 &&
    (includeBlockedRepeat ||
      (!!game.active &&
        !collides(game, { ...game.active, x: game.active.x + game.input.direction })));
  const values = [game.gravityAtUs, game.lockAtUs, canRepeat ? game.input.repeatAtUs : null].filter(
    (value): value is number => value !== null,
  );
  return values.length ? Math.max(game.elapsedUs, Math.min(...values)) : null;
}
function flashOn(game: FallingBlocksGame): boolean {
  return (
    game.clearStartUs !== null &&
    Math.floor((game.elapsedUs - game.clearStartUs) / 50_000) % 2 === 0
  );
}
export function fallingBlocksNextWakeMs(game: FallingBlocksGame): number | null {
  if (game.status !== 'playing' && game.status !== 'clearing') return null;
  const candidates = [
    nextEvent(game, false) ?? Number.MAX_SAFE_INTEGER,
    (Math.floor(game.elapsedUs / 1_000_000) + 1) * 1_000_000,
  ];
  if (game.status === 'clearing' && game.clearStartUs !== null)
    candidates.push(
      game.clearStartUs + (Math.floor((game.elapsedUs - game.clearStartUs) / 50_000) + 1) * 50_000,
    );
  return (game.timeUs + Math.max(0, Math.min(...candidates) - game.elapsedUs)) / 1000;
}
function finishUpdate(before: FallingBlocksGame, game: FallingBlocksGame): FallingBlocksUpdate {
  const changed =
    game.revision !== before.revision ||
    Math.floor(game.elapsedUs / 1_000_000) !== Math.floor(before.elapsedUs / 1_000_000) ||
    flashOn(game) !== flashOn(before);
  return { game, changed, nextWakeMs: fallingBlocksNextWakeMs(game) };
}
function releaseInputs(game: FallingBlocksGame) {
  const wasSoft = game.input.soft;
  game.input = emptyInput();
  if (wasSoft && game.status === 'playing') game.gravityAtUs = game.elapsedUs + gravityUs(game);
}
/** elapsedMs is the absolute monotonic controller clock, not a frame delta. */
export function advanceFallingBlocksGame(
  before: FallingBlocksGame,
  elapsedMs: number,
): FallingBlocksUpdate {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > Number.MAX_SAFE_INTEGER / 1000)
    throw new RangeError('Game time must be a finite nonnegative millisecond timestamp.');
  const timeUs = microseconds(elapsedMs);
  if (timeUs < before.timeUs)
    throw new RangeError('Game time cannot run backward; restart and replay commands to seek.');
  const game = copy(before),
    delta = timeUs - game.timeUs;
  game.timeUs = timeUs;
  if (game.status !== 'playing' && game.status !== 'clearing') return finishUpdate(before, game);
  const target = game.elapsedUs + delta;
  let visits = 0;
  for (;;) {
    const deadline = nextEvent(game);
    if (deadline === null || deadline > target) break;
    if (++visits > 1_000_000) throw new RangeError('Advance the game in smaller time intervals.');
    game.elapsedUs = deadline;
    if (game.status === 'clearing') {
      finishClear(game);
      continue;
    }
    if (game.lockAtUs !== null && game.lockAtUs <= deadline && grounded(game)) {
      lock(game);
      continue;
    }
    if (
      game.input.direction &&
      game.input.repeatAtUs !== null &&
      game.input.repeatAtUs <= deadline
    ) {
      const moved = horizontal(game, game.input.direction);
      const repeat = microseconds(game.options.arrMs);
      game.input.repeatAtUs = deadline + repeat;
      if (!moved) {
        const until = Math.min(target, game.gravityAtUs ?? target, game.lockAtUs ?? target);
        game.input.repeatAtUs +=
          Math.max(0, Math.floor((until - game.input.repeatAtUs) / repeat)) * repeat;
      }
    }
    if (game.gravityAtUs !== null && game.gravityAtUs <= deadline) {
      down(game);
      game.gravityAtUs = deadline + gravityUs(game);
    }
  }
  if (game.status === 'playing' || game.status === 'clearing') game.elapsedUs = target;
  return finishUpdate(before, game);
}

/** Commands are edges. Duplicate held-key downs are ignored; repeat belongs to the engine. */
export function applyFallingBlocksCommand(
  before: FallingBlocksGame,
  command: FallingBlocksGameCommand,
  elapsedMs: number,
): FallingBlocksUpdate {
  const advanced = advanceFallingBlocksGame(before, elapsedMs);
  let game = advanced.game;
  if (command === 'mute') {
    game.muted = !game.muted;
    game.revision++;
    return finishUpdate(before, game);
  }
  if (command === 'release-inputs' || command === 'release-controls') {
    releaseInputs(game);
    return finishUpdate(before, game);
  }
  if (command === 'restart' || (command === 'start' && game.status === 'game-over')) {
    const previous = game;
    game = createFallingBlocksGame(previous.options);
    game.timeUs = previous.timeUs;
    game.run = previous.run + 1;
    game.events = { ...previous.events };
    game.muted = previous.muted;
    game.revision = previous.revision + 1;
    game.status = 'playing';
    spawn(game);
    return finishUpdate(before, game);
  }
  if (
    command === 'pause' ||
    command === 'toggle-pause' ||
    command === 'resume' ||
    (command === 'start' && game.status === 'paused')
  ) {
    if (game.status === 'paused') {
      game.status = game.resumeStatus;
      game.revision++;
    } else if (
      command !== 'resume' &&
      command !== 'start' &&
      (game.status === 'playing' || game.status === 'clearing')
    ) {
      game.resumeStatus = game.status;
      releaseInputs(game);
      game.status = 'paused';
      game.revision++;
    }
    return finishUpdate(before, game);
  }
  if (command === 'start' && game.status === 'ready') {
    game.status = 'playing';
    game.run++;
    spawn(game);
    return finishUpdate(before, game);
  }
  if (game.status !== 'playing' && game.status !== 'clearing') return finishUpdate(before, game);
  if (command === 'left-up' || command === 'right-up') {
    const direction = command === 'left-up' ? -1 : 1;
    if (direction === -1) game.input.left = false;
    else game.input.right = false;
    if (game.input.direction === direction) {
      game.input.direction =
        direction === -1 ? (game.input.right ? 1 : 0) : game.input.left ? -1 : 0;
      game.input.repeatAtUs = game.input.direction
        ? game.elapsedUs + microseconds(game.options.dasMs)
        : null;
      if (game.status === 'playing' && game.input.direction) horizontal(game, game.input.direction);
    }
  } else if (command === 'left-down' || command === 'right-down') {
    const direction = command === 'left-down' ? -1 : 1,
      held = direction === -1 ? game.input.left : game.input.right;
    if (!held) {
      if (direction === -1) game.input.left = true;
      else game.input.right = true;
      game.input.direction = direction;
      game.input.repeatAtUs = game.elapsedUs + microseconds(game.options.dasMs);
      if (game.status === 'playing') horizontal(game, direction);
    }
  } else if (command === 'soft-up') {
    if (game.input.soft) {
      game.input.soft = false;
      if (game.status === 'playing') game.gravityAtUs = game.elapsedUs + gravityUs(game);
    }
  } else if (command === 'soft-down') {
    if (!game.input.soft) {
      game.input.soft = true;
      if (game.status === 'playing') {
        down(game);
        game.gravityAtUs = game.elapsedUs + gravityUs(game);
      }
    }
  } else if (game.status === 'playing') {
    if (command === 'rotate-cw' || command === 'rotate-ccw')
      rotate(game, command === 'rotate-cw' ? 1 : -1);
    else if (command === 'hard-drop' && game.active) {
      const target = ghost(game)!;
      game.score += (target.y - game.active.y) * 2;
      game.active = target;
      game.events.drop++;
      lock(game);
    } else if (command === 'hold' && game.active && !game.holdUsed) {
      const previous = game.hold;
      game.hold = game.active.kind;
      game.holdUsed = true;
      spawn(game, previous ?? undefined);
    }
  }
  return finishUpdate(before, game);
}
function previewCells(kind: FallingBlocksPiece | null): number[] {
  const cells = Array<number>(16).fill(0);
  if (kind) for (const [x, y] of SHAPES[kind]) cells[y * 4 + x] = kind;
  return cells;
}
export function projectFallingBlocksGame(game: FallingBlocksGame): FallingBlocksProjection {
  const boardRows = game.board.slice(FALLING_BLOCKS_HIDDEN_ROWS).map((row) => [...row]);
  const paint = (piece: FallingBlocksActivePiece | null, code: number, emptyOnly = false) => {
    if (!piece) return;
    for (const [x, y] of fallingBlocksPieceCells(piece))
      if (y >= 0 && y < 20 && x >= 0 && x < 10 && (!emptyOnly || boardRows[y]![x] === 0))
        boardRows[y]![x] = code;
  };
  const landing = ghost(game);
  if (landing && game.active && landing.y !== game.active.y) paint(landing, landing.kind + 7, true);
  if (game.active) paint(game.active, game.active.kind);
  const clearingRows = game.clearRows.map((row) => row - FALLING_BLOCKS_HIDDEN_ROWS);
  const flashing = flashOn(game);
  if (
    (game.status === 'clearing' ||
      (game.status === 'paused' && game.resumeStatus === 'clearing')) &&
    !flashing
  )
    for (const row of clearingRows) boardRows[row] = Array<number>(10).fill(0);
  const elapsedSeconds = Math.floor(game.elapsedUs / 1_000_000);
  return {
    boardRows,
    stats: {
      status: game.status,
      score: game.score,
      lines: game.lines,
      level: game.level,
      elapsedMs: elapsedSeconds * 1000,
      elapsedSeconds,
      piecesLocked: game.piecesLocked,
      lastClearCount: game.lastClearCount,
      activePiece: game.active?.kind ?? 0,
      holdPiece: game.hold ?? 0,
      canHold: game.status === 'playing' && !!game.active && !game.holdUsed,
      nextPieces: game.queue.slice(0, 5),
      holdCells: previewCells(game.hold),
      nextCells: game.queue.slice(0, 5).map(previewCells),
      clearingRows,
      flashOn: flashing,
      muted: game.muted,
      run: game.run,
      events: { ...game.events },
    },
  };
}
