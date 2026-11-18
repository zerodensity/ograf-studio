/**
 * Lays frames that are already encoded (VP9 picture, Opus sound) out as a WebM file.
 * Transparency travels the way WebM defines it: each picture carries a second encoded picture
 * whose brightness is its alpha, as a block addition, and the track says so with AlphaMode.
 */

export interface WebmFrame {
  timeMs: number;
  /** A picture that needs no earlier picture. Every sound frame is one. */
  key: boolean;
  data: Uint8Array;
  /** The picture's alpha, encoded as a picture of its own. All pictures of a track have it or none. */
  alpha?: Uint8Array;
}

/** Matroska's numbers for the colour description an encoder reports. */
export interface WebmColour {
  matrix: number;
  range: number;
  transfer: number;
  primaries: number;
}

export interface WebmVideoTrack {
  width: number;
  height: number;
  frameMs: number;
  colour: WebmColour | null;
  frames: readonly WebmFrame[];
}

export interface WebmAudioTrack {
  /** The Opus identification header the encoder produced. */
  opusHead: Uint8Array;
  sampleRate: number;
  channels: number;
  frames: readonly WebmFrame[];
}

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  DefaultDuration: 0x23e383,
  MaxBlockAdditionID: 0x55ee,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  AlphaMode: 0x53c0,
  Colour: 0x55b0,
  MatrixCoefficients: 0x55b1,
  Range: 0x55b9,
  TransferCharacteristics: 0x55ba,
  Primaries: 0x55bb,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockAdditions: 0x75a1,
  BlockMore: 0xa6,
  BlockAddID: 0xee,
  BlockAdditional: 0xa5,
  ReferenceBlock: 0xfb,
} as const;

const VIDEO_TRACK = 1;
const AUDIO_TRACK = 2;
const OPUS_SAMPLE_RATE = 48_000;
/** A block's time is a signed 16-bit offset from its cluster, in milliseconds. */
const LONGEST_CLUSTER_MS = 32_767;
const text = new TextEncoder();

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A whole number, big-endian, in the fewest bytes or in exactly `width` bytes. */
function unsigned(value: number, width = 0): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('A WebM number must be a whole number that is not negative.');
  const bytes: number[] = [];
  let rest = value;
  do {
    bytes.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  while (bytes.length < width) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

function float64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

function elementId(id: number): Uint8Array {
  return unsigned(id);
}

/** An element's length in EBML's variable-width form: the leading bits say how many bytes follow. */
function elementSize(length: number): Uint8Array {
  for (let width = 1; width <= 8; width += 1) {
    if (length < 2 ** (7 * width) - 1) {
      const bytes = unsigned(length, width);
      bytes[0]! |= 1 << (8 - width);
      return bytes;
    }
  }
  throw new RangeError('The content is too large for a WebM element.');
}

function element(id: number, content: Uint8Array | readonly Uint8Array[]): Uint8Array {
  const body = content instanceof Uint8Array ? content : concat(content);
  return concat([elementId(id), elementSize(body.length), body]);
}

/** The track number, the offset from the cluster's time and the flags that open every block. */
function blockHeader(track: number, offsetMs: number, flags: number): Uint8Array {
  return Uint8Array.of(0x80 | track, (offsetMs >> 8) & 0xff, offsetMs & 0xff, flags);
}

function videoBlock(frame: WebmFrame, offsetMs: number, previousTimeMs: number | null): Uint8Array {
  if (!frame.alpha)
    return element(
      ID.SimpleBlock,
      concat([blockHeader(VIDEO_TRACK, offsetMs, frame.key ? 0x80 : 0), frame.data]),
    );
  // A block with additions cannot be a SimpleBlock. In a group, a picture is a key picture exactly
  // when it names no reference, so every other picture points back at the one before it.
  const reference =
    frame.key || previousTimeMs === null
      ? []
      : [element(ID.ReferenceBlock, signed16(previousTimeMs - frame.timeMs))];
  return element(ID.BlockGroup, [
    element(ID.Block, concat([blockHeader(VIDEO_TRACK, offsetMs, 0), frame.data])),
    element(
      ID.BlockAdditions,
      element(ID.BlockMore, [
        element(ID.BlockAddID, unsigned(1)),
        element(ID.BlockAdditional, frame.alpha),
      ]),
    ),
    ...reference,
  ]);
}

function signed16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setInt16(0, value);
  return out;
}

export function writeWebm({
  durationMs,
  video,
  audio,
  app,
}: {
  durationMs: number;
  video: WebmVideoTrack;
  audio?: WebmAudioTrack | null;
  /** Written into the file as the program that made it. */
  app: string;
}): Uint8Array<ArrayBuffer> {
  const transparent = video.frames.some((frame) => frame.alpha);
  if (transparent && video.frames.some((frame) => !frame.alpha))
    throw new Error('Every picture of a transparent WebM needs its alpha.');
  if (video.frames.length === 0) throw new Error('A WebM needs at least one picture.');
  if (!video.frames[0]!.key) throw new Error('A WebM must start with a key picture.');

  const header = element(ID.EBML, [
    element(ID.EBMLVersion, unsigned(1)),
    element(ID.EBMLReadVersion, unsigned(1)),
    element(ID.EBMLMaxIDLength, unsigned(4)),
    element(ID.EBMLMaxSizeLength, unsigned(8)),
    element(ID.DocType, text.encode('webm')),
    element(ID.DocTypeVersion, unsigned(4)),
    element(ID.DocTypeReadVersion, unsigned(2)),
  ]);
  const info = element(ID.Info, [
    // One millisecond: every time in the file is then a number of milliseconds.
    element(ID.TimestampScale, unsigned(1_000_000)),
    element(ID.Duration, float64(durationMs)),
    element(ID.MuxingApp, text.encode(app)),
    element(ID.WritingApp, text.encode(app)),
  ]);
  const tracks = element(ID.Tracks, [
    element(ID.TrackEntry, [
      element(ID.TrackNumber, unsigned(VIDEO_TRACK)),
      element(ID.TrackUID, unsigned(VIDEO_TRACK)),
      element(ID.TrackType, unsigned(1)),
      element(ID.FlagLacing, unsigned(0)),
      element(ID.CodecID, text.encode('V_VP9')),
      element(ID.DefaultDuration, unsigned(Math.round(video.frameMs * 1_000_000))),
      ...(transparent ? [element(ID.MaxBlockAdditionID, unsigned(1))] : []),
      element(ID.Video, [
        element(ID.PixelWidth, unsigned(video.width)),
        element(ID.PixelHeight, unsigned(video.height)),
        ...(transparent ? [element(ID.AlphaMode, unsigned(1))] : []),
        ...(video.colour
          ? [
              element(ID.Colour, [
                element(ID.MatrixCoefficients, unsigned(video.colour.matrix)),
                element(ID.Range, unsigned(video.colour.range)),
                element(ID.TransferCharacteristics, unsigned(video.colour.transfer)),
                element(ID.Primaries, unsigned(video.colour.primaries)),
              ]),
            ]
          : []),
      ]),
    ]),
    ...(audio
      ? [
          element(ID.TrackEntry, [
            element(ID.TrackNumber, unsigned(AUDIO_TRACK)),
            element(ID.TrackUID, unsigned(AUDIO_TRACK)),
            element(ID.TrackType, unsigned(2)),
            element(ID.FlagLacing, unsigned(0)),
            element(ID.CodecID, text.encode('A_OPUS')),
            element(ID.CodecPrivate, audio.opusHead),
            // The header's pre-skip, bytes 10 and 11, is the encoder's start-up delay in samples.
            element(
              ID.CodecDelay,
              unsigned(
                Math.round(
                  ((audio.opusHead[10]! | (audio.opusHead[11]! << 8)) / OPUS_SAMPLE_RATE) * 1e9,
                ),
              ),
            ),
            element(ID.SeekPreRoll, unsigned(80_000_000)),
            element(ID.Audio, [
              element(ID.SamplingFrequency, float64(audio.sampleRate)),
              element(ID.Channels, unsigned(audio.channels)),
            ]),
          ]),
        ]
      : []),
  ]);

  // Every frame in time order, picture before sound at the same time. A cluster starts at each key
  // picture, which is where a player can start decoding.
  const blocks = [
    ...video.frames.map((frame) => ({ frame, track: VIDEO_TRACK })),
    ...(audio?.frames ?? []).map((frame) => ({ frame, track: AUDIO_TRACK })),
  ].sort((a, b) => a.frame.timeMs - b.frame.timeMs || a.track - b.track);
  const groups: { timeMs: number; blocks: Uint8Array[] }[] = [];
  let previousPictureMs: number | null = null;
  for (const { frame, track } of blocks) {
    const last = groups.at(-1);
    const startsCluster =
      !last || (track === VIDEO_TRACK && frame.key && frame.timeMs > last.timeMs);
    const group = startsCluster ? { timeMs: frame.timeMs, blocks: [] } : last;
    if (startsCluster) groups.push(group);
    const offsetMs = frame.timeMs - group.timeMs;
    if (offsetMs > LONGEST_CLUSTER_MS)
      throw new Error('Key pictures are too far apart for a WebM cluster.');
    if (track === VIDEO_TRACK) {
      group.blocks.push(videoBlock(frame, offsetMs, previousPictureMs));
      previousPictureMs = frame.timeMs;
    } else {
      group.blocks.push(
        element(ID.SimpleBlock, concat([blockHeader(AUDIO_TRACK, offsetMs, 0x80), frame.data])),
      );
    }
  }
  const clusters = groups.map((group) =>
    element(ID.Cluster, [element(ID.Timestamp, unsigned(group.timeMs)), ...group.blocks]),
  );

  // The index sits before the clusters, so a player finds it without reading the whole file.
  // Fixed-width numbers keep the index's own size from depending on the positions it lists.
  const cuesFrom = (firstCluster: number) => {
    let position = firstCluster;
    return element(
      ID.Cues,
      groups.map((group, index) => {
        const point = element(ID.CuePoint, [
          element(ID.CueTime, unsigned(group.timeMs, 4)),
          element(ID.CueTrackPositions, [
            element(ID.CueTrack, unsigned(VIDEO_TRACK)),
            element(ID.CueClusterPosition, unsigned(position, 8)),
          ]),
        ]);
        position += clusters[index]!.length;
        return point;
      }),
    );
  };
  const cues = cuesFrom(info.length + tracks.length + cuesFrom(0).length);
  const body = concat([info, tracks, cues, ...clusters]);
  return concat([header, elementId(ID.Segment), elementSize(body.length), body]);
}
