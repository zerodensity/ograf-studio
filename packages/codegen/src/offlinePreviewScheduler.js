// Non-real-time graphics need a schedule and deterministic timestamps. Only one
// sample may be queued at a time; dropping intermediate samples prevents slow
// renderers from accumulating a backlog behind operator actions.
// Called by offlinePreviewRuntime.js after these sources are bundled together.
// eslint-disable-next-line no-unused-vars
function createOfflinePreviewScheduler(instance, fps, check, reportError, onRendered) {
  const schedule = [];
  const started = performance.now();
  let tail = Promise.resolve();
  let stopped = false;
  let samplePending = false;
  let commandsPending = 0;
  let nextSampleAt = 0;
  const frameInterval = 1000 / fps;
  const enqueue = (callback) => {
    const task = tail.then(callback);
    tail = task.catch(() => {});
    return task;
  };
  const finishSeek = (startSeek) => {
    const endSeek = performance.now();
    const cost = Math.max(0, endSeek - startSeek);
    // Cheap scenes retain their authored frame rate. A costly coordinated
    // replay leaves idle time for input and skips directly to wall time.
    const idle =
      cost <= 40
        ? Math.max(0, frameInterval - cost)
        : Math.min(1500, Math.max(frameInterval, cost * 2));
    nextSampleAt = endSeek + idle;
  };
  const sample = async (timestamp) => {
    const startSeek = performance.now();
    let result;
    try {
      result = check(await instance.goToTime({ timestamp }));
    } finally {
      finishSeek(startSeek);
    }
    // Diagnostics observe only completed, successful output. They must not change
    // seek timing, action rollback or error reporting, including after disposal.
    if (!stopped) {
      try {
        onRendered?.();
      } catch {
        /* A diagnostic observer must not interrupt playback. */
      }
    }
    return result;
  };
  const tick = (time) => {
    if (stopped) return;
    if (!samplePending && commandsPending === 0 && time >= nextSampleAt) {
      samplePending = true;
      const timestamp = Math.max(0, time - started);
      void enqueue(async () => {
        // An operator action that arrived before this queued seek gets priority.
        if (commandsPending > 0 || stopped) return;
        return sample(timestamp);
      })
        .catch(reportError)
        .finally(() => {
          samplePending = false;
        });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    call(type, params) {
      const timestamp = Math.max(0, performance.now() - started);
      commandsPending++;
      const task = enqueue(async () => {
        if (schedule.length >= 10000)
          throw new Error('The preview action history is full. Reload the page to start again.');
        schedule.push({ timestamp, action: { type, params } });
        try {
          check(await instance.setActionsSchedule({ schedule: [...schedule] }));
          return await sample(timestamp);
        } catch (error) {
          schedule.pop();
          try {
            await instance.setActionsSchedule({ schedule: [...schedule] });
          } catch {
            // Keep the original failure; a later action can retry the schedule.
          }
          throw error;
        }
      });
      return task.finally(() => {
        commandsPending--;
      });
    },
    stop() {
      stopped = true;
      return tail;
    },
  };
}
