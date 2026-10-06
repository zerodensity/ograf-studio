import { useEffect } from 'react';
import './KeyboardShortcutsDialog.css';

const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';

export const KEYBOARD_SHORTCUT_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'File',
    items: [
      [`${MOD}+O`, 'Open project'],
      [`${MOD}+S`, 'Save project'],
      [`${MOD}+E`, 'Preview & Export'],
    ],
  },
  {
    title: 'Edit',
    items: [
      [`${MOD}+Z`, 'Undo'],
      [`${MOD}+Y · ${MOD}+Shift+Z`, 'Redo'],
      [`${MOD}+X`, 'Cut layers'],
      [`${MOD}+C`, 'Copy layers'],
      [`${MOD}+V`, 'Paste layers'],
      [`${MOD}+Shift+D`, 'Duplicate'],
      ['Delete · Backspace', 'Delete layers, or the selected keyframe'],
      [`${MOD}+G`, 'Group'],
      [`${MOD}+Shift+G`, 'Ungroup'],
      [`${MOD}+A`, 'Select all layers'],
      [`${MOD}+D`, 'Deselect all'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      [`${MOD}+= · ${MOD}+-`, 'Zoom in · out'],
      ['Shift+1', 'Fit the frame'],
      ['Shift+0', 'Zoom to 100%'],
      ['K', 'Key view: show the alpha channel'],
      ['Middle-drag', 'Pan'],
      ['Shift+drag', 'Move along one axis'],
      ['Escape', 'Finish path editing'],
    ],
  },
  {
    title: 'Timeline',
    items: [
      ['Space', 'Play · pause'],
      ['← · →', 'Previous · next frame'],
      [`${MOD}+← · ${MOD}+→`, 'Previous · next keyframe'],
      ['Alt+← · Alt+→', 'Move the focused Step marker'],
    ],
  },
  {
    title: 'Preview',
    items: [
      ['Space · →', 'Take in, then next step'],
      ['←', 'Previous step'],
      ['Escape', 'Leave fullscreen'],
    ],
  },
];

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <section
      className="shortcuts-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <header className="shortcuts-dialog-header">
        <div>
          <strong id="keyboard-shortcuts-title">Keyboard shortcuts</strong>
          <span>Text fields keep their own copy, paste and undo.</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close keyboard shortcuts">
          ×
        </button>
      </header>
      <div className="shortcuts-dialog-groups">
        {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="shortcuts-dialog-group">
            <h3>{group.title}</h3>
            {group.items.map(([keys, action]) => (
              <div key={keys} className="shortcuts-dialog-row">
                <span className="shortcuts-dialog-keys">
                  {keys.split(' · ').map((combo) => (
                    <kbd key={combo}>{combo}</kbd>
                  ))}
                </span>
                <span className="shortcuts-dialog-action">{action}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
