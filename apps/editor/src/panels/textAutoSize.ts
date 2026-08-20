import type { TextElement } from '@ograf-editor/scene-model';

export function measureAutoSizedText(element: TextElement): { width: number; height: number } {
  const probe = document.createElement('div');
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: 'max-content',
    height: 'max-content',
    visibility: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    lineHeight: '1.2',
    fontFamily: element.fontFamily,
    fontSize: `${Math.max(1, element.fontSize)}px`,
    fontWeight: String(element.fontWeight),
  });
  probe.textContent = element.content || ' ';
  document.body.appendChild(probe);
  const bounds = probe.getBoundingClientRect();
  probe.remove();
  return {
    width: Math.max(1, Math.ceil(bounds.width)),
    height: Math.max(1, Math.ceil(bounds.height)),
  };
}
