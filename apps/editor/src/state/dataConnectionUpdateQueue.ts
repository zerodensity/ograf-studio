import type { FieldValue } from '@ograf-editor/scene-model';

interface UpdateRequest {
  slotId: string;
  identity: string;
  data: Record<string, FieldValue>;
  valid(): boolean;
  update(data: Record<string, FieldValue>): Promise<void | boolean>;
}
interface Pending extends UpdateRequest {
  resolve(applied: boolean): void;
  reject(cause: unknown): void;
}
interface Lane {
  busy: boolean;
  pending: Pending[];
}

/** Independent feeds share one serialized writer per lane. Pending field patches coalesce,
 * then the coordinator merges them against the result of the previous completed update. */
export function createDataConnectionUpdateQueue() {
  const lanes = new Map<string, Lane>();
  let disposed = false;
  const drain = async (slotId: string, lane: Lane) => {
    if (lane.busy || disposed) return;
    lane.busy = true;
    try {
      while (!disposed && lane.pending.length) {
        const pending = lane.pending.splice(0);
        const valid: Pending[] = [];
        for (const request of pending) {
          try {
            if (request.valid()) valid.push(request);
            else request.resolve(false);
          } catch (cause) {
            request.reject(cause);
          }
        }
        if (!valid.length) continue;
        // Valid requests must still address the same exact on-air instance. A newly taken
        // instance cannot receive delayed work from the prior occupant of this lane.
        const identity = valid.at(-1)!.identity;
        const selected = valid.filter((request) => {
          if (request.identity === identity) return true;
          request.resolve(false);
          return false;
        });
        const data = Object.assign({}, ...selected.map((request) => request.data)) as Record<
          string,
          FieldValue
        >;
        try {
          const applied = await selected[0]!.update(data);
          for (const request of selected) request.resolve(applied !== false);
        } catch (cause) {
          for (const request of selected) request.reject(cause);
        }
      }
    } finally {
      lane.busy = false;
      if (lanes.get(slotId) === lane && !lane.pending.length) lanes.delete(slotId);
    }
  };
  return {
    enqueue(request: UpdateRequest): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      let lane = lanes.get(request.slotId);
      if (!lane) lanes.set(request.slotId, (lane = { busy: false, pending: [] }));
      const result = new Promise<boolean>((resolve, reject) =>
        lane!.pending.push({ ...request, resolve, reject }),
      );
      void drain(request.slotId, lane);
      return result;
    },
    dispose() {
      disposed = true;
      for (const lane of lanes.values())
        for (const request of lane.pending.splice(0)) request.resolve(false);
      lanes.clear();
    },
  };
}
