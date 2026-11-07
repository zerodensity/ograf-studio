// Stage only explicitly edited data on fully off-air lanes before global Play.
// eslint-disable-next-line no-unused-vars
function offlineStagedLaneData(laneForms, snapshot, hasPendingPlayout) {
  const slots = Object.create(null);
  if (hasPendingPlayout || !snapshot?.slots) return slots;
  for (const [slotId, form] of laneForms) {
    const lane = snapshot.slots[slotId];
    const stateId = form.select.value;
    const data = form.drafts.get(stateId);
    if (
      !data ||
      !lane ||
      lane.current ||
      lane.desired ||
      lane.incoming ||
      lane.outgoing ||
      lane.pending ||
      lane.transition
    )
      continue;
    slots[slotId] = { stateId, data };
  }
  return slots;
}

// Shared by the generated preview and its tests. Never infer success from an
// arbitrary graphic error: only the Studio coordinator's exact off-air result
// may be treated as an opportunity to stage an edit.
// eslint-disable-next-line no-unused-vars
async function updateOfflineLaneData(call, snapshot, hasPendingPlayout, slotId, data, stateId) {
  if (stateId) {
    const slot = snapshot()?.slots?.[slotId];
    const current = slot?.incoming ?? slot?.current;
    if (!slot || !current || current.stateId !== stateId || (slot.transition && !slot.incoming))
      return { statusCode: 200, v_offlineDataStaged: 'local' };
  }
  const offAirMessage = `Cannot patch lane ${slotId} while it is Off, preparing without visible output, or leaving.`;
  try {
    const result = await call('customAction', {
      id: 'transition.patch',
      payload: { slotId, ...(stateId ? { stateId } : {}), data },
    });
    if (!result || Number(result.statusCode) < 400) return result;
    if (result.statusMessage !== offAirMessage) return result;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== offAirMessage) throw error;
  }

  // updateAction stages data only when the lane is fully Off. A transition,
  // pending action, or unknown snapshot could otherwise cause a retake or
  // resurrect a leaving lane; retain the edited form values locally instead.
  const slot = snapshot()?.slots?.[slotId];
  if (
    hasPendingPlayout() ||
    !slot ||
    slot.current ||
    slot.desired ||
    slot.incoming ||
    slot.outgoing ||
    slot.pending ||
    slot.transition
  )
    return { statusCode: 200, v_offlineDataStaged: 'local' };

  const result = await call('updateAction', { data: { slots: { [slotId]: { data } } } });
  if (result && Number(result.statusCode) >= 400) return result;
  return { ...result, statusCode: result?.statusCode ?? 200, v_offlineDataStaged: 'controls' };
}
