import { dataFromSchemaDefaults, mountOGrafGraphic } from './ograf-player.js';

const layout = document.querySelector('#layout');
const title = document.querySelector('#title');
const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const feedback = document.querySelector('#feedback');
const errorOutput = document.querySelector('#error');
const retryPreview = document.querySelector('#retry-preview');
const controls = document.querySelector('#controls');
const operatorFields = document.querySelector('#operator-fields');
const moveControls = document.querySelector('#move-controls');
const previewStep = document.querySelector('#preview-step');
const fullscreen = document.querySelector('#fullscreen');

if (new URLSearchParams(location.search).get('embedded') === '1')
  document.documentElement.dataset.embedded = '';

let player;
let publicationId;
let announcedPublicationId;
let mounting;
let failedPublicationId;
let retrying;
let data = {};
let canControl = false;
let synchronized = false;
let sending;
let appliedRevision = 0;
let serverRevision = 0;
let eventQueue = Promise.resolve();
let refreshForms = () => {};
let currentStep;
let controlsOpen = false;
let controlsPosition;
let drag;

function activePreview() {
  return Boolean(player) && publicationId === announcedPublicationId;
}

function refreshFeedback() {
  const ready = activePreview() && synchronized;
  title.hidden = status.hidden = ready;
  feedback.hidden = ready && errorOutput.hidden && retryPreview.hidden;
}

function refreshStatus() {
  const active = activePreview();
  const ready = active && synchronized;
  const operator = active && canControl;
  layout.dataset.role = operator ? 'operator' : 'viewer';
  if (!active && controlsOpen) {
    controlsOpen = false;
    endDrag();
  }
  controls.hidden = !active || !controlsOpen;
  if (!controls.hidden && controlsPosition) placeControls(controlsPosition);
  const slots = player?.element?.getPlayoutSnapshot?.()?.slots;
  const laneOnAir =
    slots && Object.values(slots).some((slot) => slot.current || slot.incoming || slot.outgoing);
  const stepCount = player?.manifest.stepCount ?? 0;
  previewStep.textContent =
    currentStep === undefined || (slots && !laneOnAir)
      ? laneOnAir
        ? 'On air'
        : 'Off air'
      : `Step ${currentStep + 1}${stepCount > 0 ? ` of ${stepCount}` : ''}`;
  stage.dataset.switching = String(publicationId !== announcedPublicationId);
  const failed = Boolean(failedPublicationId) && failedPublicationId === announcedPublicationId;
  retryPreview.hidden = !failed || Boolean(retrying);
  if (ready) status.textContent = canControl ? 'Connected as operator' : 'Connected as viewer';
  else if (retrying) status.textContent = 'Retrying preview…';
  else if (failed) status.textContent = 'Preview failed to load.';
  else if (synchronized && announcedPublicationId === null)
    status.textContent = 'Waiting for Studio to open a template.';
  else if (active || announcedPublicationId === null) status.textContent = 'Reconnecting…';
  else if (announcedPublicationId) status.textContent = 'Loading graphic…';
  else status.textContent = 'Connecting…';
  if (ready) layout.dataset.revision = String(appliedRevision);
  else delete layout.dataset.revision;
  refreshFeedback();
  for (const button of operatorFields.querySelectorAll('button')) {
    button.disabled =
      !ready ||
      Boolean(sending) ||
      appliedRevision < serverRevision ||
      button.dataset.unavailable === 'true';
  }
  for (const input of operatorFields.querySelectorAll('input, select, textarea'))
    input.disabled = Boolean(sending);
}

function showError(error) {
  errorOutput.textContent = error instanceof Error ? error.message : String(error ?? '');
  errorOutput.hidden = !errorOutput.textContent;
  refreshFeedback();
}

function fitStage() {
  const resolution = player?.renderCharacteristics?.resolution;
  if (!resolution?.width || !resolution?.height) {
    stage.style.removeProperty('--graphic-width');
    return;
  }
  const width = Math.min(
    window.innerWidth,
    (window.innerHeight * resolution.width) / resolution.height,
  );
  stage.style.setProperty('--graphic-width', `${width}px`);
}

function placeControls({ left, top }) {
  const freeX = Math.max(0, window.innerWidth - controls.offsetWidth);
  const freeY = Math.max(0, window.innerHeight - controls.offsetHeight);
  const marginX = Math.min(14, freeX / 2);
  const marginY = Math.min(14, freeY / 2);
  controlsPosition = {
    left: Math.max(marginX, Math.min(freeX - marginX, left)),
    top: Math.max(marginY, Math.min(freeY - marginY, top)),
  };
  Object.assign(controls.style, {
    left: `${controlsPosition.left}px`,
    top: `${controlsPosition.top}px`,
    right: 'auto',
    bottom: 'auto',
  });
}

function endDrag() {
  if (!drag) return;
  const { pointerId } = drag;
  drag = undefined;
  moveControls.classList.remove('is-dragging');
  if (moveControls.hasPointerCapture(pointerId)) moveControls.releasePointerCapture(pointerId);
}

function showControls(open) {
  controlsOpen = open;
  if (!open) endDrag();
  refreshStatus();
}

function installPopup() {
  layout.addEventListener('contextmenu', (event) => {
    if (!activePreview()) return;
    event.preventDefault();
    if (controls.contains(event.target)) return;
    endDrag();
    controlsPosition = { left: event.clientX, top: event.clientY };
    showControls(true);
  });
  layout.addEventListener(
    'pointerdown',
    (event) => {
      if (controlsOpen && event.button === 0 && !controls.contains(event.target))
        showControls(false);
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && controlsOpen) {
      event.preventDefault();
      showControls(false);
    } else if (
      event.key.toLowerCase() === 'd' &&
      activePreview() &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.target?.closest?.('input, select, textarea, [contenteditable="true"]')
    ) {
      event.preventDefault();
      showControls(!controlsOpen);
    }
  });

  moveControls.addEventListener('pointerdown', (event) => {
    if (controls.hidden || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const { left, top } = controls.getBoundingClientRect();
    drag = { pointerId: event.pointerId, left, top, x: event.clientX, y: event.clientY };
    moveControls.setPointerCapture(event.pointerId);
    moveControls.classList.add('is-dragging');
  });
  moveControls.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    placeControls({
      left: drag.left + event.clientX - drag.x,
      top: drag.top + event.clientY - drag.y,
    });
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    moveControls.addEventListener(type, (event) => {
      if (drag?.pointerId === event.pointerId) endDrag();
    });

  const resized = () => {
    fitStage();
    if (!controls.hidden && controlsPosition) placeControls(controlsPosition);
  };
  window.addEventListener('resize', resized);
  fullscreen.hidden =
    typeof layout.requestFullscreen !== 'function' || typeof document.exitFullscreen !== 'function';
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await layout.requestFullscreen();
    } catch (error) {
      showError(error);
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    resized();
  });
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function labelField(caption, input) {
  const field = element('label');
  field.className = 'preview-data-row';
  field.append(element('span', caption), input);
  return field;
}

function selectField(label, schema, value) {
  const select = element('select');
  for (const option of schema.enum ?? [])
    select.add(new Option(schema.gddOptions?.labels?.[option] ?? option, option));
  if (value !== undefined) select.value = value;
  return { select, field: labelField(label, select) };
}

function button(label, run) {
  const result = element('button', label);
  result.type = 'button';
  result.addEventListener('click', () => {
    try {
      run();
    } catch (error) {
      showError(error);
    }
  });
  return result;
}

function panel(label) {
  const group = element('fieldset');
  group.append(element('legend', label));
  operatorFields.append(group);
  return group;
}

function row() {
  const group = element('div');
  group.className = 'preview-controls-row';
  return group;
}

/** Match the slot/state conditions emitted by Studio's coordinated export. */
function propertiesFor(schema, values) {
  const properties = { ...schema?.properties };
  for (const condition of schema?.allOf ?? []) {
    const when = Object.entries(condition.if?.properties ?? {});
    if (
      when.length &&
      when.every(([key, rule]) => Object.hasOwn(rule, 'const') && values[key] === rule.const)
    )
      Object.assign(properties, propertiesFor(condition.then, values));
  }
  return properties;
}

function publicValue(schema, value) {
  if (Array.isArray(value)) return value.map((item) => publicValue(schema?.items, item));
  if (!value || typeof value !== 'object' || !schema?.properties) return value;
  return Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([key]) => Object.hasOwn(value, key))
      .map(([key, child]) => [key, publicValue(child, value[key])]),
  );
}

function dataFields(container, schema, initial, onLaneChange) {
  const fields = new Map();
  container.replaceChildren();
  for (const [key, property] of Object.entries(schema?.properties ?? {})) {
    if (property.readOnly) continue;
    const choices = property.enum;
    const numeric = property.type === 'number' || property.type === 'integer';
    const boolean = property.type === 'boolean';
    const json = !['string', 'integer', 'number', 'boolean'].includes(property.type);
    const input = element(choices ? 'select' : json ? 'textarea' : 'input');
    input.name = key;
    input.required = !boolean && (schema.required ?? []).includes(key);
    if (choices) {
      input.add(new Option('Choose…', ''));
      choices.forEach((value, index) => {
        input.add(new Option(property.gddOptions?.labels?.[value] ?? String(value), String(index)));
      });
    } else if (boolean) input.type = 'checkbox';
    else if (numeric) {
      input.type = 'number';
      input.step = property.type === 'integer' ? '1' : 'any';
      if (typeof property.minimum === 'number') input.min = property.minimum;
      if (typeof property.maximum === 'number') input.max = property.maximum;
    } else if (json) input.rows = 3;
    else {
      input.type = 'text';
      if (Number.isInteger(property.maxLength)) input.maxLength = property.maxLength;
    }

    let changed = false;
    let current;
    function write(value) {
      current = value;
      if (choices) {
        const index = choices.findIndex(
          (choice) => JSON.stringify(choice) === JSON.stringify(value),
        );
        input.value = index < 0 ? '' : String(index);
      } else if (boolean) input.checked = value === true;
      else input.value = value === undefined ? '' : json ? JSON.stringify(value) : String(value);
    }
    function read() {
      if (!input.checkValidity()) {
        input.reportValidity();
        throw new Error(`Check the value for ${property.title || key}.`);
      }
      if (!changed && current === undefined && !input.required) return undefined;
      if (choices) return input.value === '' ? undefined : choices[Number(input.value)];
      if (boolean) return input.checked;
      if (numeric) return input.value === '' ? undefined : input.valueAsNumber;
      if (!json) return input.value;
      if (!input.value.trim()) return undefined;
      const value = JSON.parse(input.value);
      if (
        property.type === 'object' &&
        (!value || typeof value !== 'object' || Array.isArray(value))
      )
        throw new Error(`${property.title || key} must be a JSON object.`);
      if (property.type === 'array' && !Array.isArray(value))
        throw new Error(`${property.title || key} must be a JSON array.`);
      return property.additionalProperties === true ? value : publicValue(property, value);
    }
    write(
      publicValue(property, Object.hasOwn(initial ?? {}, key) ? initial[key] : property.default),
    );
    input.addEventListener('input', () => {
      changed = true;
    });
    input.addEventListener('change', () => {
      changed = true;
      if (key === 'slotId') onLaneChange?.(read());
    });
    container.append(labelField(property.title || key, input));
    fields.set(key, {
      read,
      changed: () => changed,
      settle: () => {
        if (changed) current = read();
        changed = false;
      },
      refresh: (value) => {
        const next = publicValue(property, value);
        if (!changed && JSON.stringify(next) !== JSON.stringify(current)) write(next);
      },
    });
  }
  return {
    read(changesOnly) {
      return Object.fromEntries(
        [...fields]
          .filter(([, field]) => !changesOnly || field.changed())
          .map(([key, field]) => [key, field.read()])
          .filter(([, value]) => value !== undefined),
      );
    },
    settle() {
      for (const field of fields.values()) field.settle();
    },
    refresh(values) {
      for (const [key, field] of fields) if (Object.hasOwn(values, key)) field.refresh(values[key]);
    },
  };
}

async function requestState(signal) {
  const response = await fetch('./state', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Could not read the shared session (HTTP ${response.status}).`);
  return response.json();
}

function requestId() {
  // LAN HTTP can lack randomUUID(). getRandomValues() is available on insecure origins.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function sendCommand(command, form) {
  if (!player || !synchronized || !canControl || sending || appliedRevision < serverRevision)
    return;
  const request = { publicationId, abort: new AbortController() };
  sending = request;
  showError();
  refreshStatus();
  try {
    const response = await fetch('./command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: request.abort.signal,
      body: JSON.stringify({
        publicationId: request.publicationId,
        requestId: requestId(),
        expectedRevision: serverRevision,
        command,
      }),
    });
    const result = await response.json();
    if (sending !== request) return;
    if (!response.ok) {
      if (response.status === 409) enqueue(() => recoverSnapshot(request.publicationId));
      throw new Error(
        result.message || result.error || `Command rejected (HTTP ${response.status}).`,
      );
    }
    serverRevision = Math.max(serverRevision, result.revision);
    form?.settle();
    refreshForms();
  } catch (error) {
    if (sending === request) showError(error);
  } finally {
    if (sending === request) {
      sending = undefined;
      refreshStatus();
    }
  }
}

function mountLaneControls(lanes, actions) {
  const group = panel('Transition lanes');
  const slots = Object.keys(lanes);
  const lane = selectField(
    'Lane',
    {
      enum: slots,
      gddOptions: { labels: Object.fromEntries(slots.map((id) => [id, lanes[id].title || id])) },
    },
    slots[0],
  );
  const stateHost = element('div');
  const fieldsHost = element('div');
  fieldsHost.className = 'preview-data-form';
  const laneStatus = element('p');
  laneStatus.id = 'lane-status';
  const buttons = row();
  let state;
  let form;
  const current = () => player.element.getPlayoutSnapshot?.()?.slots?.[lane.select.value];
  const active = () => current()?.incoming ?? current()?.current;
  const take = button('Take', () => {
    const values = form.read(true);
    void sendCommand(
      {
        kind: 'action',
        actionId: 'transition.take',
        payload: {
          slotId: lane.select.value,
          stateId: state.select.value,
          ...(Object.keys(values).length ? { data: values } : {}),
        },
      },
      form,
    );
  });
  buttons.append(take);
  const patch = actions.has('transition.patch')
    ? button('Update on air', () => {
        const values = form.read(true);
        if (!Object.keys(values).length) {
          showError('Change a data field first.');
          return;
        }
        void sendCommand(
          {
            kind: 'action',
            actionId: 'transition.patch',
            payload: { slotId: lane.select.value, stateId: state.select.value, data: values },
          },
          form,
        );
      })
    : null;
  if (patch) buttons.append(patch);
  const out = actions.has('transition.out')
    ? button(
        'Take Out',
        () =>
          void sendCommand({
            kind: 'action',
            actionId: 'transition.out',
            payload: { slotId: lane.select.value },
          }),
      )
    : null;
  if (out) buttons.append(out);
  group.append(lane.field, stateHost, laneStatus, fieldsHost, buttons);

  const refresh = () => {
    const selection = active();
    const labels = lanes[lane.select.value]?.properties?.stateId?.gddOptions?.labels;
    laneStatus.textContent = selection
      ? `On air: ${labels?.[selection.stateId] ?? selection.stateId}`
      : 'Off air';
    take.dataset.unavailable = String(!state.select.value);
    if (patch)
      patch.dataset.unavailable = String(!selection || state.select.value !== selection.stateId);
    if (out) out.dataset.unavailable = String(!selection && !current()?.pending);
    if (selection?.stateId === state.select.value) form.refresh(selection.data ?? {});
    refreshStatus();
  };
  function showFields() {
    const schema = propertiesFor(lanes[lane.select.value], { stateId: state.select.value }).data;
    const selection = active();
    form = dataFields(
      fieldsHost,
      state.select.value ? schema : {},
      selection?.stateId === state.select.value ? selection.data : dataFromSchemaDefaults(schema),
    );
    refresh();
  }
  function showStates() {
    const schema = lanes[lane.select.value].properties.stateId;
    state = selectField(
      'Template state',
      schema,
      active()?.stateId || schema.default || schema.enum?.find(Boolean) || '',
    );
    stateHost.replaceChildren(state.field);
    state.select.addEventListener('change', showFields);
    showFields();
  }
  lane.select.addEventListener('change', showStates);
  showStates();
  return refresh;
}

function mountSingleControls(schema) {
  const buttons = row();
  const back = button('⏮ Back', () => void sendCommand({ kind: 'play', delta: -1 }));
  back.title = 'Go back one step';
  const take = button('Take In ▶', () => void sendCommand({ kind: 'play', delta: 1 }));
  buttons.append(
    back,
    take,
    button('Take Out', () => void sendCommand({ kind: 'stop' })),
  );
  operatorFields.append(buttons);
  const refreshTransport = () => {
    back.dataset.unavailable = String(currentStep === undefined);
    take.textContent = currentStep === undefined ? 'Take In ▶' : 'Next ⏭';
  };
  if (!Object.keys(schema?.properties ?? {}).length) return refreshTransport;
  const fields = panel('Data');
  const fieldHost = element('div');
  fieldHost.className = 'preview-data-form';
  const form = dataFields(fieldHost, schema, data);
  fields.append(
    fieldHost,
    button('Update data', () => {
      const values = form.read(true);
      if (Object.keys(values).length) void sendCommand({ kind: 'update', data: values }, form);
      else showError('Change a data field first.');
    }),
  );
  return () => {
    refreshTransport();
    form.refresh(data);
  };
}

function mountCustomActions(actions) {
  if (!actions.length) return;
  const group = panel('Custom actions');
  const choice = selectField('Action', {
    enum: actions.map((action) => action.id),
    gddOptions: {
      labels: Object.fromEntries(actions.map((action) => [action.id, action.name || action.id])),
    },
  });
  const fieldsHost = element('div');
  fieldsHost.className = 'preview-data-form';
  let form;
  function showFields(selection = {}) {
    const schema = actions.find((item) => item.id === choice.select.value)?.schema;
    const values = { ...dataFromSchemaDefaults(schema), ...selection };
    const resolved = { ...schema, properties: propertiesFor(schema, values) };
    form = dataFields(
      fieldsHost,
      resolved,
      { ...dataFromSchemaDefaults(resolved), ...selection },
      (slotId) => showFields({ slotId }),
    );
  }
  choice.select.addEventListener('change', () => showFields());
  group.append(
    choice.field,
    fieldsHost,
    button('Run action', () => {
      void sendCommand(
        { kind: 'action', actionId: choice.select.value, payload: form.read(false) },
        form,
      );
    }),
  );
  showFields();
}

function mountControls() {
  operatorFields.replaceChildren();
  refreshForms = () => {};
  if (!canControl) return;
  const { schema, customActions = [] } = player.manifest;
  const actions = new Map(customActions.map((action) => [action.id, action]));
  const lanes = schema?.properties?.slots?.properties ?? {};
  const coordinated = actions.has('transition.take') && Object.keys(lanes).length > 0;
  refreshForms = coordinated ? mountLaneControls(lanes, actions) : mountSingleControls(schema);
  const laneActions = ['transition.take', 'transition.patch', 'transition.out'];
  mountCustomActions(
    customActions.filter((action) => !coordinated || !laneActions.includes(action.id)),
  );
}

async function applyEntry(entry, replay) {
  const currentPublication = publicationId;
  const { command, revision } = entry;
  if (!player || currentPublication !== announcedPublicationId) return;
  if (entry.publicationId !== undefined && entry.publicationId !== currentPublication) return;
  if (revision <= appliedRevision) return;
  if (revision !== appliedRevision + 1) throw new Error('The shared command history has a gap.');
  const options = replay ? { skipAnimation: true } : {};
  try {
    switch (command.kind) {
      case 'play': {
        const result = await player.play({
          ...options,
          ...(command.goto === undefined ? { delta: command.delta ?? 1 } : { goto: command.goto }),
        });
        if (currentPublication === announcedPublicationId) currentStep = result?.currentStep;
        break;
      }
      case 'stop':
        await player.stop(options);
        if (currentPublication === announcedPublicationId) currentStep = undefined;
        break;
      case 'update':
        await player.update(command.data, options);
        if (currentPublication === announcedPublicationId) data = { ...data, ...command.data };
        break;
      case 'action':
        await player.action(command.actionId, command.payload, options);
        break;
      default:
        throw new Error('Unsupported shared playout command.');
    }
  } catch (error) {
    if (replay && revision === 1 && command.kind === 'play') throw error;
    // An accepted command may fail on this renderer. Preserve its place in the
    // session sequence so reconnect does not run the same command twice.
    if (currentPublication === announcedPublicationId)
      showError(`Revision ${revision}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (currentPublication === announcedPublicationId) appliedRevision = revision;
}

async function discardPlayer(expectedPublication) {
  synchronized = false;
  const previous = player;
  player = undefined;
  publicationId = undefined;
  operatorFields.replaceChildren();
  refreshForms = () => {};
  currentStep = undefined;
  appliedRevision = 0;
  serverRevision = 0;
  title.textContent = 'OGraf Live Preview';
  fitStage();
  refreshStatus();
  try {
    await previous?.dispose();
  } catch (error) {
    if (expectedPublication === announcedPublicationId) showError(error);
  } finally {
    stage.replaceChildren();
  }
}

async function applySnapshot(snapshot) {
  const nextPublication = snapshot.publicationId;
  if (nextPublication !== announcedPublicationId) return false;
  const remount = publicationId !== nextPublication || (nextPublication !== null && !player);
  const rebuildControls = remount || canControl !== snapshot.canControl;
  canControl = snapshot.canControl;
  try {
    if (remount) {
      if (failedPublicationId === nextPublication) showError();
      failedPublicationId = undefined;
      await discardPlayer(nextPublication);
      if (nextPublication !== announcedPublicationId) return false;
      if (nextPublication === null) {
        publicationId = null;
        return true;
      }
      const abort = new AbortController();
      mounting = abort;
      try {
        const next = await mountOGrafGraphic({
          container: stage,
          manifestUrl: snapshot.manifestUrl,
          signal: abort.signal,
        });
        if (nextPublication !== announcedPublicationId) {
          await next.dispose().catch(() => undefined);
          return false;
        }
        player = next;
        fitStage();
      } catch (error) {
        if (abort.signal.aborted) return false;
        throw error;
      } finally {
        mounting = undefined;
      }
      publicationId = nextPublication;
      data = dataFromSchemaDefaults(player.manifest.schema) ?? {};
      title.textContent = player.manifest.name || 'OGraf Live Preview';
    }
    if (nextPublication === null) return true;
    serverRevision = Math.max(serverRevision, snapshot.revision);
    for (const entry of snapshot.commands) await applyEntry(entry, true);
    if (nextPublication !== announcedPublicationId) return false;
    if (appliedRevision < snapshot.revision)
      throw new Error('The shared session snapshot is incomplete.');
    if (rebuildControls) mountControls();
    refreshForms();
    refreshStatus();
    return true;
  } catch (error) {
    if (nextPublication !== announcedPublicationId) return false;
    if (remount && nextPublication !== null) {
      failedPublicationId = nextPublication;
      await discardPlayer(nextPublication);
    }
    throw error;
  }
}

async function recoverSnapshot(expectedPublication) {
  const snapshot = await requestState();
  if (snapshot.publicationId === expectedPublication) await applySnapshot(snapshot);
}

function enqueue(operation, expectedPublication = announcedPublicationId) {
  eventQueue = eventQueue
    .then(() => {
      if (expectedPublication === announcedPublicationId) return operation();
    })
    .catch((error) => {
      if (expectedPublication !== announcedPublicationId) return;
      synchronized = false;
      showError(error);
      refreshStatus();
    });
}

function start() {
  const eventSource = new EventSource('./events');
  let connection = 0;
  const synchronize = async (snapshot, currentConnection) => {
    if (!(await applySnapshot(snapshot))) return;
    synchronized = currentConnection === connection && eventSource.readyState === EventSource.OPEN;
    refreshStatus();
  };
  retryPreview.addEventListener('click', () => {
    const currentPublication = announcedPublicationId;
    if (!currentPublication || currentPublication !== failedPublicationId || retrying) return;
    const currentConnection = connection;
    const retry = { abort: new AbortController() };
    retrying = retry;
    showError();
    refreshStatus();
    enqueue(async () => {
      try {
        if (failedPublicationId !== currentPublication) return;
        const snapshot = await requestState(retry.abort.signal);
        if (snapshot.publicationId === currentPublication)
          await synchronize(snapshot, currentConnection);
      } finally {
        if (retrying === retry) {
          retrying = undefined;
          refreshStatus();
        }
      }
    }, currentPublication);
  });
  eventSource.addEventListener('error', () => {
    connection++;
    synchronized = false;
    refreshStatus();
    if (eventSource.readyState === EventSource.CLOSED)
      void requestState().catch((error) => {
        status.textContent = 'Could not connect';
        showError(error);
      });
  });
  eventSource.addEventListener('snapshot', (event) => {
    const currentConnection = connection;
    let snapshot;
    try {
      snapshot = JSON.parse(event.data);
    } catch {
      showError('Could not read the shared session snapshot.');
      return;
    }
    if (snapshot.publicationId !== announcedPublicationId) {
      announcedPublicationId = snapshot.publicationId;
      synchronized = false;
      sending?.abort.abort();
      sending = undefined;
      retrying?.abort.abort();
      retrying = undefined;
      failedPublicationId = undefined;
      mounting?.abort();
      showError();
      refreshStatus();
    }
    enqueue(() => synchronize(snapshot, currentConnection), snapshot.publicationId);
  });
  eventSource.addEventListener('command', (event) => {
    enqueue(async () => {
      const entry = JSON.parse(event.data);
      if (entry.publicationId !== publicationId || entry.publicationId !== announcedPublicationId)
        return;
      serverRevision = Math.max(serverRevision, entry.revision);
      refreshStatus();
      if (entry.revision > appliedRevision + 1) await recoverSnapshot(entry.publicationId);
      await applyEntry(entry, false);
      if (entry.publicationId !== announcedPublicationId) return;
      refreshForms();
      refreshStatus();
    });
  });
}

installPopup();
start();
