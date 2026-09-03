import { expect, it } from 'vitest';
import { localizeSvgReferences } from './maskedCapture';

it('localizes cloned SVG definitions without rewriting unrelated image references', () => {
  const ids = new Set(['ograf-layer-mask-7', 'gradient-2']);
  expect(localizeSvgReferences('url("http://localhost:4319/#ograf-layer-mask-7")', ids)).toBe(
    'url("#ograf-layer-mask-7")',
  );
  expect(localizeSvgReferences('url(#gradient-2)', ids)).toBe('url("#gradient-2")');
  expect(localizeSvgReferences('url("https://example.test/mask.svg#external")', ids)).toBe(
    'url("https://example.test/mask.svg#external")',
  );
  expect(localizeSvgReferences('url("data:image/svg+xml,%3Csvg%3E")', ids)).toBe(
    'url("data:image/svg+xml,%3Csvg%3E")',
  );
});
