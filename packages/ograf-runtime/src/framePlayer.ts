export interface FramePlayerOptions {
  frameRate: number;
  durationFrames: number;
  renderFrame: (frame: number) => void;
}

export interface FrameTransitionOptions {
  durationMs?: number;
  onUpdate?: () => void;
  onComplete?: () => void;
  onInterrupt?: () => void;
}

export interface FrameTransition {
  cancel(): void;
}

export type FramePlayerEvent = 'update' | 'complete';

interface TransitionState {
  options: FrameTransitionOptions;
  settled: boolean;
}

interface Motion {
  generation: number;
  anchorMs: number;
  lastTimestampMs: number;
  fromFrame: number;
  toFrame: number;
  durationMs: number;
  transition: TransitionState | null;
}

const activePlayers = new Map<FramePlayer, (timestampMs: number) => void>();
const playerOwners = new WeakMap<FramePlayer, Window | null>();
const visibilityListeners = new Map<Document, () => void>();
const moduleWindow = typeof window === 'undefined' ? null : window;
let frameRequest: number | null = null;
let frameOwner: Window | null = null;
let driverGeneration = 0;
let ticking = false;

function clockNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function reconcileDriver(): void {
  if (ticking) return;
  const owners = [
    ...new Set([...activePlayers.keys()].map((player) => playerOwners.get(player) ?? moduleWindow)),
  ].filter((owner): owner is Window => owner !== null && !owner.closed);
  const documents = new Set(owners.map((owner) => owner.document));
  for (const [document, listener] of visibilityListeners) {
    if (documents.has(document)) continue;
    document.removeEventListener('visibilitychange', listener);
    visibilityListeners.delete(document);
  }
  for (const document of documents) {
    if (visibilityListeners.has(document)) continue;
    const listener = () => reconcileDriver();
    document.addEventListener('visibilitychange', listener);
    visibilityListeners.set(document, listener);
  }
  const owner =
    owners.find((candidate) => !candidate.document.hidden) ??
    (moduleWindow && !moduleWindow.closed && !moduleWindow.document.hidden
      ? moduleWindow
      : owners[0]) ??
    null;
  if (frameRequest !== null && (activePlayers.size === 0 || owner !== frameOwner)) {
    if (frameOwner) frameOwner.cancelAnimationFrame(frameRequest);
    else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameRequest);
    frameRequest = null;
    frameOwner = null;
    ++driverGeneration;
  }
  if (activePlayers.size === 0) {
    frameOwner = null;
    return;
  }
  if (frameRequest !== null) return;
  const request = owner
    ? owner.requestAnimationFrame.bind(owner)
    : typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : null;
  if (!request) return;
  const generation = ++driverGeneration;
  frameOwner = owner;
  frameRequest = request(() => {
    if (generation !== driverGeneration) return;
    frameRequest = null;
    // A detached window's RAF timestamp has a different time origin. Keep one module clock.
    tickFramePlayers();
  });
}

/** Advance every active player once; visible detached windows can drive the shared module clock. */
export function tickFramePlayers(timestampMs = clockNow()): void {
  if (!Number.isFinite(timestampMs)) throw new RangeError('Player timestamps must be finite.');
  if (ticking) return;
  ticking = true;
  let failed = false;
  let failure: unknown;
  try {
    for (const [player, advance] of [...activePlayers]) {
      if (activePlayers.get(player) !== advance) continue;
      try {
        advance(timestampMs);
      } catch (cause) {
        // One failing renderer must not leave unrelated players or their driver stranded.
        if (!failed) failure = cause;
        failed = true;
      }
    }
  } finally {
    ticking = false;
    reconcileDriver();
  }
  if (failed) throw failure;
}

/** Owns only playhead transport. Scene sampling and DOM rendering remain deterministic callers. */
export class FramePlayer {
  readonly #frameRate: number;
  readonly #duration: number;
  readonly #renderFrame: (frame: number) => void;
  #frame = 0;
  #generation = 0;
  #disposed = false;
  #motion: Motion | null = null;
  #completedAtEnd = false;
  #events: Record<FramePlayerEvent, (() => void) | null> = { update: null, complete: null };

  constructor(options: FramePlayerOptions) {
    if (!Number.isFinite(options.frameRate) || options.frameRate <= 0)
      throw new RangeError('A player frame rate must be positive and finite.');
    if (!Number.isFinite(options.durationFrames) || options.durationFrames < 0)
      throw new RangeError('A player duration must be nonnegative and finite.');
    if (typeof options.renderFrame !== 'function')
      throw new TypeError('A player needs a renderer.');
    this.#frameRate = options.frameRate;
    this.#duration = options.durationFrames;
    this.#renderFrame = options.renderFrame;
  }

  frame(): number {
    return this.#frame;
  }

  durationFrames(): number {
    return this.#duration;
  }

  /** Reassert DOM presentation after editor cleanup without changing transport or emitting events. */
  render(): this {
    if (!this.#disposed) this.#renderFrame(this.#frame);
    return this;
  }

  /** Adopted exported graphics may need a visible document to drive their shared RAF clock. */
  setClockOwner(owner: Window | null): this {
    if (this.#disposed) return this;
    playerOwners.set(this, owner);
    reconcileDriver();
    return this;
  }

  on(event: FramePlayerEvent, callback: (() => void) | null): this {
    if (!this.#disposed) this.#events[event] = callback;
    return this;
  }

  /** A seek interrupts transport and always renders, including repeated and exact-zero seeks. */
  seek(frame: number, suppressEvents = true): this {
    if (this.#disposed) return this;
    const next = this.#clampFrame(frame);
    const generation = ++this.#generation;
    this.#interruptMotion();
    if (this.#disposed || generation !== this.#generation) return this;
    this.#publishFrame(next, !suppressEvents, generation);
    return this;
  }

  play(): this {
    if (this.#disposed || (this.#motion && this.#motion.transition === null)) return this;
    const generation = ++this.#generation;
    this.#interruptMotion();
    if (this.#disposed || generation !== this.#generation) return this;
    this.#startMotion(
      this.#duration,
      ((this.#duration - this.#frame) / this.#frameRate) * 1000,
      null,
      generation,
    );
    return this;
  }

  /** Freeze at the current wall-clock position and settle any interrupted segment's callbacks. */
  pause(): this {
    if (this.#disposed) return this;
    const generation = this.#generation;
    if (this.#motion) this.#advance(clockNow());
    if (this.#disposed || generation !== this.#generation) return this;
    ++this.#generation;
    this.#interruptMotion();
    return this;
  }

  animateTo(targetFrame: number, options: FrameTransitionOptions = {}): FrameTransition {
    const target = this.#clampFrame(targetFrame);
    if (
      options.durationMs !== undefined &&
      (!Number.isFinite(options.durationMs) || options.durationMs < 0)
    )
      throw new RangeError('A transition duration must be nonnegative and finite.');
    const transition: TransitionState = { options: { ...options }, settled: false };
    const handle: FrameTransition = { cancel: () => this.#cancelTransition(transition) };
    if (this.#disposed) {
      this.#interruptTransition(transition);
      return handle;
    }
    const generation = ++this.#generation;
    this.#interruptMotion();
    if (this.#disposed || generation !== this.#generation) {
      this.#interruptTransition(transition);
      return handle;
    }
    const duration =
      options.durationMs ?? (Math.abs(target - this.#frame) / this.#frameRate) * 1000;
    this.#startMotion(target, duration, transition, generation);
    return handle;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    playerOwners.delete(this);
    ++this.#generation;
    this.#events = { update: null, complete: null };
    this.#interruptMotion();
  }

  #clampFrame(frame: number): number {
    if (!Number.isFinite(frame)) throw new RangeError('A player frame must be finite.');
    return Math.min(this.#duration, Math.max(0, frame));
  }

  #publishFrame(frame: number, emitUpdate: boolean, generation: number): boolean {
    this.#frame = frame;
    if (frame < this.#duration) this.#completedAtEnd = false;
    this.#renderFrame(frame);
    if (this.#disposed || generation !== this.#generation) return false;
    if (emitUpdate) this.#events.update?.();
    return !this.#disposed && generation === this.#generation;
  }

  #startMotion(
    target: number,
    durationMs: number,
    transition: TransitionState | null,
    generation: number,
  ): void {
    const now = clockNow();
    const motion: Motion = {
      generation,
      anchorMs: now,
      lastTimestampMs: Number.NEGATIVE_INFINITY,
      fromFrame: this.#frame,
      toFrame: target,
      durationMs,
      transition,
    };
    this.#motion = motion;
    activePlayers.set(this, (timestampMs) => {
      if (this.#motion === motion) this.#advance(timestampMs);
    });
    if (durationMs === 0) {
      // Callers receive their cancellation handle before a synchronous completion can clear it.
      queueMicrotask(() => {
        if (this.#motion === motion) this.#advance(now);
      });
    } else reconcileDriver();
  }

  #detachMotion(): Motion | null {
    const motion = this.#motion;
    this.#motion = null;
    activePlayers.delete(this);
    reconcileDriver();
    return motion;
  }

  #interruptTransition(transition: TransitionState): void {
    if (transition.settled) return;
    transition.settled = true;
    transition.options.onInterrupt?.();
  }

  #interruptMotion(): void {
    const motion = this.#detachMotion();
    if (motion?.transition) this.#interruptTransition(motion.transition);
  }

  #cancelTransition(transition: TransitionState): void {
    if (transition.settled) return;
    if (this.#motion?.transition === transition) {
      ++this.#generation;
      this.#detachMotion();
    }
    this.#interruptTransition(transition);
  }

  #advance = (timestampMs: number): void => {
    const motion = this.#motion;
    if (!motion || this.#disposed || timestampMs <= motion.lastTimestampMs) return;
    motion.lastTimestampMs = timestampMs;
    const progress =
      motion.durationMs === 0
        ? 1
        : Math.min(1, Math.max(0, timestampMs - motion.anchorMs) / motion.durationMs);
    const frame =
      progress === 1
        ? motion.toFrame
        : motion.fromFrame + (motion.toFrame - motion.fromFrame) * progress;
    const finished = progress === 1;
    if (finished) this.#detachMotion();
    try {
      const current = this.#publishFrame(frame, true, motion.generation);
      if (current) motion.transition?.options.onUpdate?.();
      if (!finished) return;
      // Completion cleanup already happened, so callbacks may safely start another motion.
      if (
        !this.#disposed &&
        this.#generation === motion.generation &&
        frame === this.#duration &&
        !this.#completedAtEnd
      ) {
        this.#completedAtEnd = true;
        this.#events.complete?.();
      }
      if (motion.transition && !motion.transition.settled) {
        motion.transition.settled = true;
        motion.transition.options.onComplete?.();
      }
    } catch (cause) {
      if (this.#motion === motion) {
        ++this.#generation;
        this.#detachMotion();
      }
      if (motion.transition && !motion.transition.settled)
        this.#interruptTransition(motion.transition);
      throw cause;
    }
  };
}
