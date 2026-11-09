import { describe, expect, it } from 'vitest';
import { normalizeDataConnection } from '@ograf-editor/scene-model';
import { defaultTemplateExportProfile, hasEnabledExternalFeed } from './templateExportProfile';

describe('current template export profile', () => {
  const dual = { supportsRealTime: true, supportsNonRealTime: true };

  it('suggests real-time playout for a dual-capable template using the enabled market feed', () => {
    const composition = {
      dataConnections: [normalizeDataConnection({ source: 'public-markets', enabled: true })],
    };
    expect(defaultTemplateExportProfile(dual, hasEnabledExternalFeed(composition))).toBe(
      'realtime',
    );
  });

  it('does not change a dual profile for an embedded or disabled source', () => {
    const composition = {
      dataConnections: [
        normalizeDataConnection({ source: 'embedded', embeddedText: '{}' }),
        normalizeDataConnection({ source: 'url', url: 'https://example.test', enabled: false }),
      ],
    };
    expect(defaultTemplateExportProfile(dual, hasEnabledExternalFeed(composition))).toBe('dual');
  });

  it('starts from a single authored render mode when one is specified', () => {
    expect(defaultTemplateExportProfile({ ...dual, supportsRealTime: false }, true)).toBe(
      'non-realtime',
    );
    expect(defaultTemplateExportProfile({ ...dual, supportsNonRealTime: false }, false)).toBe(
      'realtime',
    );
  });
});
