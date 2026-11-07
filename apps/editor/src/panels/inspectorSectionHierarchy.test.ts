import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inspector = readFileSync(new URL('./InspectorPanel.tsx', import.meta.url), 'utf8');
const animation = readFileSync(new URL('./TextAnimationEditor.tsx', import.meta.url), 'utf8');

describe('Inspector section hierarchy', () => {
  it('renders Animation as a sibling section after the element Text section', () => {
    const elementStart = inspector.indexOf('sectionId="properties.element"');
    const elementEnd = inspector.indexOf('</CollapsibleSection>', elementStart);
    const animationStart = inspector.indexOf('<TextAnimationEditor', elementEnd);

    expect(elementStart).toBeGreaterThanOrEqual(0);
    expect(elementEnd).toBeGreaterThan(elementStart);
    expect(animationStart).toBeGreaterThan(elementEnd);
    expect(inspector.slice(elementStart, elementEnd)).not.toContain('properties.text-animation');
    expect(inspector.slice(elementStart, elementEnd)).not.toContain('<TextAnimationEditor');
    expect(inspector.slice(animationStart, animationStart + 250)).toContain(
      'clock={!!layer.element.clock}',
    );
    expect(animation).toContain(
      "sectionId={clock ? 'properties.clock-text-animation' : 'properties.text-animation'}",
    );
    expect(animation).toContain("'Update text FX' : 'Text animation'");
    expect(animation).toContain('TEXT_ANIMATION_LABELS[animation.type]');
  });
});
