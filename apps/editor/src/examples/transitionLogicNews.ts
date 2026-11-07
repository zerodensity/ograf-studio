import {
  createComposition,
  createCornerRadii,
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
  instantiateComponentDefinition,
  normalizeClockTimerSettings,
  reconcileComponentInstances,
  type ComponentDefinition,
  type Layer,
  type LayerTransform,
  type Paint,
  type TransitionLogicDefinition,
  type TransitionLogicSharedValue,
} from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from '../state/projectSet';

export const NEWS_FRAME_RATE = 50;
export const NEWS_DEFAULT_DATA = {
  name: 'MAYA BENNETT',
  role: 'INTERNATIONAL AFFAIRS CORRESPONDENT',
  headline: 'WORLD LEADERS AGREE ON CLIMATE FRAMEWORK',
  breaking: 'LANDMARK AGREEMENT REACHED IN GENEVA',
  detail: 'Live coverage · Global summit',
  ticker:
    'GLOBAL SUMMIT  /  Leaders commit to a new climate framework  •  More coverage throughout the evening',
};

const panelPaint: Paint = {
  type: 'shader',
  name: 'Northline · continuous glass sheen',
  speed: 1,
  resolutionScale: 1,
  parameters: {},
  fragmentSource: `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 base = mix(vec3(0.015, 0.035, 0.065), vec3(0.035, 0.095, 0.15), uv.y);
    float sweep = fract(iTime * 0.12) * 1.8 - 0.4;
    float sheen = exp(-pow((uv.x + uv.y * 0.08 - sweep) / 0.085, 2.0));
    float edge = smoothstep(0.978, 1.0, uv.y);
    float accent = 1.0 - smoothstep(0.003, 0.006, uv.x);
    base += sheen * vec3(0.06, 0.11, 0.14);
    base = mix(base, vec3(0.35, 0.86, 0.96), max(edge * 0.34, accent));
    fragColor = vec4(base, 0.96);
  }`,
};

const brightText: Paint = {
  type: 'linear',
  angle: 180,
  stops: [
    { offset: 0, color: '#ffffff', opacity: 1 },
    { offset: 1, color: '#bad9e9', opacity: 1 },
  ],
};

function pose(layer: Layer, values: Partial<LayerTransform>): Layer {
  layer.keyframes = [
    createLayerKeyframe(0, createDefaultTransform(values), { id: `${layer.id}-pose` }),
  ];
  return layer;
}

function rect(id: string, name: string, values: Partial<LayerTransform>, fill: Paint): Layer {
  const layer = createLayerOfKind('rectangle');
  layer.id = id;
  layer.name = name;
  if (layer.element.type === 'rectangle') {
    layer.element.fill = fill;
    layer.element.borderRadius = createCornerRadii(0);
  }
  return pose(layer, values);
}

function text(
  id: string,
  name: string,
  content: string,
  values: Partial<LayerTransform>,
  fontSize: number,
  fill: Paint = brightText,
): Layer {
  const layer = createLayerOfKind('text');
  layer.id = id;
  layer.name = name;
  if (layer.element.type === 'text') {
    Object.assign(layer.element, {
      content,
      fill,
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize,
      fontWeight: 700,
      autoFit: 'shrink-to-fit',
      minFontSize: fontSize * 0.7,
      overflowPolicy: 'clip',
      verticalAlign: 'middle',
      lineHeight: 1.1,
      letterSpacing: fontSize >= 40 ? -0.5 : 1.8,
    });
  }
  return pose(layer, values);
}

function component(id: string, name: string, layers: Layer[]): ComponentDefinition {
  return { id, name, scope: 'set', layers, dataFields: [] };
}

/** Editable assets and ordinary linked instances accompany the coordinated rehearsal. */
export function createTransitionLogicNewsExample(referenceTimeMs = Date.now()): ProjectSetDocument {
  const panel = rect(
    'news-glass',
    'Shared glass panel · continuous sheen',
    { x: 96, y: 756, width: 1728, height: 274 },
    panelPaint,
  );
  panel.effects = {
    ...panel.effects,
    dropShadowEnabled: true,
    dropShadowOpacity: 0.4,
    dropShadowOffsetY: 12,
    dropShadowBlur: 26,
  };
  const brandTile = rect(
    'news-brand-tile',
    'Brand tile',
    { x: 116, y: 784, width: 146, height: 146 },
    '#b91635',
  );
  const brandName = text(
    'news-brand-name',
    'Northline logo',
    'N',
    { x: 126, y: 784, width: 126, height: 102 },
    92,
    '#ffffff',
  );
  if (brandName.element.type === 'text') brandName.element.textAlign = 'center';
  const brandLabel = text(
    'news-brand-label',
    'Network label',
    'NORTHLINE',
    { x: 126, y: 882, width: 126, height: 26 },
    15,
    '#ffffff',
  );
  if (brandLabel.element.type === 'text') brandLabel.element.textAlign = 'center';
  const clock = text(
    'news-clock',
    'Persistent system clock',
    '00:00:00',
    { x: 1614, y: 982, width: 188, height: 28 },
    24,
    '#8faabd',
  );
  if (clock.element.type === 'text') {
    clock.element.clock = normalizeClockTimerSettings({
      referenceTimeMs,
      timeZone: 'UTC',
      format: 'hh:mm:ss',
    });
    clock.element.textAlign = 'right';
    clock.element.textAnimation = {
      ...clock.element.textAnimation,
      type: 'roll-up',
      durationFrames: 15,
      replayOnUpdate: true,
    };
  }
  const clockLabel = text(
    'news-clock-label',
    'Time zone',
    'UTC',
    { x: 1534, y: 982, width: 70, height: 28 },
    15,
    '#6b8b9d',
  );
  const assets = [
    component('news-panel-asset', 'Northline / Glass panel', [panel]),
    component('news-brand-asset', 'Northline / Network logo', [brandTile, brandName, brandLabel]),
    component('news-clock-asset', 'Northline / System clock', [clockLabel, clock]),
  ];
  const sharedInstances = assets.map((asset) => ({
    id: `${asset.id}-on-air`,
    name: asset.name,
    componentAssetId: asset.id,
    continuityKey: `${asset.id}-continuity`,
    slotId: 'lower-third',
  }));
  const shared = (
    state: 'name' | 'headline' | 'breaking' | 'off',
  ): TransitionLogicSharedValue[] => {
    const width = state === 'name' ? 1530 : 1728;
    const y = state === 'breaking' ? 728 : state === 'name' ? 788 : 756;
    const height = state === 'breaking' ? 302 : state === 'name' ? 242 : 274;
    return assets.flatMap((asset, index) =>
      asset.layers.flatMap((layer) => {
        const add = (property: string, value: number): TransitionLogicSharedValue => ({
          instanceId: sharedInstances[index]!.id,
          sourceLayerId: layer.id,
          property,
          value,
        });
        const result = [add('opacity', state === 'off' ? 0 : 1)];
        if (layer.id === panel.id)
          result.push(add('width', width), add('y', y), add('height', height));
        else if (asset.id === 'news-brand-asset') {
          const dy = layer.id === 'news-brand-label' ? 126 : 28;
          result.push(add('y', y + dy));
        } else {
          result.push(
            add('x', layer.id === 'news-clock' ? width - 114 : width - 194),
            add('y', 982),
          );
        }
        return result;
      }),
    );
  };
  const stateIds = ['name', 'headline', 'breaking', 'ticker'] as const;
  const definition: TransitionLogicDefinition = {
    version: 3,
    id: 'northline-news-transitions',
    name: 'Northline News / Transition Logic',
    defaultTransitionId: 'news-replace',
    slots: [
      {
        id: 'lower-third',
        name: 'Lower third',
        order: 0,
        defaultTransitionId: 'news-replace',
        updateTransitionId: 'news-update',
      },
      {
        id: 'ticker',
        name: 'Ticker',
        order: 1,
        defaultTransitionId: 'news-ticker',
        updateTransitionId: 'news-ticker',
      },
    ],
    states: stateIds.map((id) => ({
      id,
      name:
        id === 'name'
          ? 'Correspondent'
          : id === 'headline'
            ? 'Headline'
            : id === 'breaking'
              ? 'Breaking news'
              : 'Ticker',
      slotId: id === 'ticker' ? 'ticker' : 'lower-third',
      templateId: `news-template-${id}`,
      family: id === 'ticker' ? 'news-ticker' : 'news-lower-third',
      ...(id === 'ticker' ? {} : { sharedValues: shared(id) }),
    })),
    transitions: [
      {
        id: 'news-replace',
        name: 'Reshape and replace',
        durationFrames: 32,
        outgoingFrames: 12,
        incomingStartFrame: 14,
        incomingFrames: 18,
        sharedFrames: 32,
        easing: 'ease-in-out',
      },
      {
        id: 'news-in',
        name: 'Take in',
        durationFrames: 36,
        outgoingFrames: 0,
        incomingStartFrame: 12,
        incomingFrames: 24,
        sharedFrames: 30,
        easing: 'ease-out',
      },
      {
        id: 'news-out',
        name: 'Take out',
        durationFrames: 28,
        outgoingFrames: 18,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 28,
        easing: 'ease-in-out',
      },
      {
        id: 'news-update',
        name: 'Update content',
        durationFrames: 20,
        outgoingFrames: 8,
        incomingStartFrame: 8,
        incomingFrames: 12,
        sharedFrames: 0,
        easing: 'ease-out',
      },
      {
        id: 'news-ticker',
        name: 'Ticker content update',
        durationFrames: 24,
        outgoingFrames: 16,
        incomingStartFrame: 0,
        incomingFrames: 24,
        sharedFrames: 0,
        easing: 'ease-out',
      },
      {
        id: 'news-ticker-in',
        name: 'Reserve room, then reveal ticker',
        durationFrames: 84,
        outgoingFrames: 0,
        incomingStartFrame: 34,
        incomingFrames: 50,
        sharedFrames: 0,
        layoutPhase: { startFrame: 0, durationFrames: 30 },
        easing: 'ease-in-out',
      },
      {
        id: 'news-ticker-out',
        name: 'Hide ticker, then restore room',
        durationFrames: 69,
        outgoingFrames: 35,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        layoutPhase: { startFrame: 39, durationFrames: 30 },
        easing: 'ease-in-out',
      },
    ],
    routes: [
      {
        id: 'news-from-off',
        slotId: 'lower-third',
        from: null,
        to: '*',
        transitionId: 'news-in',
        priority: 10,
      },
      {
        id: 'news-to-off',
        slotId: 'lower-third',
        from: '*',
        to: null,
        transitionId: 'news-out',
        priority: 20,
      },
      {
        id: 'news-ticker-from-off',
        slotId: 'ticker',
        from: null,
        to: '*',
        transitionId: 'news-ticker-in',
        priority: 10,
      },
      {
        id: 'news-ticker-to-off',
        slotId: 'ticker',
        from: '*',
        to: null,
        transitionId: 'news-ticker-out',
        priority: 20,
      },
    ],
    sharedInstances,
    initialSharedValues: shared('off'),
    layoutRules: [
      {
        id: 'news-ticker-room',
        name: 'Make room for ticker',
        slotId: 'lower-third',
        whenSlotId: 'ticker',
        sharedOffsets: [
          {
            instanceId: 'news-panel-asset-on-air',
            sourceLayerId: 'news-glass',
            property: 'height',
            value: -62,
          },
          ...['news-clock', 'news-clock-label'].map((sourceLayerId) => ({
            instanceId: 'news-clock-asset-on-air',
            sourceLayerId,
            property: 'y',
            value: -62,
          })),
        ],
      },
    ],
  };
  const templates = stateIds.map((id) => {
    const fields = Object.entries(NEWS_DEFAULT_DATA).map(([key, value]) =>
      createFieldDefinition('text', {
        id: `news-field-${key}`,
        key,
        label: key[0]!.toUpperCase() + key.slice(1),
        defaultValue: value,
      }),
    );
    const composition = createComposition({
      id: `news-comp-${id}`,
      name: `Northline / ${id}`,
      width: 1920,
      height: 1080,
      frameRate: NEWS_FRAME_RATE,
      components: structuredClone(assets),
      dataFields: fields,
    });
    if (id !== 'ticker') {
      for (const [index, asset] of assets.entries()) {
        const instance = instantiateComponentDefinition(composition, asset, { x: 0, y: 0 }, true, {
          instanceId: sharedInstances[index]!.id,
          groupId: `${asset.id}-group`,
          layerIds: Object.fromEntries(
            asset.layers.map((layer) => [layer.id, `${id}-${layer.id}`]),
          ),
          fieldIds: {},
          keyIds: {},
        });
        for (const layer of instance.layers) {
          for (const value of shared(id)) {
            if (
              value.sourceLayerId === layer.componentLink?.sourceLayerId &&
              typeof value.value === 'number'
            ) {
              for (const key of layer.keyframes)
                (key.transform as unknown as Record<string, number>)[value.property] = value.value;
              for (const key of layer.animationTracks[value.property as keyof LayerTransform] ?? [])
                key.value = value.value;
            }
          }
        }
        composition.layers.push(...instance.layers);
      }
      reconcileComponentInstances(composition);
    }
    const boundText = (
      key: keyof typeof NEWS_DEFAULT_DATA,
      values: Partial<LayerTransform>,
      size: number,
      fill: Paint = brightText,
    ): Layer => {
      const layer = text(
        `${id}-${key}`,
        `${id} / ${key}`,
        NEWS_DEFAULT_DATA[key],
        values,
        size,
        fill,
      );
      layer.bindings = [{ fieldId: `news-field-${key}`, targetProperty: 'content' }];
      return layer;
    };
    if (id === 'name')
      composition.layers.push(
        text(
          'name-kicker',
          'Correspondent kicker',
          'LIVE  /  GENEVA',
          { x: 300, y: 805, width: 970, height: 25 },
          18,
          '#65d6e9',
        ),
        boundText('name', { x: 298, y: 834, width: 1180, height: 65 }, 54),
        boundText('role', { x: 300, y: 904, width: 1020, height: 32 }, 23, '#9ab3c4'),
      );
    else if (id === 'headline' || id === 'breaking') {
      const y = id === 'breaking' ? 750 : 778;
      if (id === 'breaking')
        composition.layers.push(
          rect(
            'breaking-label-bg',
            'Breaking label backing',
            { x: 300, y, width: 242, height: 32 },
            '#b91635',
          ),
        );
      composition.layers.push(
        text(
          `${id}-kicker`,
          'Editorial status',
          id === 'breaking' ? 'BREAKING NEWS' : 'THE GLOBAL BRIEF',
          { x: id === 'breaking' ? 312 : 300, y, width: 1250, height: 32 },
          20,
          id === 'breaking' ? '#ffffff' : '#65d6e9',
        ),
        boundText(id, { x: 298, y: y + 42, width: 1470, height: 70 }, id === 'breaking' ? 48 : 46),
        boundText('detail', { x: 300, y: y + 126, width: 1130, height: 32 }, 24, '#9ab3c4'),
      );
    } else {
      const tickerWindow = rect(
        'ticker-window',
        'Ticker crawl window',
        { x: 292, y: 982, width: 1516, height: 48 },
        'transparent',
      );
      tickerWindow.clipChildren = true;
      tickerWindow.semantics = {
        role: 'mask',
        tags: ['ticker', 'clip'],
        description: 'Keeps the moving ticker inside its strip and clear of the fixed label.',
      };
      const textWidth = 1680;
      const repeatDistance = textWidth + 80;
      const durationFrames = Math.round((repeatDistance / 140) * NEWS_FRAME_RATE);
      const crawls = [0, 1].map((copy) => {
        const startX = 292 + copy * repeatDistance;
        const crawl = boundText(
          'ticker',
          { x: startX, y: 988, width: textWidth, height: 36 },
          25,
          '#132b3b',
        );
        crawl.id = `ticker-crawl-${copy + 1}`;
        crawl.keyframes[0]!.id = `${crawl.id}-pose`;
        crawl.name = `Ticker crawl · ${copy === 0 ? 'first' : 'repeat'} copy`;
        crawl.parentId = tickerWindow.id;
        if (crawl.element.type === 'text') {
          // One line at every data length; fitting keeps both repeated tiles identical.
          crawl.element.autoFit = 'fit-to-width';
          crawl.element.letterSpacing = 0.8;
          crawl.element.overflowPolicy = 'clip';
        }
        crawl.semantics = {
          role: 'ticker',
          tags: ['ticker', 'crawl', 'qa:allow-loop-seam', 'qa:allow-offcanvas'],
          description: 'Two equally spaced, data-bound copies produce a continuous leftward crawl.',
        };
        crawl.loop = createLayerLoopClip({
          id: `ticker-crawl-loop-${copy + 1}`,
          name: 'Ticker · continuous crawl',
          activation: { type: 'lifecycle' },
          durationFrames,
          repeatCount: null,
          tracks: {
            x: [
              createLayerPropertyKeyframe(0, startX, {
                id: `ticker-crawl-start-${copy + 1}`,
                easing: 'linear',
              }),
              createLayerPropertyKeyframe(durationFrames, startX - repeatDistance, {
                id: `ticker-crawl-end-${copy + 1}`,
                easing: 'linear',
              }),
            ],
          },
        });
        return crawl;
      });
      composition.layers.push(
        rect(
          'ticker-strip',
          'Ticker background',
          { x: 96, y: 982, width: 1728, height: 48 },
          '#e7eff5',
        ),
        rect(
          'ticker-label-bg',
          'Ticker label background',
          { x: 96, y: 982, width: 180, height: 48 },
          '#b91635',
        ),
        text(
          'ticker-label',
          'Ticker label',
          'LATEST',
          { x: 118, y: 990, width: 140, height: 32 },
          21,
          '#ffffff',
        ),
        tickerWindow,
        ...crawls,
      );
    }
    return {
      id: `news-template-${id}`,
      name: definition.states.find((state) => state.id === id)!.name,
      inheritSettings: true,
      project: createProject({
        id: `news-project-${id}`,
        name: `Northline / ${id}`,
        description:
          'Editable news template with shared component assets and coordinated transition definitions. Open the Transition Logic rehearsal to take states on air.',
        mainCompositionId: composition.id,
        compositions: [composition],
      }),
    };
  });
  return {
    id: 'northline-transition-logic-example',
    name: 'Northline News / Transition Logic',
    nameOrigin: 'custom',
    activeTemplateId: templates[0]!.id,
    templates,
    controls: [],
    assetSlots: [],
    assets: [],
    componentAssets: assets,
    transitionLogic: definition,
  };
}
