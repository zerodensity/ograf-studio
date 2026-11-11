import { dataFromSchemaDefaults, mountOGrafGraphic } from './ograf-player.js';

const layout = document.querySelector('#layout');
const title = document.querySelector('#title');
const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const revisionLabel = document.querySelector('#revision');
const errorOutput = document.querySelector('#error');
const controls = document.querySelector('#controls');

let player;
let publicationId;
let data = {};
let eventSource;
let canControl = false;
let synchronized = false;
let sending = false;
let appliedRevision = 0;
let serverRevision = 0;
let eventQueue = Promise.resolve();
let refreshForms = () => {};

function refreshStatus() {
  const ready = Boolean(player) && synchronized;
  layout.dataset.role = canControl ? 'operator' : 'viewer';
  controls.hidden = !canControl;
  status.textContent = ready
    ? canControl
      ? 'Connected as operator'
      : 'Connected as viewer'
    : player
      ? 'Reconnecting…'
      : 'Loading graphic…';
  revisionLabel.textContent = ready ? `Revision ${appliedRevision}` : '';
  if (ready) revisionLabel.dataset.revision = String(appliedRevision);
  else delete revisionLabel.dataset.revision;
  for (const button of controls.querySelectorAll('button')) {
    button.disabled =
      !ready ||
      sending ||
      appliedRevision < serverRevision ||
      button.dataset.unavailable === 'true';
  }
  for (const input of controls.querySelectorAll('input, select, textarea'))
    input.disabled = sending;
}

function showError(error) {
  errorOutput.textContent = error instanceof Error ? error.message : String(error ?? '');
  errorOutput.hidden = !errorOutput.textContent;
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function selectField(label, schema, value) {
  const select = element('select');
  for (const option of schema.enum ?? [])
    select.add(new Option(schema.gddOptions?.labels?.[option] ?? option, option));
  if (value !== undefined) select.value = value;
  const field = element('label', label);
  field.append(select);
  return { select, field };
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
  controls.append(group);
  return group;
}

function row() {
  const group = element('div');
  group.className = 'row';
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
    const label = element('label', property.title || key);
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
    label.append(input);
    container.append(label);
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

async function requestState() {
  const response = await fetch('./state', { cache: 'no-store' });
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
  if (!synchronized || !canControl || sending || appliedRevision < serverRevision) return;
  sending = true;
  showError();
  refreshStatus();
  try {
    const response = await fetch('./command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: requestId(), expectedRevision: serverRevision, command }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) enqueue(async () => applySnapshot(await requestState()));
      throw new Error(
        result.message || result.error || `Command rejected (HTTP ${response.status}).`,
      );
    }
    serverRevision = Math.max(serverRevision, result.revision);
    form?.settle();
    refreshForms();
  } catch (error) {
    showError(error);
  } finally {
    sending = false;
    refreshStatus();
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
  fieldsHost.className = 'fields';
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
        'Take out',
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
  const group = panel('Playback');
  const buttons = row();
  buttons.append(
    button('Take / Next', () => void sendCommand({ kind: 'play', delta: 1 })),
    button('Take out', () => void sendCommand({ kind: 'stop' })),
  );
  group.append(buttons);
  if (!Object.keys(schema?.properties ?? {}).length) return () => {};
  const fields = panel('Data');
  const fieldHost = element('div');
  fieldHost.className = 'fields';
  const form = dataFields(fieldHost, schema, data);
  fields.append(
    fieldHost,
    button('Update data', () => {
      const values = form.read(true);
      if (Object.keys(values).length) void sendCommand({ kind: 'update', data: values }, form);
      else showError('Change a data field first.');
    }),
  );
  return () => form.refresh(data);
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
  fieldsHost.className = 'fields';
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
  controls.replaceChildren();
  refreshForms = () => {};
  if (!canControl) return;
  controls.append(element('h2', 'Playout controls'));
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
  const { command, revision } = entry;
  if (revision <= appliedRevision) return;
  if (revision !== appliedRevision + 1) throw new Error('The shared command history has a gap.');
  const options = replay ? { skipAnimation: true } : {};
  try {
    switch (command.kind) {
      case 'play':
        await player.play({ ...options, delta: command.delta ?? 1 });
        break;
      case 'stop':
        await player.stop(options);
        break;
      case 'update':
        await player.update(command.data, options);
        data = { ...data, ...command.data };
        break;
      case 'action':
        await player.action(command.actionId, command.payload, options);
        break;
      default:
        throw new Error('Unsupported shared playout command.');
    }
  } catch (error) {
    // An accepted command may fail on this renderer. Preserve its place in the
    // session sequence so reconnect does not run the same command twice.
    showError(`Revision ${revision}: ${error instanceof Error ? error.message : String(error)}`);
  }
  appliedRevision = revision;
}

async function applySnapshot(snapshot) {
  const remount = !player || publicationId !== snapshot.publicationId;
  const rebuildControls = remount || canControl !== snapshot.canControl;
  canControl = snapshot.canControl;
  if (remount) {
    synchronized = false;
    await player?.dispose();
    player = undefined;
    appliedRevision = 0;
    serverRevision = 0;
    player = await mountOGrafGraphic({ container: stage, manifestUrl: snapshot.manifestUrl });
    publicationId = snapshot.publicationId;
    data = dataFromSchemaDefaults(player.manifest.schema) ?? {};
    title.textContent = player.manifest.name || 'OGraf Live Preview';
  }
  serverRevision = Math.max(serverRevision, snapshot.revision);
  for (const entry of snapshot.commands) await applyEntry(entry, true);
  if (appliedRevision < snapshot.revision)
    throw new Error('The shared session snapshot is incomplete.');
  if (rebuildControls) mountControls();
  refreshForms();
  refreshStatus();
}

function enqueue(operation) {
  eventQueue = eventQueue.then(operation).catch((error) => {
    synchronized = false;
    showError(error);
    refreshStatus();
  });
}

async function start() {
  await applySnapshot(await requestState());
  eventSource = new EventSource('./events');
  let connection = 0;
  eventSource.addEventListener('error', () => {
    connection++;
    synchronized = false;
    refreshStatus();
  });
  eventSource.addEventListener('snapshot', (event) => {
    const currentConnection = connection;
    enqueue(async () => {
      await applySnapshot(JSON.parse(event.data));
      synchronized =
        currentConnection === connection && eventSource.readyState === EventSource.OPEN;
      refreshStatus();
    });
  });
  eventSource.addEventListener('command', (event) => {
    enqueue(async () => {
      const entry = JSON.parse(event.data);
      serverRevision = Math.max(serverRevision, entry.revision);
      refreshStatus();
      if (entry.revision > appliedRevision + 1) await applySnapshot(await requestState());
      await applyEntry(entry, false);
      refreshForms();
      refreshStatus();
    });
  });
}

start().catch((error) => {
  status.textContent = 'Could not connect';
  showError(error);
});
