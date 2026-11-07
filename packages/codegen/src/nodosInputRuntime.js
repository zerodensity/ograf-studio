/** Connect a page's declared inputs to an existing ElectroNode; ordinary browsers need no host. */
// Called by exported pages after these sources are bundled together.
// eslint-disable-next-line no-unused-vars
function createNodosInputBinding(contract, initialData, report) {
  if (!window.nodos || !contract) return null;
  if (contract.error) throw new Error(contract.error);
  const { inputs, wrapped, exposure, liveMediaElementTag } = contract;
  const textureInputs = inputs
    .filter((input) => input.type === 'nos.sys.vulkan.Texture')
    .map((input) => input.name);
  const targets = new Map(
    textureInputs.map((name) => {
      const target = document.createElement('nodos-input');
      target.setAttribute('name', name);
      target.setAttribute('type', 'texture');
      target.hidden = true;
      document.body.appendChild(target);
      return [name, target];
    }),
  );
  if (textureInputs.length && !customElements.get(liveMediaElementTag)) {
    customElements.define(
      liveMediaElementTag,
      class extends HTMLElement {
        getFrame() {
          return targets.get(this.dataset.sourceTag)?.shadowRoot?.querySelector('canvas') ?? null;
        }
      },
    );
  }
  const applied = new Map(
    Object.entries(initialData).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  function unwrap(shape, value) {
    if (!shape || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (shape.wrapped && (!item || !Object.hasOwn(item, 'items') || !Array.isArray(item.items)))
          throw new Error('A nested Nodos array must contain an items array.');
        return unwrap(shape.items, shape.wrapped ? item.items : item);
      });
    }
    if (!shape.properties) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        unwrap(Object.hasOwn(shape.properties, key) ? shape.properties[key] : null, item),
      ]),
    );
  }
  function publicValue(shape, value) {
    if (shape === false) return undefined;
    if (shape?.integer) {
      const number = typeof value === 'bigint' ? Number(value) : value;
      if (!Number.isSafeInteger(number))
        throw new Error('Nodos integer values must fit the safe JSON integer range.');
      return number;
    }
    if (!shape || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      if (shape.items === false) return undefined;
      return value.map((item) => publicValue(shape.items, item));
    }
    if (!shape.properties) return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const projected = publicValue(
          Object.hasOwn(shape.properties, key) ? shape.properties[key] : undefined,
          item,
        );
        return projected === undefined ? [] : [[key, projected]];
      }),
    );
  }
  // SDK/native values are data, not JSON text. Snapshot them before asynchronous updates;
  // a host may reuse its callback objects when later pin values arrive.
  function cloneValue(value, seen = new Set()) {
    if (typeof value === 'bigint') {
      const number = Number(value);
      if (!Number.isSafeInteger(number))
        throw new Error('Nodos 64-bit integer exceeds the safe JSON integer range.');
      return number;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value))
      throw new Error('Nodos values must be finite JSON data without cycles.');
    seen.add(value);
    const copy = Array.isArray(value)
      ? value.map((item) => cloneValue(item, seen))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, cloneValue(item, seen)]),
        );
    seen.delete(value);
    return copy;
  }
  function snapshotData(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    const data = {};
    for (const [key, pinValue] of Object.entries(values)) {
      if (!applied.has(key)) continue;
      const value = publicValue(exposure[key], unwrap(wrapped[key], pinValue));
      if (value !== undefined) data[key] = cloneValue(value);
    }
    return data;
  }
  async function update(values) {
    const data = {},
      fingerprints = new Map();
    for (const [key, value] of Object.entries(values)) {
      const fingerprint = JSON.stringify(value);
      if (applied.get(key) === fingerprint) continue;
      data[key] = value;
      fingerprints.set(key, fingerprint);
    }
    if (!fingerprints.size) return;
    const result = await graphic.updateAction({ data });
    if (result && result.statusCode >= 400)
      throw new Error('Nodos data update failed: ' + (result.statusMessage || result.statusCode));
    for (const [key, fingerprint] of fingerprints) applied.set(key, fingerprint);
  }
  let graphic;
  let loaded = false,
    failed = false,
    disposed = false;
  let pending = {};
  let queue = Promise.resolve();
  const unsubscribe = window.nodos.onData((values) => {
    if (failed || disposed) return;
    try {
      const data = snapshotData(values);
      if (!Object.keys(data).length) return;
      if (loaded) {
        queue = queue.then(() => (failed || disposed ? undefined : update(data))).catch(report);
        return queue;
      }
      Object.assign(pending, data);
    } catch (error) {
      report(error);
    }
  });
  return {
    start(target, load, play) {
      graphic = target;
      queue = (async () => {
        await load();
        if (disposed) return false;
        loaded = true;
        await update(pending);
        pending = {};
        if (disposed) return false;
        await play?.();
        return true;
      })().catch((error) => {
        failed = true;
        report(error);
        return false;
      });
      return queue;
    },
    dispose() {
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      for (const target of targets.values()) target.remove();
      targets.clear();
    },
  };
}
