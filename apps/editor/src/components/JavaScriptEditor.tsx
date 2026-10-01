import { useLayoutEffect, useRef } from 'react';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { undo, redo } from '../state/historyStore';

const externalChange = Annotation.define<boolean>();

export function JavaScriptEditor({
  value,
  onChange,
  label,
  readOnly = false,
  invalid = false,
  describedBy,
  placeholder: hint = '',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  readOnly?: boolean;
  invalid?: boolean;
  describedBy?: string | undefined;
  placeholder?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callback = useRef(onChange);
  const configuration = useRef(new Compartment());
  useLayoutEffect(() => {
    callback.current = onChange;
  });

  useLayoutEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        extensions: [
          javascript(),
          oneDark,
          lineNumbers(),
          highlightActiveLine(),
          bracketMatching(),
          indentOnInput(),
          indentUnit.of('  '),
          configuration.current.of([]),
          keymap.of([
            {
              key: 'Mod-z',
              run: () => {
                undo();
                return true;
              },
            },
            {
              key: 'Mod-Shift-z',
              run: () => {
                redo();
                return true;
              },
            },
            {
              key: 'Mod-y',
              run: () => {
                redo();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(externalChange))
            )
              callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    const view = editor.current!;
    if (view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: externalChange.of(true),
      });
  }, [value]);

  useLayoutEffect(() => {
    editor.current!.dispatch({
      effects: configuration.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        placeholder(hint),
        EditorView.contentAttributes.of({
          'aria-label': label,
          'aria-invalid': String(invalid),
          'aria-readonly': String(readOnly),
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          spellcheck: 'false',
        }),
      ]),
    });
  }, [readOnly, label, invalid, describedBy, hint]);

  return <div ref={host} className="javascript-editor" data-invalid={invalid} />;
}
