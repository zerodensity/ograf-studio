import { useEffect, useId, useRef } from 'react';
import {
  cancelDictation,
  startDictation,
  stopDictation,
  useDictationState,
  type RecognitionConstructor,
} from '../state/speechDictation';
import './VoiceDictationButton.css';

export function VoiceDictationButton({
  label,
  disabled = false,
  onText,
  onError,
}: {
  label: string;
  disabled?: boolean;
  onText: (text: string) => void;
  onError: (error: string) => void;
}) {
  const id = useId();
  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };
  const active = useDictationState((state) => state.activeId === id);
  const stopping = useDictationState((state) => state.activeId === id && state.stopping);
  useEffect(() => () => cancelDictation(id), [id]);
  useEffect(() => {
    if (disabled) cancelDictation(id);
  }, [disabled, id]);
  return (
    <button
      type="button"
      className={`voice-dictation-button${active ? ' is-listening' : ''}`}
      disabled={disabled || stopping}
      aria-label={active ? `Stop dictation for ${label}` : `Dictate ${label}`}
      aria-pressed={active}
      title={
        active
          ? stopping
            ? 'Finishing dictation…'
            : 'Listening — click to stop'
          : 'Dictate with your browser’s speech service. Microphone permission is required.'
      }
      onClick={(event) => {
        if (active) {
          stopDictation(id);
          return;
        }
        const owner = event.currentTarget.ownerDocument.defaultView as
          | (Window & {
              SpeechRecognition?: RecognitionConstructor;
              webkitSpeechRecognition?: RecognitionConstructor;
            })
          | null;
        const Recognition = owner?.SpeechRecognition ?? owner?.webkitSpeechRecognition;
        if (!Recognition) {
          callbacks.current.onError(
            'Voice dictation is not supported in this browser. Open Studio in Chrome or use your system dictation.',
          );
          return;
        }
        callbacks.current.onError('');
        try {
          startDictation(
            id,
            Recognition,
            owner?.navigator.language || 'en-US',
            (text) => callbacks.current.onText(text),
            (error) => callbacks.current.onError(error),
          );
        } catch {
          callbacks.current.onError('Voice dictation could not start.');
        }
      }}
    >
      {active ? (
        <span aria-hidden="true" className="voice-dictation-stop" />
      ) : (
        <svg
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <rect x="7" y="2" width="6" height="10" rx="3" />
          <path d="M4 9v1a6 6 0 0 0 12 0V9M10 16v3M6 19h8" />
        </svg>
      )}
    </button>
  );
}
