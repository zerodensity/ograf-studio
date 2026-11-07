import {
  advanceFallingBlocksGame,
  applyFallingBlocksCommand,
  createFallingBlocksGame,
  fallingBlocksNextWakeMs,
  projectFallingBlocksGame,
  type FallingBlocksEvents,
  type FallingBlocksGame,
  type FallingBlocksGameCommand,
  type FallingBlocksStatus,
} from './fallingBlocksEngine';

export interface VectorfallContext {
  state: unknown;
  data: { settings?: unknown };
  event: {
    type: 'load' | 'play' | 'out' | 'data' | 'blur' | 'tick' | 'custom-action';
    actionId?: string;
    payload?: unknown;
  };
  nowMs: number;
}
interface GameFunctionState {
  version: 1;
  game: FallingBlocksGame;
  lastEvents: FallingBlocksEvents;
  lastStatus: FallingBlocksStatus;
  bestScore: number;
  settingsSignature: string;
  musicState: 'stopped' | 'playing' | 'paused';
}
interface MediaCommand {
  name: string;
  command: 'play' | 'restart' | 'pause' | 'resume' | 'stop' | 'controls';
  gain?: number;
  muted?: boolean;
}
export interface VectorfallResult {
  state: GameFunctionState;
  data: { board: Record<string, string>[]; stats: Record<string, unknown> };
  actions: Array<{
    name: string;
    payload: { count: number; score: number; lines: number; level: number };
  }>;
  media: MediaCommand[];
  wakeAt: number | null;
}
const DEFAULT_SEED = 0x56454354;
const DEFAULT_PALETTE = {
  empty: '#081424',
  I: '#40dff8',
  J: '#5d87ff',
  L: '#ffb04a',
  O: '#ffe169',
  S: '#4be3a6',
  T: '#b18cff',
  Z: '#ff657d',
  ghost: '#243b58',
};
const EFFECTS = ['move', 'rotate', 'drop', 'lock', 'clear', 'level', 'gameOver'] as const;
const PUBLIC_COMMANDS = new Set<FallingBlocksGameCommand>([
  'start',
  'restart',
  'pause',
  'left-down',
  'left-up',
  'right-down',
  'right-up',
  'soft-down',
  'soft-up',
  'rotate-cw',
  'rotate-ccw',
  'hard-drop',
  'hold',
  'mute',
]);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function settings(value: unknown) {
  const source = object(value),
    colors = object(source.palette);
  const gain = (key: string, fallback: number) =>
    typeof source[key] === 'number' && Number.isFinite(source[key])
      ? Math.max(0, Math.min(1, source[key]))
      : fallback;
  const palette = { ...DEFAULT_PALETTE };
  for (const key of Object.keys(palette) as Array<keyof typeof palette>) {
    const color = colors[key];
    if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))
      palette[key] = color.toLowerCase();
  }
  return {
    palette,
    ghost: source.ghost !== false,
    musicGain: gain('musicGain', 0.18),
    sfxGain: gain('sfxGain', 0.45),
    seed:
      typeof source.seed === 'number' &&
      Number.isInteger(source.seed) &&
      source.seed >= 0 &&
      source.seed <= 0xffffffff
        ? source.seed
        : DEFAULT_SEED,
  };
}
function stateFrom(value: unknown): GameFunctionState | null {
  const saved = object(value),
    game = object(saved.game),
    events = object(saved.lastEvents);
  if (
    saved.version !== 1 ||
    game.version !== 1 ||
    !Array.isArray(game.board) ||
    game.board.length !== 24 ||
    EFFECTS.some((name) => typeof events[name] !== 'number' || !Number.isFinite(events[name])) ||
    typeof saved.bestScore !== 'number' ||
    !Number.isFinite(saved.bestScore) ||
    !['stopped', 'playing', 'paused'].includes(String(saved.musicState))
  )
    return null;
  return saved as unknown as GameFunctionState;
}
function fresh(seed: number, at: number, previous: GameFunctionState | null): GameFunctionState {
  const game = advanceFallingBlocksGame(createFallingBlocksGame({ seed }), at).game;
  return {
    version: 1,
    game,
    lastEvents: { ...game.events },
    lastStatus: game.status,
    bestScore: Math.max(0, previous?.bestScore ?? 0),
    settingsSignature: '',
    musicState: 'stopped',
  };
}

/** Editable template logic. The build helper embeds this function and the pure engine in one expression. */
export default function vectorfall(ctx: VectorfallContext): VectorfallResult {
  const config = settings(ctx.data?.settings);
  const previous = stateFrom(ctx.state);
  const now = Math.max(
    0,
    Number.isFinite(ctx.nowMs) ? ctx.nowMs : 0,
    previous ? previous.game.timeUs / 1000 : 0,
  );
  const loading = ctx.event.type === 'load' || !previous;
  let state = loading
    ? fresh(config.seed, now, previous)
    : { ...previous!, lastEvents: { ...previous!.lastEvents } };
  const media: MediaCommand[] = [];
  const actions: VectorfallResult['actions'] = [];
  const signature = JSON.stringify(config);
  if (loading && previous?.musicState !== undefined && previous.musicState !== 'stopped')
    media.push({ name: 'music', command: 'stop' });

  const commandName =
    ctx.event.type === 'custom-action' ? ctx.event.actionId?.replace(/^game\./, '') : undefined;
  const command = PUBLIC_COMMANDS.has(commandName as FallingBlocksGameCommand)
    ? (commandName as FallingBlocksGameCommand)
    : undefined;
  if (!loading) state.game = advanceFallingBlocksGame(state.game, now).game;
  const beforeCommand = state.game.status;

  if (ctx.event.type === 'blur' || ctx.event.type === 'out') {
    state.game = applyFallingBlocksCommand(state.game, 'release-inputs', now).game;
    if (state.game.status === 'playing' || state.game.status === 'clearing')
      state.game = applyFallingBlocksCommand(state.game, 'pause', now).game;
    if (state.musicState !== 'stopped') {
      const action = ctx.event.type === 'out' ? 'stop' : 'pause';
      if (state.musicState === 'playing' || action === 'stop')
        media.push({ name: 'music', command: action });
      state.musicState = action === 'stop' ? 'stopped' : 'paused';
    }
  } else if (command) {
    if (
      command === 'restart' ||
      (command === 'start' && ['ready', 'game-over'].includes(state.game.status))
    ) {
      if (state.game.status === 'ready' && state.game.options.seed !== config.seed) {
        const old = state.game;
        state.game = advanceFallingBlocksGame(
          createFallingBlocksGame({ ...old.options, seed: config.seed }),
          now,
        ).game;
        state.game.events = { ...old.events };
        state.game.run = old.run;
        state.game.muted = old.muted;
      } else state.game = { ...state.game, options: { ...state.game.options, seed: config.seed } };
    }
    state.game = applyFallingBlocksCommand(state.game, command, now).game;
    const active = state.game.status === 'playing' || state.game.status === 'clearing';
    if (
      command === 'restart' ||
      (command === 'start' && active && beforeCommand !== 'playing' && beforeCommand !== 'clearing')
    ) {
      const action =
        beforeCommand === 'paused' && state.musicState === 'paused' && command !== 'restart'
          ? 'resume'
          : 'restart';
      media.push({
        name: 'music',
        command: action,
        gain: config.musicGain,
        muted: state.game.muted,
      });
      state.musicState = 'playing';
    } else if (command === 'pause' && state.game.status !== beforeCommand) {
      if (state.game.status === 'paused' && state.musicState === 'playing') {
        media.push({ name: 'music', command: 'pause' });
        state.musicState = 'paused';
      } else if (active) {
        media.push({
          name: 'music',
          command: state.musicState === 'paused' ? 'resume' : 'restart',
          gain: config.musicGain,
          muted: state.game.muted,
        });
        state.musicState = 'playing';
      }
    }
  }

  if (signature !== state.settingsSignature || command === 'mute') {
    for (const name of ['music', ...EFFECTS])
      media.push({
        name,
        command: 'controls',
        gain: name === 'music' ? config.musicGain : config.sfxGain,
        muted: state.game.muted,
      });
  }
  if (state.game.status === 'game-over' && state.musicState !== 'stopped') {
    media.push({ name: 'music', command: 'stop' });
    state.musicState = 'stopped';
  }
  const silentBoundary =
    loading ||
    ['play', 'out', 'blur'].includes(ctx.event.type) ||
    command === 'restart' ||
    (command === 'start' && beforeCommand === 'game-over');
  if (!silentBoundary) {
    for (const name of EFFECTS) {
      const count = Math.max(0, state.game.events[name] - state.lastEvents[name]);
      if (!count) continue;
      actions.push({
        name,
        payload: {
          count,
          score: state.game.score,
          lines: state.game.lines,
          level: state.game.level,
        },
      });
      if (!state.game.muted)
        media.push({ name, command: 'restart', gain: config.sfxGain, muted: false });
    }
  }
  state = {
    ...state,
    bestScore: Math.max(state.bestScore, state.game.score),
    settingsSignature: signature,
    lastEvents: { ...state.game.events },
    lastStatus: state.game.status,
  };
  const projection = projectFallingBlocksGame(state.game);
  const palette = [
    config.palette.empty,
    config.palette.I,
    config.palette.J,
    config.palette.L,
    config.palette.O,
    config.palette.S,
    config.palette.T,
    config.palette.Z,
  ];
  const color = (cell: number) =>
    cell > 7
      ? config.ghost
        ? config.palette.ghost
        : config.palette.empty
      : (palette[cell] ?? config.palette.empty);
  const previewCells = (cells: readonly number[]) =>
    Object.fromEntries(
      cells.map((cell, index) => [`c${index}`, cell === 0 ? '#00000000' : color(cell)]),
    );
  const seconds = projection.stats.elapsedSeconds;
  const statusText: Record<FallingBlocksStatus, string> = {
    ready: 'READY',
    playing: 'IN PLAY',
    paused: 'PAUSED',
    clearing: 'LINE CLEAR',
    'game-over': 'GAME OVER',
  };
  const data = {
    board: projection.boardRows.map((row) =>
      Object.fromEntries(row.map((cell, index) => [`c${index}`, color(cell)])),
    ),
    stats: {
      ...projection.stats,
      bestScore: state.bestScore,
      statusText: statusText[state.game.status],
      pauseLabel: state.game.status === 'paused' ? 'RESUME' : 'PAUSE',
      muteLabel: state.game.muted ? 'UNMUTE' : 'MUTE',
      timeText: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
      comboText: projection.stats.lastClearCount
        ? `${projection.stats.lastClearCount}-LINE CLEAR`
        : '',
      holdHint: state.game.holdUsed
        ? 'AFTER PIECE LOCKS'
        : state.game.status === 'ready'
          ? 'PRESS START'
          : 'HOLD READY',
      holdCells: previewCells(projection.stats.holdCells),
      nextCells: Object.fromEntries(
        projection.stats.nextCells.map((cells, index) => [`p${index}`, previewCells(cells)]),
      ),
    },
  };
  return { state, data, actions, media, wakeAt: fallingBlocksNextWakeMs(state.game) };
}
