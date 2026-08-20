import {
  getLayerAnimatableProperties,
  gradientStopIndexForProperty,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
  validatePaint,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) (seen.has(value) ? duplicate : seen).add(value);
  return [...duplicate];
}

function validateComposition(composition: Composition, errors: string[], warnings: string[]): void {
  const prefix = `Composition "${composition.name}"`;
  if (!finitePositive(composition.width) || !finitePositive(composition.height)) {
    errors.push(`${prefix}: width and height must be finite positive numbers.`);
  }
  if (!finitePositive(composition.frameRate))
    errors.push(`${prefix}: frame rate must be positive.`);

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

  for (const duplicate of duplicates(composition.keyframes.map((keyframe) => keyframe.id))) {
    errors.push(`${prefix}: duplicate keyframe id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.layers.map((layer) => layer.id))) {
    errors.push(`${prefix}: duplicate layer id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.assets.map((asset) => asset.id))) {
    errors.push(`${prefix}: duplicate asset id "${duplicate}".`);
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
    if (layer.element.type === 'rectangle' || layer.element.type === 'ellipse') {
      for (const problem of validatePaint(layer.element.fill)) {
        errors.push(`${prefix}: layer "${layer.name}" ${problem}.`);
      }
    }
    if (layer.parentId && !layerIds.has(layer.parentId)) {
      errors.push(`${prefix}: layer "${layer.name}" references a missing transform parent.`);
    }
    if (layer.parentId === layer.id) {
      errors.push(`${prefix}: layer "${layer.name}" cannot parent itself.`);
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
    const tracks = getResolvedLayerAnimationTracks(layer);
    for (const property of getLayerAnimatableProperties(layer)) {
      const propertyKeys = tracks[property] ?? [];
      const stopIndex = gradientStopIndexForProperty(property);
      if (stopIndex !== null) {
        const fill =
          layer.element.type === 'rectangle' || layer.element.type === 'ellipse'
            ? layer.element.fill
            : null;
        if (!fill || typeof fill === 'string' || !fill.stops[stopIndex]) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" references a missing gradient stop.`,
          );
        }
      }
      if (propertyKeys.length === 0) {
        errors.push(`${prefix}: layer "${layer.name}" property "${property}" has no keys.`);
      }
      for (const duplicate of duplicates(propertyKeys.map((keyframe) => String(keyframe.frame)))) {
        errors.push(
          `${prefix}: layer "${layer.name}" property "${property}" has multiple keys at frame ${duplicate}.`,
        );
      }
      for (const keyframe of propertyKeys) {
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
      for (const [property, keys = []] of Object.entries(loop.tracks)) {
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
  for (const actionId of duplicates(composition.customActions.map((action) => action.actionId))) {
    errors.push(`${prefix}: duplicate custom action id "${actionId}".`);
  }
  const fieldIds = new Set(composition.dataFields.map((field) => field.id));
  const assetIds = new Set(composition.assets.map((asset) => asset.id));
  const validateAssetReference = (value: string, owner: string) => {
    if (value.startsWith('asset:') && !assetIds.has(value.slice('asset:'.length))) {
      errors.push(`${prefix}: ${owner} references a missing asset "${value}".`);
    }
  };
  for (const asset of composition.assets) {
    if (!asset.dataUri.startsWith('data:')) {
      errors.push(`${prefix}: asset "${asset.name}" must contain a data URI.`);
    }
  }
  for (const layer of composition.layers) {
    if (layer.binding && !fieldIds.has(layer.binding.fieldId)) {
      errors.push(`${prefix}: layer "${layer.name}" references a missing data field.`);
    }
    if (layer.element.type === 'image' && layer.element.src) {
      validateAssetReference(layer.element.src, `layer "${layer.name}"`);
    } else if (layer.element.type === 'image-sequence') {
      for (const frame of layer.element.frames) {
        validateAssetReference(frame, `layer "${layer.name}"`);
      }
    }
  }
  for (const field of composition.dataFields) {
    if (field.type === 'image-url' && typeof field.defaultValue === 'string') {
      validateAssetReference(field.defaultValue, `data field "${field.key}"`);
    }
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
  if (!project.id.trim()) errors.push('Project id is required.');
  if (!project.name.trim()) errors.push('Project name is required.');
  if (!project.compositions.some((composition) => composition.id === project.mainCompositionId)) {
    errors.push('Main composition id does not reference an existing composition.');
  }
  for (const duplicate of duplicates(project.compositions.map((composition) => composition.id))) {
    errors.push(`Duplicate composition id "${duplicate}".`);
  }
  for (const composition of project.compositions)
    validateComposition(composition, errors, warnings);
  return { valid: errors.length === 0, errors, warnings };
}
