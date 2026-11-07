import { describe, expect, it } from 'vitest';
import { mediaCompatibleExportProfile, mediaCompatibleRenderType } from './mediaExportProfile';

describe('Media export profile', () => {
  it('forces real-time preview and export while Media paint is active', () => {
    expect(mediaCompatibleRenderType(true, 'non-realtime')).toBe('realtime');
    expect(mediaCompatibleExportProfile(true, 'dual')).toBe('realtime');
    expect(mediaCompatibleExportProfile(true, 'non-realtime')).toBe('realtime');
  });

  it('preserves the requested modes when no Media paint is active', () => {
    expect(mediaCompatibleRenderType(false, 'non-realtime')).toBe('non-realtime');
    expect(mediaCompatibleExportProfile(false, 'dual')).toBe('dual');
  });
});
