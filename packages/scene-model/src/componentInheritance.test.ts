import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import {
  buildComponentDefinition,
  addEffect,
  cloneComponentValue,
  createComposition,
  createProject,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerVisualRule,
  getLayerTransformAtFrame,
  getLayerEffectsAtFrame,
  getResolvedLayerAnimationTracks,
  instantiateComponentDefinition,
  linkExistingComponentLayers,
  makeComponentInstanceUnique,
  reconcileComponentInstances,
  reconcileProjectComponentInstances,
  resetComponentInstanceOverrides,
  updateComponentDefinitionFromLayers,
  type ComponentInstanceIdentity,
  type Composition,
  type Layer,
  type RendererPluginSnapshot,
} from './index';

function shape(layer: Layer) {
  if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
  return layer.element;
}

function text(layer: Layer) {
  if (layer.element.type !== 'text') throw new Error('Expected text.');
  return layer.element;
}

function authored(kind: 'rectangle' | 'text' | 'ellipse', x = 80): Layer {
  const layer = createLayerOfKind(kind);
  layer.keyframes = [0, 12, 24].map((frame) =>
    createLayerKeyframe(frame, {
      x,
      y: 700,
      width: 320,
      height: 80,
      rotation: 0,
      opacity: frame === 12 ? 1 : 0,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    }),
  );
  return layer;
}

function fixture() {
  const composition = createComposition();
  const rectangle = authored('rectangle');
  const headline = authored('text', 100);
  const firstField = createFieldDefinition('text', {
    key: 'headline',
    label: 'Headline',
    defaultValue: 'Initial headline',
  });
  const secondField = createFieldDefinition('color', {
    key: 'plateColor',
    defaultValue: '#102030',
  });
  rectangle.bindings = [{ fieldId: secondField.id, targetProperty: 'fill' }];
  headline.bindings = [{ fieldId: firstField.id, targetProperty: 'content' }];
  shape(rectangle).fill = '#102030';
  text(headline).fontSize = 30;
  composition.layers.push(rectangle, headline);
  composition.dataFields.push(firstField, secondField);
  const definition = buildComponentDefinition(composition, [rectangle.id, headline.id], 'News');
  composition.components.push(definition);
  const original = linkExistingComponentLayers(composition, definition, [
    rectangle.id,
    headline.id,
  ]);
  const duplicate = instantiateComponentDefinition(composition, definition, { x: 300, y: 0 });
  composition.layers.push(...duplicate.layers);
  composition.dataFields.push(...duplicate.dataFields);
  reconcileComponentInstances(composition);
  return {
    composition,
    definition,
    original,
    duplicate,
    rectangle,
    headline,
    firstField,
    secondField,
  };
}

describe('persistent component inheritance', () => {
  it('keeps export keys with authored instances through reconciliation and reset', () => {
    const composition = createComposition();
    const source = authored('text');
    source.exportKey = 'scoreline';
    composition.layers.push(source);
    const definition = buildComponentDefinition(composition, [source.id], 'Score');
    expect(definition.layers[0]).not.toHaveProperty('exportKey');
    composition.components.push(definition);
    linkExistingComponentLayers(composition, definition, [source.id]);
    const duplicate = instantiateComponentDefinition(composition, definition).layers[0]!;
    composition.layers.push(duplicate);
    expect(duplicate).not.toHaveProperty('exportKey');
    duplicate.exportKey = 'away-score';

    definition.layers[0]!.name = 'Updated source';
    reconcileComponentInstances(composition);
    resetComponentInstanceOverrides(composition, [source.id, duplicate.id]);
    expect(composition.layers.map((layer) => layer.exportKey)).toEqual(['scoreline', 'away-score']);
    expect(
      composition.layers.every(
        (layer) => !layer.componentLink?.overridePaths?.includes('/exportKey'),
      ),
    ).toBe(true);
  });

  it('keeps an explicitly deleted inherited pose absent without freezing unrelated source changes', () => {
    const { composition, definition, duplicate, headline } = fixture();
    const localId = duplicate.layerIds[headline.id]!;
    const local = composition.layers.find((layer) => layer.id === localId)!;
    const key = local.keyframes.find((item) => item.frame === 12)!;
    const source = definition.layers.find((layer) => layer.id === headline.id)!;
    const sibling = composition.layers.find((layer) => layer.id === headline.id)!;
    local.keyframes = local.keyframes.filter((item) => item.id !== key.id);
    for (const [property, track] of Object.entries(local.animationTracks)) {
      if (track && track.length > 1)
        local.animationTracks[property as keyof typeof local.animationTracks] = track.filter(
          (item) => item.frame !== 12,
        );
    }
    reconcileComponentInstances(composition);
    expect(local.keyframes.map((item) => item.frame)).toEqual([0, 24]);
    expect(local.componentLink?.overridePaths).toContain(`/keyframes/@${key.id}`);
    expect(sibling.keyframes.map((item) => item.frame)).toEqual([0, 12, 24]);
    expect(reconcileComponentInstances(composition)).toEqual([]);

    // A source change outside the deletion and a newly added pose still propagate.
    text(source).color = '#aabbcc';
    source.keyframes.push(createLayerKeyframe(6, { ...source.keyframes[0]!.transform }));
    source.animationTracks.opacity!.push(createLayerPropertyKeyframe(6, 0.4));
    reconcileComponentInstances(composition);
    expect(text(local).color).toBe('#aabbcc');
    expect(local.keyframes.map((item) => item.frame)).toContain(6);
    expect(local.keyframes.map((item) => item.frame)).not.toContain(12);

    // Moving that same source identity does not resurrect it in the overridden instance.
    source.keyframes.find((item) => item.frame === 12)!.frame = 15;
    for (const track of Object.values(source.animationTracks))
      for (const item of track ?? []) if (item.frame === 12) item.frame = 15;
    reconcileComponentInstances(composition);
    expect(local.keyframes.map((item) => item.frame)).not.toContain(15);
    expect(sibling.keyframes.map((item) => item.frame)).toContain(15);

    // Persisted overrides still suppress the removed source key after reopening.
    const reopened = JSON.parse(JSON.stringify(composition)) as Composition;
    reconcileComponentInstances(reopened);
    const restored = reopened.layers.find((layer) => layer.id === localId)!;
    expect(restored.keyframes.map((item) => item.frame)).not.toContain(15);
    expect(restored.componentLink?.overridePaths).toContain(`/keyframes/@${key.id}`);
    const baseline = restored.componentLink!.baseline!;
    const localX = restored.animationTracks.x!.find((item) => item.frame === 0)!;
    localX.value = 777;
    const localXId = localX.id;
    resetComponentInstanceOverrides(reopened, [localId], [`/keyframes/@${key.id}`]);
    expect(restored.keyframes.find((item) => item.frame === 15)?.id).toBe(key.id);
    for (const [property, track] of Object.entries(baseline.animationTracks)) {
      const sourceKey = track?.find((item) => item.frame === 15);
      if (!sourceKey) continue;
      const restoredKey = restored.animationTracks[
        property as keyof typeof restored.animationTracks
      ]?.find((item) => item.frame === 15);
      expect(restoredKey?.value).toEqual(sourceKey.value);
    }
    expect(restored.animationTracks.x!.find((item) => item.frame === 0)).toMatchObject({
      id: localXId,
      value: 777,
    });
    expect(restored.componentLink?.overridePaths).not.toContain(`/keyframes/@${key.id}`);
    resetComponentInstanceOverrides(reopened, [localId]);
    expect(restored.keyframes.find((item) => item.frame === 15)?.id).toBe(key.id);
    expect(restored.animationTracks.x!.find((item) => item.frame === 0)?.value).not.toBe(777);
    expect(restored.componentLink?.overridePaths).not.toContain(`/keyframes/@${key.id}`);
  });

  it('preserves untouched legacy-only hold markers and permits deleting one explicitly', () => {
    const composition = createComposition();
    const source = authored('rectangle');
    source.animationTracks = cloneComponentValue(getResolvedLayerAnimationTracks(source));
    const hold = createLayerKeyframe(6, { ...source.keyframes[0]!.transform });
    source.keyframes.push(hold);
    composition.layers.push(source);
    const definition = buildComponentDefinition(composition, [source.id], 'Legacy hold');
    composition.components.push(definition);
    const instance = instantiateComponentDefinition(composition, definition);
    composition.layers.push(...instance.layers);
    const local = instance.layers[0]!;
    reconcileComponentInstances(composition);
    expect(local.keyframes.map((item) => item.frame)).toContain(6);
    const holdId = local.keyframes.find((item) => item.frame === 6)!.id;
    local.keyframes = local.keyframes.filter((item) => item.id !== holdId);
    reconcileComponentInstances(composition);
    expect(local.keyframes.map((item) => item.frame)).not.toContain(6);
    expect(local.keyframes.map((item) => item.frame)).toEqual([0, 12, 24]);
    resetComponentInstanceOverrides(composition, [local.id]);
    expect(local.keyframes.find((item) => item.frame === 6)?.id).toBe(holdId);
  });

  it('does not infer a keyframe deletion from timeline retiming or an equivalent local pose', () => {
    const { composition, duplicate, headline } = fixture();
    const local = composition.layers.find((layer) => layer.id === duplicate.layerIds[headline.id])!;
    const beforeId = local.keyframes.find((item) => item.frame === 12)!.id;
    // A replacement of an aggregate identity at the same frame is not a deletion.
    local.keyframes.find((item) => item.frame === 12)!.id = 'replacement-at-same-frame';
    reconcileComponentInstances(composition);
    expect(local.componentLink?.overridePaths).not.toContain(`/keyframes/@${beforeId}`);
    expect(local.keyframes.find((item) => item.frame === 12)?.id).toBe('replacement-at-same-frame');

    // Changing the host lifecycle maps source keys to new frames without recording deletions.
    composition.transitions[0]!.durationFrames = 18;
    reconcileComponentInstances(composition);
    expect(local.componentLink?.overridePaths?.some((path) => path.startsWith('/keyframes/'))).toBe(
      false,
    );
    expect(local.keyframes.map((key) => key.frame)).toContain(18);
  });

  it('adopts a new mask/path child into the promoted instance in place and updates siblings once', () => {
    const { composition, definition, original, duplicate, rectangle, headline, firstField } =
      fixture();
    const panel = composition.layers.find(
      (layer) => layer.id === duplicate.layerIds[rectangle.id],
    )!;
    const title = composition.layers.find((layer) => layer.id === duplicate.layerIds[headline.id])!;
    shape(rectangle).fill = '#fc6200';
    rectangle.animationTracks.width![1]!.value = 465;
    reconcileComponentInstances(composition);
    const localKeys = cloneComponentValue(rectangle.animationTracks);
    const newField = createFieldDefinition('color', { key: 'maskColor', defaultValue: '#ffffff' });
    const mask = authored('rectangle', 460);
    mask.name = 'New mask';
    mask.bindings = [{ fieldId: newField.id, targetProperty: 'fill' }];
    composition.dataFields.push(newField);
    composition.layers.push(mask);
    panel.mask = { sourceLayerId: mask.id, mode: 'alpha', inverted: false };
    title.motionPath = {
      sourceLayerId: mask.id,
      orientToPath: false,
      progress: 0,
      offsetX: 0,
      offsetY: 0,
    };
    panel.visualRules = [
      createLayerVisualRule({
        trigger: 'click',
        actions: [{ type: 'visibility', targetLayerId: mask.id, visible: false }],
      }),
    ];
    const external = authored('rectangle', 1200);
    external.mask = { sourceLayerId: mask.id, mode: 'alpha', inverted: false };
    composition.layers.push(external);
    const maskAnimation = cloneComponentValue(getResolvedLayerAnimationTracks(mask));
    const beforeIds = composition.layers.map((layer) => layer.id);
    const selected = [panel.id, title.id, mask.id];
    const updated = updateComponentDefinitionFromLayers(composition, definition.id, selected);
    expect(updated.sourceInstanceId).toBe(duplicate.instanceId);
    expect(updated.adoptedLayerIds).toEqual([mask.id]);
    reconcileComponentInstances(composition);
    const sourceMask = composition.layers.find((layer) => layer.id === mask.id)!;
    const sourcePanel = composition.layers.find((layer) => layer.id === panel.id)!;
    expect(beforeIds.every((id) => composition.layers.some((layer) => layer.id === id))).toBe(true);
    expect(composition.layers.filter((layer) => layer.id === mask.id)).toHaveLength(1);
    expect(sourceMask.componentLink).toMatchObject({
      instanceId: duplicate.instanceId,
      sourceLayerId: mask.id,
    });
    expect(sourceMask.bindings[0]!.fieldId).toBe(newField.id);
    expect(sourceMask.animationTracks).toEqual(maskAnimation);
    expect(sourcePanel.mask?.sourceLayerId).toBe(mask.id);
    expect(sourcePanel.visualRules[0]!.actions[0]).toMatchObject({ targetLayerId: mask.id });
    expect(composition.layers.find((layer) => layer.id === external.id)!.mask?.sourceLayerId).toBe(
      mask.id,
    );
    expect(
      updated.definition.layers.find((layer) => layer.id === rectangle.id)!.mask?.sourceLayerId,
    ).toBe(mask.id);
    expect(
      updated.definition.layers.find((layer) => layer.id === headline.id)!.motionPath
        ?.sourceLayerId,
    ).toBe(mask.id);
    expect(updated.definition.dataFields.map((field) => field.id)).toContain(firstField.id);
    const otherMask = composition.layers.filter(
      (layer) =>
        layer.componentLink?.instanceId === original.instanceId &&
        layer.componentLink.sourceLayerId === mask.id,
    );
    expect(otherMask).toHaveLength(1);
    expect(composition.layers.find((layer) => layer.id === rectangle.id)!.mask?.sourceLayerId).toBe(
      otherMask[0]!.id,
    );
    expect(
      shape(composition.layers.find((layer) => layer.id === rectangle.id)! as Layer).fill,
    ).toBe('#fc6200');
    expect(composition.layers.find((layer) => layer.id === rectangle.id)!.animationTracks).toEqual(
      localKeys,
    );
    const stable = cloneComponentValue(composition);
    updateComponentDefinitionFromLayers(composition, definition.id, selected);
    reconcileComponentInstances(composition);
    expect(composition).toEqual(stable);
    // Newly promoted children follow subsequent parent edits; source local animation is unchanged.
    shape(
      composition.components
        .find((component) => component.id === definition.id)!
        .layers.find((layer) => layer.id === mask.id)!,
    ).fill = '#0099ff';
    reconcileComponentInstances(composition);
    expect(shape(composition.layers.find((layer) => layer.id === mask.id)!).fill).toBe('#0099ff');
    expect(composition.layers.find((layer) => layer.id === mask.id)!.animationTracks).toEqual(
      maskAnimation,
    );
  });

  it('rejects ambiguous, foreign, or locked component update selections without changing the document', () => {
    const { composition, definition, original, duplicate } = fixture();
    const independent = authored('rectangle');
    composition.layers.push(independent);
    const before = cloneComponentValue(composition);
    expect(() =>
      updateComponentDefinitionFromLayers(composition, definition.id, [
        original.layers[0]!.id,
        duplicate.layers[0]!.id,
      ]),
    ).toThrow('one instance');
    expect(composition).toEqual(before);
    independent.isLocked = true;
    const locked = cloneComponentValue(composition);
    expect(() =>
      updateComponentDefinitionFromLayers(composition, definition.id, [independent.id]),
    ).toThrow('locked');
    expect(composition).toEqual(locked);
    independent.isLocked = false;
    const foreign = buildComponentDefinition(composition, [independent.id], 'Other component');
    composition.components.push(foreign);
    linkExistingComponentLayers(composition, foreign, [independent.id]);
    const linked = cloneComponentValue(composition);
    expect(() =>
      updateComponentDefinitionFromLayers(composition, definition.id, [independent.id]),
    ).toThrow('another component');
    expect(composition).toEqual(linked);
  });

  it('turns an independent replacement selection into one live source instance without copying it', () => {
    const { composition, definition } = fixture();
    const replacement = authored('rectangle');
    composition.layers.push(replacement);
    const update = updateComponentDefinitionFromLayers(composition, definition.id, [
      replacement.id,
    ]);
    reconcileComponentInstances(composition);
    expect(composition.layers.filter((layer) => layer.id === replacement.id)).toHaveLength(1);
    expect(
      composition.layers.find((layer) => layer.id === replacement.id)!.componentLink,
    ).toMatchObject({
      componentId: definition.id,
      instanceId: update.sourceInstanceId,
      sourceLayerId: replacement.id,
    });
    const stable = cloneComponentValue(composition);
    updateComponentDefinitionFromLayers(composition, definition.id, [replacement.id]);
    reconcileComponentInstances(composition);
    expect(composition).toEqual(stable);
  });
  it('keeps the saved originals under their external parent and preserves their external rules', () => {
    const composition = createComposition();
    const parent = authored('rectangle');
    const child = authored('text', 100);
    child.parentId = parent.id;
    child.visualRules = [
      createLayerVisualRule({
        trigger: 'click',
        actions: [{ type: 'visibility', targetLayerId: parent.id, visible: false }],
      }),
    ];
    composition.layers.push(parent, child);
    const beforeRules = cloneComponentValue(child.visualRules);
    const definition = buildComponentDefinition(composition, [child.id], 'Portable child');
    composition.components.push(definition);
    linkExistingComponentLayers(composition, definition, [child.id]);
    reconcileComponentInstances(composition);
    expect(definition.layers[0]!.parentId).toBeNull();
    expect(definition.layers[0]!.visualRules).toEqual([]);
    expect(child.parentId).toBe(parent.id);
    expect(child.visualRules).toEqual(beforeRules);
    expect(child.componentLink?.overridePaths).toContain('/parentId');
    expect(child.componentLink?.overridePaths).toContain('/visualRules');
    text(definition.layers[0]!).fontSize = 47;
    reconcileComponentInstances(composition);
    expect(text(child).fontSize).toBe(47);
    expect(child.parentId).toBe(parent.id);
  });
  it('updates inherited defaults on Immer drafts while preserving local style, motion, data, and identities', () => {
    const { composition, definition, duplicate, rectangle, headline, firstField } = fixture();
    const localRect = composition.layers.find(
      (layer) => layer.id === duplicate.layerIds[rectangle.id],
    )!;
    shape(localRect).fill = '#ffcc00';
    localRect.animationTracks.opacity![1]!.value = 0.35;
    const localField = composition.dataFields.find(
      (field) => field.id === duplicate.fieldIds[firstField.id],
    )!;
    localField.defaultValue = 'Local story';
    const before = cloneComponentValue(localRect);
    const previous = cloneComponentValue(composition);
    const changed = produce(composition, (draft) => {
      const master = draft.components.find((item) => item.id === definition.id)!;
      shape(master.layers.find((layer) => layer.id === rectangle.id)!).fill = '#00aaff';
      master.layers.find((layer) => layer.id === rectangle.id)!.animationTracks.opacity![1]!.value =
        0.8;
      text(master.layers.find((layer) => layer.id === headline.id)!).fontSize = 52;
      master.dataFields.find((field) => field.id === firstField.id)!.defaultValue = 'Master story';
      master.dataFields.find((field) => field.id === firstField.id)!.label = 'On-air headline';
      reconcileComponentInstances(draft, previous);
    });
    const current = changed.layers.find((layer) => layer.id === before.id)!;
    expect(shape(current).fill).toBe('#ffcc00');
    expect(shape(changed.layers.find((layer) => layer.id === rectangle.id)!).fill).toBe('#00aaff');
    expect(current.animationTracks.opacity).toEqual(before.animationTracks.opacity);
    expect(current.animationTracks.x!.map((key) => key.id)).toEqual(
      before.animationTracks.x!.map((key) => key.id),
    );
    expect(current.keyframes.map((key) => key.id)).toEqual(before.keyframes.map((key) => key.id));
    expect(current.bindings).toEqual(before.bindings);
    expect(current.groupId).toBe(before.groupId);
    expect(current.componentLink?.instanceId).toBe(before.componentLink?.instanceId);
    const updatedHeadline = changed.layers.find(
      (layer) => layer.id === duplicate.layerIds[headline.id],
    )!;
    expect(text(updatedHeadline).fontSize).toBe(52);
    expect(changed.dataFields.find((field) => field.id === localField.id)).toMatchObject({
      key: localField.key,
      defaultValue: 'Local story',
      label: 'On-air headline',
    });
    expect(changed.dataFields.find((field) => field.id === firstField.id)?.defaultValue).toBe(
      'Master story',
    );
    const plain = cloneComponentValue(changed);
    const bytes = JSON.stringify(plain);
    expect(reconcileComponentInstances(plain)).toEqual([]);
    expect(JSON.stringify(plain)).toBe(bytes);
  });

  it('treats uniform instance translation as placement and keeps inheriting source animation', () => {
    const { composition, definition, duplicate } = fixture();
    const members = composition.layers.filter(
      (layer) => layer.componentLink?.instanceId === duplicate.instanceId,
    );
    for (const layer of members) {
      for (const key of layer.keyframes) {
        key.transform.x += 75;
        key.transform.y += 18;
      }
      for (const key of layer.animationTracks.x!) key.value += 75;
      for (const key of layer.animationTracks.y!) key.value += 18;
    }
    reconcileComponentInstances(composition);
    for (const layer of members) {
      expect(layer.componentLink?.offset).toEqual({ x: 375, y: 18 });
      expect(layer.componentLink?.overridePaths).not.toContain('/animationTracks/x');
      expect(layer.componentLink?.overridePaths).not.toContain('/animationTracks/y');
    }
    const before = getLayerTransformAtFrame(members[0]!, 12).x;
    for (const source of definition.layers)
      for (const key of source.animationTracks.x!) key.value += 10;
    reconcileComponentInstances(composition);
    expect(getLayerTransformAtFrame(members[0]!, 12).x).toBe(before + 10);
  });

  it('inherits effect defaults by stable effect ID and preserves a locally animated effect after source removal', () => {
    const { composition, definition, duplicate, rectangle } = fixture();
    const master = definition.layers.find((layer) => layer.id === rectangle.id)!;
    const glow = addEffect(master, 'glow', {
      blendMode: 'screen',
      params: { radius: 5, color: '#22aaff', opacity: 0.4 },
    });
    reconcileComponentInstances(composition);
    const local = composition.layers.find(
      (layer) => layer.id === duplicate.layerIds[rectangle.id],
    )!;
    const localGlow = local.effects.stack!.find((effect) => effect.id === glow.id)!;
    localGlow.params.radius = 7;
    const property = `effects.${glow.id}.radius` as keyof typeof local.animationTracks;
    local.animationTracks[property]![0]!.value = 7;
    const keyId = local.animationTracks[property]![0]!.id;
    reconcileComponentInstances(composition);
    glow.params.radius = 14;
    glow.params.color = '#ffaacc';
    reconcileComponentInstances(composition);
    const sampled = getLayerEffectsAtFrame(local, 12).stack!.find(
      (effect) => effect.id === glow.id,
    )!;
    expect(sampled.params).toMatchObject({ radius: 7, color: '#ffaacc' });
    expect(local.animationTracks[property]![0]!.id).toBe(keyId);
    master.effects.stack = master.effects.stack!.filter((effect) => effect.id !== glow.id);
    reconcileComponentInstances(composition);
    expect(local.effects.stack!.find((effect) => effect.id === glow.id)).toBeTruthy();
    expect(
      composition.layers
        .find((layer) => layer.id === rectangle.id)!
        .effects.stack?.some((effect) => effect.id === glow.id),
    ).toBe(false);
    expect(
      getLayerEffectsAtFrame(local, 12).stack!.find((effect) => effect.id === glow.id)!.params
        .radius,
    ).toBe(7);
  });

  it('resets only the selected child, removes optional overrides, and preserves sibling parameters', () => {
    const { composition, duplicate, rectangle, headline, firstField, secondField } = fixture();
    const plate = composition.layers.find(
      (layer) => layer.id === duplicate.layerIds[rectangle.id],
    )!;
    const title = composition.layers.find((layer) => layer.id === duplicate.layerIds[headline.id])!;
    plate.crop = {
      points: [
        { x: 0.2, y: 0 },
        { x: 0.8, y: 0 },
        { x: 0.8, y: 1 },
        { x: 0.2, y: 1 },
      ],
    };
    shape(plate).fill = '#abcdef';
    text(title).fontSize = 90;
    const headlineField = composition.dataFields.find(
      (field) => field.id === duplicate.fieldIds[firstField.id],
    )!;
    const colorField = composition.dataFields.find(
      (field) => field.id === duplicate.fieldIds[secondField.id],
    )!;
    headlineField.defaultValue = 'Sibling local value';
    colorField.defaultValue = '#abcdef';
    colorField.defaultTokenId = 'local-token';
    reconcileComponentInstances(composition);
    resetComponentInstanceOverrides(composition, [plate.id]);
    expect(plate.crop).toBeUndefined();
    expect(shape(plate).fill).toBe('#102030');
    expect(colorField.defaultValue).toBe('#102030');
    expect(colorField.defaultTokenId).toBeUndefined();
    expect(text(title).fontSize).toBe(90);
    expect(headlineField.defaultValue).toBe('Sibling local value');
    expect(reconcileComponentInstances(composition)).toEqual([]);
  });

  it('promotes a linked instance canonically and Make Unique retains its scene identities', () => {
    const { composition, definition, duplicate, rectangle, headline, firstField } = fixture();
    const members = composition.layers.filter(
      (layer) => layer.componentLink?.instanceId === duplicate.instanceId,
    );
    const first = members[0]!;
    shape(first).fill = '#ee8800';
    first.animationTracks.width![1]!.value = 440;
    const localField = composition.dataFields.find(
      (field) => field.id === duplicate.fieldIds[firstField.id],
    )!;
    localField.defaultValue = 'Independent';
    reconcileComponentInstances(composition);
    const promoted = buildComponentDefinition(
      composition,
      members.map((layer) => layer.id),
      definition.name,
      definition.id,
    );
    expect(promoted.layers.map((layer) => layer.id)).toEqual(
      definition.layers.map((layer) => layer.id),
    );
    expect(promoted.dataFields.map((field) => field.id)).toEqual(
      definition.dataFields.map((field) => field.id),
    );
    expect(getLayerTransformAtFrame(promoted.layers[0]!, 0).x).toBe(80);
    const ids = members.map((layer) => layer.id);
    const bindingId = members.find((layer) => layer.componentLink?.sourceLayerId === headline.id)!
      .bindings[0]!.fieldId;
    const unique = makeComponentInstanceUnique(composition, duplicate.instanceId);
    expect(unique.id).not.toBe(definition.id);
    expect(unique.scope).toBe('local');
    expect(members.map((layer) => layer.id)).toEqual(ids);
    expect(members.find((layer) => layer.bindings[0]?.fieldId === bindingId)).toBeTruthy();
    expect(localField.defaultValue).toBe('Independent');
    shape(definition.layers.find((layer) => layer.id === rectangle.id)!).fill = '#000000';
    reconcileComponentInstances(composition);
    expect(shape(first).fill).toBe('#ee8800');
    expect(first.animationTracks.width![1]!.value).toBe(440);
  });

  it('adds source children stably and retains an externally referenced deleted child as a private asset', () => {
    const { composition, definition, duplicate } = fixture();
    const beforeIds = composition.layers.map((layer) => layer.id);
    const added = authored('ellipse', 160);
    definition.layers.push(added);
    reconcileComponentInstances(composition);
    const child = composition.layers.find(
      (layer) =>
        layer.componentLink?.instanceId === duplicate.instanceId &&
        layer.componentLink.sourceLayerId === added.id,
    )!;
    expect(beforeIds.every((id) => composition.layers.some((layer) => layer.id === id))).toBe(true);
    const childId = child.id;
    const external = authored('rectangle', 1000);
    external.mask = { sourceLayerId: childId, mode: 'alpha', inverted: false };
    composition.layers.push(external);
    definition.layers = definition.layers.filter((layer) => layer.id !== added.id);
    reconcileComponentInstances(composition);
    expect(composition.layers.find((layer) => layer.id === childId)).toBe(child);
    expect(external.mask.sourceLayerId).toBe(childId);
    expect(child.componentLink?.componentId).not.toBe(definition.id);
    expect(
      composition.components.find((asset) => asset.id === child.componentLink?.componentId)?.scope,
    ).toBe('local');
    expect(reconcileComponentInstances(composition)).toEqual([]);
  });

  it('maps portable Step activation and inherited phase timing without copying unrelated providers', () => {
    const source = createComposition();
    const layer = authored('rectangle');
    layer.loop = createLayerLoopClip({
      activation: { type: 'step', stepKeyframeId: source.keyframes[1]!.id },
      durationFrames: 50,
      tracks: {
        opacity: [
          { id: 'loop-a', frame: 0, value: 0.4, easing: 'linear' },
          { id: 'loop-b', frame: 50, value: 1, easing: 'linear' },
        ],
      },
    });
    source.layers.push(layer);
    source.rendererPlugins = [
      {
        manifest: { id: 'unrelated', version: '1' },
        sha256: 'unused',
        source: 'unrelated-provider-code',
      } as RendererPluginSnapshot,
    ];
    const definition = buildComponentDefinition(source, [layer.id], 'Portable');
    expect(definition.context?.rendererPlugins).toEqual([]);
    const target = createComposition({ frameRate: 50 });
    for (const transition of target.transitions) transition.durationFrames = 24;
    target.components.push(cloneComponentValue(definition));
    const instance = instantiateComponentDefinition(target, definition);
    target.layers.push(...instance.layers);
    target.dataFields.push(...instance.dataFields);
    expect(instance.layers[0]!.loop?.activation).toEqual({
      type: 'step',
      stepKeyframeId: target.keyframes[1]!.id,
    });
    expect(instance.layers[0]!.animationTracks.opacity!.map((key) => key.frame)).toEqual([
      0, 24, 48,
    ]);
    expect(instance.layers[0]!.loop?.durationFrames).toBe(100);
    expect(instance.layers[0]!.loop?.tracks.opacity?.map((key) => key.frame)).toEqual([0, 100]);
    expect(reconcileComponentInstances(target)).toEqual([]);
  });

  it('propagates a changed set-scoped asset across project compositions while retaining each instance override', () => {
    const project = createProject();
    const first = project.compositions[0]!;
    const source = authored('text');
    first.layers.push(source);
    const definition = buildComponentDefinition(first, [source.id], 'Shared typography');
    definition.scope = 'set';
    first.components.push(definition);
    linkExistingComponentLayers(first, definition, [source.id]);
    const second = createComposition();
    second.components.push(cloneComponentValue(definition));
    const instance = instantiateComponentDefinition(second, definition);
    second.layers.push(...instance.layers);
    second.dataFields.push(...instance.dataFields);
    project.compositions.push(second);
    reconcileProjectComponentInstances(project);
    text(instance.layers[0]!).fontSize = 70;
    reconcileProjectComponentInstances(project);
    const previous = cloneComponentValue(project);
    text(definition.layers[0]!).fontSize = 45;
    text(definition.layers[0]!).color = '#778899';
    reconcileProjectComponentInstances(project, previous);
    expect(text(source).fontSize).toBe(45);
    expect(text(instance.layers[0]!).fontSize).toBe(70);
    expect(text(instance.layers[0]!).color).toBe('#778899');
    expect(text(second.components[0]!.layers[0]!).fontSize).toBe(45);
    expect(reconcileProjectComponentInstances(project, cloneComponentValue(project))).toEqual([]);
  });

  it('keeps reserved instance/key IDs deterministic and refuses unsafe imported override pointers', () => {
    const { composition, definition } = fixture();
    const identity: ComponentInstanceIdentity = {
      instanceId: 'reserved-instance',
      groupId: 'reserved-group',
      layerIds: {},
      fieldIds: {},
      keyIds: {},
    };
    for (const source of definition.layers) {
      identity.layerIds[source.id] = `reserved-${source.id}`;
      identity.keyIds[source.id] = Object.fromEntries([
        ...source.keyframes.map((key) => [key.id, `reserved-${key.id}`]),
        ...Object.values(getResolvedLayerAnimationTracks(source)).flatMap((keys) =>
          (keys ?? []).map((key) => [key.id, `reserved-${key.id}`]),
        ),
      ]);
    }
    for (const field of definition.dataFields) identity.fieldIds[field.id] = `reserved-${field.id}`;
    const a = instantiateComponentDefinition(
      cloneComponentValue(composition),
      cloneComponentValue(definition),
      { x: 400, y: 0 },
      true,
      identity,
    );
    const b = instantiateComponentDefinition(
      cloneComponentValue(composition),
      cloneComponentValue(definition),
      { x: 400, y: 0 },
      true,
      identity,
    );
    expect(a).toEqual(b);
    const local = composition.layers.find((layer) => layer.componentLink)!;
    local.componentLink!.overridePaths = ['/element/__proto__/polluted'];
    expect(() => reconcileComponentInstances(composition)).toThrow(
      'Unsafe component override path',
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
