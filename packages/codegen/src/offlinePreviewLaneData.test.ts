import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Result = { statusCode: number; statusMessage?: string; v_offlineDataStaged?: string };
type Call = (type: string, params: unknown) => Promise<Result>;
type Snapshot = { slots: Record<string, Record<string, unknown>> } | undefined;
const source = readFileSync(new URL('./offlinePreviewLaneData.js', import.meta.url), 'utf8');
const update = runInNewContext(`${source}\nupdateOfflineLaneData`, { Error }) as (
  call: Call,
  snapshot: () => Snapshot,
  pending: () => boolean,
  slotId: string,
  data: Record<string, unknown>,
  stateId?: string,
) => Promise<Result>;
const stagedForPlay = runInNewContext(`${source}\nofflineStagedLaneData`, { Error }) as (
  forms: Map<string, { select: { value: string }; drafts: Map<string, Record<string, unknown>> }>,
  snapshot: Snapshot,
  pending: boolean,
) => Record<string, { stateId: string; data: Record<string, unknown> }>;
const offMessage =
  'Cannot patch lane headline while it is Off, preparing without visible output, or leaving.';

describe('offline coordinated lane data', () => {
  it('stages only changed, fully off-air lanes for global Play', () => {
    const forms = new Map([
      ['headline', { select: { value: 'one' }, drafts: new Map([['one', { text: 'Staged' }]]) }],
      ['header', { select: { value: 'two' }, drafts: new Map([['two', { text: 'Next' }]]) }],
      [
        'ticker',
        { select: { value: 'three' }, drafts: new Map<string, Record<string, unknown>>() },
      ],
    ]);
    const snapshot = {
      slots: { headline: {}, header: { current: { stateId: 'old' } }, ticker: {} },
    };
    const result = stagedForPlay(forms, snapshot, false);
    expect(Object.keys(result)).toEqual(['headline']);
    expect(result.headline).toEqual({ stateId: 'one', data: { text: 'Staged' } });
    expect(Object.keys(stagedForPlay(forms, snapshot, true))).toHaveLength(0);
    expect(
      Object.keys(
        stagedForPlay(forms, { slots: { headline: { desired: { stateId: 'one' } } } }, false),
      ),
    ).toHaveLength(0);
  });
  it('targets the selected on-air state and stages changes for a different next state', async () => {
    const call = vi.fn<Call>().mockResolvedValue({ statusCode: 200 });
    const snapshot = () => ({ slots: { headline: { current: { stateId: 'first' } } } });
    const staged = await update(
      call,
      snapshot,
      () => false,
      'headline',
      { title: 'Next' },
      'second',
    );
    expect(staged.v_offlineDataStaged).toBe('local');
    expect(call).not.toHaveBeenCalled();
    await update(call, snapshot, () => false, 'headline', { title: 'On air' }, 'first');
    expect(call).toHaveBeenCalledWith('customAction', {
      id: 'transition.patch',
      payload: { slotId: 'headline', stateId: 'first', data: { title: 'On air' } },
    });
  });

  it('does not patch a lane that is already leaving', async () => {
    const call = vi.fn<Call>().mockResolvedValue({ statusCode: 200 });
    const result = await update(
      call,
      () => ({
        slots: {
          headline: {
            current: { stateId: 'first' },
            transition: {},
            incoming: null,
          },
        },
      }),
      () => false,
      'headline',
      { title: 'Next' },
      'first',
    );
    expect(result.v_offlineDataStaged).toBe('local');
    expect(call).not.toHaveBeenCalled();
  });
  it('patches an on-air lane in place without an update transition', async () => {
    const call = vi.fn<Call>().mockResolvedValue({ statusCode: 200 });
    await expect(
      update(
        call,
        () => ({ slots: { headline: { current: {} } } }),
        () => false,
        'headline',
        {
          title: 'Live',
        },
      ),
    ).resolves.toEqual({ statusCode: 200 });
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith('customAction', {
      id: 'transition.patch',
      payload: { slotId: 'headline', data: { title: 'Live' } },
    });
  });

  it.each(['status', 'throw'])(
    'stages an off-air edit for the next global Take after a %s failure',
    async (failure) => {
      let selectedData = { title: 'Original', accent: 'blue' };
      let playedData: typeof selectedData | undefined;
      const call = vi.fn<Call>(async (type, params) => {
        if (type === 'customAction') {
          if (failure === 'throw') throw new Error(offMessage);
          return { statusCode: 550, statusMessage: offMessage };
        }
        if (type === 'updateAction') {
          const patch = params as {
            data: { slots: { headline: { data: Partial<typeof selectedData> } } };
          };
          selectedData = { ...selectedData, ...patch.data.slots.headline.data };
        }
        if (type === 'playAction') playedData = { ...selectedData };
        return { statusCode: 200 };
      });
      const result = await update(
        call,
        () => ({ slots: { headline: { current: null, desired: null, transition: null } } }),
        () => false,
        'headline',
        { title: 'Staged' },
      );
      expect(result.v_offlineDataStaged).toBe('controls');
      expect(call).toHaveBeenLastCalledWith('updateAction', {
        data: { slots: { headline: { data: { title: 'Staged' } } } },
      });
      await call('playAction', { delta: 1 });
      expect(playedData).toEqual({ title: 'Staged', accent: 'blue' });
    },
  );

  it.each([
    { current: { stateId: 'headline' }, transition: { progress: 0.5 } },
    { current: null, pending: { stateId: 'headline' } },
    { current: null, desired: { stateId: 'headline' } },
  ])('does not retake a transitioning or preparing lane', async (slot) => {
    const call = vi.fn<Call>().mockResolvedValue({ statusCode: 550, statusMessage: offMessage });
    const result = await update(
      call,
      () => ({ slots: { headline: slot } }),
      () => false,
      'headline',
      {
        title: 'Next',
      },
    );
    expect(result.v_offlineDataStaged).toBe('local');
    expect(call).toHaveBeenCalledOnce();
  });

  it('does not stage through the runtime while another playout command is pending', async () => {
    const call = vi.fn<Call>().mockResolvedValue({ statusCode: 550, statusMessage: offMessage });
    const result = await update(
      call,
      () => ({ slots: { headline: { current: null, desired: null } } }),
      () => true,
      'headline',
      { title: 'Next' },
    );
    expect(result.v_offlineDataStaged).toBe('local');
    expect(call).toHaveBeenCalledOnce();
  });

  it('propagates unrelated patch errors and staging failures', async () => {
    const other = vi
      .fn<Call>()
      .mockResolvedValue({ statusCode: 550, statusMessage: 'Invalid color' });
    expect(
      await update(
        other,
        () => undefined,
        () => false,
        'headline',
        { color: 'bad' },
      ),
    ).toEqual({ statusCode: 550, statusMessage: 'Invalid color' });
    expect(other).toHaveBeenCalledOnce();

    const staging = vi
      .fn<Call>()
      .mockResolvedValueOnce({ statusCode: 550, statusMessage: offMessage })
      .mockResolvedValueOnce({ statusCode: 550, statusMessage: 'Invalid data' });
    expect(
      await update(
        staging,
        () => ({ slots: { headline: { current: null, desired: null } } }),
        () => false,
        'headline',
        { color: 'bad' },
      ),
    ).toEqual({ statusCode: 550, statusMessage: 'Invalid data' });
  });
});
