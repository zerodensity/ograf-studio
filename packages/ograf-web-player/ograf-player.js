/**
 * A small, dependency-free host for trusted OGraf graphics served over HTTP(S).
 * The package's manifest, module and resources must remain at their published URLs.
 * This executes the graphic's JavaScript in the page; it is not a sandbox.
 */

const registeredClasses = new WeakMap();
let nextElementId = 0;

function cloneDefault(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function mergeSchemaDefaults(schema, existing, present) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    return present ? existing : undefined;
  if (!present && Object.prototype.hasOwnProperty.call(schema, 'default')) {
    existing = cloneDefault(schema.default);
    present = true;
  }
  if (
    !schema.properties ||
    typeof schema.properties !== 'object' ||
    Array.isArray(schema.properties)
  )
    return present ? existing : undefined;
  if (present && (!existing || typeof existing !== 'object' || Array.isArray(existing)))
    return existing;
  const result = present ? existing : {};
  for (const [key, property] of Object.entries(schema.properties)) {
    const hadValue = Object.prototype.hasOwnProperty.call(result, key);
    const value = mergeSchemaDefaults(property, hadValue ? result[key] : undefined, hadValue);
    if (value !== undefined) {
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}

/** Return explicit JSON Schema defaults, including nested object properties. */
export function dataFromSchemaDefaults(schema) {
  return mergeSchemaDefaults(schema, undefined, false);
}

function checkedUrl(value, base, allowCrossOrigin, pageOrigin) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('OGraf package URLs must use HTTP or HTTPS without embedded credentials.');
  if (!allowCrossOrigin && url.origin !== pageOrigin)
    throw new Error('Cross-origin OGraf packages require allowCrossOrigin: true and CORS access.');
  return url;
}

function constraintValue(constraint, fallback) {
  if (typeof constraint === 'number' && Number.isFinite(constraint) && constraint > 0)
    return constraint;
  if (constraint && typeof constraint === 'object') {
    for (const value of [constraint.exact, constraint.ideal])
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    let result = fallback;
    if (typeof constraint.min === 'number' && Number.isFinite(constraint.min))
      result = Math.max(result, constraint.min);
    if (typeof constraint.max === 'number' && Number.isFinite(constraint.max))
      result = Math.min(result, constraint.max);
    if (result > 0) return result;
  }
  return fallback;
}

function characteristicsFor(manifest, supplied) {
  const requirement = Array.isArray(manifest.renderRequirements)
    ? manifest.renderRequirements[0]
    : undefined;
  const width =
    supplied?.resolution?.width ?? constraintValue(requirement?.resolution?.width, 1920);
  const height =
    supplied?.resolution?.height ?? constraintValue(requirement?.resolution?.height, 1080);
  const frameRate = supplied?.frameRate ?? constraintValue(requirement?.frameRate, 25);
  if (
    ![width, height, frameRate].every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('OGraf player resolution and frame rate must be positive finite numbers.');
  return { ...supplied, resolution: { width, height }, frameRate };
}

function tagFor(GraphicClass) {
  let tag = registeredClasses.get(GraphicClass);
  if (tag) return tag;
  do tag = `ograf-web-player-${++nextElementId}`;
  while (customElements.get(tag));
  // A subclass can be registered even if another host already registered the
  // exported constructor, and lets repeated mounts reuse a single registry entry.
  customElements.define(tag, class extends GraphicClass {});
  registeredClasses.set(GraphicClass, tag);
  return tag;
}

function checkResult(action, result) {
  if (result && typeof result.statusCode === 'number' && result.statusCode >= 400) {
    const error = new Error(
      `${action} failed (${result.statusCode})${result.statusMessage ? `: ${result.statusMessage}` : ''}`,
    );
    error.statusCode = result.statusCode;
    error.result = result;
    throw error;
  }
  return result;
}

/**
 * Mount one real-time OGraf graphic and resolve when its load() is ready.
 *
 * Options: { container, manifestUrl, data?, renderCharacteristics?, fit?,
 *            allowCrossOrigin?, signal?, onEvent? }.
 * `onEvent` receives {type, result?} or {type:'error', action, error}.
 * An AbortSignal cancels manifest fetch; during import/load, abortion is
 * observed after the operation settles, followed by disposal and cleanup.
 */
export async function mountOGrafGraphic(options) {
  const { container, manifestUrl, data, renderCharacteristics, signal, onEvent } = options ?? {};
  const fit = options?.fit !== false;
  const allowCrossOrigin = options?.allowCrossOrigin === true;
  const containerDocument = container?.ownerDocument;
  const owner = containerDocument === document ? globalThis.window : containerDocument?.defaultView;
  const ContainerElement = containerDocument === document ? HTMLElement : owner?.HTMLElement;
  if (!ContainerElement || !(container instanceof ContainerElement))
    throw new Error('container must be an HTML element in a browser document.');
  if (typeof manifestUrl !== 'string' || !manifestUrl.trim())
    throw new Error('Provide the URL of a hosted .ograf.json manifest.');
  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch {
      /* Host callbacks must not interrupt the graphic. */
    }
  };
  const pageOrigin = new URL(document.URL).origin;
  const manifestLocation = checkedUrl(manifestUrl, document.baseURI, allowCrossOrigin, pageOrigin);
  let viewport;
  let graphic;
  let observer;
  let resizeListener;
  let loaded = false;
  try {
    const response = await fetch(manifestLocation.href, { signal });
    if (!response.ok) throw new Error(`Could not load OGraf manifest (HTTP ${response.status}).`);
    const actualManifestUrl = checkedUrl(
      response.url || manifestLocation.href,
      manifestLocation,
      allowCrossOrigin,
      pageOrigin,
    );
    const manifest = await response.json();
    if (
      !manifest ||
      typeof manifest !== 'object' ||
      typeof manifest.main !== 'string' ||
      !manifest.main.trim()
    )
      throw new Error('OGraf manifest must contain a main module path.');
    if (manifest.supportsRealTime !== true)
      throw new Error('This graphic does not support real-time playback.');
    const mainUrl = checkedUrl(manifest.main, actualManifestUrl, allowCrossOrigin, pageOrigin);
    const characteristics = characteristicsFor(manifest, renderCharacteristics);
    const module = await import(/* @vite-ignore */ mainUrl.href);
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (typeof module.default !== 'function' || !(module.default.prototype instanceof HTMLElement))
      throw new Error('OGraf main module must default-export an HTMLElement class.');
    graphic = document.createElement(tagFor(module.default));
    for (const method of [
      'load',
      'playAction',
      'stopAction',
      'updateAction',
      'customAction',
      'dispose',
    ])
      if (typeof graphic[method] !== 'function')
        throw new Error(`OGraf graphic is missing ${method}().`);

    const { width, height } = characteristics.resolution;
    viewport = document.createElement('div');
    viewport.className = 'ograf-web-player-viewport';
    Object.assign(viewport.style, {
      position: 'relative',
      overflow: 'hidden',
      width: fit ? '100%' : `${width}px`,
      aspectRatio: `${width} / ${height}`,
    });
    const stage = document.createElement('div');
    stage.className = 'ograf-web-player-stage';
    Object.assign(stage.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: `${width}px`,
      height: `${height}px`,
      transformOrigin: 'top left',
    });
    stage.appendChild(graphic);
    viewport.appendChild(stage);
    container.appendChild(viewport);
    const resize = () => {
      const actualWidth = viewport.getBoundingClientRect().width;
      stage.style.transform = fit && actualWidth ? `scale(${actualWidth / width})` : '';
    };
    if (fit && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(viewport);
    } else if (fit) {
      resizeListener = resize;
      owner?.addEventListener('resize', resizeListener);
    }
    resize();
    const defaults = dataFromSchemaDefaults(manifest.schema);
    const initialData = data === undefined ? (defaults === undefined ? {} : defaults) : data;
    const result = checkResult(
      'load',
      await graphic.load({
        data: initialData,
        renderType: 'realtime',
        renderCharacteristics: characteristics,
      }),
    );
    loaded = true;
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    emit({ type: 'ready', result });

    let closing = false;
    let disposal;
    const inFlight = new Set();
    const invoke = (name, method, params) => {
      if (closing) return Promise.reject(new Error('OGraf player has been disposed.'));
      // OGraf graphics handle overlapping actions. Do not queue Stop or Update
      // behind an in-progress transition; deliver calls as they arrive.
      const task = Promise.resolve().then(async () => {
        try {
          const value = checkResult(method, await graphic[method](params));
          emit({ type: name, result: value });
          return value;
        } catch (error) {
          emit({ type: 'error', action: name, error });
          throw error;
        }
      });
      inFlight.add(task);
      task.then(
        () => inFlight.delete(task),
        () => inFlight.delete(task),
      );
      return task;
    };
    return {
      manifest,
      element: graphic,
      renderCharacteristics: characteristics,
      play: (params = { delta: 1 }) => invoke('play', 'playAction', params),
      next: () => invoke('play', 'playAction', { delta: 1 }),
      stop: (params = {}) => invoke('stop', 'stopAction', params),
      update: (nextData, options = {}) =>
        invoke('update', 'updateAction', { ...options, data: nextData }),
      action: (id, payload = {}, options = {}) =>
        invoke('action', 'customAction', { ...options, id, payload }),
      dispose: () => {
        if (disposal) return disposal;
        closing = true;
        disposal = Promise.allSettled(inFlight).then(async () => {
          try {
            const value = checkResult('dispose', await graphic.dispose({}));
            emit({ type: 'dispose', result: value });
            return value;
          } catch (error) {
            emit({ type: 'error', action: 'dispose', error });
            throw error;
          } finally {
            observer?.disconnect();
            if (resizeListener) owner?.removeEventListener('resize', resizeListener);
            viewport.remove();
          }
        });
        return disposal;
      },
    };
  } catch (error) {
    observer?.disconnect();
    if (resizeListener) owner?.removeEventListener('resize', resizeListener);
    // load may allocate resources before rejecting, so always attempt disposal
    // once the graphic was mounted, even when readiness was never reached.
    if (graphic && typeof graphic.dispose === 'function') {
      try {
        await graphic.dispose({});
      } catch {
        /* Preserve the original error. */
      }
    }
    viewport?.remove();
    emit({ type: 'error', action: loaded ? 'mount' : 'load', error });
    throw error;
  }
}
