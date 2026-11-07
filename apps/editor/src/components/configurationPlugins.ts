import {
  rendererPluginKey,
  validateRendererPluginManifest,
  validateRendererPluginReference,
  type Project,
  type RendererPluginSnapshot,
  type StudioPluginSnapshot,
  validateStudioPluginSnapshot,
} from '@ograf-editor/scene-model';

/** Configuration shows required chart code, not every historical snapshot retained in a template. */
export function requiredProjectRendererPlugins(project: Project): RendererPluginSnapshot[] {
  const snapshots = new Map<string, RendererPluginSnapshot>();
  for (const composition of project.compositions) {
    // Runtime-collection prototypes and materialized component instances are already layers here.
    const selected = new Set(
      composition.layers.flatMap((layer) => {
        if (
          layer.isGuide ||
          layer.element.type !== 'chart' ||
          !layer.element.provider ||
          validateRendererPluginReference(layer.element.provider).length
        )
          return [];
        return [rendererPluginKey(layer.element.provider)];
      }),
    );
    for (const snapshot of Array.isArray(composition.rendererPlugins)
      ? composition.rendererPlugins
      : []) {
      // Leave Configuration usable when unrelated project validation fails. Non-executable review
      // still needs displayable metadata; install() performs full integrity/module verification.
      if (
        !snapshot ||
        validateRendererPluginManifest(snapshot.manifest).length ||
        typeof snapshot.source !== 'string' ||
        typeof snapshot.licenseText !== 'string'
      )
        continue;
      const reference = {
        id: snapshot.manifest.id,
        version: snapshot.manifest.version,
        sha256: snapshot.sha256,
      };
      if (validateRendererPluginReference(reference).length) continue;
      const key = rendererPluginKey(reference);
      if (selected.has(key)) snapshots.set(key, snapshot);
    }
  }
  return [...snapshots.values()];
}

/** Preset snapshots are authoring recipes; restoring them never changes already baked keys. */
export function requiredProjectStudioPlugins(project: Project): StudioPluginSnapshot[] {
  const snapshots = new Map(
    requiredProjectRendererPlugins(project).map((snapshot) => [
      rendererPluginKey({ ...snapshot.manifest, sha256: snapshot.sha256 }),
      snapshot as StudioPluginSnapshot,
    ]),
  );
  for (const composition of project.compositions) {
    const layers = [
      ...composition.layers,
      ...composition.components.flatMap((component) => component.layers),
    ];
    const selected = new Set(
      layers.flatMap((layer) =>
        [
          ...Object.values(layer.animationPresets ?? {}),
          ...Object.values(
            layer.element.type === 'chart' ? (layer.element.markAnimations ?? {}) : {},
          ),
        ].flatMap((application) =>
          application && !validateRendererPluginReference(application.reference).length
            ? [rendererPluginKey(application.reference)]
            : [],
        ),
      ),
    );
    for (const snapshot of composition.animationPresetPlugins ?? []) {
      if (validateStudioPluginSnapshot(snapshot).length) continue;
      const key = rendererPluginKey({ ...snapshot.manifest, sha256: snapshot.sha256 });
      if (selected.has(key)) snapshots.set(key, snapshot);
    }
  }
  return [...snapshots.values()];
}
