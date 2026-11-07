import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import type { ExportArtifacts } from './buildExportArtifacts';
import { buildOfflinePreviewHtml } from './offlinePreview';
import { OFFLINE_PREVIEW_RUNTIME, OFFLINE_PREVIEW_STYLE } from './offlinePreviewAssets';
import { STUDIO_RUNTIME_LICENSE_PATH } from './runtimeLicenses';

describe('self-contained offline OGraf preview', () => {
  it('embeds the exact certified artifacts without letting data break out of the payload', () => {
    const data = {
      manifest: {
        id: 'test',
        name: '</script><script>bad()</script>\u2028',
        main: 'main.js',
        supportsRealTime: true,
        supportsNonRealTime: false,
      },
      mainJs: 'const text = "</script>";',
      resources: [{ path: 'assets/image.png', data: 'AAEC', base64: true, mimeType: 'image/png' }],
    };
    const html = buildOfflinePreviewHtml(data as unknown as ExportArtifacts);
    const match = html.match(
      /<script type="application\/json" id="ograf-package">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual(data);
    expect(match![1]).not.toContain('</script>');
    expect(html).not.toContain('<script src=');
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).toContain('<title>&lt;/script&gt;&lt;script&gt;bad()&lt;/script&gt;');
  });

  it('ships the same runtime and style as their readable source files', () => {
    const controlsRuntime = ts
      .transpileModule(
        readFileSync(
          new URL('../../../apps/editor/src/panels/previewControlsInteraction.ts', import.meta.url),
          'utf8',
        ),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
      )
      .outputText.replace(/^import \{ isPreviewPresented \} from ['"][^'"]+['"];\r?\n/m, '')
      .replace(/^export /gm, '');
    expect(OFFLINE_PREVIEW_RUNTIME).toBe(
      readFileSync(new URL('../../ui-kit/src/previewFps.js', import.meta.url), 'utf8').replace(
        /^export /gm,
        '',
      ) +
        '\n' +
        "function isPreviewPresented(viewport) { return viewport?.hasAttribute('data-preview-overlay') === true; }" +
        '\n' +
        controlsRuntime +
        '\n' +
        readFileSync(new URL('./offlinePreviewScheduler.js', import.meta.url), 'utf8') +
        '\n' +
        readFileSync(new URL('./offlinePreviewLaneData.js', import.meta.url), 'utf8') +
        '\n' +
        readFileSync(new URL('./offlinePreviewRuntime.js', import.meta.url), 'utf8'),
    );
    const interactionStyle = readFileSync(
      new URL('../../../apps/editor/src/panels/PreviewControlsInteraction.css', import.meta.url),
      'utf8',
    );
    expect(
      OFFLINE_PREVIEW_STYLE.endsWith(
        readFileSync(new URL('./offlinePreview.css', import.meta.url), 'utf8') +
          '\n' +
          interactionStyle,
      ),
    ).toBe(true);
    expect(OFFLINE_PREVIEW_STYLE).toContain('SIL OPEN FONT LICENSE Version 1.1');
    const main = readFileSync(
      new URL('../../../apps/editor/src/main.tsx', import.meta.url),
      'utf8',
    );
    for (const match of main.matchAll(/import '@fontsource\/nunito\/([a-z0-9-]+\.css)'/g)) {
      const css = readFileSync(
        new URL(`../../../node_modules/@fontsource/nunito/${match[1]}`, import.meta.url),
        'utf8',
      );
      const font = css.match(/url\(\.\/files\/(nunito-[a-z0-9-]+\.woff2)\)/)![1];
      const bytes = readFileSync(
        new URL(`../../../node_modules/@fontsource/nunito/files/${font}`, import.meta.url),
      );
      expect(OFFLINE_PREVIEW_STYLE).toContain(`data:font/woff2;base64,${bytes.toString('base64')}`);
    }
  });

  it('uses Studio control sections and lane styling while retaining left/right docking and FPS controls', () => {
    const html = buildOfflinePreviewHtml({
      manifest: { id: 'test', name: 'Example' },
      mainJs: '',
      resources: [],
    } as unknown as ExportArtifacts);
    expect(html).toContain('id="controls" class="preview-fullscreen-data"');
    expect(html).toContain('class="ograf-offline-preview preview-stage-wrap" data-preview-overlay');
    expect(html).toContain('class="preview-fullscreen-data-heading"');
    expect(html).toContain('<strong>Preview controls</strong>');
    expect(html).toContain('class="preview-popup-body playout-controls-panel"');
    expect(html).toContain('id="transport" class="preview-controls-row"');
    expect(html).toContain('id="dock-side" aria-label="Dock controls"');
    expect(html).toContain(
      '<option value="right">Right</option><option value="left">Left</option>',
    );
    expect(html).toContain('id="background-settings" class="preview-background-controls"');
    expect(html).toContain(
      'id="fps-enabled" type="checkbox" aria-label="Show FPS overlay" checked',
    );
    expect(html).toContain('<div id="stage"></div>');
    expect(html.indexOf('id="fps-overlay"')).toBeGreaterThan(html.indexOf('</svg>'));
    expect(OFFLINE_PREVIEW_STYLE).toContain("body[data-dock='left'] #output");
    expect(OFFLINE_PREVIEW_STYLE).toContain('grid-template-columns: minmax(0, 1fr) auto auto');
    expect(OFFLINE_PREVIEW_STYLE).toContain('min-height: 26px');
    expect(OFFLINE_PREVIEW_STYLE).toContain('#panel > *');
    expect(OFFLINE_PREVIEW_STYLE).toContain('#controls[data-preview-adjusting]:not([hidden])');
    expect(OFFLINE_PREVIEW_RUNTIME).toContain('const LISTBOX_CONTROL');
    expect(OFFLINE_PREVIEW_RUNTIME).toContain('data-preview-active-control');
  });

  it('references the ZIP license without duplicating it in the embedded player payload', () => {
    const licenseText = 'FULL LICENSE TEXT SENTINEL';
    const media = { path: 'assets/logo.png', data: 'AAEC', base64: true, mimeType: 'image/png' };
    const thirdParty = {
      path: 'licenses/other.txt',
      data: 'Other license',
      base64: false,
      mimeType: 'text/plain',
    };
    const html = buildOfflinePreviewHtml({
      manifest: { id: 'test' },
      mainJs: 'class Graphic {}',
      resources: [
        {
          path: STUDIO_RUNTIME_LICENSE_PATH,
          data: licenseText,
          base64: false,
          mimeType: 'text/plain',
        },
        media,
        thirdParty,
      ],
    } as unknown as ExportArtifacts);
    const match = html.match(
      /<script type="application\/json" id="ograf-package">([\s\S]*?)<\/script>/,
    )!;
    expect(JSON.parse(match[1]!).resources).toEqual([media, thirdParty]);
    expect(html).toContain(`href="./${STUDIO_RUNTIME_LICENSE_PATH}"`);
    expect(html).toContain('OGraf Studio playback components');
    expect(html).toContain('AGPL-3.0-only');
    expect(html).not.toContain(licenseText);
  });

  it('includes optional public state schemas only in the local preview payload', () => {
    const manifest = { id: 'test', schema: { type: 'object' } };
    const stateSchemas = { lane: { a: { properties: { title: { type: 'string' } } } } };
    const html = buildOfflinePreviewHtml({
      manifest,
      mainJs: '',
      resources: [],
      offlinePreviewStateSchemas: stateSchemas,
    } as unknown as ExportArtifacts);
    const match = html.match(
      /<script type="application\/json" id="ograf-package">([\s\S]*?)<\/script>/,
    )!;
    const payload = JSON.parse(match[1]!);
    expect(payload.stateSchemas).toEqual(stateSchemas);
    expect(payload.manifest).toEqual(manifest);
  });
});
