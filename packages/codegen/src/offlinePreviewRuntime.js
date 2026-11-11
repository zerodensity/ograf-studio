/** Fit only the actual composition, leaving the dock outside the graphic's viewport. */
function offlinePreviewFit(width, height, availableWidth, availableHeight) {
  const scale = Math.min(availableWidth / width, availableHeight / height);
  return {
    scale,
    width: width * scale,
    height: height * scale,
    left: (availableWidth - width * scale) / 2,
    top: (availableHeight - height * scale) / 2,
  };
}

/** Presentation-only state never sends updates to the certified graphic. */
function createOfflinePreviewView(report, onControlsVisibilityChange) {
  const get = (id) => document.getElementById(id);
  const controls = get('controls');
  const output = get('output');
  const frame = get('frame');
  const stage = get('stage');
  const fullscreen = get('fullscreen');
  const side = get('dock-side');
  const kind = get('background-kind');
  const color = get('background-color');
  const colorRow = get('background-color-row');
  const background = get('background');
  const image = get('background-image');
  const video = get('background-video');
  const fileRow = get('background-file-row');
  const file = get('background-file');
  const cameraRow = get('background-camera-row');
  const camera = get('background-camera');
  let width = 1920;
  let height = 1080;
  let mediaUrl;
  let mediaRevision = 0;
  let closed = false;

  function fit() {
    const available = output.getBoundingClientRect();
    const fitted = offlinePreviewFit(width, height, available.width, available.height);
    Object.assign(frame.style, {
      left: `${fitted.left}px`,
      top: `${fitted.top}px`,
      width: `${fitted.width}px`,
      height: `${fitted.height}px`,
    });
    Object.assign(stage.style, {
      width: `${width}px`,
      height: `${height}px`,
      transform: `scale(${fitted.scale})`,
    });
  }
  function showControls(visible) {
    if (controls.hidden === !visible) return;
    const returnFocus = !visible && controls.contains(document.activeElement);
    controls.hidden = !visible;
    document.body.classList.toggle('controls-hidden', !visible);
    fit();
    if (returnFocus) output.focus({ preventScroll: true });
    onControlsVisibilityChange?.(visible);
  }
  function fullscreenChanged() {
    const active = Boolean(document.fullscreenElement);
    fullscreen.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    showControls(!active);
  }
  function handleControlsShortcut(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    if (event.key.toLowerCase() === 'd') showControls(controls.hidden);
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      showControls(true);
    }
  }
  function clearMedia() {
    mediaRevision++;
    if (video.srcObject) {
      for (const track of video.srcObject.getTracks()) track.stop();
      video.srcObject = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    image.removeAttribute('src');
    image.hidden = video.hidden = true;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = undefined;
    camera.textContent = 'Start webcam';
  }
  function updateBackground() {
    clearMedia();
    background.dataset.kind = kind.value;
    background.style.backgroundColor = color.value;
    color.hidden = kind.value !== 'solid';
    colorRow.hidden = kind.value !== 'solid';
    fileRow.hidden = kind.value !== 'image' && kind.value !== 'video';
    cameraRow.hidden = kind.value !== 'webcam';
    file.accept = kind.value === 'video' ? 'video/*' : 'image/*';
    file.value = '';
  }
  side.addEventListener('change', () => {
    document.body.dataset.dock = side.value === 'left' ? 'left' : 'right';
    fit();
  });
  get('hide').addEventListener('click', () => showControls(false));
  const showAtPreview = (event) => {
    event.preventDefault();
    showControls(true);
  };
  output.addEventListener('contextmenu', showAtPreview);
  document.addEventListener('keydown', handleControlsShortcut);
  document.addEventListener('fullscreenchange', fullscreenChanged);
  kind.addEventListener('change', updateBackground);
  color.addEventListener('input', () => {
    background.style.backgroundColor = color.value;
  });
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (!selected || (kind.value !== 'image' && kind.value !== 'video')) return;
    clearMedia();
    mediaUrl = URL.createObjectURL(selected);
    const target = kind.value === 'image' ? image : video;
    target.src = mediaUrl;
    target.hidden = false;
    if (target === video) {
      video.muted = true;
      const revision = mediaRevision;
      void video.play().catch((error) => {
        if (revision === mediaRevision && !closed) report(error.message || String(error), true);
      });
    }
  });
  camera.addEventListener('click', async () => {
    if (video.srcObject) {
      clearMedia();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      report('Webcam is unavailable in this browser context.', true);
      return;
    }
    clearMedia();
    const revision = mediaRevision;
    camera.textContent = 'Connecting…';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (closed || revision !== mediaRevision || kind.value !== 'webcam') {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.srcObject = stream;
      video.muted = true;
      video.hidden = false;
      camera.textContent = 'Stop webcam';
      await video.play();
    } catch (error) {
      if (revision !== mediaRevision || closed) return;
      clearMedia();
      report(error.message || String(error), true);
    }
  });
  for (const [input, guide] of [
    ['action-safe', 'action-guide'],
    ['title-safe', 'title-guide'],
  ]) {
    get(input).addEventListener('change', () => {
      get(guide).toggleAttribute('hidden', !get(input).checked);
    });
  }
  window.addEventListener('resize', fit);
  updateBackground();
  fit();
  return {
    showControls,
    setDimensions(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      fit();
    },
    dispose() {
      closed = true;
      clearMedia();
      window.removeEventListener('resize', fit);
      output.removeEventListener('contextmenu', showAtPreview);
      document.removeEventListener('keydown', handleControlsShortcut);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
    },
  };
}

/** Record the cue events emitted by the mounted single or coordinated graphic. */
function installFrameCueLog(graphic) {
  const doc = graphic.ownerDocument;
  const entries = doc.getElementById('frame-cue-entries');
  const count = doc.getElementById('frame-cue-count');
  const empty = doc.getElementById('frame-cue-empty');
  const clear = doc.getElementById('frame-cue-clear');
  const limit = 20;

  function refresh() {
    count.textContent = String(entries.childElementCount);
    empty.hidden = entries.childElementCount > 0;
    clear.disabled = !empty.hidden;
  }

  function onCue({ detail }) {
    if (!detail || typeof detail.name !== 'string' || !Number.isSafeInteger(detail.frame)) return;
    const item = doc.createElement('li');
    const name = doc.createElement('strong');
    name.textContent = detail.name;
    const metadata = doc.createElement('small');
    metadata.textContent = [
      `Frame ${detail.frame}`,
      detail.instanceId && `Instance ${detail.instanceId}`,
      detail.laneId && `Lane ${detail.laneId}`,
      detail.templateId && `Template ${detail.templateId}`,
    ]
      .filter(Boolean)
      .join(' · ');
    item.append(name, metadata);
    if (detail.payload !== undefined) {
      const payload = doc.createElement('code');
      payload.textContent = JSON.stringify(detail.payload);
      item.append(payload);
    }
    entries.prepend(item);
    if (entries.childElementCount > limit) entries.lastElementChild.remove();
    refresh();
  }

  function clearLog() {
    entries.replaceChildren();
    refresh();
  }

  graphic.addEventListener('ograf-studio-cue', onCue);
  clear.addEventListener('click', clearLog);
  return () => {
    graphic.removeEventListener('ograf-studio-cue', onCue);
    clear.removeEventListener('click', clearLog);
  };
}

(async function () {
  'use strict';
  const payload = JSON.parse(document.getElementById('ograf-package').textContent);
  const { manifest, resources, stateSchemas } = payload;
  const nodosHost = Boolean(window.nodos);
  if (nodosHost) document.body.dataset.nodos = '';
  const coordinatedSet = Boolean(
    manifest.schema?.properties?.slots?.properties &&
    (manifest.customActions || []).some((action) => action.id === 'transition.take'),
  );
  const stage = document.getElementById('stage');
  const controls = document.getElementById('controls');
  const status = document.getElementById('status');
  const lanes = document.getElementById('lanes');
  const dataPanel = document.getElementById('data');
  const actionsPanel = document.getElementById('actions');
  const playButton = document.getElementById('play');
  const backButton = document.getElementById('back');
  const outButton = document.getElementById('out');
  const fullscreen = document.getElementById('fullscreen');
  const stepStatus = document.getElementById('preview-step');
  const fpsBadge = document.getElementById('fps-overlay');
  const fpsToggle = document.getElementById('fps-enabled');
  const objectUrls = [];
  let graphic;
  let nodosBinding;
  let moduleUrl;
  let disposed = false;
  let currentStep;
  let scheduler;
  let fpsMonitor;
  let releaseFrameCueLog;
  let playoutMutations = 0;
  const laneForms = new Map();

  function say(text, error) {
    status.textContent = text;
    status.classList.toggle('error', Boolean(error));
  }
  function refreshFpsVisibility() {
    fpsMonitor?.dispose();
    fpsMonitor = undefined;
    fpsBadge.hidden = nodosHost || controls.hidden || !fpsToggle.checked || disposed || !graphic;
    if (fpsBadge.hidden) return;
    const format = (value) => (value === null ? '—' : value.toFixed(1));
    fpsBadge.textContent = scheduler ? 'Preview FPS — · Render FPS —' : 'Preview FPS —';
    fpsBadge.title = scheduler
      ? 'Browser preview animation-frame cadence; Render FPS counts completed rendered samples, not authored FPS or GPU throughput'
      : 'Browser preview animation-frame cadence, not authored FPS or GPU throughput';
    fpsMonitor = createPreviewFpsMonitor({
      target: document.getElementById('frame'),
      ownerWindow: window,
      renderSampling: Boolean(scheduler),
      onSample: ({ fps, renderFps }) => {
        fpsBadge.textContent = `Preview FPS ${format(fps)}${scheduler ? ` · Render FPS ${format(renderFps)}` : ''}`;
      },
    });
  }
  fpsToggle.addEventListener('change', refreshFpsVisibility);
  const view = createOfflinePreviewView(say, refreshFpsVisibility);
  const releaseControlsInteraction = installPreviewControlsInteraction(
    document.body,
    controls,
    true,
    () => view.showControls(true),
    document,
  );
  function check(result) {
    if (result && Number(result.statusCode) >= 400)
      throw new Error(result.statusMessage || `Graphic returned status ${result.statusCode}.`);
    return result;
  }
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  function defaults(schema, value, present) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return value;
    if (!present && Object.prototype.hasOwnProperty.call(schema, 'default')) {
      value = clone(schema.default);
      present = true;
    }
    if (!schema.properties || typeof schema.properties !== 'object') return value;
    if (present && (!value || typeof value !== 'object' || Array.isArray(value))) return value;
    const result = present ? value : {};
    for (const [key, child] of Object.entries(schema.properties)) {
      const has = Object.prototype.hasOwnProperty.call(result, key);
      const next = defaults(child, has ? result[key] : undefined, has);
      if (next !== undefined)
        Object.defineProperty(result, key, {
          value: next,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    return result;
  }
  function valueFor(schema, value) {
    if (value !== undefined && value !== null) return value;
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return 0;
    if (schema.type === 'array') return [];
    if (schema.type === 'object') return {};
    return '';
  }
  function setPath(root, path, value) {
    let current = root;
    for (const key of path.slice(0, -1)) {
      const existing = Object.prototype.hasOwnProperty.call(current, key)
        ? current[key]
        : undefined;
      if (!existing || typeof existing !== 'object' || Array.isArray(existing))
        Object.defineProperty(current, key, {
          value: {},
          enumerable: true,
          configurable: true,
          writable: true,
        });
      current = current[key];
    }
    Object.defineProperty(current, path[path.length - 1], {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  function patchFor(path, value, values) {
    const patch = {};
    // OGraf updates can merge at the top level. Send the complete edited root
    // value for nested fields so its siblings are not accidentally erased.
    setPath(patch, [path[0]], path.length > 1 ? clone(values[path[0]]) : value);
    return patch;
  }
  function constraint(value, fallback) {
    if (value && typeof value === 'object') {
      for (const n of [value.exact, value.ideal]) if (Number.isFinite(n) && n > 0) return n;
      if (Number.isFinite(value.min)) fallback = Math.max(fallback, value.min);
      if (Number.isFinite(value.max)) fallback = Math.min(fallback, value.max);
    }
    return fallback;
  }
  function blob(data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    objectUrls.push(url);
    return url;
  }
  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function mime(resource) {
    if (resource.mimeType) return resource.mimeType;
    const extension = resource.path.split('.').pop().toLowerCase();
    return (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        ttf: 'font/ttf',
        otf: 'font/otf',
        woff: 'font/woff',
        woff2: 'font/woff2',
        css: 'text/css',
        txt: 'text/plain',
      }[extension] || 'application/octet-stream'
    );
  }
  fullscreen.addEventListener('click', () => {
    const operation = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    Promise.resolve(operation).catch((error) => say(error.message || String(error), true));
  });

  function refreshStepStatus() {
    stepStatus.textContent = coordinatedSet
      ? 'Coordinated set'
      : scheduler
        ? 'Rendered preview'
        : currentStep === undefined
          ? 'Off air'
          : `Step ${currentStep + 1} of ${manifest.stepCount ?? currentStep + 1}`;
  }
  function run(label, callback, lifecycle) {
    Promise.resolve()
      .then(callback)
      .then((result) => {
        check(result);
        if (lifecycle === 'out') currentStep = undefined;
        else if (lifecycle === 'play' && !scheduler) currentStep = result?.currentStep;
        if (result?.v_offlineDataStaged === 'controls') say(`${label} staged for the next Take.`);
        else if (result?.v_offlineDataStaged === 'local')
          say(`${label} staged locally. Take this lane to apply it.`);
        else say(`${label} ${scheduler ? 'scheduled' : 'complete'}.`);
        playButton.textContent = scheduler
          ? 'Play / Next ▶'
          : currentStep === undefined
            ? 'Take In ▶'
            : 'Next ⏭';
        refreshStepStatus();
        backButton.disabled = !scheduler && currentStep === undefined;
      })
      .catch((error) => say(error.message || String(error), true));
  }
  function call(type, params) {
    if (disposed) return Promise.reject(new Error('Preview is closed.'));
    const changesPlayout =
      type === 'playAction' ||
      type === 'stopAction' ||
      (type === 'customAction' &&
        ['transition.take', 'transition.out', 'transition.clear'].includes(params.id));
    if (changesPlayout) playoutMutations++;
    try {
      const result = scheduler ? scheduler.call(type, params) : graphic[type](params);
      return changesPlayout
        ? Promise.resolve(result).finally(() => {
            playoutMutations--;
            // A late edit staged while Take/Out was preparing may now target an
            // on-air state. Reconcile without requiring another playout action.
            if (!playoutMutations) for (const form of laneForms.values()) form.refresh?.();
          })
        : result;
    } catch (error) {
      if (changesPlayout) playoutMutations--;
      throw error;
    }
  }

  function button(label, callback) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', callback);
    return element;
  }
  function heading(parent, text) {
    const group = document.createElement('section');
    group.className = 'section preview-control-section';
    const title = document.createElement('h3');
    title.textContent = text;
    group.appendChild(title);
    parent.appendChild(group);
    return group;
  }
  function fieldRows(parent, properties, values, onChange, prefix) {
    for (const [key, schema] of Object.entries(properties || {})) {
      if (!schema || schema.hidden === true) continue;
      const path = [...(prefix || []), key];
      let value = values;
      for (const segment of path)
        value = value && typeof value === 'object' ? value[segment] : undefined;
      value = valueFor(schema, value);
      if (schema.type === 'object' && schema.properties) {
        const group = heading(parent, schema.title || key);
        fieldRows(group, schema.properties, values, onChange, path);
        continue;
      }
      const label = document.createElement('label');
      label.className = 'row preview-data-row';
      if (schema.description) label.title = schema.description;
      const text = document.createElement('span');
      text.className = 'field-label';
      text.textContent = schema.title || key;
      label.appendChild(text);
      let input;
      let alphaInput;
      let hexInput;
      let alphaByte = 255;
      const alphaColor = schema.gddType === 'color-rrggbbaa';
      if (Array.isArray(schema.enum)) {
        input = document.createElement('select');
        for (const option of schema.enum) {
          const el = document.createElement('option');
          el.value = String(option);
          el.textContent = schema.gddOptions?.labels?.[String(option)] ?? String(option);
          input.appendChild(el);
        }
        input.value = String(value);
      } else if (schema.type === 'array' || schema.type === 'object') {
        input = document.createElement('textarea');
        input.value = JSON.stringify(value);
      } else {
        input = document.createElement('input');
        input.type =
          schema.type === 'boolean'
            ? 'checkbox'
            : schema.type === 'number' || schema.type === 'integer'
              ? 'number'
              : /^color-rrggbb(?:aa)?$/.test(schema.gddType || '')
                ? 'color'
                : 'text';
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else if (alphaColor) {
          const color = /^#[0-9a-f]{8}$/i.test(String(value)) ? String(value) : '#000000ff';
          input.value = color.slice(0, 7);
          alphaByte = parseInt(color.slice(7), 16);
          alphaInput = document.createElement('input');
          alphaInput.type = 'number';
          alphaInput.min = '0';
          alphaInput.max = '100';
          alphaInput.step = '0.1';
          alphaInput.value = String(Math.round((alphaByte / 255) * 1000) / 10);
          alphaInput.setAttribute('aria-label', `${schema.title || key} opacity percent`);
          alphaInput.className = 'color-alpha';
        } else input.value = String(value);
        if (schema.maxLength && input.type === 'text') input.maxLength = schema.maxLength;
        if (schema.type === 'number') input.step = 'any';
        if (schema.minimum !== undefined) input.min = String(schema.minimum);
        if (schema.maximum !== undefined) input.max = String(schema.maximum);
      }
      input.setAttribute('aria-label', schema.title || key);
      if (input.type === 'color') {
        hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.className = 'color-input-hex';
        hexInput.value = alphaColor
          ? `${input.value}${alphaByte.toString(16).padStart(2, '0')}`
          : input.value;
        hexInput.setAttribute('aria-label', `${schema.title || key} hex`);
        hexInput.spellcheck = false;
      }
      const change = (event) => {
        try {
          if (hexInput && event.currentTarget === hexInput) {
            const hex = hexInput.value.trim();
            if (
              !new RegExp(
                alphaColor ? '^#[0-9a-f]{6}(?:[0-9a-f]{2})?$' : '^#[0-9a-f]{6}$',
                'i',
              ).test(hex)
            )
              throw new Error(alphaColor ? 'Use #RRGGBB or #RRGGBBAA.' : 'Use #RRGGBB.');
            input.value = hex.slice(0, 7);
            if (alphaColor && hex.length === 9) alphaByte = parseInt(hex.slice(7), 16);
            if (alphaInput) alphaInput.value = String(Math.round((alphaByte / 255) * 1000) / 10);
          }
          if (alphaInput && event.currentTarget === alphaInput) {
            if (!alphaInput.value.trim() || !alphaInput.validity.valid)
              throw new Error('Opacity must be between 0 and 100.');
            alphaByte = Math.round((Number(alphaInput.value) / 100) * 255);
          }
          const next = alphaInput
            ? `${input.value}${alphaByte.toString(16).padStart(2, '0')}`
            : input.type === 'checkbox'
              ? input.checked
              : schema.type === 'number' || schema.type === 'integer'
                ? Number(input.value)
                : schema.type === 'array' || schema.type === 'object'
                  ? JSON.parse(input.value)
                  : input.value;
          if (
            schema.type === 'array'
              ? !Array.isArray(next)
              : schema.type === 'object' &&
                (!next || typeof next !== 'object' || Array.isArray(next))
          )
            throw new Error(`Enter a JSON ${schema.type}.`);
          if ((schema.type === 'number' || schema.type === 'integer') && !Number.isFinite(next))
            throw new Error('Enter a valid number.');
          if (
            (schema.type === 'number' || schema.type === 'integer') &&
            (!input.value.trim() || !input.validity.valid)
          )
            throw new Error('Enter a valid number.');
          setPath(values, path, next);
          input.setAttribute('aria-invalid', 'false');
          hexInput?.setAttribute('aria-invalid', 'false');
          alphaInput?.setAttribute('aria-invalid', 'false');
          if (hexInput && event.currentTarget !== hexInput) hexInput.value = next;
          onChange(path, next);
        } catch (error) {
          (event.currentTarget || input).setAttribute('aria-invalid', 'true');
          say(error.message || String(error), true);
        }
      };
      input.addEventListener(
        input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input',
        change,
      );
      alphaInput?.addEventListener('change', change);
      hexInput?.addEventListener('input', change);
      if (hexInput) {
        const color = document.createElement('span');
        color.className = 'color-value-input';
        color.setAttribute('role', 'group');
        color.setAttribute('aria-label', `${schema.title || key} color value`);
        color.appendChild(input);
        color.appendChild(hexInput);
        if (alphaInput) {
          color.appendChild(alphaInput);
          const percent = document.createElement('small');
          percent.textContent = '%';
          color.appendChild(percent);
        }
        label.appendChild(color);
      } else label.appendChild(input);
      parent.appendChild(label);
    }
  }
  function showData(schema, initial) {
    if (!schema?.properties) return;
    const group = heading(dataPanel, 'Data');
    fieldRows(group, schema.properties, initial, (path, value) => {
      run('Data update', () => call('updateAction', { data: patchFor(path, value, initial) }));
    });
  }
  function showLanes(slotSchema, initial) {
    const group = heading(lanes, 'Playout transitions');
    group.className = 'section preview-transition-controls';
    for (const [slotId, schema] of Object.entries(slotSchema.properties || {})) {
      const laneGroup = document.createElement('div');
      laneGroup.className = 'preview-transition-slot';
      laneGroup.setAttribute('role', 'group');
      laneGroup.setAttribute('aria-label', schema.title || slotId);
      const laneHeading = document.createElement('div');
      laneHeading.className = 'preview-transition-slot-heading';
      const row = document.createElement('div');
      row.className = 'preview-transition-slot-actions';
      const title = document.createElement('strong');
      title.textContent = schema.title || slotId;
      laneHeading.appendChild(title);
      const laneStatus = document.createElement('small');
      laneStatus.setAttribute('role', 'status');
      laneHeading.appendChild(laneStatus);
      const select = document.createElement('select');
      select.className = 'lane-select';
      select.setAttribute('aria-label', `${schema.title || slotId} state`);
      const choice = schema.properties?.stateId || {};
      for (const state of (choice.enum || []).filter(Boolean)) {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = choice.gddOptions?.labels?.[state] ?? state;
        select.appendChild(option);
      }
      const slot = initial?.slots?.[slotId] ?? clone(schema.default) ?? {};
      if (slot.stateId) select.value = slot.stateId;
      const drafts = new Map();
      const observed = new Map();
      const expanded = new Map();
      const attempted = new Map();
      const section = document.createElement('div');
      section.className = 'preview-slot-forms';
      let lastSignature = '';
      let renderedSelection;
      const laneName = schema.title || slotId;
      const stateName = (id) => choice.gddOptions?.labels?.[id] ?? id;
      const stateSchema = (id) => stateSchemas?.[slotId]?.[id] ?? schema.properties?.data ?? {};
      const selectionFor = (snapshot) => {
        const current = snapshot?.slots?.[slotId];
        if (!current || (current.transition && !current.incoming)) return null;
        return current.incoming ?? current.current ?? null;
      };
      // Retain only schema-declared keys, including nested objects: runtime data may
      // contain hidden authoring values that must never become operator controls.
      const publicValue = (fieldSchema, value) => {
        if (Array.isArray(value)) return value.map((item) => publicValue(fieldSchema?.items, item));
        if (!value || typeof value !== 'object') return clone(value);
        if (!fieldSchema?.properties) return clone(value);
        return Object.fromEntries(
          Object.entries(fieldSchema.properties)
            .filter(([key]) => Object.prototype.hasOwnProperty.call(value, key))
            .map(([key, child]) => [key, publicValue(child, value[key])]),
        );
      };
      const staged = (stateId, patch) => {
        drafts.set(stateId, { ...drafts.get(stateId), ...clone(patch) });
        attempted.delete(stateId);
      };
      const updateLane = async (stateId, patch) => {
        const result = await updateOfflineLaneData(
          call,
          () => graphic.getPlayoutSnapshot?.(),
          () => playoutMutations > 0,
          slotId,
          patch,
          stateId,
        );
        if (result?.v_offlineDataStaged === 'local') attempted.delete(stateId);
        return result;
      };
      if (slot.stateId && slot.data)
        observed.set(slot.stateId, publicValue(stateSchema(slot.stateId), slot.data));
      const refresh = (snapshot = graphic.getPlayoutSnapshot?.(), selectionOnly = false) => {
        const lane = snapshot?.slots?.[slotId];
        const visible = lane?.incoming ?? lane?.current ?? lane?.outgoing;
        const pendingName = lane?.pending?.stateId && stateName(lane.pending.stateId);
        const leaving = Boolean(lane?.transition && !lane.incoming);
        const statusText = lane?.error
          ? 'Error'
          : pendingName
            ? `Preparing · ${pendingName}`
            : lane?.transition
              ? `${leaving ? 'Leaving' : 'Changing'}${visible?.stateId ? ` · ${stateName(visible.stateId)}` : ''}`
              : visible?.stateId
                ? `On · ${stateName(visible.stateId)}`
                : 'Off';
        if (laneStatus.textContent !== statusText) laneStatus.textContent = statusText;
        const statusState = lane?.error
          ? 'error'
          : lane?.transition
            ? 'transition'
            : visible
              ? 'on'
              : 'off';
        if (laneStatus.dataset.state !== statusState) laneStatus.dataset.state = statusState;
        laneStatus.title = lane?.error || statusText;
        takeButton.disabled = !select.value;
        outButton.disabled = !visible && !lane?.pending;
        const active = selectionFor(snapshot);
        const selectedId = select.value;
        if (active?.stateId) {
          const data = publicValue(stateSchema(active.stateId), active.data || {});
          observed.set(active.stateId, data);
          const pending = drafts.get(active.stateId);
          if (pending) {
            for (const key of Object.keys(pending))
              if (JSON.stringify(pending[key]) === JSON.stringify(data[key])) delete pending[key];
            if (!Object.keys(pending).length) {
              drafts.delete(active.stateId);
              attempted.delete(active.stateId);
            }
          }
          const remaining = drafts.get(active.stateId);
          const pendingSignature = remaining && JSON.stringify(remaining);
          if (
            remaining &&
            !selectionOnly &&
            !lane?.transition &&
            !lane?.pending &&
            !playoutMutations &&
            attempted.get(active.stateId) !== pendingSignature
          ) {
            attempted.set(active.stateId, pendingSignature);
            run(`Update ${laneName}`, () => updateLane(active.stateId, clone(remaining)));
          }
        }
        const signature = JSON.stringify([
          active?.stateId,
          active?.stateId && observed.get(active.stateId),
          selectedId,
          [...drafts],
        ]);
        if (lastSignature === signature) return;
        const selectionChanged = selectedId !== renderedSelection;
        // Replacing focused inputs interrupts color pickers and text editing.
        // A deliberate template selection must still replace the old template's form.
        if (!selectionChanged && section.contains(document.activeElement)) return;
        lastSignature = signature;
        renderedSelection = selectedId;
        for (const detail of section.querySelectorAll('details[data-form-key]'))
          expanded.set(detail.dataset.stateId, detail.open);
        section.replaceChildren();
        const makeForm = (stateId, onAir) => {
          const formSchema = stateSchema(stateId);
          const fields = formSchema.properties || {};
          if (!Object.keys(fields).length) return;
          const base = clone(observed.get(stateId) ?? formSchema.default ?? {});
          const values = defaults(formSchema, base, true) || {};
          Object.assign(values, clone(drafts.get(stateId) || {}));
          const detail = document.createElement('details');
          detail.className = 'preview-slot-data';
          const formKey = `${onAir ? 'on-air' : 'next'}:${stateId}`;
          detail.dataset.formKey = formKey;
          detail.dataset.stateId = stateId;
          detail.open = selectionChanged || !expanded.has(stateId) ? true : expanded.get(stateId);
          const summary = document.createElement('summary');
          summary.textContent = `Data · ${stateName(stateId)} `;
          const dataStatus = document.createElement('small');
          dataStatus.textContent = onAir ? 'On air' : 'Next';
          summary.appendChild(dataStatus);
          detail.appendChild(summary);
          fieldRows(detail, fields, values, (path, value) => {
            const patch = patchFor(path, value, values);
            staged(stateId, patch);
            if (!onAir) {
              say(`${laneName} data staged for the next Take.`);
              return;
            }
            attempted.set(stateId, JSON.stringify(drafts.get(stateId)));
            run(`Update ${laneName}`, () => updateLane(stateId, patch));
          });
          section.appendChild(detail);
        };
        if (selectedId) makeForm(selectedId, selectedId === active?.stateId);
      };
      laneForms.set(slotId, { select, drafts, refresh });
      section.addEventListener('focusout', () => setTimeout(() => refresh(), 0));
      select.addEventListener('change', () => refresh(undefined, true));
      row.appendChild(select);
      const takeButton = button('Take', () =>
        run(`Take ${schema.title || slotId}`, () =>
          call('customAction', {
            id: 'transition.take',
            payload: {
              slotId,
              stateId: select.value,
              ...(drafts.has(select.value) ? { data: clone(drafts.get(select.value)) } : {}),
            },
          }),
        ),
      );
      takeButton.setAttribute('aria-label', `Take ${laneName}`);
      takeButton.title = 'Show this graphic in the preview using its transition.';
      row.appendChild(takeButton);
      const outButton = button('Out', () =>
        run(`Out ${schema.title || slotId}`, () =>
          call('customAction', { id: 'transition.out', payload: { slotId } }),
        ),
      );
      outButton.setAttribute('aria-label', `Out ${laneName}`);
      outButton.title = 'Animate this output group out of the preview.';
      row.appendChild(outButton);
      laneGroup.appendChild(laneHeading);
      laneGroup.appendChild(row);
      laneGroup.appendChild(section);
      group.appendChild(laneGroup);
      graphic.subscribePlayout?.(refresh);
      refresh();
    }
    if ((manifest.customActions || []).some((action) => action.id === 'transition.clear'))
      group.appendChild(
        button('Clear all', () =>
          run('Clear all', () => call('customAction', { id: 'transition.clear', payload: {} })),
        ),
      );
  }
  function showActions() {
    const supported = (manifest.customActions || []).filter(
      (action) =>
        !['transition.take', 'transition.out', 'transition.clear', 'transition.patch'].includes(
          action.id,
        ),
    );
    if (!supported.length) return;
    const group = heading(actionsPanel, 'Custom actions');
    for (const action of supported) {
      const detail = document.createElement('details');
      detail.className = 'preview-custom-action';
      const summary = document.createElement('summary');
      summary.textContent = action.name || action.id;
      detail.appendChild(summary);
      const values = defaults(action.schema) || {};
      const fields = document.createElement('div');
      detail.appendChild(fields);
      let renderedFieldsSignature;
      const refreshFields = () => {
        const properties = { ...action.schema?.properties };
        for (const condition of action.schema?.allOf || []) {
          const required = condition.if?.required || [];
          const matches =
            required.every((key) => Object.prototype.hasOwnProperty.call(values, key)) &&
            Object.entries(condition.if?.properties || {}).every(
              ([key, test]) =>
                (test.const === undefined || values[key] === test.const) &&
                (!Array.isArray(test.enum) || test.enum.includes(values[key])),
            );
          const branch = matches ? condition.then : condition.else;
          for (const [key, patch] of Object.entries(branch?.properties || {}))
            properties[key] = { ...properties[key], ...patch };
        }
        for (const [key, schema] of Object.entries(properties)) {
          if (
            Array.isArray(schema.enum) &&
            schema.enum.length &&
            !schema.enum.includes(values[key])
          ) {
            const fallback = schema.enum.includes(schema.default) ? schema.default : schema.enum[0];
            Object.defineProperty(values, key, {
              value: fallback,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          }
        }
        const signature = JSON.stringify(properties);
        // Ordinary input edits change values, not their controls. Keep the same DOM nodes,
        // selection/caret and even invalid structured drafts until a schema actually changes.
        if (signature === renderedFieldsSignature) return;
        const focused = fields.contains(document.activeElement) ? document.activeElement : null;
        // Dropdown/Boolean discriminators commit immediately. Text, number and JSON editors
        // may be mid-draft; defer a conditional form change until they have left the field.
        if (
          focused &&
          focused.tagName !== 'SELECT' &&
          !['checkbox', 'radio'].includes(focused.type)
        )
          return;
        renderedFieldsSignature = signature;
        fields.replaceChildren();
        fieldRows(fields, properties, values, refreshFields);
      };
      fields.addEventListener('focusout', () => setTimeout(refreshFields, 0));
      refreshFields();
      detail.appendChild(
        button('Run', () =>
          run(action.name || action.id, () =>
            call('customAction', { id: action.id, payload: values }),
          ),
        ),
      );
      group.appendChild(detail);
    }
  }
  async function stageOfflineLaneDraftsForPlay() {
    const slots = offlineStagedLaneData(
      laneForms,
      graphic.getPlayoutSnapshot?.(),
      playoutMutations > 0,
    );
    if (Object.keys(slots).length)
      check(await call('updateAction', { data: { slots: clone(slots) } }));
  }
  async function cleanup() {
    if (disposed) return;
    disposed = true;
    fpsMonitor?.dispose();
    fpsMonitor = undefined;
    fpsToggle.removeEventListener('change', refreshFpsVisibility);
    releaseControlsInteraction();
    releaseFrameCueLog?.();
    view.dispose();
    nodosBinding?.dispose();
    try {
      await scheduler?.stop();
      await graphic?.dispose({});
    } catch {
      /* Closing the page is best effort. */
    }
    if (moduleUrl) delete globalThis.__ografPackageResourceUrls?.[moduleUrl];
    for (const url of objectUrls) URL.revokeObjectURL(url);
  }
  window.addEventListener(
    'pagehide',
    () => {
      void cleanup();
    },
    { once: true },
  );
  try {
    if (!manifest.supportsRealTime && !manifest.supportsNonRealTime)
      throw new Error('This package does not support an available preview mode.');
    const requirement = manifest.renderRequirements?.[0] || {};
    const width = constraint(requirement.resolution?.width, 1920);
    const height = constraint(requirement.resolution?.height, 1080);
    const frameRate = constraint(requirement.frameRate, 25);
    const urls = Object.create(null);
    for (const resource of resources)
      urls[resource.path] = blob(
        resource.base64 ? decodeBase64(resource.data) : resource.data,
        mime(resource),
      );
    const initialData = defaults(manifest.schema) ?? {};
    const renderType = manifest.supportsRealTime ? 'realtime' : 'non-realtime';
    if (nodosHost && renderType !== 'realtime')
      throw new Error('Nodos input playback requires a Real-time or Dual export profile.');
    nodosBinding = createNodosInputBinding(payload.nodos, initialData, (error) => {
      console.error('Nodos graphic:', error);
      say(error.message || String(error), true);
    });
    moduleUrl = blob(payload.mainJs, 'text/javascript');
    (globalThis.__ografPackageResourceUrls ??= Object.create(null))[moduleUrl] = urls;
    const module = await import(moduleUrl);
    if (typeof module.default !== 'function' || !(module.default.prototype instanceof HTMLElement))
      throw new Error('The graphic module is not an OGraf web component.');
    const tag = `ograf-offline-${Math.random().toString(36).slice(2)}`;
    customElements.define(tag, class extends module.default {});
    graphic = document.createElement(tag);
    releaseFrameCueLog = installFrameCueLog(graphic);
    stage.appendChild(graphic);
    view.setDimensions(width, height);
    const load = async () =>
      check(
        await graphic.load({
          data: initialData,
          renderType,
          renderCharacteristics: { resolution: { width, height }, frameRate },
        }),
      );
    if (nodosBinding) {
      view.showControls(false);
      const started = await nodosBinding.start(graphic, load, async () =>
        check(await graphic.playAction({ delta: 1 })),
      );
      if (!started) return;
    } else await load();
    if (renderType === 'non-realtime') {
      if (
        typeof graphic.setActionsSchedule !== 'function' ||
        typeof graphic.goToTime !== 'function'
      )
        throw new Error('Non-real-time preview is unavailable for this graphic.');
      scheduler = createOfflinePreviewScheduler(
        graphic,
        frameRate,
        check,
        (error) => say(error.message || String(error), true),
        () => fpsMonitor?.recordRender(),
      );
      playButton.textContent = 'Play / Next ▶';
    }
    playButton.disabled = outButton.disabled = false;
    backButton.disabled = !scheduler;
    refreshStepStatus();
    refreshFpsVisibility();
    playButton.addEventListener('click', () =>
      run(
        'Play',
        async () => {
          await stageOfflineLaneDraftsForPlay();
          return call('playAction', { delta: 1 });
        },
        'play',
      ),
    );
    backButton.addEventListener('click', () =>
      run('Back', () => call('playAction', { delta: -1 }), 'play'),
    );
    outButton.addEventListener('click', () => run('Take Out', () => call('stopAction', {}), 'out'));
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        playButton.click();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        backButton.click();
      }
    });
    if (coordinatedSet) showLanes(manifest.schema.properties.slots, initialData);
    else showData(manifest.schema, initialData);
    showActions();
    say(renderType === 'realtime' ? 'Ready.' : 'Ready · rendered preview.');
  } catch (error) {
    if (nodosHost) console.error('Nodos graphic:', error);
    say(error.message || String(error), true);
  }
})();
