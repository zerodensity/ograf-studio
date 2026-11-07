import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ColorInput } from './ColorInput';

describe('compact color control', () => {
  it('shows a labeled picker without a separate text field when closed', () => {
    const markup = renderToStaticMarkup(
      createElement(ColorInput, { label: 'Fill', value: '#12345680', onChange: () => {} }),
    );
    expect(markup).toContain('aria-label="Choose Fill"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('<input');
  });
});
