import {
  advanceBreakoutGame,
  applyBreakoutCommand,
  breakoutNextWakeMs,
  createBreakoutGame,
  projectBreakoutGame,
  setBreakoutPointer,
  type BreakoutCommand,
  type BreakoutEvents,
  type BreakoutGame,
  type BreakoutStatus,
} from './breakoutEngine';

export interface BreakoutContext {
  state: unknown;
  data: { settings?: unknown };
  pointer?: { x: number; y: number } | null;
  event: {
    type: 'load' | 'play' | 'out' | 'data' | 'blur' | 'focus' | 'tick' | 'custom-action';
    actionId?: string;
    payload?: unknown;
  };
  nowMs: number;
}
interface FunctionState {
  version: 1;
  game: BreakoutGame;
  lastEvents: BreakoutEvents;
  bestScore: number;
  onAir: boolean;
  focused: boolean;
  settingsSignature: string;
  musicState: 'stopped' | 'playing' | 'paused';
  brickFades: Array<{ id: number; atMs: number }>;
  lastBrickSignature: string;
  lastStatsSignature: string;
}
interface MediaCommand {
  name: string;
  command: 'restart' | 'pause' | 'resume' | 'stop' | 'controls';
  gain?: number;
  muted?: boolean;
}
export interface BreakoutData {
  bricks: Record<string, string | number>[];
  actors: Record<string, Record<string, string | number>>;
  stats: Record<string, unknown>;
}
export interface BreakoutResult {
  state: FunctionState;
  data: Partial<BreakoutData>;
  actions: Array<{
    name: string;
    payload: { count: number; score: number; level: number; lives: number };
  }>;
  media: MediaCommand[];
  wakeAt: number | null;
}
const EFFECTS = [
  'bounce',
  'brick',
  'armor',
  'launch',
  'life',
  'level',
  'gameOver',
  'power',
] as const;
const COMMANDS = new Set<BreakoutCommand>([
  'start',
  'launch',
  'pause',
  'restart',
  'mute',
  'left-down',
  'left-up',
  'right-down',
  'right-up',
]);
export const BREAKOUT_DEFAULT_PALETTE = {
  paddle: '#f0f8ff',
  ball: '#ffffff',
  trail: '#65dfff',
  shield: '#55e9b0',
  row0: '#ff648c',
  row1: '#ff9658',
  row2: '#ffd96a',
  row3: '#5ae4b5',
  row4: '#58c5ff',
  row5: '#a68aff',
  wide: '#55e9b0',
  slow: '#68bfff',
  armor: '#f2f6ff',
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function settings(value: unknown) {
  const source = object(value),
    colors = object(source.palette),
    palette = { ...BREAKOUT_DEFAULT_PALETTE };
  for (const key of Object.keys(palette) as Array<keyof typeof palette>) {
    if (typeof colors[key] === 'string' && /^#[\da-f]{6}$/i.test(colors[key]))
      palette[key] = colors[key].toLowerCase();
  }
  const gain = (key: string, fallback: number) =>
    typeof source[key] === 'number' && Number.isFinite(source[key])
      ? Math.max(0, Math.min(1, source[key]))
      : fallback;
  return {
    palette,
    musicGain: gain('musicGain', 0.35),
    sfxGain: gain('sfxGain', 0.7),
    trail: source.trail !== false,
    seed:
      typeof source.seed === 'number' &&
      Number.isInteger(source.seed) &&
      source.seed >= 0 &&
      source.seed <= 0xffffffff
        ? source.seed
        : 0x42524943,
  };
}
function previousState(value: unknown): FunctionState | null {
  const state = object(value),
    game = object(state.game),
    events = object(state.lastEvents);
  if (
    state.version !== 1 ||
    game.version !== 1 ||
    !Array.isArray(game.bricks) ||
    game.bricks.length !== 72 ||
    !Array.isArray(game.pickups) ||
    game.pickups.length !== 3 ||
    typeof state.bestScore !== 'number' ||
    !Number.isFinite(state.bestScore) ||
    EFFECTS.some((key) => typeof events[key] !== 'number' || !Number.isFinite(events[key]))
  )
    return null;
  return state as unknown as FunctionState;
}
const STATUS: Record<BreakoutStatus, string> = {
  ready: 'READY TO LAUNCH',
  serve: 'READY TO LAUNCH',
  playing: 'IN PLAY',
  paused: 'PAUSED',
  'level-clear': 'LEVEL CLEAR',
  'game-over': 'GAME OVER',
  won: 'ALL LEVELS CLEAR',
};
const LEVEL_NAMES = ['SPECTRUM', 'CROSSCURRENT', 'CORE ARMOR'];

/** The build helper embeds the original simulation into this editable template function. */
export default function breakout(ctx: BreakoutContext): BreakoutResult {
  const config = settings(ctx.data?.settings),
    old = previousState(ctx.state);
  const now = Math.max(
    0,
    Number.isFinite(ctx.nowMs) ? ctx.nowMs : 0,
    old ? old.game.timeUs / 1000 : 0,
  );
  const loading = ctx.event.type === 'load' || !old;
  let state: FunctionState = loading
    ? {
        version: 1,
        game: advanceBreakoutGame(createBreakoutGame({ seed: config.seed }), now).game,
        lastEvents: {
          bounce: 0,
          brick: 0,
          armor: 0,
          launch: 0,
          life: 0,
          level: 0,
          gameOver: 0,
          power: 0,
        },
        bestScore: Math.max(0, old?.bestScore ?? 0),
        onAir: false,
        focused: true,
        settingsSignature: '',
        musicState: 'stopped',
        brickFades: [],
        lastBrickSignature: '',
        lastStatsSignature: '',
      }
    : { ...old!, focused: old!.focused !== false, lastEvents: { ...old!.lastEvents } };
  const media: MediaCommand[] = [],
    actions: BreakoutResult['actions'] = [];
  const signature = JSON.stringify(config);
  const name =
    ctx.event.type === 'custom-action' ? ctx.event.actionId?.replace(/^game\./, '') : undefined;
  const command = COMMANDS.has(name as BreakoutCommand) ? (name as BreakoutCommand) : undefined;
  if (!loading)
    state.game =
      state.focused && ctx.event.type !== 'blur' && ctx.event.type !== 'out'
        ? advanceBreakoutGame(state.game, now).game
        : { ...state.game, timeUs: Math.round(now * 1000) };
  if (ctx.event.type === 'play') state.onAir = true;
  if (
    ctx.event.type === 'focus' ||
    (command && ['start', 'launch', 'restart', 'pause'].includes(command))
  )
    state.focused = true;
  if (state.onAir && state.focused && ctx.event.type !== 'blur' && ctx.event.type !== 'out')
    state.game = setBreakoutPointer(
      state.game,
      ctx.pointer &&
        Number.isFinite(ctx.pointer.x) &&
        Number.isFinite(ctx.pointer.y) &&
        ctx.pointer.x >= 120 &&
        ctx.pointer.x <= 1440 &&
        ctx.pointer.y >= 200 &&
        ctx.pointer.y <= 920
        ? ctx.pointer.x
        : null,
      now,
    ).game;
  if (ctx.event.type === 'blur' || ctx.event.type === 'out') {
    state.focused = false;
    state.game = applyBreakoutCommand(state.game, 'release-inputs', now).game;
    if (state.game.status === 'playing' || state.game.status === 'level-clear')
      state.game = applyBreakoutCommand(state.game, 'pause', now).game;
    if (ctx.event.type === 'out') state.onAir = false;
    if (state.musicState !== 'stopped')
      media.push({ name: 'music', command: ctx.event.type === 'out' ? 'stop' : 'pause' });
    state.musicState =
      ctx.event.type === 'out'
        ? 'stopped'
        : state.musicState === 'playing'
          ? 'paused'
          : state.musicState;
  } else if (command && !loading) {
    if (command === 'restart' && state.game.seed !== config.seed)
      state.game = { ...state.game, seed: config.seed };
    state.game = applyBreakoutCommand(state.game, command, now).game;
    if (state.game.status === 'paused') {
      if (state.musicState === 'playing') media.push({ name: 'music', command: 'pause' });
      if (state.musicState === 'playing') state.musicState = 'paused';
    } else if (
      ['start', 'launch', 'restart', 'pause'].includes(command) &&
      !['won', 'game-over'].includes(state.game.status)
    ) {
      if (command === 'restart' || state.musicState === 'stopped')
        media.push({
          name: 'music',
          command: 'restart',
          gain: config.musicGain,
          muted: state.game.muted,
        });
      else if (state.musicState === 'paused')
        media.push({
          name: 'music',
          command: 'resume',
          gain: config.musicGain,
          muted: state.game.muted,
        });
      state.musicState = 'playing';
    }
  }
  if (state.musicState === 'playing' && ['game-over', 'won'].includes(state.game.status)) {
    media.push({ name: 'music', command: 'stop' });
    state.musicState = 'stopped';
  }
  if (!loading && (signature !== state.settingsSignature || command === 'mute')) {
    media.push({
      name: 'music',
      command: 'controls',
      gain: config.musicGain,
      muted: state.game.muted,
    });
    for (const name of EFFECTS)
      media.push({ name, command: 'controls', gain: config.sfxGain, muted: state.game.muted });
  }
  const effectsAllowed =
    !loading &&
    !['load', 'play', 'out', 'blur', 'focus'].includes(ctx.event.type) &&
    command !== 'restart';
  if (effectsAllowed)
    for (const name of EFFECTS) {
      const count = state.game.events[name] - state.lastEvents[name];
      if (count <= 0) continue;
      actions.push({
        name,
        payload: {
          count,
          score: state.game.score,
          level: state.game.level,
          lives: state.game.lives,
        },
      });
      if (!state.game.muted)
        media.push({ name, command: 'restart', gain: config.sfxGain, muted: false });
    }
  state = {
    ...state,
    bestScore: Math.max(state.bestScore, state.game.score),
    lastEvents: { ...state.game.events },
    settingsSignature: signature,
    brickFades:
      loading ||
      command === 'restart' ||
      ctx.event.type === 'blur' ||
      ctx.event.type === 'out' ||
      old!.game.run !== state.game.run ||
      old!.game.level !== state.game.level
        ? []
        : [
            ...(old!.brickFades ?? []).filter((fade) => now - fade.atMs < 100),
            ...state.game.bricks.flatMap((brick) =>
              old!.game.bricks[brick.id]!.hp > 0 && brick.hp === 0
                ? [{ id: brick.id, atMs: now }]
                : [],
            ),
          ],
  };
  const p = projectBreakoutGame(state.game),
    palette = config.palette;
  const brickSignature = [
    state.game.level,
    state.game.run,
    state.game.bricks.map((brick) => brick.hp).join(''),
    palette.row0,
    palette.row1,
    palette.row2,
    palette.row3,
    palette.row4,
    palette.row5,
    palette.ball,
  ].join('|');
  const publishBricks =
    loading ||
    old!.lastBrickSignature !== brickSignature ||
    state.brickFades.length > 0 ||
    (old!.brickFades?.length ?? 0) > 0;
  const bricks = publishBricks
    ? p.bricks.map((brick, index) => {
        const fade = state.brickFades.find((entry) => entry.id === index);
        const opacity = brick.hp ? 1 : fade ? Math.max(0, 1 - (now - fade.atMs) / 100) : 0;
        const pop = fade ? opacity * 0.06 : 0;
        return {
          ...brick,
          x: brick.x - (brick.width * pop) / 2,
          y: brick.y - (brick.height * pop) / 2,
          width: brick.width * (1 + pop),
          height: brick.height * (1 + pop),
          color: fade ? palette.ball : palette[`row${Math.floor(index / 12)}` as 'row0'],
          opacity,
          armorOpacity: brick.hp > 1 ? 1 : 0,
          label: brick.hp > 1 ? String(brick.hp) : '',
        };
      })
    : undefined;
  const actors: BreakoutData['actors'] = {
    paddle: { ...p.paddle, color: palette.paddle, opacity: 1 },
    ball: {
      ...p.ball,
      color: palette.ball,
      opacity: ['level-clear', 'game-over', 'won'].includes(state.game.status) ? 0 : 1,
    },
    shield: {
      x: 120,
      y: 894,
      width: 1320,
      height: 4,
      color: palette.shield,
      opacity: state.game.shield ? 0.8 : 0,
    },
  };
  for (let index = 0; index < 4; index++)
    actors[`trail${index}`] = {
      ...p.trail[index]!,
      color: palette.trail,
      opacity:
        config.trail &&
        (state.game.status === 'playing' ||
          (state.game.status === 'paused' && state.game.resumeStatus === 'playing'))
          ? (4 - index) * 0.09
          : 0,
    };
  for (let index = 0; index < 3; index++) {
    const pickup = p.pickups[index]!;
    actors[`pickup${index}`] = {
      x: pickup.active ? pickup.x : 120,
      y: pickup.active ? pickup.y : 200,
      width: 28,
      height: 28,
      color: palette[pickup.kind],
      opacity: pickup.active ? 1 : 0,
      label: pickup.kind === 'wide' ? 'W' : pickup.kind === 'slow' ? 'S' : '+',
    };
  }
  const seconds = p.stats.elapsedSeconds;
  const powers = [
    p.stats.wide ? 'WIDE PADDLE' : '',
    p.stats.slow ? 'SLOW BALL' : '',
    p.stats.shield ? 'SHIELD READY' : '',
  ].filter(Boolean);
  const initialBricks = state.game.bricks.filter((brick) => brick.maxHp > 0).length;
  const stats = {
    ...p.stats,
    title: 'PRISM BREAKER',
    statusText: STATUS[state.game.status],
    bestScore: state.bestScore,
    levelName: LEVEL_NAMES[state.game.level - 1]!,
    progress: initialBricks ? 1 - p.stats.bricksLeft / initialBricks : 1,
    progressWidth: 288 * (initialBricks ? 1 - p.stats.bricksLeft / initialBricks : 1),
    progressText: `${Math.round(100 * (initialBricks ? 1 - p.stats.bricksLeft / initialBricks : 1))}% CLEAR`,
    currentLevelLabel: `${String(state.game.level).padStart(2, '0')} / 03`,
    activePowerText: powers.join('  ·  ') || 'COLLECT FALLING POWER-UPS',
    powerRemaining: Math.max(
      0,
      Math.ceil(
        (Math.max(state.game.wideUntilUs, state.game.slowUntilUs) - state.game.elapsedUs) / 1e6,
      ),
    ),
    life0: state.game.lives >= 1 ? 1 : 0.16,
    life1: state.game.lives >= 2 ? 1 : 0.16,
    life2: state.game.lives >= 3 ? 1 : 0.16,
    livesText: Array(state.game.lives).fill('●').join(' '),
    timeText: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
    comboText: state.game.combo > 1 ? `${state.game.combo}× COMBO` : 'BUILD A COMBO',
    pauseLabel: state.game.status === 'paused' ? 'RESUME' : 'PAUSE',
    muteLabel: state.game.muted ? 'UNMUTE' : 'MUTE',
    message:
      state.game.status === 'ready' || state.game.status === 'serve'
        ? 'CLICK OR PRESS SPACE TO LAUNCH'
        : state.game.status === 'paused'
          ? 'PRESS P TO RESUME'
          : state.game.status === 'game-over'
            ? 'PRESS R TO TRY AGAIN'
            : state.game.status === 'won'
              ? 'SPECTRUM COMPLETE — PRESS R TO REPLAY'
              : state.game.status === 'level-clear'
                ? 'NEXT LEVEL INCOMING'
                : 'MOVE MOUSE · ARROW KEYS ALSO WORK',
  };
  // Compact event/clock keys retain no prior 72-brick payload or large serialized snapshots.
  // Only moving actors cross the worker boundary on ordinary animation ticks.
  const statsSignature = [
    p.stats.status,
    p.stats.score,
    state.bestScore,
    p.stats.level,
    p.stats.lives,
    p.stats.combo,
    p.stats.maxCombo,
    p.stats.elapsedSeconds,
    p.stats.bricksLeft,
    p.stats.wide,
    p.stats.slow,
    p.stats.shield,
    p.stats.muted,
    p.stats.run,
    stats.powerRemaining,
    ...EFFECTS.map((event) => p.stats.events[event]),
  ].join('|');
  const publishStats = loading || old!.lastStatsSignature !== statsSignature;
  // Preserve the visible frame during its authored exit. Re-Take publishes the saved waiting
  // or paused state in full; cleared transient fades must not leave stale visible bricks.
  const takingOut = ctx.event.type === 'out';
  state.lastBrickSignature = takingOut ? '' : brickSignature;
  state.lastStatsSignature = takingOut ? '' : statsSignature;
  return {
    state,
    data: takingOut
      ? {}
      : { ...(bricks ? { bricks } : {}), actors, ...(publishStats ? { stats } : {}) },
    actions,
    media,
    wakeAt:
      state.onAir && state.focused
        ? (breakoutNextWakeMs(state.game) ?? (state.brickFades.length ? now + 16 : null))
        : null,
  };
}
