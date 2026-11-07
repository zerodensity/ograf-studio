import { describe, expect, it } from 'vitest';
import { cameraSettingsDialogOpen, isCanvasBackdropInteraction } from './canvasBackdropInteraction';

describe('canvas background popup interaction', () => {
  it('keeps the popup open for its controls and the portaled webcam settings, but closes on ordinary outside clicks', () => {
    const root = { contains: (node: Node | null) => node === internal };
    const internal = { nodeType: 1, closest: () => null } as unknown as Node;
    const camera = {
      nodeType: 1,
      closest: (selector: string) =>
        selector === 'dialog.webcam-camera-settings[open]' ? {} : null,
    } as unknown as Node;
    const outside = { nodeType: 1, closest: () => null } as unknown as Node;
    const nestedText = { nodeType: 3, parentElement: camera } as unknown as Node;
    expect(isCanvasBackdropInteraction(root, internal)).toBe(true);
    expect(isCanvasBackdropInteraction(root, camera)).toBe(true);
    expect(isCanvasBackdropInteraction(root, nestedText)).toBe(true);
    expect(isCanvasBackdropInteraction(root, outside)).toBe(false);
    expect(isCanvasBackdropInteraction(root, null)).toBe(false);
  });

  it('allows Escape to reach an open modal camera settings dialog first', () => {
    const active = { querySelector: () => ({}) } as unknown as Pick<Document, 'querySelector'>;
    const closed = { querySelector: () => null } as unknown as Pick<Document, 'querySelector'>;
    expect(cameraSettingsDialogOpen(active)).toBe(true);
    expect(cameraSettingsDialogOpen(closed)).toBe(false);
  });
});
