import {
  isRendererPluginSnapshot,
  isShaderPackPluginSnapshot,
  type StudioPluginSnapshot,
} from '@ograf-editor/scene-model';
import { applicationComponents } from './configurationApplications';

export function ApplicationComponents({ snapshot }: { snapshot: StudioPluginSnapshot }) {
  const info = applicationComponents(snapshot);
  if (!info.library)
    return (
      <div className="application-components is-preset-pack">
        <section className="application-component-identity" aria-label="Pack identity">
          <h4>{isShaderPackPluginSnapshot(snapshot) ? 'Shader pack' : 'Animation preset pack'}</h4>
          <strong>
            {info.adapter.name}{' '}
            <small className="application-component-version">{info.adapter.version}</small>
          </strong>
        </section>
        <section className="application-component-metadata" aria-label="Pack declarations">
          <span className="application-component-publisher">
            Publisher: {info.adapter.publisher}
          </span>
          <span className="application-component-license">
            License: {info.adapter.license} <small>(declared)</small>
          </span>
          <span className="application-component-validation">
            {isShaderPackPluginSnapshot(snapshot)
              ? 'GLSL programs · run on the GPU after explicit use'
              : 'Validated JSON data · no JavaScript execution'}
          </span>
        </section>
      </div>
    );
  return (
    <div className="application-components">
      <section className="application-component-adapter" aria-label="Studio adapter declarations">
        <h4>Studio adapter (integration code)</h4>
        <strong>
          {info.adapter.name}{' '}
          <small className="application-component-version">{info.adapter.version}</small>
        </strong>
        <div className="application-component-meta-line">
          <span>Publisher: {info.adapter.publisher}</span>
          <span>
            License: {info.adapter.license} <small>(declared)</small>
          </span>
        </div>
      </section>
      <section
        className="application-component-library"
        aria-label="Underlying library declarations"
      >
        <h4>Underlying library</h4>
        <strong>
          {info.library.name}{' '}
          <small className="application-component-version">{info.library.version}</small>
        </strong>
        <div className="application-component-meta-line">
          <span>Publisher: {info.library.publisher}</span>
          <span>
            License: {info.library.license}
            {info.library.licenseOrigin !== 'unknown' ? (
              <small> ({info.library.licenseOrigin})</small>
            ) : null}
          </span>
        </div>
        {info.library.homepage ? (
          <a href={info.library.homepage} target="_blank" rel="noopener noreferrer">
            Library homepage ↗
          </a>
        ) : null}
      </section>
    </div>
  );
}

export function ApplicationBundleDetails({ snapshot }: { snapshot: StudioPluginSnapshot }) {
  const chart = isRendererPluginSnapshot(snapshot);
  const shader = isShaderPackPluginSnapshot(snapshot);
  return (
    <div className="application-bundle-details">
      <dl>
        <dt>Plugin ID</dt>
        <dd>{snapshot.manifest.id}</dd>
        <dt>SHA-256</dt>
        <dd>
          <code>{snapshot.sha256}</code>
        </dd>
        <dt>{chart ? 'Chart types' : shader ? 'Shaders' : 'Presets'}</dt>
        <dd>
          {chart
            ? snapshot.manifest.presets.join(', ')
            : shader
              ? snapshot.shaders.map((preset) => preset.name).join(', ')
              : snapshot.presets.map((preset) => preset.name).join(', ')}
        </dd>
      </dl>
      {shader ? (
        <p className="configuration-help">
          {(['fill', 'outline', 'effect'] as const)
            .map(
              (target) =>
                `${target}: ${snapshot.shaders.filter((preset) => preset.targets.includes(target)).length}`,
            )
            .join(' · ')}
        </p>
      ) : null}
      <p className="configuration-help">
        {chart ? (
          <>
            One complete bundle contains the Studio adapter and its library. Library files cannot be
            swapped separately; separate vendor-file or BYOL setup is not supported. Attribution and
            licenses are package declarations, not independently verified provenance.
          </>
        ) : shader ? (
          <>
            This pack contains GPU shader programs. Installing and reviewing the pack does not
            compile or preview them. Applying a shader runs its GLSL on your GPU; complex programs
            may increase GPU load. Applied paints and effects are independent copies, so removing
            this pack only affects the chooser.
          </>
        ) : (
          <>
            This pack contains validated animation definitions, not executable code. Applying a
            preset creates editable keyframes. Removing the installed pack does not change
            previously baked animation keys.
          </>
        )}
      </p>
    </div>
  );
}
