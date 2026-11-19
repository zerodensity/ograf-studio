/**
 * Renders a movie's frames on several mounted trees of the same composition at once. The page
 * paints every tree in one screen refresh, so each tree adds a frame to that refresh.
 */

/** One mounted tree of a composition. It shows one frame at a time. */
export interface FrameCopy<Frame extends unknown[]> {
  /** The frame as the page itself paints it, or `null` when the page cannot hand its picture over. */
  painted(...frame: Frame): Promise<ImageBitmap | null>;
  /** The frame drawn from a copy of the tree. */
  copied(...frame: Frame): Promise<ImageBitmap>;
}

/**
 * The picture of a frame, taken from whichever tree is free. Pictures are handed out in the order
 * they were asked for, whichever is ready first.
 *
 * A movie that had to leave the page's own picture stays with the copies of the tree, because the
 * two draw text a little differently: one change of drawer in a movie, never a flicker between
 * two. Handing pictures out in order makes that change fall on one frame for every tree, and
 * draws the copies one at a time, in the movie's order.
 */
export function picturesFromCopies<Frame extends unknown[]>(
  copies: readonly FrameCopy<Frame>[],
  pagePaints: boolean,
): (...frame: Frame) => Promise<ImageBitmap> {
  const idle = [...copies];
  const waiting: Array<(copy: FrameCopy<Frame>) => void> = [];
  const withCopy = async <Result>(
    work: (copy: FrameCopy<Frame>) => Promise<Result>,
  ): Promise<Result> => {
    const copy =
      idle.pop() ?? (await new Promise<FrameCopy<Frame>>((resolve) => waiting.push(resolve)));
    try {
      return await work(copy);
    } finally {
      const next = waiting.shift();
      if (next) next(copy);
      else idle.push(copy);
    }
  };
  let handedOut: Promise<void> = Promise.resolve();
  return async (...frame) => {
    const earlier = handedOut;
    let handOut!: () => void;
    handedOut = new Promise<void>((resolve) => (handOut = resolve));
    try {
      const painted = pagePaints ? await withCopy((copy) => copy.painted(...frame)) : null;
      await earlier;
      if (painted && pagePaints) return painted;
      painted?.close();
      pagePaints = false;
      return await withCopy((copy) => copy.copied(...frame));
    } finally {
      handOut();
    }
  };
}
