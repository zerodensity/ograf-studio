import {
  createComposition,
  createDefaultTransform,
  createFieldDefinition,
  createKeyframe,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  createTransition,
  type EasingPreset,
  type Layer,
  type LayerTransform,
  type Project,
} from '@ograf-editor/scene-model';

interface AuthoredKey {
  frame: number;
  transform: Partial<LayerTransform>;
  easing?: EasingPreset;
}

function keyLayer(layer: Layer, base: LayerTransform, keys: AuthoredKey[]): Layer {
  layer.keyframes = keys.map((key) =>
    createLayerKeyframe(key.frame, createDefaultTransform({ ...base, ...key.transform }), {
      easing: key.easing ?? 'linear',
    }),
  );
  return layer;
}

/** A deliberately rich, exportable lower third for exercising the editor and OGraf lifecycle. */
export function createLowerThirdExampleProject(): Project {
  const start = createKeyframe({ name: 'Off Air', role: 'start' });
  const onAir = createKeyframe({ name: 'On Air', role: 'step' });
  const end = createKeyframe({ name: 'Clear', role: 'end' });
  const nameField = createFieldDefinition('text', {
    key: 'presenterName',
    label: 'Presenter name',
    defaultValue: 'ALEX MORGAN',
    required: true,
  });
  const titleField = createFieldDefinition('text', {
    key: 'presenterTitle',
    label: 'Presenter title',
    defaultValue: 'Senior Broadcast Producer',
  });

  const panel = createLayerOfKind('rectangle');
  panel.name = 'Glass Panel';
  if (panel.element.type === 'rectangle') {
    panel.element.fill = '#151a27';
    panel.element.borderRadius = 12;
    panel.element.strokeColor = '#39445f';
    panel.element.strokeWidth = 2;
  }
  panel.effects = {
    ...panel.effects,
    dropShadowEnabled: true,
    dropShadowOpacity: 0.7,
    dropShadowOffsetX: 12,
    dropShadowOffsetY: 16,
    dropShadowBlur: 22,
  };
  keyLayer(panel, createDefaultTransform({ y: 790, width: 900, height: 190 }), [
    { frame: 0, transform: { x: -980, opacity: 0 } },
    { frame: 12, transform: { x: 90, opacity: 0.96 }, easing: 'expo-out' },
    { frame: 70, transform: { x: 90, opacity: 0.96 } },
    { frame: 88, transform: { x: -980, opacity: 0 }, easing: 'back-in' },
    { frame: 90, transform: { x: -980, opacity: 0 } },
  ]);

  const accent = createLayerOfKind('rectangle');
  accent.name = 'Accent Sweep';
  if (accent.element.type === 'rectangle') {
    accent.element.fill = '#29b6f6';
    accent.element.borderRadius = 6;
  }
  accent.effects = { ...accent.effects, blur: 0.5 };
  keyLayer(accent, createDefaultTransform({ y: 790, width: 18, height: 190 }), [
    { frame: 0, transform: { x: -80, opacity: 0 } },
    { frame: 8, transform: { x: 90, opacity: 1 }, easing: 'back-out' },
    { frame: 72, transform: { x: 90, opacity: 1 } },
    { frame: 82, transform: { x: 1040, opacity: 0 }, easing: 'expo-in' },
    { frame: 90, transform: { x: 1040, opacity: 0 } },
  ]);

  const pulse = createLayerOfKind('ellipse');
  pulse.name = 'Live Pulse';
  if (pulse.element.type === 'ellipse') pulse.element.fill = '#ff4d67';
  pulse.effects = {
    ...pulse.effects,
    dropShadowEnabled: true,
    dropShadowColor: '#ff4d67',
    dropShadowOpacity: 0.75,
    dropShadowOffsetX: 0,
    dropShadowOffsetY: 0,
    dropShadowBlur: 14,
  };
  keyLayer(pulse, createDefaultTransform({ x: 130, y: 830 }), [
    { frame: 0, transform: { x: 141, y: 841, width: 1, height: 1, opacity: 0 } },
    {
      frame: 15,
      transform: { x: 130, y: 830, width: 22, height: 22, opacity: 1 },
      easing: 'elastic-out',
    },
    { frame: 70, transform: { x: 130, y: 830, width: 22, height: 22, opacity: 1 } },
    {
      frame: 78,
      transform: { x: 141, y: 841, width: 1, height: 1, opacity: 0 },
      easing: 'back-in',
    },
    { frame: 90, transform: { x: 141, y: 841, width: 1, height: 1, opacity: 0 } },
  ]);

  const name = createLayerOfKind('text');
  name.name = 'Presenter Name';
  name.binding = { fieldId: nameField.id, targetProperty: 'content' };
  if (name.element.type === 'text') {
    name.element.content = 'ALEX MORGAN';
    name.element.color = '#ffffff';
    name.element.fontFamily = 'Impact, Haettenschweiler, sans-serif';
    name.element.fontSize = 58;
    name.element.fontWeight = 700;
    name.element.autoFit = 'shrink-to-fit';
  }
  keyLayer(name, createDefaultTransform({ y: 815, width: 660, height: 76 }), [
    { frame: 0, transform: { x: -780, opacity: 0 } },
    { frame: 16, transform: { x: 175, opacity: 1 }, easing: 'back-out' },
    { frame: 70, transform: { x: 175, opacity: 1 } },
    { frame: 84, transform: { x: -780, opacity: 0 }, easing: 'expo-in' },
    { frame: 90, transform: { x: -780, opacity: 0 } },
  ]);

  const title = createLayerOfKind('text');
  title.name = 'Presenter Title';
  title.binding = { fieldId: titleField.id, targetProperty: 'content' };
  if (title.element.type === 'text') {
    title.element.content = 'Senior Broadcast Producer';
    title.element.color = '#8edcff';
    title.element.fontFamily = '"Trebuchet MS", sans-serif';
    title.element.fontSize = 30;
    title.element.fontWeight = 600;
    title.element.autoFit = 'shrink-to-fit';
  }
  keyLayer(title, createDefaultTransform({ x: 178, width: 650, height: 48 }), [
    { frame: 0, transform: { y: 940, opacity: 0 } },
    { frame: 18, transform: { y: 890, opacity: 1 }, easing: 'sine-out' },
    { frame: 70, transform: { y: 890, opacity: 1 } },
    { frame: 80, transform: { y: 940, opacity: 0 }, easing: 'sine-in' },
    { frame: 90, transform: { y: 940, opacity: 0 } },
  ]);

  const composition = createComposition({
    name: 'Lower Third Demo',
    width: 1920,
    height: 1080,
    frameRate: 30,
    backgroundColor: 'transparent',
    layers: [panel, accent, pulse, name, title],
    keyframes: [start, onAir, end],
    transitions: [
      createTransition(start.id, onAir.id, { durationFrames: 18, easing: 'expo-out' }),
      createTransition(onAir.id, end.id, { durationFrames: 72, easing: 'sine-in-out' }),
    ],
    dataFields: [nameField, titleField],
  });

  return createProject({
    name: 'Broadcast Lower Third Demo',
    description:
      'A multi-layer lower third exercising independent keys, easing, effects, and data.',
    version: '1.0.0',
    mainCompositionId: composition.id,
    compositions: [composition],
  });
}
