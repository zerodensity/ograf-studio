import {
  livePlayoutRequestSchema,
  MAX_PLAYOUT_REQUEST_BYTES,
} from '@ograf-editor/agent-tools/playout';
import type { CoordinatedPlayoutSnapshot } from '@ograf-editor/ograf-types';
import { readBehaviorPreviewPlayout, updateBehaviorPreviewSlot } from './behaviorPreviewStore';

interface Receipt {
  requestId: string;
  operation: 'update';
  slotId: string;
  status: 'running' | 'completed' | 'failed';
  error: string | null;
}

const epoch = crypto.randomUUID();
let revision = 0;
let lastStamp = '';
const commands = new Map<string, { fingerprint: string; receipt: Receipt }>();
const seenRequestIds = new Set<string>();

function publicSnapshot(): Record<string, unknown> {
  const result = readBehaviorPreviewPlayout();
  const snapshot = result.snapshot as CoordinatedPlayoutSnapshot | null;
  // Animation frames do not invalidate a feed's revision. Operator lane changes and accepted
  // data updates do, including changes from Rules, so a stale feed must read again.
  const stamp = JSON.stringify({
    sessionId: result.sessionId,
    loading: result.loading,
    snapshot: snapshot ? { ...snapshot, frame: undefined } : null,
  });
  if (stamp !== lastStamp) {
    lastStamp = stamp;
    revision += 1;
  }
  let dataOmitted = false;
  if (snapshot && JSON.stringify(snapshot).length > 96 * 1024) {
    dataOmitted = true;
    result.snapshot = JSON.parse(
      JSON.stringify(snapshot, (key, value: unknown) => (key === 'data' ? undefined : value)),
    );
  }
  return {
    ...result,
    revision: `preview:${epoch}:${revision}`,
    dataOmitted,
    recentCommands: [...commands.values()]
      .slice(-32)
      .reverse()
      .map(({ receipt }) => ({ ...receipt })),
  };
}

/** Update-only external data bridge for the same combined preview used by Studio controls. */
export async function handlePreviewPlayoutRequest(
  input: unknown,
): Promise<Record<string, unknown>> {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_PLAYOUT_REQUEST_BYTES)
    throw new Error('Playout request is too large.');
  const request = livePlayoutRequestSchema.parse(input);
  if (request.target !== 'preview') throw new Error('This request must explicitly target preview.');
  if (request.action === 'read') return publicSnapshot();
  if (request.operation.type !== 'update') throw new Error('Preview supports data updates only.');
  const operation = request.operation;
  const fingerprint = JSON.stringify(operation);
  const previous = commands.get(request.requestId);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new Error('This requestId was already used for a different preview update.');
    return { ...publicSnapshot(), request: { ...previous.receipt }, accepted: true };
  }
  if (seenRequestIds.has(request.requestId))
    throw new Error(
      'This preview request receipt expired. Read the current output before a new update.',
    );
  const current = publicSnapshot();
  if (request.expectedRevision !== current.revision)
    throw new Error(
      'Preview revision changed. Read ograf_get_playout with target preview and retry intentionally.',
    );
  const snapshot = current.snapshot as CoordinatedPlayoutSnapshot | null;
  if (!current.sessionId || current.loading || !snapshot?.loaded)
    throw new Error('Open a combined preview and take a graphic using Studio controls first.');
  const slot = snapshot.slots[operation.slotId];
  const selection = slot?.incoming ?? slot?.current;
  if (!slot || !selection || (slot.transition && !slot.incoming))
    throw new Error('This preview slot has no on-air state to update. Take a state first.');
  if (operation.stateId !== undefined && selection.stateId !== operation.stateId)
    throw new Error('The preview on-air state changed. Read the current state before updating.');
  if (commands.size >= 64) {
    const completed = [...commands].find(([, entry]) => entry.receipt.status !== 'running');
    if (!completed) throw new Error('Wait for pending preview data updates to complete.');
    commands.delete(completed[0]);
  }
  const receipt: Receipt = {
    requestId: request.requestId,
    operation: 'update',
    slotId: operation.slotId,
    status: 'running',
    error: null,
  };
  commands.set(request.requestId, { fingerprint, receipt });
  seenRequestIds.add(request.requestId);
  revision += 1;
  // Dispatch synchronously to bind to the session admitted above. Completion is polled just
  // like live playout; a resource fetch or authored update must not block operator Out/Clear.
  void updateBehaviorPreviewSlot(
    operation.slotId,
    operation.data,
    operation.stateId,
    operation.mode ?? 'transition',
  ).then(
    () => {
      receipt.status = 'completed';
    },
    (cause: unknown) => {
      receipt.status = 'failed';
      receipt.error = cause instanceof Error ? cause.message : String(cause);
    },
  );
  return { ...publicSnapshot(), request: { ...receipt }, accepted: true };
}
