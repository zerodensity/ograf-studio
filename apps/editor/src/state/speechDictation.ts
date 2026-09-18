import { create } from 'zustand';

export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>;
}

export interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionConstructor = new () => BrowserRecognition;

export const useDictationState = create<{ activeId: string | null; stopping: boolean }>(() => ({
  activeId: null,
  stopping: false,
}));
let active: {
  id: string;
  recognition: BrowserRecognition;
  dispose: () => void;
  finishTimer?: ReturnType<typeof setTimeout>;
} | null = null;

export function appendDictatedText(current: string, transcript: string, maxLength = 2000): string {
  const words = transcript.trim();
  if (!words) return current;
  const gap = !current || /\s$/.test(current) || /^[,.;:!?]/.test(words) ? '' : ' ';
  return `${current}${gap}${words}`.slice(0, maxLength);
}

export function cancelDictation(id?: string): void {
  if (!active || (id && active.id !== id)) return;
  const session = active;
  session.dispose();
  try {
    session.recognition.abort();
  } catch {
    /* Already stopped. */
  }
}

export function stopDictation(id: string): void {
  if (!active || active.id !== id || useDictationState.getState().stopping) return;
  const session = active;
  useDictationState.setState({ stopping: true });
  session.finishTimer = setTimeout(() => cancelDictation(id), 5000);
  try {
    session.recognition.stop();
  } catch {
    cancelDictation(id);
  }
}

/** Starts only from an explicit mic click; committed results stay attached to that field. */
export function startDictation(
  id: string,
  Recognition: RecognitionConstructor,
  language: string,
  onText: (text: string) => void,
  onError: (error: string) => void,
): void {
  cancelDictation();
  const recognition = new Recognition();
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = false;
  const consumed = new Set<number>();
  const timeout = setTimeout(() => stopDictation(id), 60_000);
  const session = {
    id,
    recognition,
    finishTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    dispose: () => {
      clearTimeout(timeout);
      clearTimeout(session.finishTimer);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (active === session) {
        active = null;
        useDictationState.setState({ activeId: null, stopping: false });
      }
    },
  };
  active = session;
  useDictationState.setState({ activeId: id, stopping: false });
  recognition.onresult = (event) => {
    if (active !== session) return;
    const words: string[] = [];
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      if (result?.isFinal && !consumed.has(index)) {
        consumed.add(index);
        const text = result[0]?.transcript.trim();
        if (text) words.push(text);
      }
    }
    if (words.length) onText(words.join(' '));
  };
  recognition.onerror = (event) => {
    if (active !== session) return;
    const messages: Record<string, string> = {
      'not-allowed': 'Microphone access was denied. Allow it in your browser settings, then retry.',
      'service-not-allowed':
        'Speech recognition is unavailable in this browser. Try Chrome or your system dictation.',
      'audio-capture': 'No microphone is available. Check your input device and retry.',
      network:
        'The browser speech service could not connect. Check your connection or use system dictation.',
      'no-speech': 'No speech was detected. Click the microphone and try again.',
      'language-not-supported': 'Your browser does not support dictation in its selected language.',
    };
    if (event.error !== 'aborted')
      onError(messages[event.error] ?? 'Dictation stopped. Please try again.');
    cancelDictation(id);
  };
  recognition.onend = session.dispose;
  try {
    recognition.start();
  } catch {
    cancelDictation(id);
    onError('Dictation could not start. Check microphone permission or use a supported browser.');
  }
}
