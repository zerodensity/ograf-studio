import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYER_MOTION_STYLES } from '@ograf-editor/scene-model';
import { LAYER_MOTION_FEELS } from './layerMotionFeels';

describe('Animate In / Out guide', () => {
  it('documents each offered style and feel in the detailed section', () => {
    const guide = readFileSync(new URL('../../../../docs/USER_GUIDE.md', import.meta.url), 'utf8');
    const section = guide.split('### Animate In / Out')[1]?.split('\n### ')[0] ?? '';
    expect(section).not.toBe('');
    for (const style of LAYER_MOTION_STYLES)
      expect(section.toLowerCase()).toContain(`**${style.toLowerCase()}**`);
    for (const feel of LAYER_MOTION_FEELS) expect(section).toContain(feel.label);
  });
});
