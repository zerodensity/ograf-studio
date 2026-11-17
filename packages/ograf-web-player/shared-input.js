const MOVE_INTERVAL_MS = 1000 / 30;

export function createSharedInput({ url, onError, onPointer, fetchImpl = globalThis.fetch }) {
  // getRandomValues also works on the non-secure HTTP origins used by LAN preview.
  const clientId = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  let session;
  let boundGraphic;
  let requestCounter = 0;
  let lastSequence = 0;
  let timer;
  let pendingMove;
  const queued = [];
  let active;

  function resetOutgoing() {
    clearTimeout(timer);
    timer = undefined;
    pendingMove = undefined;
    queued.length = 0;
    const previous = active;
    active = undefined;
    previous?.abort();
  }

  async function postInput(request, body) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal,
      });
      // A publication or mode can change before the next SSE snapshot reaches this client.
      if (!response.ok && response.status !== 409)
        throw new Error(`Shared input could not be sent (HTTP ${response.status}).`);
    } catch (error) {
      if (active === request) onError?.(error);
    } finally {
      if (active === request) {
        active = undefined;
        sendNext();
      }
    }
  }

  function sendNext() {
    if (active || !boundGraphic || queued.length === 0) return;
    const request = new AbortController();
    active = request;
    void postInput(request, {
      publicationId: session.publicationId,
      syncVersion: session.syncVersion,
      clientId,
      requestId: `${clientId}-${++requestCounter}`,
      input: queued.shift(),
    });
  }

  function flushMove() {
    clearTimeout(timer);
    timer = undefined;
    if (!pendingMove) return;
    if (queued.at(-1)?.type === 'pointer-move') queued[queued.length - 1] = pendingMove;
    else queued.push(pendingMove);
    pendingMove = undefined;
    sendNext();
  }

  function send(input) {
    if (!boundGraphic) return;
    if (input.type === 'pointer-move') {
      pendingMove = input;
      timer ??= setTimeout(flushMove, MOVE_INTERVAL_MS);
      return;
    }
    flushMove();
    queued.push(input);
    sendNext();
  }

  function setSession(next) {
    const epochChanged =
      session?.publicationId !== next?.publicationId || session?.syncVersion !== next?.syncVersion;
    const nextGraphic = next?.publicationId && next.syncViewers ? next.graphic : null;
    const nextBound = next?.canSend && nextGraphic?.setSharedInputHandler ? nextGraphic : undefined;
    if (epochChanged) lastSequence = 0;
    if (epochChanged || boundGraphic !== nextBound) resetOutgoing();
    if (epochChanged || session?.graphic !== nextGraphic) onPointer?.(null);
    session = next ? { ...next, graphic: nextGraphic } : undefined;
    if (boundGraphic === nextBound) return;
    boundGraphic?.setSharedInputHandler(null);
    boundGraphic = nextBound;
    boundGraphic?.setSharedInputHandler(send);
  }

  return {
    setSession,
    receive(entry) {
      if (
        !session?.graphic ||
        session.publicationId !== entry.publicationId ||
        session.syncVersion !== entry.syncVersion ||
        entry.sequence <= lastSequence
      )
        return;
      lastSequence = entry.sequence;
      if (entry.clientId === clientId) return;
      const { input } = entry;
      if (input.type === 'pointer-leave') onPointer?.(null);
      else if (input.position) onPointer?.(input.position);
      try {
        session.graphic.applySharedInput?.(input);
      } catch (error) {
        onError?.(error);
      }
    },
    dispose() {
      setSession(null);
    },
  };
}
