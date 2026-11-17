import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CoordinatedPlayoutSnapshot, Graphic } from '@ograf-editor/ograf-types';
import type { FieldValue } from '@ograf-editor/scene-model';
import type { SharedPlayoutFeed } from './sharedPlayoutPublish';
import {
  dataFromSchemaDefaults,
  mountOGrafGraphic,
  type OGrafPlayer,
  type OGrafPlayerManifest,
  type OGrafPlayerResult,
} from '../../../../packages/ograf-web-player/ograf-player.js';
import {
  createSharedInput,
  type SharedInputEntry,
  type SharedInputGraphic,
} from '../../../../packages/ograf-web-player/shared-input.js';

export type SharedLiveCommand =
  | { kind: 'play'; delta?: number; goto?: number }
  | { kind: 'stop' }
  | { kind: 'update'; data: Record<string, unknown> }
  | { kind: 'action'; actionId: string; payload?: Record<string, unknown> };

export type SharedLiveGraphic = HTMLElement &
  Graphic &
  SharedInputGraphic & {
    getPlayoutSnapshot?(): CoordinatedPlayoutSnapshot;
    subscribePlayout?(listener: (snapshot: CoordinatedPlayoutSnapshot) => void): () => void;
    setPresentationSuspended?(suspended: boolean): void;
  };

interface JournalEntry {
  revision: number;
  command: SharedLiveCommand;
}

interface SessionSnapshot {
  publicationId: string | null;
  manifestUrl: string | null;
  revision: number;
  commands: JournalEntry[];
  feeds?: SharedPlayoutFeed[];
  syncViewers: boolean;
  syncVersion: number;
}

interface LiveState {
  ready: boolean;
  loading: boolean;
  error: string;
  publicationId: string | null;
  currentStep: number | undefined;
  data: Record<string, FieldValue>;
  snapshot: CoordinatedPlayoutSnapshot | null;
  graphic: SharedLiveGraphic | null;
  manifest: OGrafPlayerManifest | null;
  syncViewers: boolean;
  syncVersion: number;
  syncPending: boolean;
  syncError: string;
}

type Result = OGrafPlayerResult | undefined;
type Outcome = { result: Result } | { error: unknown };
const route = '/api/shared-playout';
const initialState: LiveState = {
  ready: false,
  loading: true,
  error: '',
  publicationId: null,
  currentStep: undefined,
  data: {},
  snapshot: null,
  graphic: null,
  manifest: null,
  syncViewers: true,
  syncVersion: -1,
  syncPending: false,
  syncError: '',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function requestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** The native Preview surface follows the same certified package and journal as the LAN clients. */
export function createSharedLivePreview(
  container: HTMLElement,
  onState: (state: LiveState) => void,
  isPresentationSuspended: () => boolean,
) {
  let state = initialState;
  let closed = false;
  let announced: string | null | undefined;
  let player: OGrafPlayer | null = null;
  let unwatch = () => {};
  let applied = 0;
  let appliedFeed = 0;
  let revision = 0;
  let connection = 0;
  let events = Promise.resolve();
  let submissions = Promise.resolve();
  let mounting: AbortController | undefined;
  let posting: AbortController | undefined;
  let retrying: AbortController | undefined;
  let updatingSync: AbortController | undefined;
  const outcomes = new Map<number, Outcome>();
  const waiters = new Map<number, (outcome: Outcome) => void>();
  const source = new EventSource(`${route}/events`);
  const sharedInput = createSharedInput({
    url: `${route}/input`,
    onError: (error) => patch({ syncError: errorMessage(error) }),
  });

  function patch(value: Partial<LiveState>) {
    const previous = state;
    state = { ...state, ...value };
    if (
      previous.ready !== state.ready ||
      previous.publicationId !== state.publicationId ||
      previous.syncViewers !== state.syncViewers ||
      previous.syncVersion !== state.syncVersion ||
      previous.graphic !== state.graphic
    ) {
      sharedInput.setSession(
        state.ready
          ? {
              publicationId: state.publicationId,
              syncVersion: state.syncVersion,
              syncViewers: state.syncViewers,
              canSend: true,
              graphic: state.graphic,
            }
          : null,
      );
    }
    if (!closed) onState(state);
  }

  function applySyncMode(mode: Pick<SessionSnapshot, 'syncViewers' | 'syncVersion'>) {
    if (!closed && mode.syncVersion > state.syncVersion) patch(mode);
  }

  function resetPublication(publicationId: string | null, error = '') {
    const { syncViewers, syncVersion, syncPending, syncError } = state;
    patch({
      ...initialState,
      publicationId,
      loading: !error,
      error,
      syncViewers,
      syncVersion,
      syncPending,
      syncError,
    });
  }

  function isCurrent(publicationId: string | null | undefined) {
    return !closed && publicationId === announced;
  }

  function cancelRequests() {
    mounting?.abort();
    posting?.abort();
    retrying?.abort();
    for (const complete of waiters.values())
      complete({ error: new Error('The shared publication changed.') });
    waiters.clear();
  }

  async function discardPlayer() {
    const previous = player;
    player = null;
    unwatch();
    unwatch = () => {};
    outcomes.clear();
    applied = 0;
    appliedFeed = 0;
    revision = 0;
    if (previous) {
      try {
        await previous.dispose();
      } catch {
        // The viewport is removed by the player even if graphic disposal fails.
      }
    }
  }

  function enqueue(
    operation: () => Promise<void>,
    expectedPublication: string | null | undefined = announced,
  ) {
    events = events
      .then(async () => {
        if (isCurrent(expectedPublication)) await operation();
      })
      .catch((error: unknown) => {
        if (isCurrent(expectedPublication))
          patch({ ready: false, loading: false, error: errorMessage(error) });
      });
  }

  async function invoke(entry: JournalEntry, publicationId: string, replay: boolean) {
    const active = player;
    if (!active || !isCurrent(publicationId) || entry.revision <= applied) return;
    if (entry.revision !== applied + 1) throw new Error('The shared playout journal has a gap.');
    const { command } = entry;
    const options = replay ? { skipAnimation: true } : {};
    let outcome: Outcome;
    try {
      let result: Result;
      switch (command.kind) {
        case 'play':
          result = await active.play({
            ...options,
            ...(command.goto === undefined
              ? { delta: command.delta ?? 1 }
              : { goto: command.goto }),
          });
          if (isCurrent(publicationId)) patch({ currentStep: result?.currentStep });
          break;
        case 'stop':
          result = await active.stop(options);
          if (isCurrent(publicationId)) patch({ currentStep: undefined });
          break;
        case 'update':
          result = await active.update(command.data, options);
          if (isCurrent(publicationId))
            patch({ data: { ...state.data, ...command.data } as Record<string, FieldValue> });
          break;
        case 'action':
          result = await active.action(command.actionId, command.payload, options);
          break;
      }
      outcome = { result };
    } catch (error) {
      if (replay && entry.revision === 1 && command.kind === 'play') throw error;
      outcome = { error };
      if (isCurrent(publicationId)) patch({ error: errorMessage(error) });
    }
    if (!isCurrent(publicationId)) return;
    applied = entry.revision;
    if (!('error' in outcome) && state.error) patch({ error: '' });
    if (posting) outcomes.set(applied, outcome);
    waiters.get(applied)?.(outcome);
    waiters.delete(applied);
  }

  async function invokeFeed(feed: SharedPlayoutFeed, replay: boolean) {
    const active = player;
    const { publicationId, sequence, target, data } = feed;
    if (!active || !isCurrent(publicationId) || sequence <= appliedFeed) return;
    appliedFeed = sequence;
    try {
      const options = replay ? { skipAnimation: true } : {};
      if (target.kind === 'graphic') {
        await active.update(data, options);
        if (isCurrent(publicationId)) patch({ data: { ...state.data, ...data } });
      } else {
        const selected = state.snapshot?.slots[target.slotId];
        if ((selected?.incoming ?? selected?.current)?.stateId !== target.stateId) return;
        await active.action(
          'transition.patch',
          { slotId: target.slotId, stateId: target.stateId, data },
          options,
        );
      }
    } catch (error) {
      if (isCurrent(publicationId)) patch({ error: errorMessage(error) });
    }
  }

  async function synchronize(snapshot: SessionSnapshot, expectedConnection: number) {
    const publicationId = snapshot.publicationId;
    if (!isCurrent(publicationId)) return;
    applySyncMode({ syncViewers: snapshot.syncViewers, syncVersion: snapshot.syncVersion });
    const remount = publicationId !== state.publicationId || (publicationId !== null && !player);
    try {
      if (remount) {
        resetPublication(publicationId);
        await discardPlayer();
        if (!isCurrent(publicationId)) return;
        if (publicationId === null) {
          patch({ loading: false });
          return;
        }
        if (!snapshot.manifestUrl) throw new Error('The shared publication has no manifest.');
        const abort = new AbortController();
        mounting = abort;
        let next: OGrafPlayer;
        try {
          next = await mountOGrafGraphic({
            container,
            manifestUrl: snapshot.manifestUrl,
            fit: false,
            signal: abort.signal,
          });
        } finally {
          if (mounting === abort) mounting = undefined;
        }
        if (!isCurrent(publicationId)) {
          await next.dispose().catch(() => undefined);
          return;
        }
        player = next;
        const graphic = next.element as SharedLiveGraphic;
        graphic.setPresentationSuspended?.(isPresentationSuspended());
        patch({
          graphic,
          manifest: next.manifest,
          data: (dataFromSchemaDefaults(next.manifest.schema) ?? {}) as Record<string, FieldValue>,
          snapshot: graphic.getPlayoutSnapshot?.() ?? null,
        });
        unwatch =
          graphic.subscribePlayout?.((value) => {
            if (isCurrent(publicationId) && player === next) patch({ snapshot: value });
          }) ?? (() => {});
      }
      if (publicationId === null) {
        patch({ loading: false });
        return;
      }
      revision = Math.max(revision, snapshot.revision);
      for (const entry of snapshot.commands) await invoke(entry, publicationId, true);
      for (const feed of snapshot.feeds ?? []) await invokeFeed(feed, true);
      if (!isCurrent(publicationId)) return;
      if (applied < snapshot.revision)
        throw new Error('The shared session snapshot is incomplete.');
      patch({
        ready: expectedConnection === connection && source.readyState === EventSource.OPEN,
        loading: false,
      });
    } catch (error) {
      if (!isCurrent(publicationId)) return;
      if (remount) {
        await discardPlayer();
        if (isCurrent(publicationId)) resetPublication(publicationId, errorMessage(error));
        return;
      }
      throw error;
    }
  }

  async function readSnapshot(signal?: AbortSignal): Promise<SessionSnapshot> {
    const response = await fetch(`${route}/state`, { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`Could not read shared playout (HTTP ${response.status}).`);
    return (await response.json()) as SessionSnapshot;
  }

  function refresh(publicationId: string) {
    const expectedConnection = connection;
    enqueue(async () => {
      const snapshot = await readSnapshot();
      if (snapshot.publicationId === publicationId) await synchronize(snapshot, expectedConnection);
    }, publicationId);
  }

  source.addEventListener('error', () => {
    connection++;
    if (source.readyState === EventSource.CLOSED) {
      announced = undefined;
      cancelRequests();
      patch({ ready: false, loading: false, error: 'Shared playout connection closed.' });
    } else patch({ ready: false, loading: true });
  });
  source.addEventListener('snapshot', (event: MessageEvent<string>) => {
    let snapshot: SessionSnapshot;
    try {
      snapshot = JSON.parse(event.data) as SessionSnapshot;
    } catch (error) {
      patch({ ready: false, loading: false, error: errorMessage(error) });
      return;
    }
    if (snapshot.publicationId !== announced) {
      announced = snapshot.publicationId;
      cancelRequests();
      if (snapshot.syncVersion < state.syncVersion) patch({ syncVersion: -1 });
      patch({ ready: false, loading: true, error: '' });
    }
    const expectedConnection = connection;
    enqueue(() => synchronize(snapshot, expectedConnection), snapshot.publicationId);
  });
  source.addEventListener('command', (event: MessageEvent<string>) => {
    enqueue(async () => {
      const entry = JSON.parse(event.data) as JournalEntry & { publicationId: string };
      if (!isCurrent(entry.publicationId) || state.publicationId !== entry.publicationId || !player)
        return;
      revision = Math.max(revision, entry.revision);
      if (entry.revision > applied + 1) {
        const snapshot = await readSnapshot();
        if (snapshot.publicationId === entry.publicationId) await synchronize(snapshot, connection);
      }
      await invoke(entry, entry.publicationId, false);
    });
  });
  source.addEventListener('feed', (event: MessageEvent<string>) => {
    enqueue(async () => {
      const feed = JSON.parse(event.data) as SharedPlayoutFeed;
      if (state.publicationId === feed.publicationId) await invokeFeed(feed, false);
    });
  });
  source.addEventListener('input', (event: MessageEvent<string>) => {
    enqueue(async () => sharedInput.receive(JSON.parse(event.data) as SharedInputEntry));
  });

  async function submit(publicationId: string | null | undefined, command: SharedLiveCommand) {
    if (!publicationId || !isCurrent(publicationId) || !state.ready)
      throw new Error('Shared playout is not ready.');
    const abort = new AbortController();
    posting = abort;
    try {
      const response = await fetch(`${route}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          publicationId,
          requestId: requestId(),
          expectedRevision: revision,
          command,
        }),
      });
      const receipt = (await response.json()) as { revision: number; error?: string };
      if (!isCurrent(publicationId)) throw new Error('The shared publication changed.');
      if (!response.ok) {
        if (response.status === 409) refresh(publicationId);
        throw new Error(receipt.error ?? `Command rejected (HTTP ${response.status}).`);
      }
      revision = Math.max(revision, receipt.revision);
      const outcome =
        outcomes.get(receipt.revision) ??
        (await new Promise<Outcome>((resolve) => waiters.set(receipt.revision, resolve)));
      if (!isCurrent(publicationId)) throw new Error('The shared publication changed.');
      if ('error' in outcome) throw outcome.error;
      return outcome.result;
    } finally {
      if (posting === abort) {
        posting = undefined;
        outcomes.clear();
      }
    }
  }

  return {
    send(command: SharedLiveCommand): Promise<Result> {
      const publicationId = announced;
      const result = submissions.then(() => submit(publicationId, command));
      submissions = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    async setSyncViewers(syncViewers: boolean) {
      if (closed || updatingSync || state.syncVersion < 0) return;
      const abort = new AbortController();
      updatingSync = abort;
      patch({ syncPending: true, syncError: '' });
      try {
        const response = await fetch(`${route}/mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify({ syncViewers }),
        });
        const receipt = (await response.json()) as Pick<
          SessionSnapshot,
          'syncViewers' | 'syncVersion'
        > & { error?: string };
        if (!response.ok)
          throw new Error(
            receipt.error ?? `Could not change viewer sync (HTTP ${response.status}).`,
          );
        applySyncMode({ syncViewers: receipt.syncViewers, syncVersion: receipt.syncVersion });
      } catch (error) {
        if (!closed) patch({ syncError: errorMessage(error) });
      } finally {
        updatingSync = undefined;
        if (!closed) patch({ syncPending: false });
      }
    },
    retry() {
      const publicationId = announced;
      if (!publicationId || retrying) return;
      const abort = new AbortController();
      retrying = abort;
      patch({ ready: false, loading: true, error: '' });
      enqueue(async () => {
        try {
          const snapshot = await readSnapshot(abort.signal);
          if (snapshot.publicationId === publicationId) await synchronize(snapshot, connection);
        } finally {
          if (retrying === abort) retrying = undefined;
        }
      }, publicationId);
    },
    dispose() {
      closed = true;
      source.close();
      sharedInput.dispose();
      cancelRequests();
      updatingSync?.abort();
      void discardPlayer();
    },
  };
}

export function useSharedLivePreview(
  enabled: boolean,
  containerRef: RefObject<HTMLElement | null>,
  presentationSuspended = false,
  ownerDocument?: Document,
) {
  const [state, setState] = useState(initialState);
  const controller = useRef<ReturnType<typeof createSharedLivePreview> | null>(null);
  const suspended = useRef(presentationSuspended);
  suspended.current = presentationSuspended;
  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;
    setState(initialState);
    const next = createSharedLivePreview(container, setState, () => suspended.current);
    controller.current = next;
    return () => {
      controller.current = null;
      next.dispose();
    };
  }, [enabled, containerRef, ownerDocument]);
  useEffect(() => {
    if (enabled) state.graphic?.setPresentationSuspended?.(presentationSuspended);
  }, [enabled, presentationSuspended, state.graphic]);
  const send = useCallback((command: SharedLiveCommand) => {
    return controller.current?.send(command) ?? Promise.reject(new Error('Shared playout is off.'));
  }, []);
  const retry = useCallback(() => controller.current?.retry(), []);
  const setSyncViewers = useCallback((syncViewers: boolean) => {
    void controller.current?.setSyncViewers(syncViewers);
  }, []);
  return {
    ...(enabled ? state : { ...initialState, loading: false }),
    send,
    retry,
    setSyncViewers,
  };
}
