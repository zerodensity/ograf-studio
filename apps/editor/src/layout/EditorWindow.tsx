import { createContext, useContext } from 'react';

export type EditorWindow = Window & typeof globalThis;
export const EditorWindowContext = createContext<EditorWindow | null>(null);
export function useEditorWindow() {
  const owner = useContext(EditorWindowContext) ?? window;
  return { window: owner, document: owner.document };
}

// Adopted nodes can retain the constructor of the window that created them.
export function isDomNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'nodeType' in value;
}
export function isDomElement(value: unknown): value is HTMLElement {
  return isDomNode(value) && value.nodeType === 1;
}
export function isInputElement(value: unknown): value is HTMLInputElement {
  return isDomElement(value) && value.tagName === 'INPUT';
}
export function isSelectElement(value: unknown): value is HTMLSelectElement {
  return isDomElement(value) && value.tagName === 'SELECT';
}
