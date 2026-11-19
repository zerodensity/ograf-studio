import { describe, expect, it, vi } from 'vitest';
import { picturesFromCopies, type FrameCopy } from './frameCopies';

type StandInPicture = ImageBitmap & { frame: number; drawer: string };

const picture = (frame: number, drawer: string) =>
  ({ frame, drawer, close: vi.fn() }) as unknown as StandInPicture;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A tree whose pictures are ready only when the test says so. */
function standInCopy(name: string, copied: number[] = []) {
  const pending = new Map<number, (picture: ImageBitmap | null) => void>();
  const copy: FrameCopy<[frame: number]> = {
    painted: (frame) => new Promise((resolve) => pending.set(frame, resolve)),
    copied: async (frame) => {
      copied.push(frame);
      return picture(frame, `${name} copied`);
    },
  };
  return {
    copy,
    frames: () => [...pending.keys()],
    paint(frame: number, hidden = false) {
      const result = hidden ? null : picture(frame, `${name} painted`);
      pending.get(frame)!(result);
      pending.delete(frame);
      return result as StandInPicture | null;
    },
  };
}

describe('picturesFromCopies', () => {
  it('renders as many frames at once as there are trees', async () => {
    const a = standInCopy('a');
    const b = standInCopy('b');
    const pictureOf = picturesFromCopies([a.copy, b.copy], true);
    const asked = [1, 2, 3].map((frame) => pictureOf(frame));
    await settle();
    // The third frame waits for a tree.
    expect([...a.frames(), ...b.frames()].sort()).toEqual([1, 2]);
    (a.frames()[0] === 1 ? a : b).paint(1);
    await settle();
    expect([...a.frames(), ...b.frames()].sort()).toEqual([2, 3]);
    for (const tree of [a, b]) for (const frame of tree.frames()) tree.paint(frame);
    expect((await Promise.all(asked)).map((result) => (result as StandInPicture).frame)).toEqual([
      1, 2, 3,
    ]);
  });

  it('hands pictures out in the order they were asked for', async () => {
    const a = standInCopy('a');
    const b = standInCopy('b');
    const pictureOf = picturesFromCopies([a.copy, b.copy], true);
    const done: number[] = [];
    const asked = [1, 2].map((frame) =>
      pictureOf(frame).then((result) => void done.push((result as StandInPicture).frame)),
    );
    await settle();
    const [early, late] = a.frames()[0] === 1 ? [a, b] : [b, a];
    late.paint(2);
    await settle();
    expect(done).toEqual([]);
    early.paint(1);
    await Promise.all(asked);
    expect(done).toEqual([1, 2]);
  });

  it('changes to copies of the tree at one frame, and keeps to them', async () => {
    const copied: number[] = [];
    const a = standInCopy('a', copied);
    const b = standInCopy('b', copied);
    const pictureOf = picturesFromCopies([a.copy, b.copy], true);
    const asked = [1, 2].map((frame) => pictureOf(frame));
    await settle();
    const [early, late] = a.frames()[0] === 1 ? [a, b] : [b, a];
    // The later frame was painted before the page was hidden; the earlier one was not.
    const paintedLate = late.paint(2)!;
    early.paint(1, true);
    const pictures = (await Promise.all(asked)) as StandInPicture[];
    expect(pictures.map(({ frame, drawer }) => [frame, drawer.split(' ')[1]])).toEqual([
      [1, 'copied'],
      [2, 'copied'],
    ]);
    // The picture the page had painted for the later frame would have flickered between them.
    expect(paintedLate.close).toHaveBeenCalledOnce();
    // The copies were drawn in the movie's order.
    expect(copied).toEqual([1, 2]);
    const next = (await pictureOf(3)) as StandInPicture;
    expect(next.drawer).toContain('copied');
    expect([...a.frames(), ...b.frames()]).toEqual([]);
  });

  it('draws copies one at a time where the page hands over no picture', async () => {
    let drawing = 0;
    let most = 0;
    const copy = (): FrameCopy<[frame: number]> => ({
      painted: vi.fn(),
      copied: async (frame) => {
        most = Math.max(most, ++drawing);
        await settle();
        drawing -= 1;
        return picture(frame, 'copied');
      },
    });
    const copies = [copy(), copy()];
    const pictureOf = picturesFromCopies(copies, false);
    const pictures = (await Promise.all(
      [1, 2, 3].map((frame) => pictureOf(frame)),
    )) as StandInPicture[];
    expect(pictures.map(({ frame }) => frame)).toEqual([1, 2, 3]);
    expect(most).toBe(1);
    for (const { painted } of copies) expect(painted).not.toHaveBeenCalled();
  });

  it('gives a tree back and lets later frames through when a frame fails', async () => {
    const failure = new Error('The shader could not draw.');
    const copy: FrameCopy<[frame: number]> = {
      painted: async (frame) => {
        if (frame === 1) throw failure;
        return picture(frame, 'painted');
      },
      copied: vi.fn(),
    };
    const pictureOf = picturesFromCopies([copy], true);
    const first = pictureOf(1);
    const second = pictureOf(2);
    await expect(first).rejects.toBe(failure);
    expect(((await second) as StandInPicture).frame).toBe(2);
  });
});
