import { describe, expect, it } from 'vitest';
import type { AgentAreaReference } from '@ograf-editor/agent-tools';
import { parseAreaReference, parseAreaReferences } from './areaReference';
import { buildTurnMessages, compactChatHistory } from './chatAgent';

export const referenceFixture: AgentAreaReference = {
  projectId: 'project-a',
  compositionId: 'composition-a',
  frame: 12,
  revision: 3,
  compositionWidth: 1920,
  compositionHeight: 1080,
  rect: { x: 100, y: 700, width: 800, height: 200 },
  image: {
    mimeType: 'image/png',
    width: 1,
    height: 1,
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  },
};

describe('area reference transport', () => {
  it('passes freehand geometry alongside mixed rectangle references and separate images', () => {
    const polygon = [
      { x: 100, y: 700 },
      { x: 900, y: 700 },
      { x: 500, y: 900 },
    ];
    const freehand = {
      ...referenceFixture,
      polygon,
      instruction: 'Change only inside this outline',
    };
    const parsed = parseAreaReferences([referenceFixture, freehand], 'editor:project-a');
    expect(parsed).toEqual([referenceFixture, freehand]);
    const messages = buildTurnMessages('portable-model', 'Fix these areas', {}, parsed);
    const user = messages.find((message) => message.role === 'user');
    expect(user?.content).toContain(`"polygon":${JSON.stringify(polygon)}`);
    expect(user?.content).toContain('pixels outside the polygon are transparent');
    expect(user?.role === 'user' && user.images).toHaveLength(2);
    expect(user?.content).not.toContain(referenceFixture.image.data);
  });
  it('rejects invalid, oversized or out-of-bounds freehand outlines', () => {
    const point = { x: 200, y: 750 };
    for (const polygon of [
      [point, point],
      Array(513).fill(point),
      [point, point, { x: 99, y: 750 }],
      [point, point, { x: 950, y: 750 }],
      [point, point, { x: 200, y: Infinity }],
    ]) {
      expect(() =>
        parseAreaReference({ ...referenceFixture, polygon }, 'editor:project-a'),
      ).toThrow();
    }
  });
  it('validates project association, bounds, payload type and image dimensions', () => {
    expect(parseAreaReference(referenceFixture, 'editor:project-a')).toEqual(referenceFixture);
    expect(() => parseAreaReference(referenceFixture, 'editor:other')).toThrow();
    expect(() =>
      parseAreaReference(
        { ...referenceFixture, rect: { x: 1900, y: 0, width: 100, height: 50 } },
        'editor:project-a',
      ),
    ).toThrow();
    expect(() =>
      parseAreaReference(
        { ...referenceFixture, image: { ...referenceFixture.image, width: 20 } },
        'editor:project-a',
      ),
    ).toThrow();
    expect(() =>
      parseAreaReference(
        { ...referenceFixture, image: { ...referenceFixture.image, data: 'A'.repeat(6_000_001) } },
        'editor:project-a',
      ),
    ).toThrow();
  });
  it.each(['portable-model', 'opus-5'])(
    'sends image separately from ambient text for %s',
    (model) => {
      const messages = buildTurnMessages(
        model,
        'Correct this spacing',
        { selection: { layerIds: [] } },
        referenceFixture,
      );
      const user = messages.find((message) => message.role === 'user');
      expect(user?.role === 'user' && user.images).toMatchObject([referenceFixture.image]);
      expect(messages.map((message) => message.content).join('')).toContain('"x":100');
      expect(messages.map((message) => message.content).join('')).not.toContain(
        referenceFixture.image.data,
      );
    },
  );
  it('keeps three numbered instructions paired with their coordinates and images', () => {
    const instructions = ['Make smaller', 'Use a bigger font', 'Change to red'];
    const areas = instructions.map((instruction, index) => ({
      ...referenceFixture,
      instruction,
      rect: { ...referenceFixture.rect, x: 100 + index * 100 },
    }));
    expect(parseAreaReferences(areas, 'editor:project-a')).toEqual(areas);
    const messages = buildTurnMessages('portable-model', 'Apply the instructions', {}, areas);
    const user = messages.find((message) => message.role === 'user');
    expect(user?.role === 'user' && user.images?.map((image) => image.label)).toEqual(
      instructions.map((note, index) => `Area ${index + 1} — Frame 12. Instruction: ${note}`),
    );
    instructions.forEach((note) => expect(user?.content).toContain(note));
    const earlier = buildTurnMessages('portable-model', 'Previous area', {}, referenceFixture);
    const retained = compactChatHistory([
      ...earlier,
      ...messages,
      { role: 'user', content: 'Apply those three changes' },
    ]);
    expect(
      retained.flatMap((message) => (message.role === 'user' ? (message.images ?? []) : [])),
    ).toHaveLength(3);
  });
  it('rejects excessive counts, mixed compositions and oversized annotations', () => {
    expect(() =>
      parseAreaReferences(Array(9).fill(referenceFixture), 'editor:project-a'),
    ).toThrow();
    expect(() =>
      parseAreaReferences(
        [referenceFixture, { ...referenceFixture, compositionId: 'other' }],
        'editor:project-a',
      ),
    ).toThrow();
    expect(() =>
      parseAreaReferences(
        [{ ...referenceFixture, instruction: 'x'.repeat(2001) }],
        'editor:project-a',
      ),
    ).toThrow();
    expect(() => parseAreaReferences([], 'editor:project-a')).toThrow();
  });
  it('retains the latest visual reference through tool rounds and follow-ups, without accumulating older images', () => {
    const earlier = buildTurnMessages('portable-model', 'Old area', {}, referenceFixture);
    const latest = buildTurnMessages('portable-model', 'New area', {}, referenceFixture);
    const history = compactChatHistory([
      ...earlier,
      ...latest,
      { role: 'user', content: 'Move it a little more' },
    ]);
    const images = history.flatMap((message) =>
      message.role === 'user' ? (message.images ?? []) : [],
    );
    expect(images).toHaveLength(1);
    expect(history.at(-1)?.content).toBe('Move it a little more');
    expect(earlier.some((message) => message.role === 'user' && message.images?.length)).toBe(true);
  });
});
