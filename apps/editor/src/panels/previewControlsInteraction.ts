import { isPreviewPresented } from '../state/previewPresentation';

const VALUE_EDITOR =
  'input,select,textarea,[contenteditable="true"],[role="slider"],[role="spinbutton"],[role="combobox"],[role="listbox"],[aria-haspopup="listbox"]';
const LISTBOX_CONTROL =
  'select,[role="combobox"],[role="listbox"],[role="option"],[aria-haspopup="listbox"]';
const FIELD_ROW = '[data-preview-control-row],.preview-data-row,.playout-data-field';
const FIXED_ROW = '[data-preview-fixed-visibility]';
const COMPOSITE =
  '.property-row,.color-input,.preview-transition-slot-actions,.playout-state-choice,label';
const ACTION_ROW =
  '.preview-fullscreen-data-heading,.preview-controls-row,.preview-transition-heading,.preview-transition-slot-heading,.playout-slot-actions,.playout-slot-status,.playout-session-actions,.template-preview-transport';
const UNIT = 'data-preview-opacity-unit';
const PATH = 'data-preview-opacity-path';
const finishedPreviewEdits = new WeakSet<Event>();

/** The first outside click completes an isolated edit before popup dismissal. */
export function didFinishPreviewEdit(event: Event): boolean {
  return finishedPreviewEdits.has(event);
}

function element(value: EventTarget | null): Element | null {
  const candidate = value as (Element & { parentElement?: Element | null }) | null;
  if (candidate?.nodeType === 1 && typeof candidate.closest === 'function') return candidate;
  return candidate?.parentElement ?? null;
}

function descendants(parent: Element): Element[] {
  const result: Element[] = [];
  for (const child of parent.children) result.push(child, ...descendants(child));
  return result;
}

/** UI-only listeners; never affect the graphic's own pointer/rule event propagation. */
export function installPreviewControlsInteraction(
  viewport: HTMLElement,
  controls: HTMLElement | null,
  active: boolean,
  onContextMenu?: (event: MouseEvent) => void,
  ownerDocument: Document = viewport.ownerDocument,
): () => void {
  const marked = new Map<Element, Set<string>>();
  const opacityMarked = new Map<Element, Set<string>>();
  let disposed = false;
  let activeRow: Element | null = null;
  let focusedEditor: Element | null = null;
  let hoveredRow: Element | null = null;
  let pointerInside = false;
  let popup: Element | null = null;
  let dragPointer: number | null = null;
  let suspendedAfterLeave = false;

  // A detached pane is adopted by its parent layout effect after child effects
  // install. Subscribe in the destination document, but resolve ownership live.
  const fullscreen = () => isPreviewPresented(viewport);
  const available = () =>
    !disposed &&
    active &&
    controls !== null &&
    fullscreen() &&
    viewport.contains(controls) &&
    !controls.closest('[hidden]');
  const removeMarkers = (collection: Map<Element, Set<string>>) => {
    for (const [target, names] of collection)
      for (const name of names) target.removeAttribute(name);
    collection.clear();
  };
  const mark = (collection: Map<Element, Set<string>>, target: Element, name: string) => {
    target.setAttribute(name, '');
    const names = collection.get(target) ?? new Set<string>();
    names.add(name);
    collection.set(target, names);
  };
  const clearMarkers = () => {
    removeMarkers(marked);
    activeRow = null;
  };
  const clear = () => {
    clearMarkers();
    popup = null;
    dragPointer = null;
    suspendedAfterLeave = true;
  };
  const setHovered = (row: Element | null) => {
    if (row === hoveredRow) return;
    hoveredRow?.removeAttribute('data-preview-hovered-control');
    hoveredRow = row;
    hoveredRow?.setAttribute('data-preview-hovered-control', '');
  };
  const unitFor = (target: EventTarget | null): Element | null => {
    const row = element(target)?.closest(`[${UNIT}]`) ?? null;
    return row && controls?.contains(row) ? row : null;
  };
  const listbox = (target: EventTarget | null): Element | null => {
    const candidate = element(target)?.closest(LISTBOX_CONTROL);
    return candidate && controls?.contains(candidate) ? candidate : null;
  };
  const editor = (target: EventTarget | null): Element | null => {
    // Dropdowns keep the complete panel visible, including editable combobox inputs and options.
    if (listbox(target)) return null;
    const candidate = element(target)?.closest(VALUE_EDITOR);
    if (!candidate || !controls?.contains(candidate)) return null;
    const input = candidate as HTMLInputElement;
    if (
      candidate.matches(':disabled') ||
      candidate.getAttribute('aria-disabled') === 'true' ||
      candidate.getAttribute('aria-readonly') === 'true' ||
      input.readOnly ||
      (candidate.tagName.toLowerCase() === 'input' &&
        ['button', 'submit', 'reset', 'hidden', 'image'].includes(input.type))
    )
      return null;
    return candidate;
  };
  const clearListboxInteraction = (target: EventTarget | null): boolean => {
    if (!listbox(target)) return false;
    focusedEditor = null;
    clear();
    return true;
  };
  const hasFocusedEditor = () =>
    !!activeRow &&
    (activeRow.contains(focusedEditor) || activeRow.contains(editor(ownerDocument.activeElement)));
  const finishEditing = (blur = false) => {
    const value = focusedEditor ?? editor(ownerDocument.activeElement);
    clear();
    if (blur) {
      focusedEditor = null;
      (value as HTMLElement | null)?.blur?.();
    }
  };

  // Partition the pane into disjoint row/branch roots. Ancestors never receive
  // opacity, so each field or fixed header retains its own visibility.
  const refreshRows = () => {
    removeMarkers(opacityMarked);
    if (!available() || !controls) {
      setHovered(null);
      clear();
      return;
    }
    const children = descendants(controls);
    const fixed = children.filter((node) => node.matches(FIXED_ROW));
    const preferred = children.filter(
      (node) => node.matches(FIELD_ROW) && !node.closest(FIXED_ROW),
    );
    const rows = [
      ...fixed,
      ...preferred.filter(
        (node) => !preferred.some((other) => other !== node && node.contains(other)),
      ),
    ];
    const addRow = (candidate: Element) => {
      if (candidate === controls || !controls.contains(candidate)) return;
      if (rows.some((row) => row.contains(candidate) || candidate.contains(row))) return;
      rows.push(candidate);
    };
    for (const value of children.filter((node) => node.matches(VALUE_EDITOR))) {
      if (rows.some((row) => row.contains(value))) continue;
      const composite = value.closest(COMPOSITE);
      addRow(composite && !rows.some((row) => composite.contains(row)) ? composite : value);
    }
    for (const row of children.filter((node) => node.matches(ACTION_ROW))) addRow(row);
    const partition = (node: Element) => {
      if (rows.includes(node) || !rows.some((row) => node.contains(row))) {
        mark(opacityMarked, node, UNIT);
        return;
      }
      mark(opacityMarked, node, PATH);
      for (const child of node.children) partition(child);
    };
    mark(opacityMarked, controls, 'data-preview-opacity-controls');
    for (const child of controls.children) partition(child);
    if (activeRow && (!controls.contains(activeRow) || !activeRow.hasAttribute(UNIT))) clear();
    if (hoveredRow && (!controls.contains(hoveredRow) || !hoveredRow.hasAttribute(UNIT)))
      setHovered(null);
  };
  const activate = (value: Element) => {
    if (!available() || !controls) return;
    const row = unitFor(value) ?? value.closest(FIELD_ROW) ?? value.closest(COMPOSITE) ?? value;
    if (row === controls || !controls.contains(row)) return;
    clearMarkers();
    activeRow = row;
    mark(marked, controls, 'data-preview-adjusting');
    mark(marked, row, 'data-preview-active-control');
    let branch = row;
    while (branch !== controls) {
      const parent: Element | null = branch.parentElement;
      if (!parent) break;
      for (const sibling of parent.children)
        if (sibling !== branch) mark(marked, sibling, 'data-preview-dimmed');
      if (parent !== controls) mark(marked, parent, 'data-preview-active-path');
      branch = parent;
    }
  };
  const isPopup = (value: Element) =>
    value.tagName.toLowerCase() === 'input' && (value as HTMLInputElement).type === 'color';
  const isRange = (value: Element) =>
    value.getAttribute('role') === 'slider' ||
    (value.tagName.toLowerCase() === 'input' && (value as HTMLInputElement).type === 'range');
  const insideBounds = (event: PointerEvent) => {
    if (!activeRow || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY))
      return pointerInside;
    const bounds = activeRow.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return pointerInside;
    return (
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom
    );
  };

  const contextMenu = (event: Event) => {
    if (disposed || !fullscreen()) return;
    event.preventDefault();
    clear();
    setHovered(null);
    onContextMenu?.(event as MouseEvent);
  };
  const fullscreenChanged = () => {
    if (!fullscreen()) {
      clear();
      setHovered(null);
      removeMarkers(opacityMarked);
    } else if (active) refreshRows();
  };
  const pointerOver = (event: PointerEvent) => {
    if (available()) setHovered(unitFor(event.target));
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    pointerInside = true;
    suspendedAfterLeave = false;
    setHovered(unitFor(event.target));
    if (clearListboxInteraction(event.target)) return;
    const value = editor(event.target);
    if (!value) {
      const target = element(event.target);
      if (target && activeRow?.contains(target) && hasFocusedEditor()) return;
      clear();
      return;
    }
    popup = isPopup(value) ? value : null;
    dragPointer = isRange(value) ? event.pointerId : null;
    activate(value);
  };
  const pointerEnter = (event: PointerEvent) => {
    pointerInside = true;
    // Returning from native UI ends an unfocused popup interaction. A focused
    // editor or captured slider still owns its row until commit or release.
    if (suspendedAfterLeave || (!hasFocusedEditor() && dragPointer === null)) popup = null;
    setHovered(unitFor(event.target));
  };
  const pointerLeave = () => {
    pointerInside = false;
    setHovered(null);
    // Pointer movement does not commit a field that still owns keyboard focus.
    if (!popup && dragPointer === null && !hasFocusedEditor()) clear();
  };
  const pointerReturned = (event: PointerEvent) => {
    if (!available()) return;
    const target = element(event.target);
    if (!target) return;
    if (dragPointer !== null || (popup && event.buttons)) return;
    setHovered(unitFor(target));
    if (!activeRow) return;
    if (activeRow.contains(target)) {
      if (popup) popup = null;
    } else if (popup || !hasFocusedEditor()) clear();
  };
  const pointerReleased = (event: PointerEvent) => {
    if (dragPointer !== event.pointerId) return;
    const inside = event.type !== 'pointercancel' && insideBounds(event);
    if (inside) setHovered(activeRow);
    else setHovered(null);
    clear();
  };
  const lostCapture = (event: PointerEvent) => {
    if (dragPointer !== event.pointerId) return;
    dragPointer = null;
    if (!pointerInside) setHovered(null);
    clear();
  };
  const focusIn = (event: FocusEvent) => {
    const value = editor(event.target);
    focusedEditor = value;
    if (value) {
      suspendedAfterLeave = false;
      activate(value);
    } else clear();
  };
  const focusOut = (event: FocusEvent) => {
    const next = editor(event.relatedTarget);
    focusedEditor = next;
    if (next) activate(next);
    else if (event.relatedTarget !== null || !popup) clear();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (clearListboxInteraction(event.target)) return;
    // Reveal the normal tab order before the browser chooses the next control.
    if (event.key === 'Tab') {
      clear();
      return;
    }
    if (event.key === 'Escape') {
      finishEditing(true);
      return;
    }
    const value = editor(event.target);
    if (!value || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    if (
      event.key === 'Enter' &&
      !event.isComposing &&
      !isPopup(value) &&
      value.tagName.toLowerCase() !== 'textarea' &&
      value.getAttribute('contenteditable') !== 'true' &&
      value.getAttribute('aria-multiline') !== 'true'
    ) {
      finishEditing(true);
      return;
    }
    suspendedAfterLeave = false;
    if (isPopup(value) && ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(event.key))
      popup = value;
    activate(value);
  };
  const input = (event: Event) => {
    if (clearListboxInteraction(event.target)) return;
    const value = editor(event.target);
    if (!value || (suspendedAfterLeave && !popup)) return;
    activate(value);
    if (
      event.type === 'change' &&
      (isPopup(value) ||
        (value.tagName.toLowerCase() === 'input' &&
          ['checkbox', 'radio'].includes((value as HTMLInputElement).type)))
    )
      finishEditing(true);
  };
  const outsidePointerDown = (event: Event) => {
    const target = element(event.target);
    if (target && (activeRow ? !activeRow.contains(target) : !controls?.contains(target))) {
      if (activeRow) finishedPreviewEdits.add(event);
      finishEditing(true);
      setHovered(null);
    }
  };

  viewport.addEventListener('contextmenu', contextMenu, true);
  ownerDocument.addEventListener('fullscreenchange', fullscreenChanged);
  let observer: MutationObserver | undefined;
  if (active && controls) {
    refreshRows();
    const Observer = (ownerDocument.defaultView as (Window & typeof globalThis) | null)
      ?.MutationObserver;
    if (Observer) {
      observer = new Observer(refreshRows);
      observer.observe(controls, { childList: true, subtree: true });
    }
    controls.addEventListener('pointerover', pointerOver, true);
    controls.addEventListener('pointerdown', pointerDown, true);
    controls.addEventListener('pointerenter', pointerEnter);
    controls.addEventListener('pointerleave', pointerLeave);
    controls.addEventListener('lostpointercapture', lostCapture, true);
    controls.addEventListener('focusin', focusIn, true);
    controls.addEventListener('focusout', focusOut, true);
    controls.addEventListener('keydown', keyDown, true);
    controls.addEventListener('input', input, true);
    controls.addEventListener('change', input, true);
    ownerDocument.addEventListener('pointerdown', outsidePointerDown, true);
    ownerDocument.addEventListener('pointermove', pointerReturned, true);
    ownerDocument.addEventListener('pointerup', pointerReleased, true);
    ownerDocument.addEventListener('pointercancel', pointerReleased, true);
  }
  return () => {
    disposed = true;
    observer?.disconnect();
    clear();
    focusedEditor = null;
    setHovered(null);
    removeMarkers(opacityMarked);
    viewport.removeEventListener('contextmenu', contextMenu, true);
    ownerDocument.removeEventListener('fullscreenchange', fullscreenChanged);
    controls?.removeEventListener('pointerover', pointerOver, true);
    controls?.removeEventListener('pointerdown', pointerDown, true);
    controls?.removeEventListener('pointerenter', pointerEnter);
    controls?.removeEventListener('pointerleave', pointerLeave);
    controls?.removeEventListener('lostpointercapture', lostCapture, true);
    controls?.removeEventListener('focusin', focusIn, true);
    controls?.removeEventListener('focusout', focusOut, true);
    controls?.removeEventListener('keydown', keyDown, true);
    controls?.removeEventListener('input', input, true);
    controls?.removeEventListener('change', input, true);
    ownerDocument.removeEventListener('pointerdown', outsidePointerDown, true);
    ownerDocument.removeEventListener('pointermove', pointerReturned, true);
    ownerDocument.removeEventListener('pointerup', pointerReleased, true);
    ownerDocument.removeEventListener('pointercancel', pointerReleased, true);
  };
}
