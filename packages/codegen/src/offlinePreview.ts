import type { ExportArtifacts } from './buildExportArtifacts';
import {
  NODOS_INPUT_RUNTIME,
  OFFLINE_PREVIEW_RUNTIME,
  OFFLINE_PREVIEW_STYLE,
} from './offlinePreviewAssets';
import { STUDIO_RUNTIME_LICENSE_PATH, STUDIO_RUNTIME_LICENSE_TEXT } from './runtimeLicenses';

/** Escape the payload so graphic text or shader source cannot terminate its HTML script element. */
function htmlSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function htmlSafeText(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

function authoringPromptsSection(manifest: ExportArtifacts['manifest']): string {
  const history = manifest.v_ografStudioAuthoringPrompts;
  const templates = history?.version === 1 ? history.templates : [];
  const entries = templates
    .filter(({ prompts }) => prompts.length > 0)
    .map(({ name, prompts }) => {
      const heading =
        templates.length > 1 || name !== manifest.name ? `<h3>${htmlSafeText(name)}</h3>` : '';
      const items = prompts
        .map(
          ({ text }, index) =>
            `<li><strong>${index === 0 ? 'Original prompt' : `Follow-up ${index}`}</strong><div style="white-space:pre-wrap;overflow-wrap:anywhere">${htmlSafeText(text)}</div></li>`,
        )
        .join('');
      return `<section>${heading}<ol>${items}</ol></section>`;
    })
    .join('');
  return `<details id="authoring-prompts" class="preview-background-controls"><summary>Authoring prompts</summary>${entries || '<p class="playout-controls-note">No authoring prompts were saved with this graphic.</p>'}</details>`;
}

/** Build a self-contained local preview from the exact certified package files. */
export function buildOfflinePreviewHtml(artifacts: ExportArtifacts): string {
  const title = htmlSafeText(artifacts.manifest.name || 'OGraf preview');
  const runtimeLicense = artifacts.resources.find(
    (resource) => resource.path === STUDIO_RUNTIME_LICENSE_PATH,
  );
  const licenseText = htmlSafeText(
    runtimeLicense && !runtimeLicense.base64 ? runtimeLicense.data : STUDIO_RUNTIME_LICENSE_TEXT,
  );
  const payload = htmlSafeJson({
    manifest: artifacts.manifest,
    mainJs: artifacts.mainJs,
    ...(artifacts.nodosInputContract ? { nodos: artifacts.nodosInputContract } : {}),
    // The runtime license is displayed in the page below. Graphic assets stay embedded.
    resources: artifacts.resources.filter(
      (resource) => resource.path !== STUDIO_RUNTIME_LICENSE_PATH,
    ),
    ...(artifacts.offlinePreviewStateSchemas
      ? { stateSchemas: artifacts.offlinePreviewStateSchemas }
      : {}),
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${OFFLINE_PREVIEW_STYLE}</style></head>
<!-- OGraf Studio's embedded playback components are licensed under AGPL-3.0-only. See the playback license embedded in this file. -->
<body class="ograf-offline-preview preview-stage-wrap controls-hidden" data-preview-overlay data-dock="right"><main id="output" aria-label="Graphic preview" aria-keyshortcuts="D Shift+F10" tabindex="0"><div id="frame"><div id="background"><img id="background-image" alt="" hidden><video id="background-video" muted loop playsinline hidden></video></div><div id="stage"></div><svg id="safe-guides" aria-label="EBU R95 safe area guides" viewBox="0 0 100 100" preserveAspectRatio="none"><rect id="action-guide" x="3.5" y="3.5" width="93" height="93" hidden></rect><rect id="title-guide" x="5" y="5" width="90" height="90" hidden></rect></svg><output id="fps-overlay" class="preview-fps-overlay" aria-label="Preview FPS" aria-live="off" title="Browser preview animation-frame cadence, not authored FPS or GPU throughput" hidden>Preview FPS —</output></div></main>
<aside id="controls" class="preview-fullscreen-data" aria-label="Playout controls" hidden>
<header class="preview-fullscreen-data-heading"><strong>Preview controls</strong><button id="fullscreen" type="button">Fullscreen</button><button id="hide" type="button" aria-label="Hide controls" title="Hide controls (D)">×</button></header>
<div id="panel" class="preview-popup-body playout-controls-panel">
<div class="preview-template-navigation" aria-label="Controlled graphic"><span title="${title}">${title}</span><small id="preview-step">Off air</small></div>
<div id="transport" class="preview-controls-row"><button id="back" type="button" title="Go back one step" disabled>⏮ Back</button><button id="play" type="button" disabled>Take In ▶</button><button id="out" type="button" disabled>Take Out</button></div>
<div id="status" class="playout-controls-note" role="status">Loading graphic…</div>
<details id="view-settings" class="preview-background-controls"><summary>View settings</summary><label class="preview-background-controls-row"><span>Dock controls</span><select id="dock-side" aria-label="Dock controls"><option value="right">Right</option><option value="left">Left</option></select></label><label class="preview-background-controls-row"><span>FPS overlay</span><input id="fps-enabled" type="checkbox" aria-label="Show FPS overlay" checked></label></details>
<div id="lanes"></div>
<details id="background-settings" class="preview-background-controls"><summary>Background</summary><label class="preview-background-controls-row"><span>Source</span><select id="background-kind" aria-label="Presentation background"><option value="solid">Solid color</option><option value="checker">Checkerboard</option><option value="image">Still image</option><option value="video">Local video</option><option value="webcam">Webcam · local preview</option></select></label><label id="background-color-row" class="preview-background-controls-row"><span>Color</span><input id="background-color" type="color" value="#090d13" aria-label="Background color"></label><label id="background-file-row" class="preview-background-controls-row" hidden><span>Local file</span><input id="background-file" type="file" accept="image/*" aria-label="Background file"></label><div id="background-camera-row" class="preview-background-controls-actions" hidden><button id="background-camera" type="button">Start webcam</button></div><div class="preview-background-controls-row"><span>Program guides</span><span class="preview-guide-choices"><label><input id="action-safe" type="checkbox">Action safe</label><label><input id="title-safe" type="checkbox">Title safe</label></span></div><p class="playout-controls-note">Background and guides affect this preview only; the graphic is unchanged.</p></details>
<div id="data" class="preview-data-form"></div><div id="actions"></div>
${authoringPromptsSection(artifacts.manifest)}
<p class="hint">Right-click for controls · D toggles · Escape exits fullscreen.</p><details class="preview-background-controls"><summary>OGraf Studio playback license · AGPL-3.0</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${licenseText}</pre></details>
</div></aside>
<script id="nodos-inputs" type="application/json">${htmlSafeJson(artifacts.nodosInputContract && 'inputs' in artifacts.nodosInputContract ? artifacts.nodosInputContract.inputs : [])}</script>
<script type="application/json" id="ograf-package">${payload}</script><script>${(NODOS_INPUT_RUNTIME + '\n' + OFFLINE_PREVIEW_RUNTIME).replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
