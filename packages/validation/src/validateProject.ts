import { textAnimatorPaintErrors } from '@ograf-editor/scene-model';
import { clockDataSetting, clockSettingsWithData } from '@ograf-editor/scene-model';
import {
  isNodosTypeName,
  isGradientPaint,
  dataConnectionErrors,
  MAX_DATA_CONNECTIONS,
  cropRectErrors,
  layerCropErrors,
  sourceCropErrors,
  isMediaPaint,
  isShaderPaint,
  getElementFill,
  getElementShaderPaint,
  getElementShaderPaints,
  migrateShaderBindingTarget,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  shaderAnimationValueErrors,
  normalizeTextAnimation,
  textAnimationErrors,
  textCrawlErrors,
  tickerErrors,
  applyElementDataValue,
  elementAssetReferences,
  walkElementContents,
  readElementDataValue,
  validateClockTimerSettings,
  validateTimerAlarmTrigger,
  clockTimerActionId,
  parseClockTimerManualValue,
  isClockTimerActionId,
  isLayerRuleProperty,
  layerRulePropertyValueError,
  isVisualRuleEdgeDataRule,
  isVisualRuleMouseFieldId,
  visualRulePlayoutActionErrors,
  VISUAL_RULE_SET_DATA_MODES,
  visualRuleRange,
  VISUAL_RULE_EVENT_OPERATORS,
  VISUAL_RULE_OPERATOR_VALUES,
  VISUAL_RULE_TRIGGER_VALUES,
  isVisualRuleKeyboardTrigger,
  visualRuleKeyboardErrors,
  validateLogicFunctionDefinitions,
  layerTransformBindingErrors,
  type VisualRuleOperator,
  type VisualRuleTrigger,
} from '@ograf-editor/scene-model';

const VISUAL_RULE_TRIGGERS: ReadonlySet<VisualRuleTrigger> = new Set(VISUAL_RULE_TRIGGER_VALUES);
const VISUAL_RULE_OPERATORS: ReadonlySet<VisualRuleOperator> = new Set(VISUAL_RULE_OPERATOR_VALUES);

function comparableHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
    ?.toLowerCase();
  if (!hex) return null;
  const expanded =
    hex.length <= 4 ? [...hex].map((character) => character + character).join('') : hex;
  return expanded.length === 6 ? `${expanded}ff` : expanded;
}
import {
  layerEffectErrors,
  parseEffectProperty,
  effectParameterSpec,
  layerModifiersErrors,
  parseModifierProperty,
  modifierParameterSpec,
} from '@ograf-editor/scene-model';
import {
  layerMaskErrors,
  tilingPatternErrors,
  layerLightingErrors,
  stylePackColorLinkErrors,
  applyDesignTokenBinding,
  BLEND_MODES,
  inspectLottieAnimationData,
  parseChartData,
  chartPresentationErrors,
  chartRendererFeatureErrors,
  chartAnimationErrors,
  chartMarkAnimationErrors,
  validateRendererPluginSnapshot,
  validateRendererPluginReference,
  rendererPluginKey,
  rendererPluginByteLength,
  MAX_RENDERER_PLUGIN_CATALOG_ENTRIES,
  MAX_RENDERER_PLUGIN_CATALOG_BYTES,
  type RendererPluginSnapshot,
  validateAnimationPresetPluginSnapshot,
  studioPluginReference,
  studioPluginKey,
  layerMotionWindows,
  type AnimationPresetPluginSnapshot,
  inspectShaderElement,
  inspectShaderResourcePaint,
  inspectShaderSource,
  normalizeShaderParameterValue,
  valueAtSourcePath,
  getLayerAnimatableProperties,
  gradientStopIndexForProperty,
  isRevealAnimationProperty,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
  fieldDefinitionAtPath,
  validatePaint,
  typographyPresetsErrors,
  typographyBindingErrors,
  backgroundStylesErrors,
  mediaPaintAssetReferences,
  type Composition,
  type FieldDefinition,
  type Project,
  type Asset,
  type Layer,
} from '@ograf-editor/scene-model';

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

const componentRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const componentIdValid = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;

function validateComponentPaths(value: unknown, owner: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 1024) {
    errors.push(`${owner} override paths must be an array of at most 1024 JSON Pointers.`);
    return;
  }
  const used = new Set<string>();
  for (const path of value) {
    if (
      typeof path !== 'string' ||
      path === '/' ||
      path.length > 4096 ||
      !/^\/(?:[^~]|~[01])*$/.test(path) ||
      path
        .split('/')
        .slice(1)
        .some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment)) ||
      /^\/(id|componentLink)(\/|$)/.test(path)
    ) {
      errors.push(`${owner} has an invalid or immutable override path.`);
      continue;
    }
    if (used.has(path)) errors.push(`${owner} repeats override path "${path}".`);
    used.add(path);
  }
}

function validateComponentIdMap(value: unknown, owner: string, errors: string[]): void {
  if (!componentRecord(value) || Object.keys(value).length > 10000) {
    errors.push(`${owner} must be an ID mapping with at most 10000 entries.`);
    return;
  }
  for (const [source, target] of Object.entries(value))
    if (
      !componentIdValid(source) ||
      !componentIdValid(target) ||
      ['__proto__', 'prototype', 'constructor'].includes(source)
    )
      errors.push(`${owner} contains an invalid source or instance ID.`);
}

function validateComponentLink(layer: Layer, owner: string, errors: string[]): void {
  const link = layer.componentLink;
  if (!link) return;
  if (!componentRecord(link)) {
    errors.push(`${owner} component link must be an object.`);
    return;
  }
  for (const property of ['componentId', 'instanceId', 'sourceLayerId'] as const)
    if (!componentIdValid(link[property]))
      errors.push(`${owner} component ${property} is invalid.`);
  if (link.overridePaths !== undefined) validateComponentPaths(link.overridePaths, owner, errors);
  for (const key of ['fieldIds', 'keyIds'] as const)
    if (link[key] !== undefined) validateComponentIdMap(link[key], `${owner} ${key}`, errors);
  if (
    link.offset !== undefined &&
    (!componentRecord(link.offset) ||
      !Number.isFinite(link.offset.x) ||
      !Number.isFinite(link.offset.y))
  )
    errors.push(`${owner} component offset requires finite x and y.`);
  if (link.baseline !== undefined) {
    const baseline = link.baseline;
    if (
      !componentRecord(baseline) ||
      baseline.id !== layer.id ||
      !componentRecord(baseline.element) ||
      !componentRecord(baseline.effects) ||
      !componentRecord(baseline.animationTracks) ||
      !Array.isArray(baseline.keyframes) ||
      baseline.keyframes.length === 0 ||
      Object.prototype.hasOwnProperty.call(baseline, 'componentLink')
    )
      errors.push(
        `${owner} component baseline must be an inherited layer snapshot with matching identity.`,
      );
  }
  if (link.fieldBaselines !== undefined) {
    if (!componentRecord(link.fieldBaselines) || Object.keys(link.fieldBaselines).length > 10000)
      errors.push(`${owner} component field baselines must be a bounded source-field mapping.`);
    else
      for (const [sourceId, field] of Object.entries(link.fieldBaselines)) {
        if (
          !componentIdValid(sourceId) ||
          !componentRecord(field) ||
          !componentIdValid(field.id) ||
          typeof field.key !== 'string' ||
          !Array.isArray(field.options) ||
          !Array.isArray(field.properties) ||
          !Array.isArray(field.fileExtensions) ||
          !componentRecord(field.constraints)
        )
          errors.push(`${owner} component field baseline is invalid.`);
      }
  }
  if (link.fieldOverridePaths !== undefined) {
    if (
      !componentRecord(link.fieldOverridePaths) ||
      Object.keys(link.fieldOverridePaths).length > 10000
    )
      errors.push(`${owner} component field overrides must be a bounded source-field mapping.`);
    else
      for (const [sourceId, paths] of Object.entries(link.fieldOverridePaths)) {
        if (!componentIdValid(sourceId))
          errors.push(`${owner} component override source-field ID is invalid.`);
        validateComponentPaths(paths, `${owner} field ${sourceId}`, errors);
      }
  }
}

function validateAsset(asset: Asset, owner: string, errors: string[]): void {
  if (!componentIdValid(asset.id)) errors.push(`${owner} asset ID is invalid.`);
  if (typeof asset.dataUri !== 'string' || !asset.dataUri.startsWith('data:'))
    errors.push(`${owner} asset "${asset.name}" must contain a data URI.`);
  if (asset.kind === 'font' && !asset.fontFamily?.trim())
    errors.push(`${owner} font asset "${asset.name}" requires a font family name.`);
  if (
    asset.packagePath &&
    (asset.packagePath.startsWith('/') ||
      asset.packagePath.startsWith('\\') ||
      asset.packagePath.includes('\\') ||
      asset.packagePath.split('/').includes('..') ||
      /^[a-z]:/i.test(asset.packagePath))
  )
    errors.push(`${owner} asset "${asset.name}" package path must be a safe relative URL.`);
  if (
    asset.kind === 'font' &&
    asset.fontWeight &&
    !/^([1-9]00|[1-9]00 [1-9]00)$/.test(asset.fontWeight)
  )
    errors.push(
      `${owner} font asset "${asset.name}" weight must be a CSS weight such as 400 or a range such as 100 900.`,
    );
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) (seen.has(value) ? duplicate : seen).add(value);
  return [...duplicate];
}

function validateFieldDefinition(field: FieldDefinition, owner: string, errors: string[]): void {
  if (field.nodosType !== undefined && !isNodosTypeName(field.nodosType))
    errors.push(
      `${owner}: nodosType must be a nonempty Nodos type name of at most 256 characters.`,
    );
  if (isVisualRuleMouseFieldId(field.id) || isVisualRuleMouseFieldId(field.key))
    errors.push(`${owner}: Mouse X and Mouse Y are reserved Rules operands, not data fields.`);
  for (const duplicate of duplicates(field.properties.map((property) => property.key))) {
    errors.push(`${owner}: repeats object property key "${duplicate}".`);
  }
  if (field.type === 'object') {
    if (field.items !== null) errors.push(`${owner}: object fields cannot declare array items.`);
    for (const property of field.properties) {
      if (!property.key.trim()) errors.push(`${owner}: object property keys cannot be empty.`);
      validateFieldDefinition(property, `${owner}.${property.key || '<empty>'}`, errors);
    }
  } else if (field.properties.length > 0) {
    errors.push(`${owner}: only object fields can declare properties.`);
  }
  if (field.type === 'array') {
    if (!field.items) errors.push(`${owner}: array fields require an item schema.`);
    else validateFieldDefinition(field.items, `${owner}[]`, errors);
  } else if (field.items !== null) {
    errors.push(`${owner}: only array fields can declare an item schema.`);
  }

  const optionValues = field.options.map((option) => option.value);
  for (const duplicate of duplicates(optionValues)) {
    errors.push(`${owner}: repeats select option value "${duplicate}".`);
  }
  if ((field.type === 'select' || field.type === 'select-multiple') && field.options.length === 0) {
    errors.push(`${owner}: select fields require at least one option.`);
  }
  if (field.options.some((option) => !option.value.trim() || !option.label.trim())) {
    errors.push(`${owner}: select option values and labels cannot be empty.`);
  }
  if (field.type === 'select' && !optionValues.includes(String(field.defaultValue))) {
    errors.push(`${owner}: select default must match one declared option.`);
  }
  if (
    field.type === 'select-multiple' &&
    (!Array.isArray(field.defaultValue) ||
      field.defaultValue.some(
        (value) => typeof value !== 'string' || !optionValues.includes(value),
      ))
  ) {
    errors.push(`${owner}: select-multiple defaults must be declared option values.`);
  }
  if (
    (field.type === 'integer' || field.type === 'duration-ms') &&
    (!Number.isInteger(field.defaultValue) ||
      (Number(field.defaultValue) < 0 && field.type === 'duration-ms'))
  ) {
    errors.push(
      `${owner}: ${field.type} default must be ${field.type === 'duration-ms' ? 'a non-negative ' : 'an '}integer.`,
    );
  }
  if (
    (field.type === 'number' || field.type === 'percentage') &&
    (typeof field.defaultValue !== 'number' || !Number.isFinite(field.defaultValue))
  ) {
    errors.push(`${owner}: numeric default must be finite.`);
  }
  const constraints = field.constraints;
  for (const key of ['minLength', 'maxLength'] as const) {
    const value = constraints[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${owner}: ${key} must be a non-negative integer.`);
    }
  }
  for (const key of ['minItems', 'maxItems'] as const) {
    const value = constraints[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${owner}: ${key} must be a non-negative integer.`);
    }
  }
  if (
    constraints.minLength !== undefined &&
    constraints.maxLength !== undefined &&
    constraints.minLength > constraints.maxLength
  ) {
    errors.push(`${owner}: minLength cannot exceed maxLength.`);
  }
  if (
    constraints.minimum !== undefined &&
    constraints.maximum !== undefined &&
    constraints.minimum > constraints.maximum
  ) {
    errors.push(`${owner}: minimum cannot exceed maximum.`);
  }
  if (
    constraints.minItems !== undefined &&
    constraints.maxItems !== undefined &&
    constraints.minItems > constraints.maxItems
  ) {
    errors.push(`${owner}: minItems cannot exceed maxItems.`);
  }
  if (
    constraints.step !== undefined &&
    (!Number.isFinite(constraints.step) || constraints.step <= 0)
  ) {
    errors.push(`${owner}: step must be a positive finite number.`);
  }
  if (constraints.pattern) {
    try {
      new RegExp(constraints.pattern);
    } catch {
      errors.push(`${owner}: pattern is not a valid regular expression.`);
    }
  }
  if (typeof field.defaultValue === 'string') {
    if (constraints.minLength !== undefined && field.defaultValue.length < constraints.minLength) {
      errors.push(`${owner}: default is shorter than minLength.`);
    }
    if (constraints.maxLength !== undefined && field.defaultValue.length > constraints.maxLength) {
      errors.push(`${owner}: default exceeds maxLength.`);
    }
    if (constraints.pattern) {
      try {
        if (!new RegExp(constraints.pattern).test(field.defaultValue)) {
          errors.push(`${owner}: default does not match pattern.`);
        }
      } catch {
        // The invalid pattern is reported above.
      }
    }
  }
  if (typeof field.defaultValue === 'number') {
    if (constraints.minimum !== undefined && field.defaultValue < constraints.minimum) {
      errors.push(`${owner}: default is below minimum.`);
    }
    if (constraints.maximum !== undefined && field.defaultValue > constraints.maximum) {
      errors.push(`${owner}: default exceeds maximum.`);
    }
  }
  if (field.type === 'boolean' && typeof field.defaultValue !== 'boolean') {
    errors.push(`${owner}: boolean default must be boolean.`);
  }
  const stringTypes = new Set(['text', 'textarea', 'color', 'image-url', 'file-path', 'select']);
  if (stringTypes.has(field.type) && typeof field.defaultValue !== 'string') {
    errors.push(`${owner}: ${field.type} default must be a string.`);
  }
  if (field.type === 'gradient') {
    if (
      !field.defaultValue ||
      typeof field.defaultValue !== 'object' ||
      Array.isArray(field.defaultValue) ||
      !('stops' in field.defaultValue)
    ) {
      errors.push(`${owner}: gradient default must be a gradient paint.`);
    } else {
      for (const problem of validatePaint(
        field.defaultValue as Parameters<typeof validatePaint>[0],
      )) {
        errors.push(`${owner}: gradient default ${problem}.`);
      }
    }
  }
  if (field.type === 'object') {
    if (
      !field.defaultValue ||
      typeof field.defaultValue !== 'object' ||
      Array.isArray(field.defaultValue)
    ) {
      errors.push(`${owner}: object default must be an object.`);
    } else {
      const value = field.defaultValue as Record<string, unknown>;
      for (const property of field.properties) {
        if (property.required && !Object.hasOwn(value, property.key)) {
          errors.push(`${owner}: default is missing required property "${property.key}".`);
          continue;
        }
        if (Object.hasOwn(value, property.key)) {
          validateFieldDefaultValue(
            property,
            value[property.key],
            `${owner} default.${property.key}`,
            errors,
          );
        }
      }
    }
  }
  if (field.type === 'array') {
    if (!Array.isArray(field.defaultValue)) {
      errors.push(`${owner}: array default must be an array.`);
    } else {
      if (constraints.minItems !== undefined && field.defaultValue.length < constraints.minItems) {
        errors.push(`${owner}: default has fewer than minItems.`);
      }
      if (constraints.maxItems !== undefined && field.defaultValue.length > constraints.maxItems) {
        errors.push(`${owner}: default exceeds maxItems.`);
      }
      if (field.items) {
        field.defaultValue.forEach((value, index) =>
          validateFieldDefaultValue(field.items!, value, `${owner} default[${index}]`, errors),
        );
      }
    }
  }
  for (const extension of field.fileExtensions) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(extension)) {
      errors.push(`${owner}: invalid file extension "${extension}".`);
    }
  }
}

function validateFieldDefaultValue(
  field: FieldDefinition,
  value: unknown,
  owner: string,
  errors: string[],
): void {
  validateFieldDefinition(
    { ...field, defaultValue: value as FieldDefinition['defaultValue'] },
    owner,
    errors,
  );
}

function validateComposition(composition: Composition, errors: string[], warnings: string[]): void {
  for (const error of validateLogicFunctionDefinitions(composition.functions, composition))
    errors.push(`Composition "${composition.name}": ${error}`);
  const prefix = `Composition "${composition.name}"`;
  const connections = composition.dataConnections ?? [];
  if (!Array.isArray(connections) || connections.length > MAX_DATA_CONNECTIONS)
    errors.push(
      `${prefix}: data connections must contain at most ${MAX_DATA_CONNECTIONS} entries.`,
    );
  else {
    const connectionIds = new Set<string>();
    for (const connection of connections) {
      const issues = dataConnectionErrors(connection, composition.dataFields);
      errors.push(...issues.map((issue) => `${prefix}: ${issue}`));
      if (!issues.length && connectionIds.has(connection.id))
        errors.push(`${prefix}: duplicate data connection ${connection.id}.`);
      connectionIds.add(connection?.id);
    }
  }
  const rendererPlugins = Array.isArray(composition.rendererPlugins)
    ? composition.rendererPlugins
    : [];
  const pluginsByKey = new Map<string, RendererPluginSnapshot>();
  if (composition.rendererPlugins !== undefined && !Array.isArray(composition.rendererPlugins))
    errors.push(`${prefix}: renderer plugin catalog must be an array.`);
  if (rendererPlugins.length > MAX_RENDERER_PLUGIN_CATALOG_ENTRIES)
    errors.push(`${prefix}: renderer plugin catalog exceeds 16 snapshots.`);
  let pluginBytes = 0;
  for (const snapshot of rendererPlugins) {
    const pluginErrors = validateRendererPluginSnapshot(snapshot);
    errors.push(...pluginErrors.map((error) => `${prefix}: ${error}`));
    if (pluginErrors.length) continue;
    pluginBytes +=
      rendererPluginByteLength(snapshot.source) +
      rendererPluginByteLength(snapshot.licenseText) +
      rendererPluginByteLength(JSON.stringify(snapshot.manifest));
    const key = rendererPluginKey({ ...snapshot.manifest, sha256: snapshot.sha256 });
    if (pluginsByKey.has(key)) errors.push(`${prefix}: duplicate renderer plugin snapshot ${key}.`);
    pluginsByKey.set(key, snapshot);
  }
  if (pluginBytes > MAX_RENDERER_PLUGIN_CATALOG_BYTES)
    errors.push(`${prefix}: renderer plugin catalog exceeds 8 MiB.`);
  const animationPlugins = Array.isArray(composition.animationPresetPlugins)
    ? composition.animationPresetPlugins
    : [];
  const animationByKey = new Map<string, AnimationPresetPluginSnapshot>();
  if (
    composition.animationPresetPlugins !== undefined &&
    !Array.isArray(composition.animationPresetPlugins)
  )
    errors.push(`${prefix}: animation preset catalog must be an array.`);
  if (animationPlugins.length > MAX_RENDERER_PLUGIN_CATALOG_ENTRIES)
    errors.push(`${prefix}: animation preset catalog exceeds 16 snapshots.`);
  let animationBytes = 0;
  for (const snapshot of animationPlugins) {
    const snapshotErrors = validateAnimationPresetPluginSnapshot(snapshot);
    errors.push(...snapshotErrors.map((error) => `${prefix}: ${error}`));
    if (snapshotErrors.length) continue;
    animationBytes +=
      rendererPluginByteLength(JSON.stringify(snapshot.manifest)) +
      rendererPluginByteLength(JSON.stringify(snapshot.presets)) +
      rendererPluginByteLength(snapshot.licenseText);
    const key = studioPluginKey(studioPluginReference(snapshot));
    if (animationByKey.has(key))
      errors.push(`${prefix}: duplicate animation preset snapshot ${key}.`);
    animationByKey.set(key, snapshot);
  }
  if (animationBytes > MAX_RENDERER_PLUGIN_CATALOG_BYTES)
    errors.push(`${prefix}: animation preset catalog exceeds 8 MiB.`);
  const motionWindows = layerMotionWindows(composition);
  for (const layer of composition.layers) {
    if (layer.animationPresets === undefined) continue;
    const applications = layer.animationPresets;
    if (!applications || typeof applications !== 'object' || Array.isArray(applications)) {
      errors.push(
        `${prefix}: layer "${layer.name}" animation preset provenance must be an object.`,
      );
      continue;
    }
    if (Object.keys(applications).some((key) => key !== 'in' && key !== 'out'))
      errors.push(
        `${prefix}: layer "${layer.name}" animation preset provenance contains unknown sides.`,
      );
    for (const side of ['in', 'out'] as const) {
      const application = applications[side];
      if (application === undefined) continue;
      const label = `${prefix}: layer "${layer.name}" ${side} animation preset`;
      if (!application || typeof application !== 'object' || Array.isArray(application)) {
        errors.push(`${label} provenance must be an object.`);
        continue;
      }
      if (
        Object.keys(application).some(
          (key) =>
            !['reference', 'presetId', 'durationFrames', 'offsetFrames', 'parameters'].includes(
              key,
            ),
        )
      )
        errors.push(`${label} provenance contains unknown fields.`);
      const referenceErrors = validateRendererPluginReference(application.reference);
      errors.push(...referenceErrors.map((error) => `${label}: ${error}`));
      const snapshot = !referenceErrors.length
        ? animationByKey.get(studioPluginKey(application.reference))
        : undefined;
      if (!referenceErrors.length && !snapshot)
        errors.push(`${label} requires a missing pinned definition/version/digest.`);
      const preset = snapshot?.presets.find((candidate) => candidate.id === application.presetId);
      if (snapshot && !preset) errors.push(`${label} has an unknown preset id.`);
      if (preset && !preset.tracks[side]?.length)
        errors.push(`${label} does not declare this side.`);
      if (preset?.targetKinds && !preset.targetKinds.includes(layer.element.type))
        errors.push(`${label} does not support this element kind.`);
      const duration = application.durationFrames;
      const offset = application.offsetFrames ?? 0;
      const available = motionWindows
        ? side === 'in'
          ? motionWindows.inFrames
          : motionWindows.outFrames
        : 0;
      if (
        !Number.isInteger(duration) ||
        duration < 1 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        duration + offset > available
      )
        errors.push(`${label} duration/offset must fit its lifecycle window.`);
      if (
        !application.parameters ||
        typeof application.parameters !== 'object' ||
        Array.isArray(application.parameters)
      )
        errors.push(`${label} parameters must be an object.`);
      else if (preset)
        for (const [id, value] of Object.entries(application.parameters)) {
          const parameter = preset.parameters?.find((candidate) => candidate.id === id);
          if (
            !parameter ||
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < parameter.min ||
            value > parameter.max
          )
            errors.push(`${label} parameter ${id} is unknown or outside its declared range.`);
        }
    }
  }
  for (const error of stylePackColorLinkErrors(composition)) errors.push(`${prefix}: ${error}`);
  const patternIds = new Set<string>();
  for (const pattern of composition.patterns) {
    if (patternIds.has(pattern.id)) errors.push(`${prefix}: duplicate pattern ID ${pattern.id}.`);
    patternIds.add(pattern.id);
    for (const problem of tilingPatternErrors(pattern))
      errors.push(`${prefix}: pattern "${pattern.name}": ${problem}`);
  }
  for (const layer of composition.layers) {
    for (const problem of layerLightingErrors(layer, composition.patterns))
      errors.push(`${prefix}: ${problem}`);
    if (layer.crop)
      for (const problem of layerCropErrors(layer.crop))
        errors.push(`${prefix}: layer "${layer.name}" ${problem}.`);
    if (layer.element.type === 'pattern') {
      if (!patternIds.has(layer.element.patternId))
        errors.push(`${prefix}: layer "${layer.name}" references a missing pattern.`);
      if (layer.loop && layer.loop.activation.type !== 'lifecycle')
        errors.push(
          `${prefix}: pattern layer "${layer.name}" requires lifecycle loop activation to preserve the shared clock.`,
        );
    }
  }
  for (const problem of layerMaskErrors(composition)) errors.push(`${prefix}: ${problem}`);
  if (!finitePositive(composition.width) || !finitePositive(composition.height)) {
    errors.push(`${prefix}: width and height must be finite positive numbers.`);
  }
  if (composition.crop)
    for (const problem of cropRectErrors(composition.crop, composition, true))
      errors.push(`${prefix}: ${problem}.`);
  if (!finitePositive(composition.frameRate))
    errors.push(`${prefix}: frame rate must be positive.`);
  if (
    !Number.isInteger(composition.updateTransitionFrames) ||
    composition.updateTransitionFrames < 0
  ) {
    errors.push(`${prefix}: update transition frames must be a non-negative integer.`);
  }

  const starts = composition.keyframes.filter((keyframe) => keyframe.role === 'start');
  const ends = composition.keyframes.filter((keyframe) => keyframe.role === 'end');
  if (starts.length !== 1 || composition.keyframes[0]?.role !== 'start') {
    errors.push(`${prefix}: requires exactly one Start state in the first position.`);
  }
  if (ends.length !== 1 || composition.keyframes.at(-1)?.role !== 'end') {
    errors.push(`${prefix}: requires exactly one End state in the final position.`);
  }
  if (composition.keyframes.slice(1, -1).some((keyframe) => keyframe.role !== 'step')) {
    errors.push(`${prefix}: only Step states may appear between Start and End.`);
  }

  const typeErrors = typographyPresetsErrors(
    composition.designSystem.typography === undefined ? [] : composition.designSystem.typography,
  );
  for (const error of typeErrors) errors.push(`${prefix}: ${error}`);
  const typographyCatalog = typeErrors.length ? [] : (composition.designSystem.typography ?? []);
  const backgroundErrors = backgroundStylesErrors(
    composition.designSystem.backgrounds === undefined ? [] : composition.designSystem.backgrounds,
  );
  for (const error of backgroundErrors) errors.push(`${prefix}: ${error}`);
  const backgroundCatalog = backgroundErrors.length
    ? []
    : (composition.designSystem.backgrounds ?? []);
  if (composition.backgroundPaint !== undefined)
    for (const error of backgroundStylesErrors([
      { id: 'output', name: 'Output', paint: composition.backgroundPaint },
    ]))
      errors.push(`${prefix}: background ${error}`);
  if (
    composition.backgroundPaintOverridden !== undefined &&
    typeof composition.backgroundPaintOverridden !== 'boolean'
  )
    errors.push(`${prefix}: invalid background override flag.`);
  if (
    composition.backgroundStyleId !== undefined &&
    (typeof composition.backgroundStyleId !== 'string' ||
      !backgroundCatalog.some((style) => style.id === composition.backgroundStyleId))
  )
    errors.push(`${prefix}: background references a missing style.`);
  const defaultBackground = composition.designSystem.defaultBackgroundStyleId;
  if (
    defaultBackground !== undefined &&
    defaultBackground !== null &&
    (typeof defaultBackground !== 'string' ||
      !backgroundCatalog.some((style) => style.id === defaultBackground))
  )
    errors.push(`${prefix}: default background references a missing style.`);
  const validateBackgroundMedia = (paint: unknown, owner: string) => {
    if (
      !isMediaPaint(paint) ||
      backgroundStylesErrors([{ id: 'output', name: 'Output', paint }]).length
    )
      return;
    const entries =
      paint.source.kind === 'clip'
        ? [{ ref: paint.source.src, kind: 'media', mime: 'video/' }]
        : paint.source.fallback
          ? [{ ref: paint.source.fallback, kind: 'image', mime: 'image/' }]
          : [];
    for (const entry of entries) {
      if (!entry.ref.startsWith('asset:')) continue;
      const asset = composition.assets.find((item) => item.id === entry.ref.slice(6));
      if (!asset) errors.push(`${prefix}: ${owner} references a missing asset.`);
      else if (asset.kind !== entry.kind || !asset.mimeType.startsWith(entry.mime))
        errors.push(`${prefix}: ${owner} references the wrong asset kind or MIME type.`);
    }
  };
  for (const style of backgroundCatalog) validateBackgroundMedia(style.paint, 'background style');
  validateBackgroundMedia(composition.backgroundPaint, 'background');
  for (const duplicate of duplicates(composition.keyframes.map((keyframe) => keyframe.id))) {
    errors.push(`${prefix}: duplicate keyframe id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.layers.map((layer) => layer.id))) {
    errors.push(`${prefix}: duplicate layer id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.assets.map((asset) => asset.id))) {
    errors.push(`${prefix}: duplicate asset id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.components.map((component) => component.id))) {
    errors.push(`${prefix}: duplicate component id "${duplicate}".`);
  }
  for (const duplicate of duplicates(
    composition.runtimeCollections.map((collection) => collection.id),
  )) {
    errors.push(`${prefix}: duplicate runtime collection id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.designSystem.tokens.map((token) => token.id))) {
    errors.push(`${prefix}: duplicate design-token id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.designSystem.tokens.map((token) => token.key))) {
    errors.push(`${prefix}: duplicate design-token key "${duplicate}".`);
  }
  if (!composition.designSystem.name.trim()) {
    errors.push(`${prefix}: design-system name cannot be empty.`);
  }
  for (const token of composition.designSystem.tokens) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token.key)) {
      errors.push(`${prefix}: design-token key "${token.key}" is invalid.`);
    }
    if (!token.name.trim()) errors.push(`${prefix}: design-token "${token.key}" has no name.`);
    if (typeof token.value === 'number' && !Number.isFinite(token.value)) {
      errors.push(`${prefix}: design-token "${token.key}" must be finite.`);
    }
  }
  for (const component of composition.components) {
    const componentOwner = `${prefix}: component "${component.name}"`;
    if (!componentIdValid(component.id)) errors.push(`${componentOwner} ID is invalid.`);
    if (component.scope !== undefined && !['local', 'set'].includes(component.scope))
      errors.push(`${componentOwner} scope must be local or set.`);
    if (component.resources !== undefined) {
      if (!Array.isArray(component.resources) || component.resources.length > 10000)
        errors.push(`${componentOwner} resources must be an array of at most 10000 assets.`);
      else {
        for (const duplicate of duplicates(component.resources.map((asset) => asset.id)))
          errors.push(`${componentOwner} repeats asset ID "${duplicate}".`);
        for (const asset of component.resources) validateAsset(asset, componentOwner, errors);
      }
    }
    if (component.patterns !== undefined) {
      if (!Array.isArray(component.patterns) || component.patterns.length > 10000)
        errors.push(`${componentOwner} patterns must be a bounded array.`);
      else {
        for (const duplicate of duplicates(component.patterns.map((pattern) => pattern.id)))
          errors.push(`${componentOwner} repeats pattern ID "${duplicate}".`);
        for (const pattern of component.patterns)
          for (const problem of tilingPatternErrors(pattern))
            errors.push(`${componentOwner}: ${problem}`);
      }
    }
    if (component.context !== undefined) {
      const context = component.context;
      if (
        !componentRecord(context) ||
        !finitePositive(context.frameRate) ||
        !Array.isArray(context.keyframes) ||
        context.keyframes.length < 2 ||
        context.keyframes.length > 10000 ||
        !Array.isArray(context.transitions) ||
        context.transitions.length > 10000 ||
        !Array.isArray(context.customActions) ||
        context.customActions.length > 10000
      ) {
        errors.push(
          `${componentOwner} source context requires a finite frame rate and bounded lifecycle/action arrays.`,
        );
        continue;
      }
      const sourceAssets = new Map(composition.assets.map((asset) => [asset.id, asset]));
      for (const asset of Array.isArray(component.resources) ? component.resources : [])
        sourceAssets.set(asset.id, asset);
      const sourcePatterns = new Map(composition.patterns.map((pattern) => [pattern.id, pattern]));
      for (const pattern of Array.isArray(component.patterns) ? component.patterns : [])
        sourcePatterns.set(pattern.id, pattern);
      const designSystem = context.designSystem ?? composition.designSystem;
      const {
        stylePackColors: _colors,
        stylePackRestore: _restore,
        ...sourceDesignSystem
      } = designSystem;
      const {
        backgroundPaint: _paint,
        backgroundStyleId: _style,
        backgroundPaintOverridden: _overridden,
        functions: _functions,
        ...sourceComposition
      } = composition;
      const canonical: Composition = {
        ...sourceComposition,
        id: component.id,
        name: `${composition.name} / Component ${component.name}`,
        backgroundColor: 'transparent',
        frameRate: context.frameRate,
        keyframes: context.keyframes,
        transitions: context.transitions,
        customActions: context.customActions,
        mediaCues: context.mediaCues ?? [],
        rendererPlugins: context.rendererPlugins ?? [],
        animationPresetPlugins: context.animationPresetPlugins ?? [],
        // Composition backgrounds/restoration links are outside a component's source scene.
        designSystem: { ...sourceDesignSystem, backgrounds: [], defaultBackgroundStyleId: null },
        layers: component.layers,
        dataFields: component.dataFields,
        assets: [...sourceAssets.values()],
        patterns: [...sourcePatterns.values()],
        components: [],
        runtimeCollections: [],
        dataConnections: [],
        layout: { ...composition.layout, timelineFolders: [] },
      };
      validateComposition(canonical, errors, warnings);
      continue;
    }
    for (const problem of layerMaskErrors({
      ...composition,
      layers: component.layers,
      runtimeCollections: [],
    }))
      errors.push(`${prefix}: component "${component.name}": ${problem}`);
    if (!component.name.trim()) errors.push(`${prefix}: component names cannot be empty.`);
    if (component.layers.length === 0) {
      errors.push(`${prefix}: component "${component.name}" contains no layers.`);
    }
    for (const duplicate of duplicates(component.layers.map((layer) => layer.id))) {
      errors.push(`${prefix}: component "${component.name}" repeats layer id "${duplicate}".`);
    }
    for (const duplicate of duplicates(component.dataFields.map((field) => field.id))) {
      errors.push(`${prefix}: component "${component.name}" repeats field id "${duplicate}".`);
    }
    for (const duplicate of duplicates(component.dataFields.map((field) => field.key))) {
      errors.push(`${prefix}: component "${component.name}" repeats field key "${duplicate}".`);
    }
    for (const field of component.dataFields) {
      validateFieldDefinition(
        field,
        `${prefix}: component "${component.name}" field "${field.key}"`,
        errors,
      );
    }
    const componentFieldIds = new Set(component.dataFields.map((field) => field.id));
    for (const problem of layerModifiersErrors(component.layers, component.dataFields))
      errors.push(`${prefix}: component "${component.name}": ${problem}`);
    const canonicalPatterns = component.patterns ?? composition.patterns;
    for (const layer of component.layers) {
      const owner = `${prefix}: component "${component.name}" layer "${layer.name}"`;
      validateComponentLink(layer, owner, errors);
      for (const problem of typographyBindingErrors(layer, typographyCatalog))
        errors.push(`${owner}: ${problem}`);
      for (const problem of layerLightingErrors(layer, canonicalPatterns))
        errors.push(`${owner}: ${problem}`);
      if (layer.crop)
        for (const problem of layerCropErrors(layer.crop)) errors.push(`${owner}: ${problem}`);
      const sourcePatternId = layer.element.type === 'pattern' ? layer.element.patternId : null;
      if (sourcePatternId && !canonicalPatterns.some((pattern) => pattern.id === sourcePatternId))
        errors.push(`${owner} references a missing source pattern.`);
      if (layer.element.type === 'text') {
        if (!Number.isFinite(layer.element.strokeWidth) || layer.element.strokeWidth < 0) {
          errors.push(`${owner} text stroke width must be finite and non-negative.`);
        }
      } else if (layer.animationTracks.strokeWidth?.length) {
        errors.push(
          `${owner} cannot animate text stroke width on a ${layer.element.type} element.`,
        );
      }
      for (const key of layer.animationTracks.strokeWidth ?? []) {
        if (!Number.isFinite(key.value) || key.value < 0) {
          errors.push(`${owner} stroke-width track values must be finite and non-negative.`);
        }
      }
      if (layer.element.type !== 'text' && layer.loop?.tracks.strokeWidth?.length) {
        errors.push(`${owner} cannot loop text stroke width on a ${layer.element.type} element.`);
      }
      for (const key of layer.loop?.tracks.strokeWidth ?? []) {
        if (!Number.isFinite(key.value) || key.value < 0) {
          errors.push(`${owner} loop stroke-width values must be finite and non-negative.`);
        }
      }
      for (const binding of layer.bindings) {
        if (!componentFieldIds.has(binding.fieldId)) {
          errors.push(
            `${prefix}: component "${component.name}" layer "${layer.name}" references a missing component field.`,
          );
        }
      }
    }
  }

  const expectedEdges = new Set(
    composition.keyframes
      .slice(1)
      .map((keyframe, index) => `${composition.keyframes[index]!.id}:${keyframe.id}`),
  );
  const actualEdges = new Set(
    composition.transitions.map(
      (transition) => `${transition.fromKeyframeId}:${transition.toKeyframeId}`,
    ),
  );
  for (const edge of expectedEdges) {
    if (!actualEdges.has(edge)) errors.push(`${prefix}: missing transition ${edge}.`);
  }
  for (const transition of composition.transitions) {
    const edge = `${transition.fromKeyframeId}:${transition.toKeyframeId}`;
    if (!expectedEdges.has(edge))
      errors.push(`${prefix}: transition ${edge} does not join adjacent states.`);
    if (!Number.isInteger(transition.durationFrames) || transition.durationFrames < 0) {
      errors.push(
        `${prefix}: transition ${edge} duration must be a non-negative integer frame count.`,
      );
    }
  }

  const durationFrames = getTotalFrames(composition);
  if (!Number.isFinite(composition.layout.gridSize) || composition.layout.gridSize <= 0) {
    errors.push(`${prefix}: layout grid size must be a finite positive number.`);
  }
  if (!Number.isFinite(composition.layout.snapThreshold) || composition.layout.snapThreshold < 0) {
    errors.push(`${prefix}: layout snap threshold must be a finite non-negative number.`);
  }
  for (const guide of composition.layout.guides) {
    if (!Number.isFinite(guide.position)) errors.push(`${prefix}: guide positions must be finite.`);
  }
  const layerIds = new Set(composition.layers.map((layer) => layer.id));
  errors.push(
    ...layerModifiersErrors(composition.layers, composition.dataFields).map(
      (error) => `${prefix}: ${error}`,
    ),
  );
  for (const duplicate of duplicates(
    composition.layout.timelineFolders.map((folder) => folder.id),
  )) {
    errors.push(`${prefix}: duplicate timeline folder id "${duplicate}".`);
  }
  const folderMembership = new Map<string, string>();
  for (const folder of composition.layout.timelineFolders) {
    if (!folder.name.trim()) errors.push(`${prefix}: timeline folder names cannot be empty.`);
    for (const duplicate of duplicates(folder.layerIds)) {
      errors.push(`${prefix}: timeline folder "${folder.name}" repeats layer "${duplicate}".`);
    }
    for (const layerId of folder.layerIds) {
      if (!layerIds.has(layerId)) {
        errors.push(`${prefix}: timeline folder "${folder.name}" references a missing layer.`);
      }
      const existing = folderMembership.get(layerId);
      if (existing) {
        errors.push(
          `${prefix}: layer "${layerId}" belongs to both timeline folders "${existing}" and "${folder.name}".`,
        );
      } else {
        folderMembership.set(layerId, folder.name);
      }
    }
  }
  for (const layer of composition.layers) {
    if (!BLEND_MODES.includes(layer.blendMode)) {
      errors.push(
        `${prefix}: layer "${layer.name}" has unsupported blend mode "${layer.blendMode}".`,
      );
    }
    if (
      layer.element.type === 'rectangle' ||
      layer.element.type === 'ellipse' ||
      layer.element.type === 'path' ||
      layer.element.type === 'pattern' ||
      layer.element.type === 'text' ||
      (layer.element.type === 'chart' &&
        'fill' in layer.element &&
        layer.element.fill !== undefined)
    ) {
      for (const problem of validatePaint(getElementFill(layer.element)!)) {
        errors.push(`${prefix}: layer "${layer.name}" ${problem}.`);
      }
    }
    if (layer.parentId && !layerIds.has(layer.parentId)) {
      errors.push(`${prefix}: layer "${layer.name}" references a missing transform parent.`);
    }
    if (layer.element.type === 'path' && !['nonzero', 'evenodd'].includes(layer.element.fillRule)) {
      errors.push(`${prefix}: layer "${layer.name}" has an invalid path fill rule.`);
    }
    if (layer.element.type === 'path' && layer.element.stretchInsets) {
      const { left, right, top, bottom } = layer.element.stretchInsets;
      if (
        [left, right, top, bottom].some((value) => !Number.isFinite(value) || value < 0) ||
        left + right > layer.element.viewBoxWidth ||
        top + bottom > layer.element.viewBoxHeight
      ) {
        errors.push(`${prefix}: layer "${layer.name}" has invalid path stretch insets.`);
      }
      if (typeof layer.element.fill !== 'string') {
        warnings.push(
          `${prefix}: layer "${layer.name}" path stretch regions currently preserve solid fills only; its complex paint uses ordinary scaling.`,
        );
      }
    }
    if (layer.parentId === layer.id) {
      errors.push(`${prefix}: layer "${layer.name}" cannot parent itself.`);
    }
    if (
      layer.motionBlur &&
      (typeof layer.motionBlur.enabled !== 'boolean' ||
        !Number.isFinite(layer.motionBlur.shutterAngle) ||
        layer.motionBlur.shutterAngle < 0 ||
        layer.motionBlur.shutterAngle > 360)
    ) {
      errors.push(
        `${prefix}: layer "${layer.name}" has invalid experimental motion blur settings.`,
      );
    }
    if (
      layer.motionBlur?.enabled &&
      (layer.motionPath ||
        layer.modifiers?.length ||
        layer.bindings.some((binding) => ['x', 'y'].includes(binding.targetProperty)))
    ) {
      warnings.push(
        `${prefix}: layer "${layer.name}" motion blur samples authored X/Y keys, not path, modifier or bound movement.`,
      );
    }
    if (layer.motionPath) {
      const source = composition.layers.find(
        (candidate) => candidate.id === layer.motionPath!.sourceLayerId,
      );
      if (!source || source.element.type !== 'path') {
        errors.push(
          `${prefix}: layer "${layer.name}" motion path references a missing path layer.`,
        );
      }
      if (
        layer.motionPath.sourceLayerId === layer.id ||
        !Number.isFinite(layer.motionPath.progress) ||
        layer.motionPath.progress < 0 ||
        layer.motionPath.progress > 1 ||
        !Number.isFinite(layer.motionPath.offsetX) ||
        !Number.isFinite(layer.motionPath.offsetY) ||
        (layer.motionPath.rotationOffset !== undefined &&
          (!Number.isFinite(layer.motionPath.rotationOffset) ||
            Math.abs(layer.motionPath.rotationOffset) > 360))
      ) {
        errors.push(`${prefix}: layer "${layer.name}" has invalid motion-path settings.`);
      }
    }
    const visited = new Set<string>([layer.id]);
    let parentId = layer.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        errors.push(`${prefix}: layer "${layer.name}" has a cyclic transform parent chain.`);
        break;
      }
      visited.add(parentId);
      parentId =
        composition.layers.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
    if (layer.keyframes.length === 0) {
      errors.push(`${prefix}: layer "${layer.name}" has no animation keyframes.`);
    }
    for (const duplicate of duplicates(layer.keyframes.map((keyframe) => String(keyframe.frame)))) {
      errors.push(`${prefix}: layer "${layer.name}" has multiple keys at frame ${duplicate}.`);
    }
    for (const keyframe of layer.keyframes) {
      if (
        !Number.isInteger(keyframe.frame) ||
        keyframe.frame < 0 ||
        keyframe.frame > durationFrames
      ) {
        errors.push(
          `${prefix}: layer "${layer.name}" key frame must be an integer from 0 to ${durationFrames}.`,
        );
      }
      if (Object.values(keyframe.transform).some((value) => !Number.isFinite(value))) {
        errors.push(`${prefix}: layer "${layer.name}" has a non-finite transform value.`);
      }
    }
    const stackErrors = layerEffectErrors(layer);
    if (stackErrors.length) {
      errors.push(...stackErrors.map((error) => `${prefix}: layer "${layer.name}": ${error}`));
      continue;
    }
    for (const property of new Set([
      ...Object.keys(layer.animationTracks),
      ...Object.keys(layer.loop?.tracks ?? {}),
    ]))
      if (property.startsWith('modifiers.') && !modifierParameterSpec(layer, property))
        errors.push(
          `${prefix}: layer "${layer.name}" references a missing numeric modifier parameter ${property}.`,
        );
      else if (
        parseEffectProperty(property) &&
        typeof effectParameterSpec(layer.effects, property)?.default !== 'number'
      )
        errors.push(
          `${prefix}: layer "${layer.name}" references a missing numeric effect parameter ${property}.`,
        );
    const tracks = getResolvedLayerAnimationTracks(layer);
    for (const property of new Set([
      ...Object.keys(layer.animationTracks),
      ...Object.keys(layer.loop?.tracks ?? {}),
    ])) {
      if (
        parseShaderAnimationProperty(property) &&
        !shaderAnimationPropertySpec(layer.element, property)
      )
        errors.push(
          `${prefix}: layer "${layer.name}" references missing shader animation property "${property}".`,
        );
    }
    if (layer.element.type !== 'text' && layer.animationTracks.strokeWidth?.length) {
      errors.push(
        `${prefix}: layer "${layer.name}" cannot animate text stroke width on a ${layer.element.type} element.`,
      );
    }
    for (const property of getLayerAnimatableProperties(layer)) {
      const propertyKeys = tracks[property] ?? [];
      const stopIndex = gradientStopIndexForProperty(property);
      if (stopIndex !== null) {
        const fill = getElementFill(layer.element);
        if (!isGradientPaint(fill) || !fill.stops[stopIndex]) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" references a missing gradient stop.`,
          );
        }
      }
      if (
        propertyKeys.length === 0 &&
        !parseShaderAnimationProperty(property) &&
        !parseModifierProperty(property)
      ) {
        errors.push(`${prefix}: layer "${layer.name}" property "${property}" has no keys.`);
      }
      for (const duplicate of duplicates(propertyKeys.map((keyframe) => String(keyframe.frame)))) {
        errors.push(
          `${prefix}: layer "${layer.name}" property "${property}" has multiple keys at frame ${duplicate}.`,
        );
      }
      for (const keyframe of propertyKeys) {
        if (parseShaderAnimationProperty(property))
          errors.push(
            ...shaderAnimationValueErrors(layer.element, property, keyframe.value).map(
              (error) => `${prefix}: layer "${layer.name}": ${error}`,
            ),
          );
        if (
          isRevealAnimationProperty(property) &&
          (!Number.isFinite(keyframe.value) ||
            keyframe.value < 0 ||
            (property !== 'scale' && keyframe.value > 1))
        )
          errors.push(
            `${prefix}: layer "${layer.name}" ${property} key must be ${property === 'scale' ? '0 or more' : '0–1'}.`,
          );
        const spec = effectParameterSpec(layer.effects, property);
        const modifierSpec = modifierParameterSpec(layer, property);
        if (
          modifierSpec &&
          (keyframe.value < modifierSpec.min || keyframe.value > modifierSpec.max)
        )
          errors.push(
            `${prefix}: layer "${layer.name}" modifier key ${property} must be ${modifierSpec.min}–${modifierSpec.max}.`,
          );
        if (spec && (keyframe.value < spec.min! || keyframe.value > spec.max!))
          errors.push(
            `${prefix}: layer "${layer.name}" effect key ${property} must be ${spec.min}–${spec.max}.`,
          );
        if (
          !Number.isInteger(keyframe.frame) ||
          keyframe.frame < 0 ||
          keyframe.frame > durationFrames
        ) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" key frame must be an integer from 0 to ${durationFrames}.`,
          );
        }
        if (!Number.isFinite(keyframe.value)) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" has a non-finite value.`,
          );
        }
        if (property === 'strokeWidth' && keyframe.value < 0) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "strokeWidth" values must be non-negative.`,
          );
        }
        if (stopIndex !== null && (keyframe.value < 0 || keyframe.value > 1)) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" values must be from 0 to 1.`,
          );
        }
        if (
          keyframe.curve &&
          Object.values(keyframe.curve).some(
            (value) => !Number.isFinite(value) || value < 0 || value > 1,
          )
        ) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" has an invalid cubic Bézier curve.`,
          );
        }
      }
    }
    if (layer.loop) {
      const loop = layer.loop;
      const activation = loop.activation;
      if (loop.timing) {
        const timing = loop.timing;
        const field = composition.dataFields.find((entry) => entry.id === timing.holdFieldId);
        if (!timing.groupId?.trim() || !field || !['number', 'integer'].includes(field.type))
          errors.push(
            `${prefix}: layer "${layer.name}" loop timing requires a group and a numeric hold field.`,
          );
        let end = 0;
        if (!Array.isArray(timing.holdRanges) || !timing.holdRanges.length)
          errors.push(`${prefix}: layer "${layer.name}" loop timing requires hold ranges.`);
        for (const range of timing.holdRanges ?? []) {
          if (
            !Number.isInteger(range.startFrame) ||
            !Number.isInteger(range.endFrame) ||
            range.startFrame < end ||
            range.endFrame <= range.startFrame ||
            range.endFrame > loop.durationFrames
          )
            errors.push(
              `${prefix}: layer "${layer.name}" loop hold ranges must be ordered, disjoint and inside the clip.`,
            );
          end = range.endFrame;
        }
        const peers = composition.layers.filter(
          (entry) => entry.loop?.timing?.groupId === timing.groupId,
        );
        if (
          peers.some(
            (entry) =>
              entry.loop!.durationFrames !== loop.durationFrames ||
              entry.loop!.phaseOffsetFrames !== loop.phaseOffsetFrames ||
              JSON.stringify(entry.loop!.activation) !== JSON.stringify(loop.activation) ||
              JSON.stringify(entry.loop!.timing) !== JSON.stringify(timing),
          )
        )
          errors.push(
            `${prefix}: loop group "${timing.groupId}" must share activation, phase, duration and hold timing.`,
          );
      }
      if (!Number.isInteger(loop.durationFrames) || loop.durationFrames < 1) {
        errors.push(`${prefix}: layer "${layer.name}" loop duration must be a positive integer.`);
      }
      if (
        loop.repeatCount !== null &&
        (!Number.isInteger(loop.repeatCount) || loop.repeatCount < 1)
      ) {
        errors.push(`${prefix}: layer "${layer.name}" loop repeat count must be positive or null.`);
      }
      if (
        activation.type === 'step' &&
        !composition.keyframes.some(
          (keyframe) => keyframe.id === activation.stepKeyframeId && keyframe.role === 'step',
        )
      ) {
        errors.push(`${prefix}: layer "${layer.name}" loop references a missing OGraf Step.`);
      }
      if (
        activation.type === 'customAction' &&
        !composition.customActions.some(
          (action) => action.actionId === activation.customActionId,
        ) &&
        !isClockTimerActionId(composition.layers, activation.customActionId)
      ) {
        errors.push(`${prefix}: layer "${layer.name}" loop references a missing custom action.`);
      }
      if (activation.type === 'customAction' && loop.repeatCount === null) {
        errors.push(
          `${prefix}: layer "${layer.name}" custom-action clip must use a finite repeat count.`,
        );
      }
      for (const [property, keys = []] of Object.entries(loop.tracks)) {
        if (property === 'strokeWidth' && layer.element.type !== 'text') {
          errors.push(
            `${prefix}: layer "${layer.name}" cannot loop text stroke width on a ${layer.element.type} element.`,
          );
        }
        if (keys.length === 0) {
          errors.push(`${prefix}: layer "${layer.name}" loop property "${property}" has no keys.`);
          continue;
        }
        for (const duplicate of duplicates(keys.map((key) => String(key.frame)))) {
          errors.push(
            `${prefix}: layer "${layer.name}" loop property "${property}" has multiple keys at local frame ${duplicate}.`,
          );
        }
        for (const key of keys) {
          if (parseShaderAnimationProperty(property))
            errors.push(
              ...shaderAnimationValueErrors(layer.element, property, key.value).map(
                (error) => `${prefix}: layer "${layer.name}" loop: ${error}`,
              ),
            );
          if (
            isRevealAnimationProperty(property) &&
            (!Number.isFinite(key.value) ||
              key.value < 0 ||
              (property !== 'scale' && key.value > 1))
          )
            errors.push(
              `${prefix}: layer "${layer.name}" loop ${property} key must be ${property === 'scale' ? '0 or more' : '0–1'}.`,
            );
          const spec = effectParameterSpec(layer.effects, property);
          const modifierSpec = modifierParameterSpec(layer, property);
          if (modifierSpec && (key.value < modifierSpec.min || key.value > modifierSpec.max))
            errors.push(
              `${prefix}: layer "${layer.name}" loop modifier ${property} must be ${modifierSpec.min}–${modifierSpec.max}.`,
            );
          if (spec && (key.value < spec.min! || key.value > spec.max!))
            errors.push(
              `${prefix}: layer "${layer.name}" loop effect ${property} must be ${spec.min}–${spec.max}.`,
            );
          if (!Number.isInteger(key.frame) || key.frame < 0 || key.frame > loop.durationFrames) {
            errors.push(
              `${prefix}: layer "${layer.name}" loop property "${property}" keys must stay inside 0..${loop.durationFrames}.`,
            );
          }
          if (!Number.isFinite(key.value)) {
            errors.push(
              `${prefix}: layer "${layer.name}" loop property "${property}" has a non-finite value.`,
            );
          }
          if (property === 'strokeWidth' && key.value < 0) {
            errors.push(
              `${prefix}: layer "${layer.name}" loop property "strokeWidth" values must be non-negative.`,
            );
          }
        }
        const ordered = [...keys].sort((a, b) => a.frame - b.frame);
        if (
          loop.repeatCount === null &&
          ordered[0]?.frame === 0 &&
          ordered.at(-1)?.frame === loop.durationFrames &&
          Math.abs(ordered[0]!.value - ordered.at(-1)!.value) > 0.0001
        ) {
          warnings.push(
            `${prefix}: layer "${layer.name}" loop property "${property}" has different values at its repeat seam.`,
          );
        }
      }
    }
  }

  for (const key of duplicates(composition.dataFields.map((field) => field.key))) {
    errors.push(`${prefix}: duplicate data field key "${key}".`);
  }
  const allFieldNodes: FieldDefinition[] = [];
  const collectFieldNodes = (field: FieldDefinition) => {
    allFieldNodes.push(field);
    field.properties.forEach(collectFieldNodes);
    if (field.items) collectFieldNodes(field.items);
  };
  composition.dataFields.forEach(collectFieldNodes);
  for (const id of duplicates(allFieldNodes.map((field) => field.id))) {
    errors.push(`${prefix}: duplicate data schema node id "${id}".`);
  }
  for (const field of composition.dataFields) {
    validateFieldDefinition(field, `${prefix}: data field "${field.key}"`, errors);
    if (field.defaultTokenId) {
      const token = composition.designSystem.tokens.find((t) => t.id === field.defaultTokenId);
      if (field.type !== 'color' || token?.type !== 'color')
        errors.push(`${prefix}: field "${field.key}" has an invalid Brand Kit default token.`);
      else if (
        field.defaultValue !== token.value &&
        !(
          comparableHexColor(field.defaultValue) !== null &&
          comparableHexColor(field.defaultValue) === comparableHexColor(token.value)
        )
      )
        warnings.push(`${prefix}: field "${field.key}" Brand Kit default is out of sync.`);
    }
  }
  for (const actionId of duplicates(composition.customActions.map((action) => action.actionId))) {
    errors.push(`${prefix}: duplicate custom action id "${actionId}".`);
  }
  const fieldIds = new Set(composition.dataFields.map((field) => field.id));
  const customActionIds = new Set(composition.customActions.map((action) => action.actionId));
  for (const layer of composition.layers) {
    if (layer.isGuide || layer.element.type !== 'text' || !layer.element.clock) continue;
    for (const command of ['start', 'pause', 'reset', 'restart'] as const) {
      const actionId = clockTimerActionId(layer.id, command);
      if (customActionIds.has(actionId))
        errors.push(
          `${prefix}: custom action "${actionId}" conflicts with a built-in clock/timer command.`,
        );
      customActionIds.add(actionId);
    }
  }
  const fieldById = new Map(composition.dataFields.map((field) => [field.id, field]));
  const collectionByPrototypeLayerId = new Map<string, Composition['runtimeCollections'][number]>();
  const collectionFieldIds = new Set<string>();
  for (const collection of composition.runtimeCollections) {
    if (!collection.name.trim())
      errors.push(`${prefix}: runtime collection names cannot be empty.`);
    if (
      !Number.isInteger(collection.capacity) ||
      collection.capacity < 1 ||
      collection.capacity > 100
    ) {
      errors.push(`${prefix}: runtime collection "${collection.name}" capacity must be 1..100.`);
    }
    if (
      !Number.isFinite(collection.offsetPerItem.x) ||
      !Number.isFinite(collection.offsetPerItem.y)
    ) {
      errors.push(`${prefix}: runtime collection "${collection.name}" offset must be finite.`);
    }
    if (collection.overflow !== 'truncate') {
      errors.push(`${prefix}: runtime collection "${collection.name}" has unsupported overflow.`);
    }
    if (
      !Number.isInteger(collection.pageSize ?? 0) ||
      (collection.pageSize ?? 0) < 0 ||
      (collection.pageSize ?? 0) > collection.capacity ||
      !Number.isInteger(collection.page ?? 0) ||
      (collection.page ?? 0) < 0
    ) {
      errors.push(`${prefix}: runtime collection "${collection.name}" has invalid pagination.`);
    }
    const field = fieldById.get(collection.fieldId);
    if (!field) {
      errors.push(`${prefix}: runtime collection "${collection.name}" references a missing field.`);
    } else {
      if (field.type !== 'array' || field.items?.type !== 'object') {
        errors.push(
          `${prefix}: runtime collection "${collection.name}" requires an array field with object items.`,
        );
      }
      if (collectionFieldIds.has(field.id)) {
        errors.push(
          `${prefix}: array field "${field.key}" drives more than one runtime collection.`,
        );
      }
      collectionFieldIds.add(field.id);
      if (field.constraints.maxItems !== collection.capacity) {
        errors.push(
          `${prefix}: runtime collection "${collection.name}" capacity must equal field maxItems.`,
        );
      }
      for (const [label, path] of [
        ['item key', collection.itemKeyPath ?? []],
        ['sort', collection.sortPath ?? []],
      ] as const) {
        if (path.length && !fieldDefinitionAtPath(field, path, { fromArrayItem: true })) {
          errors.push(
            `${prefix}: runtime collection "${collection.name}" ${label} path is missing.`,
          );
        }
      }
    }
    if (collection.prototypeLayerIds.length === 0) {
      errors.push(`${prefix}: runtime collection "${collection.name}" has no prototype layers.`);
      continue;
    }
    if (new Set(collection.prototypeLayerIds).size !== collection.prototypeLayerIds.length) {
      errors.push(`${prefix}: runtime collection "${collection.name}" repeats prototype layers.`);
    }
    const prototypeLayers = collection.prototypeLayerIds
      .map((id) => composition.layers.find((layer) => layer.id === id))
      .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer));
    if (prototypeLayers.length !== collection.prototypeLayerIds.length) {
      errors.push(`${prefix}: runtime collection "${collection.name}" references missing layers.`);
    }
    if (!prototypeLayers.some((layer) => layer.isVisible && !layer.isGuide)) {
      errors.push(`${prefix}: runtime collection "${collection.name}" has no visible prototype.`);
    }
    if (prototypeLayers.some((layer) => layer.isGuide)) {
      errors.push(
        `${prefix}: runtime collection "${collection.name}" cannot contain guide layers.`,
      );
    }
    const groups = new Set(prototypeLayers.map((layer) => layer.groupId));
    if (groups.size !== 1 || groups.has(null)) {
      errors.push(
        `${prefix}: runtime collection "${collection.name}" prototype must use one persistent group.`,
      );
    }
    const indexes = prototypeLayers
      .map((layer) => composition.layers.findIndex((candidate) => candidate.id === layer.id))
      .sort((left, right) => left - right);
    if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1]! + 1)) {
      errors.push(
        `${prefix}: runtime collection "${collection.name}" prototype layers must be contiguous.`,
      );
    }
    const prototypeIds = new Set(collection.prototypeLayerIds);
    for (const layer of prototypeLayers) {
      if (collectionByPrototypeLayerId.has(layer.id)) {
        errors.push(
          `${prefix}: layer "${layer.name}" belongs to more than one runtime collection.`,
        );
      }
      collectionByPrototypeLayerId.set(layer.id, collection);
      const parent = layer.parentId
        ? composition.layers.find((candidate) => candidate.id === layer.parentId)
        : undefined;
      if (parent?.clipChildren && !prototypeIds.has(parent.id)) {
        errors.push(
          `${prefix}: runtime collection "${collection.name}" clip parents must stay inside the prototype.`,
        );
      }
    }
  }
  const designTokenById = new Map(
    composition.designSystem.tokens.map((token) => [token.id, token]),
  );
  const componentById = new Map(
    composition.components.map((component) => [component.id, component]),
  );
  const assetIds = new Set(composition.assets.map((asset) => asset.id));
  const assetById = new Map(composition.assets.map((asset) => [asset.id, asset]));
  const validateAssetReference = (value: string, owner: string) => {
    if (value.startsWith('asset:') && !assetIds.has(value.slice('asset:'.length))) {
      errors.push(`${prefix}: ${owner} references a missing asset "${value}".`);
    }
  };
  for (const asset of composition.assets) validateAsset(asset, prefix, errors);
  for (const cueId of duplicates(composition.mediaCues.map((cue) => cue.id))) {
    errors.push(`${prefix}: duplicate media cue id "${cueId}".`);
  }
  const lifecycleIds = new Set(composition.keyframes.map((keyframe) => keyframe.id));
  for (const cue of composition.mediaCues) {
    const owner = `${prefix}: media cue "${cue.name || cue.id}"`;
    if (!cue.name.trim()) errors.push(`${owner} requires a name.`);
    if (cue.sources.length === 0) errors.push(`${owner} requires at least one source.`);
    for (const sourceId of duplicates(cue.sources.map((source) => source.id))) {
      errors.push(`${owner} repeats source id "${sourceId}".`);
    }
    if (!cue.sources.some((source) => source.id === cue.activeSourceId)) {
      errors.push(`${owner} active source does not exist.`);
    }
    const activeSource = cue.sources.find((source) => source.id === cue.activeSourceId);
    if (cue.visual.crop)
      for (const problem of sourceCropErrors(cue.visual.crop))
        errors.push(`${prefix}: media cue "${cue.name}" ${problem}.`);
    if (cue.visual.targetLayerId) {
      const target = composition.layers.find((layer) => layer.id === cue.visual.targetLayerId);
      if (!target || !('fill' in target.element)) {
        errors.push(`${owner} references an invalid video paint target.`);
      }
      if (activeSource?.kind === 'clip' && activeSource.mediaType === 'audio') {
        errors.push(`${owner} cannot paint an audio-only source onto a layer.`);
      }
    }
    if (
      !Number.isFinite(cue.visual.positionX) ||
      cue.visual.positionX < 0 ||
      cue.visual.positionX > 1 ||
      !Number.isFinite(cue.visual.positionY) ||
      cue.visual.positionY < 0 ||
      cue.visual.positionY > 1
    ) {
      errors.push(`${owner} video position must stay within 0..1.`);
    }
    for (const source of cue.sources) {
      if (!source.name.trim()) errors.push(`${owner} has an unnamed source.`);
      if (source.kind === 'clip') {
        if (!source.src.trim()) errors.push(`${owner} clip source is required.`);
        validateAssetReference(source.src, `media cue "${cue.name}"`);
        if (source.src.startsWith('asset:')) {
          const asset = assetById.get(source.src.slice('asset:'.length));
          const expectedKind = source.mediaType === 'audio' ? 'audio' : 'media';
          if (asset && asset.kind !== expectedKind) {
            errors.push(
              `${owner} ${source.mediaType} source "${source.name}" references a ${asset.kind} asset.`,
            );
          }
        }
      } else {
        if (!/^[A-Za-z0-9._:-]+$/.test(source.tag)) {
          errors.push(`${owner} live source "${source.name}" has an invalid renderer tag.`);
        }
        if (source.fallback) {
          validateAssetReference(source.fallback, `media cue "${cue.name}" live fallback`);
        }
      }
    }
    if (
      !Number.isFinite(cue.trimStartMs) ||
      cue.trimStartMs < 0 ||
      (cue.trimEndMs !== null &&
        (!Number.isFinite(cue.trimEndMs) || cue.trimEndMs <= cue.trimStartMs))
    ) {
      errors.push(`${owner} has an invalid trim range.`);
    }
    if (
      cue.durationFrames != null &&
      (!Number.isInteger(cue.durationFrames) || cue.durationFrames < 1)
    ) {
      errors.push(`${owner} Timeline duration must be a positive integer frame count.`);
    }
    if (!Number.isFinite(cue.speed) || cue.speed < 0.1 || cue.speed > 16) {
      errors.push(`${owner} speed must be from 0.1 to 16.`);
    }
    if (!Number.isFinite(cue.volume) || cue.volume < 0 || cue.volume > 1) {
      errors.push(`${owner} volume must be from 0 to 1.`);
    }
    if (cue.trigger.type === 'timeline') {
      if (
        !Number.isInteger(cue.trigger.startFrame) ||
        cue.trigger.startFrame < 0 ||
        cue.trigger.startFrame > durationFrames
      ) {
        errors.push(`${owner} timeline trigger must be inside the composition duration.`);
      }
    } else if (cue.trigger.type === 'lifecycle' && !lifecycleIds.has(cue.trigger.keyframeId)) {
      errors.push(`${owner} references a missing lifecycle state.`);
    } else if (cue.trigger.type === 'customAction' && !customActionIds.has(cue.trigger.actionId)) {
      errors.push(`${owner} references a missing custom action.`);
    }
    if (
      !Number.isInteger(cue.transition.durationFrames) ||
      cue.transition.durationFrames < 0 ||
      (cue.transition.type === 'crossfade' && cue.transition.durationFrames < 1)
    ) {
      errors.push(`${owner} source transition duration is invalid.`);
    }
    if (cue.sources.some((source) => source.kind === 'live')) {
      warnings.push(
        `${owner} uses renderer-provided live media; verify source readiness and fallback behavior on the target renderer.`,
      );
    }
  }
  const componentMembers = new Map<string, Set<string>>();
  const instanceComponents = new Map<string, string>();
  for (const layer of composition.layers) {
    validateComponentLink(layer, `${prefix}: layer "${layer.name}"`, errors);
    if ('clock' in layer.element && layer.element.type !== 'text') {
      errors.push(`${prefix}: layer "${layer.name}" clock settings require a text element.`);
    }
    if (layer.componentLink) {
      const link = layer.componentLink;
      const previousComponent = instanceComponents.get(link.instanceId);
      if (previousComponent && previousComponent !== link.componentId)
        errors.push(
          `${prefix}: component instance "${link.instanceId}" references more than one asset.`,
        );
      instanceComponents.set(link.instanceId, link.componentId);
      const sourceMembers = componentMembers.get(link.instanceId) ?? new Set<string>();
      if (sourceMembers.has(link.sourceLayerId))
        errors.push(
          `${prefix}: component instance "${link.instanceId}" repeats source layer "${link.sourceLayerId}".`,
        );
      sourceMembers.add(link.sourceLayerId);
      componentMembers.set(link.instanceId, sourceMembers);
      const component = componentById.get(layer.componentLink.componentId);
      if (!component) {
        errors.push(`${prefix}: layer "${layer.name}" links to a missing component.`);
      } else if (
        !component.layers.some(
          (sourceLayer) => sourceLayer.id === layer.componentLink?.sourceLayerId,
        )
      ) {
        errors.push(`${prefix}: layer "${layer.name}" links to a missing component source layer.`);
      }
    }
    for (const targetProperty of duplicates(
      layer.designTokenBindings.map((binding) => binding.targetProperty),
    )) {
      errors.push(
        `${prefix}: layer "${layer.name}" links design-token target "${targetProperty}" more than once.`,
      );
    }
    for (const binding of layer.designTokenBindings) {
      if (binding.overridden !== undefined && typeof binding.overridden !== 'boolean')
        errors.push(`${prefix}: layer "${layer.name}" has an invalid design-token override flag.`);
      const token = designTokenById.get(binding.tokenId);
      if (!token) {
        errors.push(`${prefix}: layer "${layer.name}" references a missing design token.`);
        continue;
      }
      // A retained inactive link records the Reset source, not the locally authored paint/value.
      if (binding.overridden === true) continue;
      const projected = structuredClone(layer);
      try {
        applyDesignTokenBinding(projected, binding, token);
        if (
          JSON.stringify(projected.element) !== JSON.stringify(layer.element) ||
          JSON.stringify(projected.effects) !== JSON.stringify(layer.effects)
        ) {
          warnings.push(
            `${prefix}: layer "${layer.name}" design-token link for "${binding.targetProperty}" is out of sync with its materialized value.`,
          );
        }
      } catch (error) {
        errors.push(
          `${prefix}: layer "${layer.name}" has an invalid design-token link: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const error of typographyBindingErrors(layer, typographyCatalog))
      errors.push(`${prefix}: layer "${layer.name}" ${error}`);
    for (const binding of layer.bindings) {
      if (layer.element.type === 'ticker' && binding.targetProperty.startsWith('items.')) {
        const target = /^items\.([^.]+)\.(.+)$/.exec(binding.targetProperty);
        const item = target ? layer.element.items.find((item) => item.id === target[1]) : undefined;
        if (
          !item ||
          (target![2] !== 'height' &&
            readElementDataValue(layer.element, binding.targetProperty) === undefined)
        )
          errors.push(
            `${prefix}: ticker "${layer.name}" binds a missing item property "${binding.targetProperty}".`,
          );
      }
      if (
        layer.element.type === 'text' &&
        layer.element.clock &&
        ['content', 'runs'].includes(binding.targetProperty)
      ) {
        errors.push(
          `${prefix}: clock/timer layer "${layer.name}" generates its text and cannot bind ${binding.targetProperty}.`,
        );
      }
      if (!fieldIds.has(binding.fieldId)) {
        errors.push(`${prefix}: layer "${layer.name}" references a missing data field.`);
        continue;
      }
      if (
        binding.targetProperty.startsWith('modifiers.') &&
        !modifierParameterSpec(layer, binding.targetProperty)
      )
        errors.push(`${prefix}: layer "${layer.name}" binds a missing numeric modifier parameter.`);
      if (
        parseEffectProperty(binding.targetProperty) &&
        !effectParameterSpec(layer.effects, binding.targetProperty)
      )
        errors.push(`${prefix}: layer "${layer.name}" binds a missing effect parameter.`);
      const gradientColor = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(binding.targetProperty);
      if (
        gradientColor &&
        (!('fill' in layer.element) ||
          !isGradientPaint(layer.element.fill) ||
          !layer.element.fill.stops[Number(gradientColor[1])])
      )
        errors.push(`${prefix}: layer "${layer.name}" binds a missing gradient color stop.`);
      const field = fieldById.get(binding.fieldId)!;
      for (const error of layerTransformBindingErrors(binding, field))
        errors.push(`${prefix}: layer "${layer.name}": ${error}`);
      const collection = collectionByPrototypeLayerId.get(layer.id);
      const tickerFeed = layer.element.type === 'ticker' && binding.targetProperty === 'items';
      const fromArrayItem = field.type === 'array' && !tickerFeed;
      if (fromArrayItem && collection?.fieldId !== field.id) {
        errors.push(
          `${prefix}: layer "${layer.name}" can bind array field "${field.key}" only inside its runtime collection prototype.`,
        );
        continue;
      }
      const resolved = fieldDefinitionAtPath(field, binding.sourcePath ?? [], { fromArrayItem });
      if (tickerFeed) {
        if (
          resolved?.type !== 'array' &&
          resolved?.type !== 'text' &&
          resolved?.type !== 'textarea'
        )
          errors.push(
            `${prefix}: ticker "${layer.name}" item feed requires an array or JSON text field.`,
          );
        else {
          try {
            applyElementDataValue(
              layer.element,
              'items',
              valueAtSourcePath(field.defaultValue, binding.sourcePath),
            );
          } catch (error) {
            errors.push(
              `${prefix}: ticker "${layer.name}" item feed default: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      if (parseModifierProperty(binding.targetProperty)) {
        const numericTypes = new Set(['number', 'integer', 'percentage', 'duration-ms']);
        if (resolved && !numericTypes.has(resolved.type) && !binding.valueMap)
          errors.push(
            `${prefix}: layer "${layer.name}" modifier parameter requires a numeric data field or value mapping.`,
          );
        const spec = modifierParameterSpec(layer, binding.targetProperty);
        const defaultValue = valueAtSourcePath(field.defaultValue, binding.sourcePath);
        const mapped = binding.valueMap?.[String(defaultValue)] ?? defaultValue;
        if (
          !fromArrayItem &&
          spec &&
          (typeof mapped !== 'number' ||
            !Number.isFinite(mapped) ||
            mapped < spec.min ||
            mapped > spec.max)
        )
          errors.push(
            `${prefix}: layer "${layer.name}" modifier field default must be ${spec.min}–${spec.max}.`,
          );
      }
      if (binding.targetProperty === 'clock.manualValue') {
        if (layer.element.type !== 'text' || !layer.element.clock)
          errors.push(
            `${prefix}: layer "${layer.name}" manual time binding requires a clock/timer.`,
          );
        else if (
          resolved &&
          ![
            'text',
            'textarea',
            'select',
            'number',
            'integer',
            'duration-ms',
            'percentage',
          ].includes(resolved.type)
        )
          errors.push(
            `${prefix}: clock/timer layer "${layer.name}" manual value requires a text or numeric data field.`,
          );
        else if (layer.element.clock.source === 'manual' && !fromArrayItem) {
          const value = valueAtSourcePath(field.defaultValue, binding.sourcePath);
          const mapped = binding.valueMap?.[String(value)] ?? value;
          if (parseClockTimerManualValue(layer.element.clock, mapped) === null)
            errors.push(
              `${prefix}: clock/timer layer "${layer.name}" manual field default is not a valid time or duration.`,
            );
        }
      }
      const clockSetting = clockDataSetting(binding.targetProperty);
      if (clockSetting) {
        if (layer.element.type !== 'text' || !layer.element.clock)
          errors.push(
            `${prefix}: layer "${layer.name}" binding "${binding.targetProperty}" requires a clock/timer.`,
          );
        else if (!fromArrayItem) {
          const value = valueAtSourcePath(field.defaultValue, binding.sourcePath);
          const mapped = binding.valueMap?.[String(value)] ?? value;
          if (!clockSettingsWithData(layer.element.clock, clockSetting, mapped))
            errors.push(
              `${prefix}: clock/timer layer "${layer.name}" field default is not a valid value for "${binding.targetProperty}".`,
            );
        }
      }
      if (layer.element.type === 'chart' && binding.targetProperty === 'data') {
        if (resolved?.type !== 'text' && resolved?.type !== 'textarea')
          errors.push(
            `${prefix}: layer "${layer.name}" chart data binding needs a text or textarea field.`,
          );
        else {
          try {
            parseChartData(valueAtSourcePath(field.defaultValue, binding.sourcePath));
          } catch (error) {
            errors.push(
              `${prefix}: layer "${layer.name}" chart field default: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      const shaderTarget = /^(fill|strokePaint)\.parameters\.(.+)$/.exec(
        migrateShaderBindingTarget(binding.targetProperty),
      );
      const boundShader = shaderTarget
        ? getElementShaderPaint(
            layer.element,
            shaderTarget[1] === 'strokePaint' ? 'stroke' : 'fill',
          )
        : undefined;
      const shaderParameter = boundShader
        ? inspectShaderSource(boundShader.fragmentSource).parameters.find(
            (parameter) => parameter.name === shaderTarget![2],
          )
        : undefined;
      if (shaderTarget && !shaderParameter) {
        errors.push(
          `${prefix}: layer "${layer.name}" binds an unmarked shader parameter "${binding.targetProperty}".`,
        );
      }
      const vectorObject =
        shaderParameter?.control === 'vector2' &&
        resolved?.type === 'object' &&
        ['x', 'y'].every((axis) =>
          resolved.properties.some(
            (child) => child.key === axis && (child.type === 'number' || child.type === 'integer'),
          ),
        );
      if (
        !resolved ||
        (resolved.type === 'object' && !vectorObject) ||
        (resolved.type === 'array' && !tickerFeed)
      ) {
        errors.push(
          `${prefix}: layer "${layer.name}" binding path for field "${field.key}" must resolve to a scalar leaf.`,
        );
      }
      if (shaderParameter && resolved) {
        const compatible =
          shaderParameter.control === 'vector2'
            ? vectorObject
            : shaderParameter.control === 'color'
              ? resolved.type === 'color'
              : shaderParameter.control === 'toggle'
                ? resolved.type === 'boolean'
                : shaderParameter.glslType === 'int'
                  ? resolved.type === 'integer'
                  : resolved.type === 'number' || resolved.type === 'integer';
        if (!compatible)
          errors.push(
            `${prefix}: layer "${layer.name}" shader parameter "${shaderParameter.name}" has an incompatible field type.`,
          );
        try {
          const rootValue =
            fromArrayItem && Array.isArray(field.defaultValue)
              ? field.defaultValue[0]
              : field.defaultValue;
          if (rootValue !== undefined)
            normalizeShaderParameterValue(
              shaderParameter,
              valueAtSourcePath(rootValue, binding.sourcePath),
            );
        } catch (error) {
          errors.push(
            `${prefix}: layer "${layer.name}" shader parameter "${shaderParameter.name}" field default: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    for (const targetProperty of duplicates(
      layer.bindings.map((binding) => binding.targetProperty),
    )) {
      errors.push(
        `${prefix}: layer "${layer.name}" binds target property "${targetProperty}" more than once.`,
      );
    }
    for (const ruleId of duplicates((layer.visualRules ?? []).map((rule) => rule.id))) {
      errors.push(`${prefix}: layer "${layer.name}" repeats visual rule id "${ruleId}".`);
    }
    for (const rule of layer.visualRules ?? []) {
      const ruleLabel = `${prefix}: layer "${layer.name}" visual rule "${rule.name}"`;
      if (
        rule.hostGroupId &&
        (!composition.layers.some((member) => member.groupId === rule.hostGroupId) ||
          layer.groupId !== rule.hostGroupId)
      )
        errors.push(
          `${ruleLabel} must be stored on a member of its owning group "${rule.hostGroupId}".`,
        );
      const trigger = rule.trigger ?? 'data';
      if (isVisualRuleKeyboardTrigger(trigger) || rule.keyboard !== undefined)
        for (const message of visualRuleKeyboardErrors(rule.keyboard))
          errors.push(`${ruleLabel}: ${message}`);
      if (trigger === 'timer-alarm')
        for (const message of validateTimerAlarmTrigger(rule.timerAlarm, composition.layers))
          errors.push(`${ruleLabel}: ${message}`);
      if (!VISUAL_RULE_TRIGGERS.has(trigger)) {
        errors.push(`${prefix}: layer "${layer.name}" visual rule has an unknown trigger.`);
      }
      const conditions = [...(trigger === 'data' ? [rule] : []), ...(rule.conditions ?? [])];
      if (
        trigger === 'data' &&
        !fieldIds.has(rule.fieldId) &&
        !isVisualRuleMouseFieldId(rule.fieldId)
      ) {
        errors.push(
          `${prefix}: layer "${layer.name}" visual rule references a missing data field.`,
        );
      }
      for (const condition of rule.conditions ?? []) {
        if (!fieldIds.has(condition.fieldId) && !isVisualRuleMouseFieldId(condition.fieldId))
          errors.push(`${ruleLabel} has a condition on a missing data field.`);
      }
      for (const condition of conditions) {
        if (!VISUAL_RULE_OPERATORS.has(condition.operator))
          errors.push(`${ruleLabel} uses unknown operator "${condition.operator}".`);
        if (
          condition.compareFieldId &&
          !fieldIds.has(condition.compareFieldId) &&
          !isVisualRuleMouseFieldId(condition.compareFieldId)
        )
          errors.push(`${ruleLabel} compares with a missing data field.`);
        if (
          condition.operator === 'between' &&
          !condition.compareFieldId &&
          !visualRuleRange(condition.value)
        )
          errors.push(`${ruleLabel} needs a [min, max] pair for "between".`);
        if (
          condition.compareFieldId &&
          ['between', 'one-of', 'not-one-of'].includes(condition.operator)
        )
          errors.push(`${ruleLabel} cannot compare "${condition.operator}" with another field.`);
      }
      if (trigger !== 'data' && conditions.some((c) => VISUAL_RULE_EVENT_OPERATORS.has(c.operator)))
        errors.push(`${ruleLabel} can watch for changes only on a Data trigger.`);
      if (rule.match !== undefined && rule.match !== 'all' && rule.match !== 'any')
        errors.push(`${ruleLabel} has an unknown condition match "${String(rule.match)}".`);
      if (trigger === 'custom-action' && (!rule.eventId || !customActionIds.has(rule.eventId)))
        errors.push(`${ruleLabel} must name an existing custom action.`);
      if (
        trigger === 'step' &&
        rule.eventId &&
        !composition.keyframes.some((k) => k.id === rule.eventId && k.role === 'step')
      )
        errors.push(`${ruleLabel} references a missing step.`);
      const isState =
        trigger === 'hover' || (trigger === 'data' && !isVisualRuleEdgeDataRule(rule));
      if (rule.delayFrames !== undefined) {
        if (!Number.isFinite(rule.delayFrames) || rule.delayFrames < 0)
          errors.push(`${ruleLabel} delay must be zero or more frames.`);
        else if (isState && rule.delayFrames > 0)
          errors.push(`${ruleLabel} delay applies only to event triggers.`);
      }
      if (rule.actions.length === 0 && trigger !== 'timer-alarm') {
        errors.push(`${prefix}: layer "${layer.name}" visual rule "${rule.name}" has no actions.`);
      }
      for (const action of rule.actions) {
        if (action.type === 'playout')
          for (const message of visualRulePlayoutActionErrors(action))
            errors.push(`${ruleLabel}: ${message}`);
        if (
          (action.type === 'custom-action' || action.type === 'shader-animation') &&
          !customActionIds.has(action.actionId)
        ) {
          errors.push(
            action.actionId
              ? `${ruleLabel} references missing custom action "${action.actionId}".`
              : `${ruleLabel} has a ${action.type} action with no action chosen.`,
          );
        }
        if (
          (action.type === 'play-sound' || action.type === 'take-media') &&
          !composition.mediaCues.some((cue) => cue.id === action.cueId)
        ) {
          errors.push(
            action.cueId
              ? `${ruleLabel} references missing media cue "${action.cueId}".`
              : `${ruleLabel} has a ${action.type} action with no sound or media chosen.`,
          );
        }
        if (
          action.type === 'visibility' ||
          action.type === 'toggle-visibility' ||
          action.type === 'property'
        ) {
          if (
            action.targetLayerId &&
            !composition.layers.some((candidate) => candidate.id === action.targetLayerId)
          )
            errors.push(`${ruleLabel} targets a missing layer "${action.targetLayerId}".`);
          if (action.targetGroupId) {
            if (!composition.layers.some((candidate) => candidate.groupId === action.targetGroupId))
              errors.push(`${ruleLabel} targets a missing group "${action.targetGroupId}".`);
            if (action.targetLayerId)
              errors.push(`${ruleLabel} targets both an object and a group; choose one.`);
          }
          if (
            action.transitionFrames !== undefined &&
            (!Number.isFinite(action.transitionFrames) || action.transitionFrames < 0)
          )
            errors.push(`${ruleLabel} transition must be zero or more frames.`);
        }
        if (action.type === 'toggle-visibility' && isState)
          errors.push(`${ruleLabel} can toggle visibility only on an event trigger.`);
        if (action.type === 'set-data') {
          if (!fieldIds.has(action.fieldId))
            errors.push(`${ruleLabel} changes a missing data field "${action.fieldId}".`);
          if (!(VISUAL_RULE_SET_DATA_MODES as readonly string[]).includes(action.mode))
            errors.push(`${ruleLabel} uses unknown data change "${String(action.mode)}".`);
          else if (
            (action.mode === 'increase' || action.mode === 'decrease') &&
            action.value !== undefined &&
            action.value !== '' &&
            !Number.isFinite(Number(action.value))
          )
            errors.push(`${ruleLabel} needs a number to ${action.mode} by.`);
        }
        if (action.type === 'property' && isLayerRuleProperty(action.targetProperty)) {
          const error = layerRulePropertyValueError(action.targetProperty, action.value);
          if (error) errors.push(`${ruleLabel} ${error}`);
        }
      }
    }
    if (layer.element.type === 'ticker') {
      const tickerProblems = tickerErrors(layer.element);
      errors.push(
        ...tickerProblems.map((problem) => `${prefix}: ticker "${layer.name}": ${problem}`),
      );
      if (!tickerProblems.length) {
        for (const reference of elementAssetReferences(layer.element))
          validateAssetReference(reference, `ticker "${layer.name}"`);
        if (layer.element.background)
          errors.push(
            ...validatePaint(layer.element.background).map(
              (problem) => `${prefix}: ticker "${layer.name}" background: ${problem}`,
            ),
          );
        for (const item of layer.element.items) {
          const owner = `${prefix}: ticker "${layer.name}" item "${item.name ?? item.id}"`;
          if (item.effects)
            errors.push(
              ...layerEffectErrors({ element: item.element, effects: item.effects }).map(
                (problem) => `${owner}: ${problem}`,
              ),
            );
          const element = item.element;
          if ('fill' in element && element.fill)
            errors.push(...validatePaint(element.fill).map((problem) => `${owner}: ${problem}`));
          if (element.type === 'text') {
            errors.push(
              ...textAnimatorPaintErrors(element).map((problem) => `${owner}: ${problem}`),
            );
            errors.push(
              ...textAnimationErrors(element.textAnimation).map(
                (problem) => `${owner}: ${problem}`,
              ),
            );
            if (!['auto', 'ltr', 'rtl'].includes(element.direction))
              errors.push(`${owner}: invalid text direction.`);
            if (
              !Number.isFinite(element.fontSize) ||
              element.fontSize <= 0 ||
              typeof element.content !== 'string'
            )
              errors.push(`${owner}: invalid text content or font size.`);
            if (element.clock)
              errors.push(
                ...validateClockTimerSettings(element.clock).map(
                  (problem) => `${owner}: ${problem}`,
                ),
              );
          }
          if (
            element.type === 'image-sequence' &&
            (!Array.isArray(element.frames) || !Number.isFinite(element.fps) || element.fps <= 0)
          )
            errors.push(`${owner}: invalid image sequence.`);
          if (element.type === 'lottie') {
            if (!element.animationData) errors.push(`${owner}: Lottie has no animation JSON.`);
            else
              errors.push(
                ...inspectLottieAnimationData(element.animationData).errors.map(
                  (problem) => `${owner}: ${problem}`,
                ),
              );
            if (!Number.isFinite(element.speed) || element.speed < 0)
              errors.push(`${owner}: invalid Lottie speed.`);
          }
          if (element.type === 'image' || element.type === 'image-sequence') {
            if (element.crop)
              errors.push(
                ...sourceCropErrors(element.crop).map((problem) => `${owner}: ${problem}`),
              );
            if (element.fit && !['contain', 'cover', 'fill'].includes(element.fit))
              errors.push(`${owner}: invalid image fit.`);
          }
        }
      }
    }
    for (const { slot, paint } of (layer.element.type === 'ticker' &&
    tickerErrors(layer.element).length
      ? []
      : walkElementContents(layer.element)
    ).flatMap(getElementShaderPaints)) {
      errors.push(
        ...inspectShaderElement(paint).errors.map(
          (error) => `${prefix}: layer "${layer.name}" ${slot} paint: ${error}`,
        ),
      );
    }
    if (
      'strokePaint' in layer.element &&
      layer.element.strokePaint !== undefined &&
      (layer.element.type !== 'text' || !isShaderPaint(layer.element.strokePaint))
    ) {
      errors.push(
        `${prefix}: layer "${layer.name}" strokePaint must be a shader paint on a text layer, or omitted.`,
      );
    }
    if (
      ['image', 'image-sequence', 'lottie'].includes(layer.element.type) &&
      'fill' in layer.element &&
      layer.element.fill !== undefined &&
      !isShaderPaint(layer.element.fill) &&
      !isMediaPaint(layer.element.fill)
    ) {
      errors.push(
        `${prefix}: layer "${layer.name}" media fill must be a shader, media paint, or omitted.`,
      );
    }
    const mediaPaint = isMediaPaint(getElementFill(layer.element))
      ? getElementFill(layer.element)
      : undefined;
    if (mediaPaint && isMediaPaint(mediaPaint)) {
      if (['image', 'image-sequence', 'lottie'].includes(layer.element.type))
        for (const problem of validatePaint(mediaPaint))
          errors.push(`${prefix}: layer "${layer.name}" ${problem}.`);
      for (const reference of mediaPaintAssetReferences(mediaPaint))
        validateAssetReference(reference, `layer "${layer.name}" media paint`);
      if (mediaPaint.source.kind === 'clip' && mediaPaint.source.src.startsWith('asset:')) {
        const asset = assetById.get(mediaPaint.source.src.slice('asset:'.length));
        if (asset && (asset.kind !== 'media' || !asset.mimeType.startsWith('video/')))
          errors.push(
            `${prefix}: layer "${layer.name}" media clip must reference a video media asset.`,
          );
      }
      if (mediaPaint.source.kind === 'live' && mediaPaint.source.fallback?.startsWith('asset:')) {
        const asset = assetById.get(mediaPaint.source.fallback.slice('asset:'.length));
        if (asset && (asset.kind !== 'image' || !asset.mimeType.startsWith('image/')))
          errors.push(
            `${prefix}: layer "${layer.name}" live media fallback must reference an image asset.`,
          );
      }
    }
    if (layer.element.type === 'image' || layer.element.type === 'image-sequence') {
      if (layer.element.crop)
        for (const problem of sourceCropErrors(layer.element.crop))
          errors.push(`${prefix}: layer "${layer.name}" ${problem}.`);
      if (
        layer.element.fit !== undefined &&
        !['contain', 'cover', 'fill'].includes(layer.element.fit)
      )
        errors.push(`${prefix}: layer "${layer.name}" image fit is invalid.`);
    }
    if (layer.element.type === 'image' && layer.element.src) {
      validateAssetReference(layer.element.src, `layer "${layer.name}"`);
    } else if (layer.element.type === 'image-sequence') {
      for (const frame of layer.element.frames) {
        validateAssetReference(frame, `layer "${layer.name}"`);
      }
    } else if (layer.element.type === 'chart') {
      if (layer.element.provider == null)
        warnings.push(
          `${prefix}: layer "${layer.name}" has no assigned chart renderer provider. Assign a pinned plugin before preview or export.`,
        );
      if (layer.element.provider != null) {
        const providerErrors = validateRendererPluginReference(layer.element.provider);
        errors.push(...providerErrors.map((error) => `${prefix}: layer "${layer.name}": ${error}`));
        if (!providerErrors.length) {
          const plugin = pluginsByKey.get(rendererPluginKey(layer.element.provider));
          if (!plugin)
            errors.push(
              `${prefix}: layer "${layer.name}" requires a missing pinned renderer plugin version or digest.`,
            );
          else if (!plugin.manifest.presets.includes(layer.element.preset))
            errors.push(
              `${prefix}: layer "${layer.name}" renderer plugin does not support preset ${layer.element.preset}.`,
            );
          else
            errors.push(
              ...chartRendererFeatureErrors(layer.element, plugin.manifest).map(
                (error) => `${prefix}: layer "${layer.name}": ${error}`,
              ),
            );
        }
      }
      errors.push(
        ...chartAnimationErrors(layer.element.animation).map(
          (error) => `${prefix}: layer "${layer.name}": ${error}`,
        ),
        ...chartMarkAnimationErrors(layer.element, animationPlugins, motionWindows).map(
          (error) => `${prefix}: layer "${layer.name}": ${error}`,
        ),
      );
      if (
        ![
          'bar',
          'horizontal-bar',
          'stacked-bar',
          'line',
          'area',
          'pie',
          'doughnut',
          'radar',
          'polar-area',
        ].includes(layer.element.preset)
      )
        errors.push(`${prefix}: layer "${layer.name}" has an unknown chart preset.`);
      try {
        parseChartData(layer.element.data);
      } catch (error) {
        errors.push(
          `${prefix}: layer "${layer.name}" chart data: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      errors.push(
        ...chartPresentationErrors(layer.element.presentation).map(
          (error) => `${prefix}: layer "${layer.name}": ${error}`,
        ),
      );
      if (!/^#[\da-f]{6}$/i.test(layer.element.textColor))
        errors.push(`${prefix}: layer "${layer.name}" chart textColor must be #RRGGBB.`);
      if (
        !Number.isFinite(layer.element.fontSize) ||
        layer.element.fontSize < 8 ||
        layer.element.fontSize > 96
      )
        errors.push(`${prefix}: layer "${layer.name}" chart label size must be 8–96 px.`);
      if (
        typeof layer.element.showLegend !== 'boolean' ||
        typeof layer.element.showGrid !== 'boolean'
      )
        errors.push(
          `${prefix}: layer "${layer.name}" chart legend/grid settings must be booleans.`,
        );
    } else if (layer.element.type === 'shader') {
      const inspection = inspectShaderElement(layer.element);
      errors.push(
        ...inspection.errors.map((error) => `${prefix}: layer "${layer.name}": ${error}`),
      );
    } else if (layer.element.type === 'lottie') {
      if (!layer.element.animationData) {
        errors.push(`${prefix}: Lottie layer "${layer.name}" has no animation JSON.`);
      } else {
        const inspection = inspectLottieAnimationData(layer.element.animationData);
        errors.push(
          ...inspection.errors.map((error) => `${prefix}: layer "${layer.name}": ${error}`),
        );
        warnings.push(
          ...inspection.warnings.map((warning) => `${prefix}: layer "${layer.name}": ${warning}`),
        );
      }
      if (!Number.isFinite(layer.element.speed) || layer.element.speed < 0) {
        errors.push(
          `${prefix}: Lottie layer "${layer.name}" speed must be finite and non-negative.`,
        );
      }
    } else if (layer.element.type === 'audio') {
      if (!layer.element.src) errors.push(`${prefix}: audio layer "${layer.name}" has no source.`);
      else {
        validateAssetReference(layer.element.src, `audio layer "${layer.name}"`);
        if (layer.element.src.startsWith('asset:')) {
          const asset = assetById.get(layer.element.src.slice('asset:'.length));
          if (asset && (asset.kind !== 'audio' || !asset.mimeType.startsWith('audio/')))
            errors.push(`${prefix}: audio layer "${layer.name}" must reference an audio asset.`);
        }
      }
      if (
        !Number.isFinite(layer.element.volume) ||
        layer.element.volume < 0 ||
        layer.element.volume > 1
      )
        errors.push(`${prefix}: audio layer "${layer.name}" volume must be from 0 to 1.`);
      if (
        !Number.isFinite(layer.element.trimStartMs) ||
        layer.element.trimStartMs < 0 ||
        !Number.isFinite(layer.element.timelineStartMs) ||
        layer.element.timelineStartMs < 0 ||
        (layer.element.trimEndMs !== null && layer.element.trimEndMs <= layer.element.trimStartMs)
      )
        errors.push(`${prefix}: audio layer "${layer.name}" has invalid trim/timeline values.`);
    } else if (layer.element.type === 'text') {
      const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
      for (const error of textAnimatorPaintErrors(layer.element))
        errors.push(`${prefix}: text layer "${layer.name}": ${error}`);
      for (const error of textAnimationErrors(layer.element.textAnimation)) {
        errors.push(`${prefix}: text layer "${layer.name}": ${error}`);
      }
      for (const error of textCrawlErrors(layer.element.crawl)) {
        errors.push(`${prefix}: text layer "${layer.name}": ${error}`);
      }
      if (layer.element.clock !== undefined) {
        for (const error of validateClockTimerSettings(layer.element.clock)) {
          errors.push(`${prefix}: clock/timer layer "${layer.name}": ${error}`);
        }
      }
      if (
        !(['auto-size', 'shrink-to-fit', 'fit-to-width', 'squeeze', 'fixed'] as const).includes(
          layer.element.autoFit,
        )
      ) {
        errors.push(`${prefix}: text layer "${layer.name}" has an unsupported text sizing mode.`);
      }
      if (!Number.isFinite(layer.element.strokeWidth) || layer.element.strokeWidth < 0) {
        errors.push(
          `${prefix}: text layer "${layer.name}" stroke width must be finite and non-negative.`,
        );
      }
      if (!Number.isFinite(layer.element.lineHeight) || layer.element.lineHeight < 0.5) {
        errors.push(`${prefix}: text layer "${layer.name}" line height must be at least 0.5.`);
      }
      if (!Number.isFinite(layer.element.letterSpacing)) {
        errors.push(`${prefix}: text layer "${layer.name}" letter spacing must be finite.`);
      }
      if (!Number.isFinite(layer.element.baselineShift)) {
        errors.push(`${prefix}: text layer "${layer.name}" baseline shift must be finite.`);
      }
      if (
        !Number.isFinite(layer.element.minFontSize) ||
        layer.element.minFontSize < 1 ||
        layer.element.minFontSize > layer.element.fontSize
      ) {
        errors.push(
          `${prefix}: text layer "${layer.name}" minimum font size must be between 1 and its authored font size.`,
        );
      }
      if (!['auto', 'ltr', 'rtl'].includes(layer.element.direction)) {
        errors.push(`${prefix}: text layer "${layer.name}" has an invalid text direction.`);
      }
      if (
        layer.element.language &&
        !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(layer.element.language)
      ) {
        errors.push(`${prefix}: text layer "${layer.name}" has an invalid language tag.`);
      }
      if (
        layer.element.runs.length > 0 &&
        layer.element.runs.map((run) => run.text).join('') !== layer.element.content
      ) {
        errors.push(
          `${prefix}: text layer "${layer.name}" styled runs must concatenate to content.`,
        );
      }
      for (const run of layer.element.runs) {
        if (
          run.fontWeight !== undefined &&
          (!Number.isFinite(run.fontWeight) || run.fontWeight < 1)
        )
          errors.push(`${prefix}: text layer "${layer.name}" has an invalid styled-run weight.`);
      }
      if (textAnimation.customActionId && !customActionIds.has(textAnimation.customActionId)) {
        errors.push(
          `${prefix}: text layer "${layer.name}" animation references missing custom action "${textAnimation.customActionId}".`,
        );
      }
    }
  }
  for (const field of composition.dataFields) {
    const visitFieldAssets = (
      node: FieldDefinition,
      value: FieldDefinition['defaultValue'],
      owner: string,
    ) => {
      if ((node.type === 'image-url' || node.type === 'file-path') && typeof value === 'string') {
        validateAssetReference(value, owner);
      } else if (
        node.type === 'object' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const record = value as Record<string, FieldDefinition['defaultValue']>;
        for (const property of node.properties) {
          if (record[property.key] !== undefined) {
            visitFieldAssets(property, record[property.key]!, `${owner}.${property.key}`);
          }
        }
      } else if (node.type === 'array' && node.items && Array.isArray(value)) {
        value.forEach((item, index) => visitFieldAssets(node.items!, item, `${owner}[${index}]`));
      }
    };
    visitFieldAssets(field, field.defaultValue, `data field "${field.key}"`);
  }

  if (composition.keyframes.every((keyframe) => keyframe.role !== 'step')) {
    warnings.push(
      `${prefix}: has zero pausable steps; playAction moves directly from Start to End.`,
    );
  }
}

/** Structural validation for the editor document, before compiling the OGraf manifest/runtime. */
export function validateProject(project: Project): ProjectValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(project.shaders)) {
    errors.push('Project shader library must be an array.');
  } else {
    const shaderIds: string[] = [];
    for (const [index, resource] of project.shaders.entries()) {
      if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
        errors.push(`Shader library entry ${index + 1} must be an object.`);
        continue;
      }
      if (typeof resource.id !== 'string' || !resource.id.trim())
        errors.push(`Shader library entry ${index + 1} requires a non-empty id.`);
      else shaderIds.push(resource.id);
      if (!isShaderPaint(resource.paint)) {
        errors.push(`Shader library entry "${resource.id || index + 1}" requires a shader paint.`);
        continue;
      }
      const inspection = inspectShaderResourcePaint(resource.paint);
      errors.push(
        ...inspection.errors.map(
          (error) => `Shader library entry "${resource.id || index + 1}": ${error}`,
        ),
      );
      warnings.push(
        ...inspection.warnings.map(
          (warning) => `Shader library entry "${resource.id || index + 1}": ${warning}`,
        ),
      );
    }
    for (const id of duplicates(shaderIds)) errors.push(`Duplicate shader resource id "${id}".`);
  }
  if (!project.id.trim()) errors.push('Project id is required.');
  if (!project.name.trim()) errors.push('Project name is required.');
  if (!project.supportsRealTime && !project.supportsNonRealTime) {
    errors.push('Project must support real-time, non-real-time, or both render modes.');
  }
  if (!project.compositions.some((composition) => composition.id === project.mainCompositionId)) {
    errors.push('Main composition id does not reference an existing composition.');
  }
  for (const duplicate of duplicates(project.compositions.map((composition) => composition.id))) {
    errors.push(`Duplicate composition id "${duplicate}".`);
  }
  for (const composition of project.compositions)
    validateComposition(composition, errors, warnings);
  if (project.supportsNonRealTime) {
    for (const composition of project.compositions) {
      if (composition.functions?.length)
        errors.push(
          `Composition "${composition.name}" uses Functions, which require standalone real-time playback and cannot declare non-real-time support.`,
        );
      if (isMediaPaint(composition.backgroundPaint))
        errors.push(
          `Composition "${composition.name}" uses a media background, which is real-time-only.`,
        );
      if (composition.mediaCues.length > 0) {
        errors.push(
          `Composition "${composition.name}" uses Media Cues, whose initial runtime is real-time-only and cannot declare non-real-time support.`,
        );
      }
      for (const layer of composition.layers) {
        const paint = getElementFill(layer.element);
        if (isMediaPaint(paint))
          errors.push(
            `Composition "${composition.name}": layer "${layer.name}" uses media paint, whose initial runtime is real-time-only and cannot declare non-real-time support.`,
          );
        if (layer.element.type === 'audio')
          errors.push(
            `Composition "${composition.name}": layer "${layer.name}" uses audio, which is real-time-only and cannot declare non-real-time support.`,
          );
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}
