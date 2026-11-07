import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPreviewControlsInteraction } from './previewControlsInteraction';

// The controller uses structural DOM APIs so detached editor windows do not
// depend on instanceof checks against the main window's Element constructor.
class TestDocument extends EventTarget {
  fullscreenElement: TestElement | null = null;
  activeElement: TestElement | null = null;
}
class TestElement extends EventTarget {
  readonly nodeType = 1;
  readonly children: TestElement[] = [];
  readonly attributes = new Map<string, string>();
  parentElement: TestElement | null = null;
  hidden = false;
  disabled = false;
  readOnly = false;
  type = 'text';
  bounds = { left: 10, top: 10, right: 210, bottom: 210, width: 200, height: 200 };
  readonly ownerDocument: TestDocument;
  readonly tagName: string;
  constructor(ownerDocument: TestDocument, tagName = 'div', classes = '') {
    super();
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.attributes.set('class', classes);
  }
  append(...children: TestElement[]) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }
  contains(target: TestElement | null): boolean {
    return !!target && (this === target || this.children.some((child) => child.contains(target)));
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const item = part.trim();
      if (item === ':disabled') return this.disabled || !!this.parentElement?.matches(':disabled');
      if (item.startsWith('.'))
        return (this.getAttribute('class') ?? '').split(' ').includes(item.slice(1));
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(item);
      if (attribute) {
        if (attribute[1] === 'hidden') return this.hidden;
        return attribute[2] === undefined
          ? this.hasAttribute(attribute[1]!)
          : this.getAttribute(attribute[1]!) === attribute[2];
      }
      return this.tagName.toLowerCase() === item;
    });
  }
  closest(selector: string): TestElement | null {
    return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
  getBoundingClientRect() {
    return this.bounds;
  }
}

function emit(
  receiver: EventTarget,
  type: string,
  target: EventTarget = receiver,
  values: Record<string, unknown> = {},
) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries({
    target,
    relatedTarget: null,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    buttons: 0,
    ...values,
  }))
    Object.defineProperty(event, key, { value });
  receiver.dispatchEvent(event);
  return event;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(active = true, fullscreen = true) {
  const doc = new TestDocument();
  const make = (tag = 'div', classes = '') => new TestElement(doc, tag, classes);
  const viewport = make();
  const stage = make();
  const controls = make('aside');
  const header = make('button');
  const transport = make().append(make('button'));
  const form = make();
  const fieldset = make('fieldset');
  const firstFrame = make('div', 'property-row-frame');
  const secondFrame = make('div', 'property-row-frame');
  const firstRow = make('div', 'preview-data-row');
  const secondRow = make('div', 'preview-data-row');
  const firstLabel = make('span');
  const color = make('span', 'color-input');
  const picker = make('input');
  picker.type = 'color';
  const hex = make('input');
  const alpha = make('input');
  alpha.type = 'number';
  color.append(picker, hex, alpha);
  firstRow.append(firstLabel, color);
  const value = make('input');
  value.type = 'number';
  secondRow.append(make('span'), value);
  firstFrame.append(firstRow);
  secondFrame.append(secondRow);
  fieldset.append(firstFrame, secondFrame);
  form.append(fieldset);
  controls.append(header, transport, form);
  viewport.append(stage, controls);
  if (fullscreen) doc.fullscreenElement = viewport;
  const cleanup = installPreviewControlsInteraction(
    viewport as unknown as HTMLElement,
    controls as unknown as HTMLElement,
    active,
  );
  cleanups.push(cleanup);
  return {
    doc,
    make,
    viewport,
    stage,
    controls,
    header,
    transport,
    form,
    fieldset,
    firstFrame,
    secondFrame,
    firstRow,
    secondRow,
    firstLabel,
    color,
    picker,
    hex,
    alpha,
    value,
    cleanup,
  };
}

describe('fullscreen preview browser-menu scope', () => {
  it('suppresses only browser default in fullscreen even when controls are hidden/inactive', () => {
    const { viewport, doc, stage } = fixture(false);
    const listener = vi.fn();
    viewport.addEventListener('contextmenu', listener);
    const fullscreenEvent = emit(viewport, 'contextmenu', stage);
    expect(fullscreenEvent.defaultPrevented).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    doc.fullscreenElement = null;
    expect(emit(viewport, 'contextmenu', stage).defaultPrevented).toBe(false);
  });

  it('does not block a different element being fullscreen or embedded controls', () => {
    const { viewport, doc, stage, controls, value } = fixture(true, false);
    expect(emit(viewport, 'contextmenu', stage).defaultPrevented).toBe(false);
    emit(controls, 'focusin', value);
    expect(controls.hasAttribute('data-preview-adjusting')).toBe(false);
    doc.fullscreenElement = stage;
    expect(emit(viewport, 'contextmenu', stage).defaultPrevented).toBe(false);
  });

  it('opens hidden controls after their viewport is adopted into the destination document', () => {
    const f = fixture(false, false);
    f.cleanup();
    const detached = new TestDocument();
    const open = vi.fn();
    f.controls.hidden = true;
    const cleanup = installPreviewControlsInteraction(
      f.viewport as unknown as HTMLElement,
      f.controls as unknown as HTMLElement,
      false,
      open,
      detached as unknown as Document,
    );
    cleanups.push(cleanup);

    // React child layout effects install before the parent moves the stable
    // pane host. At installation the viewport still belongs to its old window.
    Object.assign(f.viewport, { ownerDocument: detached });
    f.doc.fullscreenElement = f.viewport;
    expect(emit(f.viewport, 'contextmenu', f.stage).defaultPrevented).toBe(false);
    detached.fullscreenElement = f.viewport;
    const click = emit(f.viewport, 'contextmenu', f.stage, { clientX: 1640, clientY: 720 });
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(click);

    detached.fullscreenElement = null;
    expect(emit(f.viewport, 'contextmenu', f.stage).defaultPrevented).toBe(false);
    cleanup();
    detached.fullscreenElement = f.viewport;
    expect(emit(f.viewport, 'contextmenu', f.stage).defaultPrevented).toBe(false);
  });

  it('uses destination document events for editing and cleans them up before docking back', () => {
    const f = fixture(true, false);
    f.cleanup();
    const detached = new TestDocument();
    const detachedOpen = vi.fn();
    const cleanupDetached = installPreviewControlsInteraction(
      f.viewport as unknown as HTMLElement,
      f.controls as unknown as HTMLElement,
      true,
      detachedOpen,
      detached as unknown as Document,
    );
    cleanups.push(cleanupDetached);
    Object.assign(f.viewport, { ownerDocument: detached });
    detached.fullscreenElement = f.viewport;
    emit(detached, 'fullscreenchange');
    expect(f.controls.hasAttribute('data-preview-opacity-controls')).toBe(true);

    emit(f.controls, 'focusin', f.hex);
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(true);
    emit(f.doc, 'pointerdown', f.stage);
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(true);
    emit(detached, 'pointerdown', f.stage);
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(false);

    emit(f.controls, 'focusin', f.value);
    detached.fullscreenElement = null;
    emit(detached, 'fullscreenchange');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    expect(f.controls.hasAttribute('data-preview-opacity-controls')).toBe(false);

    cleanupDetached();
    Object.assign(f.viewport, { ownerDocument: f.doc });
    const dockedOpen = vi.fn();
    const cleanupDocked = installPreviewControlsInteraction(
      f.viewport as unknown as HTMLElement,
      f.controls as unknown as HTMLElement,
      true,
      dockedOpen,
      f.doc as unknown as Document,
    );
    cleanups.push(cleanupDocked);
    detached.fullscreenElement = f.viewport;
    expect(emit(f.viewport, 'contextmenu', f.stage).defaultPrevented).toBe(false);
    f.doc.fullscreenElement = f.viewport;
    emit(f.doc, 'fullscreenchange');
    expect(emit(f.viewport, 'contextmenu', f.stage).defaultPrevented).toBe(true);
    expect(dockedOpen).toHaveBeenCalledOnce();
    expect(detachedOpen).not.toHaveBeenCalled();
    emit(f.controls, 'focusin', f.value);
    emit(detached, 'pointerdown', f.stage);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.doc, 'pointerdown', f.stage);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    cleanupDocked();
    expect(f.controls.hasAttribute('data-preview-opacity-controls')).toBe(false);
  });
});

describe('fullscreen control editing emphasis', () => {
  it('keeps the complete color row readable and dims sibling branches exactly once', () => {
    const f = fixture();
    emit(f.controls, 'pointerdown', f.picker);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(true);
    expect(f.color.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.hex.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.alpha.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.firstLabel.hasAttribute('data-preview-dimmed')).toBe(false);
    for (const path of [f.firstFrame, f.fieldset, f.form])
      expect(path.hasAttribute('data-preview-active-path')).toBe(true);
    for (const branch of [f.header, f.transport, f.secondFrame])
      expect(branch.hasAttribute('data-preview-dimmed')).toBe(true);
    expect(f.secondRow.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.value.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.firstFrame.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.controls.hasAttribute('data-preview-active-path')).toBe(false);
  });

  it('moves emphasis with keyboard focus and clears old branch markers', () => {
    const f = fixture();
    emit(f.controls, 'focusin', f.hex);
    emit(f.controls, 'focusout', f.hex, { relatedTarget: f.value });
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(false);
    expect(f.firstFrame.hasAttribute('data-preview-dimmed')).toBe(true);
    expect(f.secondFrame.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.secondRow.hasAttribute('data-preview-active-control')).toBe(true);
    emit(f.controls, 'focusout', f.value, { relatedTarget: f.header });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('keeps a focused field isolated across pointer leave until focus leaves the row', () => {
    const f = fixture();
    emit(f.controls, 'focusin', f.value);
    emit(f.controls, 'pointerleave');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.controls, 'pointerenter', f.value);
    emit(f.controls, 'pointerleave');
    expect(f.secondRow.hasAttribute('data-preview-active-control')).toBe(true);
    expect(f.firstFrame.hasAttribute('data-preview-dimmed')).toBe(true);
    emit(f.controls, 'input', f.value);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.controls, 'keydown', f.value, { key: 'ArrowUp' });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.controls, 'pointerleave');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.controls, 'focusout', f.value, { relatedTarget: f.header });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('restores when moving to another row or the header without clicking and rejects late input', () => {
    const f = fixture();
    emit(f.controls, 'pointerdown', f.value);
    emit(f.doc, 'pointermove', f.header);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    emit(f.controls, 'input', f.value);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    emit(f.controls, 'keydown', f.value, { key: 'ArrowUp' });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.doc, 'pointermove', f.hex);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('keeps one complete field/composite active while moving between its nested controls', () => {
    const f = fixture();
    emit(f.controls, 'pointerdown', f.hex);
    for (const target of [f.picker, f.hex, f.alpha, f.firstLabel]) {
      emit(f.doc, 'pointermove', target);
      expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(true);
    }
    emit(f.doc, 'pointermove', f.secondRow);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('does not dim for header drags, lifecycle buttons, disabled or readonly controls', () => {
    const f = fixture();
    emit(f.controls, 'pointerdown', f.value);
    emit(f.controls, 'pointerdown', f.header);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    f.value.disabled = true;
    emit(f.controls, 'pointerdown', f.value);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    f.value.disabled = false;
    f.value.readOnly = true;
    emit(f.controls, 'focusin', f.value);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it.each(['textarea', 'contenteditable', 'role-slider', 'role-spinbutton'])(
    'supports keyboard value editing in %s',
    (kind) => {
      const f = fixture();
      const value = f.make(kind === 'textarea' ? 'textarea' : 'div');
      if (kind === 'contenteditable') value.setAttribute('contenteditable', 'true');
      if (kind.startsWith('role-')) value.setAttribute('role', kind.slice(5));
      f.secondRow.append(value);
      emit(f.controls, 'focusin', value);
      expect(f.secondRow.hasAttribute('data-preview-active-control')).toBe(true);
      emit(f.controls, 'keydown', value, { key: 'Escape' });
      expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    },
  );

  it('preserves native color popup emphasis through null focus and popup pointer boundaries until commit', () => {
    const f = fixture();
    emit(f.controls, 'pointerdown', f.picker);
    emit(f.controls, 'focusout', f.picker);
    emit(f.doc, 'blur');
    emit(f.controls, 'pointerleave');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.controls, 'input', f.picker);
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(true);
    emit(f.controls, 'change', f.picker);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('restores after returning from native popup UI and leaving the pane or moving outside', () => {
    const f = fixture();
    emit(f.controls, 'pointerdown', f.picker);
    emit(f.controls, 'pointerleave');
    emit(f.controls, 'pointerenter');
    emit(f.controls, 'pointerleave');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    emit(f.controls, 'pointerdown', f.picker);
    emit(f.doc, 'pointermove', f.stage);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('keeps a focused color editor isolated when returning from its native popup until commit', () => {
    const f = fixture();
    emit(f.controls, 'focusin', f.picker);
    emit(f.controls, 'pointerdown', f.picker);
    emit(f.controls, 'pointerleave');
    emit(f.controls, 'pointerenter', f.picker);
    emit(f.controls, 'pointerleave');
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(true);
    expect(f.secondFrame.hasAttribute('data-preview-dimmed')).toBe(true);
    emit(f.controls, 'input', f.picker);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.controls, 'change', f.picker);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);

    emit(f.controls, 'focusin', f.picker);
    emit(f.controls, 'pointerdown', f.picker);
    emit(f.controls, 'pointerleave');
    emit(f.controls, 'pointerenter', f.picker);
    emit(f.controls, 'focusout', f.picker, { relatedTarget: f.header });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('keeps the full panel visible while opening a native select by keyboard', () => {
    const f = fixture();
    const select = f.make('select');
    f.secondRow.append(select);
    const blur = vi.fn();
    Object.assign(select, { blur });
    f.doc.activeElement = select;
    emit(f.controls, 'focusin', select);
    expect(emit(f.controls, 'keydown', select, { key: ' ' }).defaultPrevented).toBe(false);
    emit(f.controls, 'focusout', select);
    emit(f.controls, 'pointerleave');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    emit(f.controls, 'change', select);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    emit(f.controls, 'keydown', select, { key: 'Escape' });
    expect(blur).not.toHaveBeenCalled();
    expect(f.doc.activeElement).toBe(select);
  });

  it.each([
    'select',
    'multiple-select',
    'native-option',
    'combobox-input',
    'combobox-button',
    'listbox-option',
    'listbox-input',
  ])('never isolates %s, including when it shares a row with a focused value editor', (kind) => {
    const f = fixture();
    let control: TestElement;
    let target: TestElement;
    if (kind === 'select' || kind === 'multiple-select' || kind === 'native-option') {
      control = f.make('select');
      if (kind === 'multiple-select') control.setAttribute('multiple', '');
      target = kind === 'native-option' ? f.make('option') : control;
      if (target !== control) control.append(target);
    } else if (kind === 'listbox-input') {
      control = target = f.make('input');
      control.setAttribute('aria-haspopup', 'listbox');
    } else {
      control = f.make();
      control.setAttribute('role', kind === 'listbox-option' ? 'listbox' : 'combobox');
      target = f.make(
        kind === 'combobox-input' ? 'input' : kind === 'combobox-button' ? 'button' : 'div',
      );
      if (kind === 'listbox-option') target.setAttribute('role', 'option');
      control.append(target);
    }
    f.firstRow.append(control);
    emit(f.controls, 'focusin', f.hex);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    expect(emit(f.controls, 'pointerdown', target).defaultPrevented).toBe(false);
    emit(f.controls, 'pointerover', target);
    expect(f.firstRow.hasAttribute('data-preview-hovered-control')).toBe(true);
    for (const type of ['focusin', 'input', 'change']) emit(f.controls, type, target);
    for (const key of ['ArrowDown', 'Enter', ' ', 'F4', 'Escape'])
      expect(emit(f.controls, 'keydown', target, { key }).defaultPrevented).toBe(false);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    expect(f.header.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.secondFrame.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.firstRow.hasAttribute('data-preview-active-control')).toBe(false);
  });

  it('clears a text edit when focus moves into an editable combobox in the same row', () => {
    const f = fixture();
    const combo = f.make();
    combo.setAttribute('role', 'combobox');
    const input = f.make('input');
    combo.append(input);
    f.firstRow.append(combo);
    emit(f.controls, 'focusin', f.hex);
    emit(f.controls, 'focusout', f.hex, { relatedTarget: input });
    emit(f.controls, 'focusin', input);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    expect(f.secondFrame.hasAttribute('data-preview-dimmed')).toBe(false);
    emit(f.controls, 'keydown', input, { key: 'a' });
    emit(f.controls, 'input', input);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('keeps a captured range drag readable and restores when released outside the pane', () => {
    const f = fixture();
    f.value.type = 'range';
    emit(f.controls, 'pointerdown', f.value, { pointerId: 7 });
    emit(f.controls, 'pointerleave');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.doc, 'pointerup', f.value, { pointerId: 8, clientX: 300, clientY: 300 });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.doc, 'pointerup', f.value, { pointerId: 7, clientX: 300, clientY: 300 });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    emit(f.controls, 'pointerdown', f.value, { pointerId: 9 });
    emit(f.doc, 'pointercancel', f.value, { pointerId: 9 });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('restores after a range drag releases outside its field even if still inside the pane', () => {
    const f = fixture();
    f.value.type = 'range';
    f.secondRow.bounds = { left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40 };
    emit(f.controls, 'pointerdown', f.value, { pointerId: 4 });
    emit(f.doc, 'pointermove', f.header, { buttons: 1, pointerId: 4 });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(true);
    emit(f.doc, 'pointerup', f.value, { pointerId: 4, clientX: 150, clientY: 80 });
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
  });

  it('clears all markers and listeners on fullscreen exit, hide/reinstall and cleanup', () => {
    const f = fixture();
    emit(f.controls, 'pointerdown', f.picker);
    f.doc.fullscreenElement = null;
    emit(f.doc, 'fullscreenchange');
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    f.doc.fullscreenElement = f.viewport;
    f.controls.hidden = true;
    emit(f.controls, 'focusin', f.value);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    f.controls.hidden = false;
    emit(f.controls, 'focusin', f.value);
    f.cleanup();
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    expect(f.secondRow.hasAttribute('data-preview-active-control')).toBe(false);
    expect(f.firstFrame.hasAttribute('data-preview-dimmed')).toBe(false);
    expect(f.form.hasAttribute('data-preview-active-path')).toBe(false);
    emit(f.controls, 'focusin', f.hex);
    expect(f.controls.hasAttribute('data-preview-adjusting')).toBe(false);
    expect(emit(f.viewport, 'contextmenu', f.stage).defaultPrevented).toBe(false);
  });
});
