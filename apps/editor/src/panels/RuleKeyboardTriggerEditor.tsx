import { useEffect, useId, useRef, useState } from 'react';
import type { VisualRuleKeyboardTrigger } from '@ograf-editor/scene-model';
import {
  friendlyRuleKeyboardKey,
  parseRuleKeyboardKey,
  recordedRuleKeyboard,
  ruleKeyboardEditorValue,
  RULE_KEY_OPTIONS,
} from './ruleKeyboardControls';
import './RuleKeyboardTriggerEditor.css';

export function RuleKeyboardTriggerEditor({
  value: rawValue,
  trigger,
  onChange,
}: {
  value?: VisualRuleKeyboardTrigger;
  trigger: 'key-down' | 'key-up';
  onChange(value: VisualRuleKeyboardTrigger): void;
}) {
  const value = ruleKeyboardEditorValue(rawValue);
  const optionsId = useId();
  const [keyDraft, setKeyDraft] = useState(friendlyRuleKeyboardKey(value.key));
  const [recording, setRecording] = useState<'idle' | 'recording' | 'release'>('idle');
  const releaseKey = useRef<string | null>(null);
  useEffect(() => setKeyDraft(friendlyRuleKeyboardKey(value.key)), [value.key]);

  const commitKey = () => {
    const key = parseRuleKeyboardKey(keyDraft);
    if (key && key !== value.key) onChange({ ...value, key });
    setKeyDraft(friendlyRuleKeyboardKey(key || value.key));
  };
  const cancelRecording = () => {
    releaseKey.current = null;
    setRecording('idle');
  };

  return (
    <div className="rules-keyboard-trigger">
      <div className="rules-keyboard-main">
        <label>
          <span>Key</span>
          <input
            aria-label="Rule keyboard key"
            list={optionsId}
            value={keyDraft}
            maxLength={128}
            placeholder="Enter"
            onChange={(event) => setKeyDraft(event.target.value)}
            onBlur={commitKey}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              event.preventDefault();
              event.stopPropagation();
              commitKey();
            }}
          />
          <datalist id={optionsId}>
            {RULE_KEY_OPTIONS.map(([key, label]) => (
              <option key={key} value={label} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          aria-label="Record keyboard shortcut"
          aria-pressed={recording !== 'idle'}
          data-rule-key-recording={recording !== 'idle' ? 'true' : undefined}
          title="Click Record, then press a key or shortcut. Escape cancels; choose Escape in the Key field."
          onClick={(event) => {
            if (recording !== 'idle') cancelRecording();
            else {
              event.currentTarget.focus();
              setRecording('recording');
            }
          }}
          onBlur={cancelRecording}
          onKeyDownCapture={(event) => {
            if (recording === 'idle' || event.nativeEvent.isComposing || event.keyCode === 229)
              return;
            event.preventDefault();
            event.stopPropagation();
            if (recording === 'release') return;
            if (event.key === 'Escape') {
              releaseKey.current = event.key;
              setRecording('release');
              return;
            }
            const next = recordedRuleKeyboard(event.nativeEvent);
            if (!next) return;
            onChange({ ...value, ...next });
            setKeyDraft(friendlyRuleKeyboardKey(next.key));
            releaseKey.current = event.key;
            setRecording('release');
          }}
          onKeyUpCapture={(event) => {
            if (recording === 'idle' || event.nativeEvent.isComposing || event.keyCode === 229)
              return;
            event.preventDefault();
            event.stopPropagation();
            if (recording === 'release' && releaseKey.current === event.key) cancelRecording();
          }}
        >
          {recording === 'recording'
            ? 'Press a key…'
            : recording === 'release'
              ? 'Release key…'
              : 'Record'}
        </button>
      </div>
      <div className="rules-keyboard-modifiers">
        {(['ctrl', 'alt', 'shift', 'meta'] as const).map((modifier) => (
          <label
            key={modifier}
            title={modifier === 'meta' ? 'Command on macOS, Windows key on Windows' : undefined}
          >
            <input
              type="checkbox"
              aria-label={`Rule keyboard ${modifier}`}
              checked={value[modifier] === true}
              onChange={(event) => onChange({ ...value, [modifier]: event.target.checked })}
            />
            {modifier === 'ctrl' ? 'Ctrl' : modifier[0]!.toUpperCase() + modifier.slice(1)}
          </label>
        ))}
        {trigger === 'key-down' ? (
          <label title="Run again when the held key repeats">
            <input
              type="checkbox"
              aria-label="Allow keyboard repeat"
              checked={value.repeat === true}
              onChange={(event) => onChange({ ...value, repeat: event.target.checked })}
            />
            Repeat while held
          </label>
        ) : null}
      </div>
      {recording !== 'idle' ? (
        <small className="rule-editor-note" role="status">
          {recording === 'release'
            ? 'Release the key to finish.'
            : 'Press a shortcut. Escape cancels; click elsewhere to stop.'}
        </small>
      ) : (
        <small className="rule-editor-note">
          Focus the real-time preview to use keys. Escape exits Studio preview.
        </small>
      )}
    </div>
  );
}
