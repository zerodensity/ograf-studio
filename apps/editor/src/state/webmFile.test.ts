import { describe, expect, it } from 'vitest';
import { writeWebm, type WebmFrame } from './webmFile';

interface Parsed {
  id: number;
  start: number;
  data: Uint8Array;
  children: Parsed[];
}

/** The elements that hold other elements, in the subset of WebM this writer produces. */
const MASTERS = new Set([
  0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x55b0, 0xe1, 0x1c53bb6b, 0xbb, 0xb7,
  0x1f43b675, 0xa0, 0x75a1, 0xa6,
]);

function vintWidth(first: number): number {
  return Math.clz32(first) - 23;
}

function parse(bytes: Uint8Array, from = 0, to = bytes.length): Parsed[] {
  const out: Parsed[] = [];
  let at = from;
  while (at < to) {
    const start = at;
    const idWidth = vintWidth(bytes[at]!);
    let id = 0;
    for (let i = 0; i < idWidth; i += 1) id = id * 256 + bytes[at + i]!;
    at += idWidth;
    const sizeWidth = vintWidth(bytes[at]!);
    let size = bytes[at]! & (0xff >> sizeWidth);
    for (let i = 1; i < sizeWidth; i += 1) size = size * 256 + bytes[at + i]!;
    at += sizeWidth;
    out.push({
      id,
      start,
      data: bytes.subarray(at, at + size),
      children: MASTERS.has(id) ? parse(bytes, at, at + size) : [],
    });
    at += size;
  }
  return out;
}

const find = (elements: Parsed[], id: number) => elements.filter((element) => element.id === id);
const one = (elements: Parsed[], id: number) => find(elements, id)[0]!;
const number = (element: Parsed) => element.data.reduce((value, byte) => value * 256 + byte, 0);
const string = (element: Parsed) => new TextDecoder().decode(element.data);

const picture = (timeMs: number, key: boolean, byte: number): WebmFrame => ({
  timeMs,
  key,
  data: Uint8Array.of(byte, byte),
});
const opusHead = Uint8Array.of(
  ...new TextEncoder().encode('OpusHead'),
  1,
  2,
  0x38,
  0x01,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
);

function webm(frames: WebmFrame[], sound: WebmFrame[] | null = null) {
  const bytes = writeWebm({
    durationMs: 80,
    video: {
      width: 1920,
      height: 1080,
      frameMs: 20,
      colour: { matrix: 1, range: 2, transfer: 13, primaries: 1 },
      frames,
    },
    audio: sound ? { opusHead, sampleRate: 48_000, channels: 2, frames: sound } : null,
    app: 'Test',
  });
  const [header, segment] = parse(bytes);
  return { bytes, header: header!, segment: segment! };
}

describe('writeWebm', () => {
  it('describes a VP9 picture track and an Opus sound track', () => {
    const { header, segment } = webm(
      [picture(0, true, 1), picture(20, false, 2)],
      [{ timeMs: 0, key: true, data: Uint8Array.of(9) }],
    );
    expect(string(one(header.children, 0x4282))).toBe('webm');
    const info = one(segment.children, 0x1549a966).children;
    expect(number(one(info, 0x2ad7b1))).toBe(1_000_000);
    expect(new DataView(one(info, 0x4489).data.slice().buffer).getFloat64(0)).toBe(80);

    const [video, audio] = find(one(segment.children, 0x1654ae6b).children, 0xae);
    expect(string(one(video!.children, 0x86))).toBe('V_VP9');
    expect(number(one(video!.children, 0x23e383))).toBe(20_000_000);
    const size = one(video!.children, 0xe0).children;
    expect([number(one(size, 0xb0)), number(one(size, 0xba))]).toEqual([1920, 1080]);
    expect(one(size, 0x55b0).children.map(number)).toEqual([1, 2, 13, 1]);
    expect(find(size, 0x53c0)).toEqual([]);

    expect(string(one(audio!.children, 0x86))).toBe('A_OPUS');
    expect(one(audio!.children, 0x63a2).data).toEqual(opusHead);
    // A pre-skip of 312 samples at 48 kHz is 6.5 ms.
    expect(number(one(audio!.children, 0x56aa))).toBe(6_500_000);
  });

  it('starts a cluster at each key picture and indexes it', () => {
    const { bytes, segment } = webm(
      [picture(0, true, 1), picture(20, false, 2), picture(40, true, 3), picture(60, false, 4)],
      [
        { timeMs: 0, key: true, data: Uint8Array.of(9) },
        { timeMs: 40, key: true, data: Uint8Array.of(9) },
      ],
    );
    const clusters = find(segment.children, 0x1f43b675);
    expect(clusters.map((cluster) => number(one(cluster.children, 0xe7)))).toEqual([0, 40]);
    // Track number, offset from the cluster and the key flag open every block; picture comes first.
    expect(
      find(clusters[1]!.children, 0xa3).map((block) => [...block.data.subarray(0, 4)]),
    ).toEqual([
      [0x81, 0, 0, 0x80],
      [0x82, 0, 0, 0x80],
      [0x81, 0, 20, 0],
    ]);

    const segmentData = segment.start + (bytes.length - segment.start - segment.data.length);
    const points = find(one(segment.children, 0x1c53bb6b).children, 0xbb);
    expect(points.map((point) => number(one(point.children, 0xb3)))).toEqual([0, 40]);
    expect(
      points.map((point) => segmentData + number(one(one(point.children, 0xb7).children, 0xf1))),
    ).toEqual(clusters.map((cluster) => cluster.start));
    expect(one(segment.children, 0x1c53bb6b).start).toBeLessThan(clusters[0]!.start);
  });

  it('carries transparency as a block addition and marks the track', () => {
    const alpha = (frame: WebmFrame, byte: number) => ({ ...frame, alpha: Uint8Array.of(byte) });
    const { segment } = webm([
      alpha(picture(0, true, 1), 7),
      alpha(picture(20, false, 2), 8),
      alpha(picture(40, false, 3), 9),
    ]);
    const video = one(one(segment.children, 0x1654ae6b).children, 0xae).children;
    expect(number(one(video, 0x55ee))).toBe(1);
    expect(number(one(one(video, 0xe0).children, 0x53c0))).toBe(1);

    const cluster = one(segment.children, 0x1f43b675).children;
    expect(find(cluster, 0xa3)).toEqual([]);
    const groups = find(cluster, 0xa0);
    expect(
      groups.map((group) => {
        const more = one(one(group.children, 0x75a1).children, 0xa6).children;
        return [
          [...one(group.children, 0xa1).data],
          number(one(more, 0xee)),
          [...one(more, 0xa5).data],
          find(group.children, 0xfb).map((reference) =>
            new DataView(reference.data.slice().buffer).getInt16(0),
          ),
        ];
      }),
    ).toEqual([
      // A key picture names no reference; every other one points at the picture before it.
      [[0x81, 0, 0, 0, 1, 1], 1, [7], []],
      [[0x81, 0, 20, 0, 2, 2], 1, [8], [-20]],
      [[0x81, 0, 40, 0, 3, 3], 1, [9], [-20]],
    ]);
  });

  it('refuses a movie no player could decode', () => {
    expect(() => webm([])).toThrow('at least one picture');
    expect(() => webm([picture(0, false, 1)])).toThrow('start with a key picture');
    expect(() =>
      webm([{ ...picture(0, true, 1), alpha: Uint8Array.of(1) }, picture(20, false, 2)]),
    ).toThrow('needs its alpha');
    expect(() => webm([picture(0, true, 1), picture(40_000, false, 2)])).toThrow(
      'Key pictures are too far apart',
    );
  });
});
