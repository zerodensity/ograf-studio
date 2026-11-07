import { useEffect, useRef } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { useMovableDialog } from './useMovableDialog';
import './KeyboardShortcutsDialog.css';

const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';

export const KEYBOARD_SHORTCUT_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
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
      ['Middle-drag', 'Pan'],
      ['Shift+drag', 'Move along one axis'],
      ['C', 'Crop selected layers, or canvas when nothing is selected'],
      ['Enter · Escape', 'Apply · cancel the active crop'],
      ['Arrow keys · Shift+arrow', 'Move the crop by 1 · 10 pixels'],
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
      ['D', 'Show · hide fullscreen preview controls'],
      ['Space', 'Take in, then next lifecycle step or out'],
      ['→', 'Next step, or next template after the last step'],
      ['←', 'Previous step, or previous template before the first step'],
      ['Escape', 'Leave fullscreen'],
    ],
  },
];

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { document } = useEditorWindow();
  const dialog = useRef<HTMLElement>(null);
  const movable = useMovableDialog(dialog);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose, document]);

  return (
    <section
      ref={dialog}
      {...movable.dialogProps}
      className="shortcuts-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <header className="shortcuts-dialog-header" {...movable.handleProps}>
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
