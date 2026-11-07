// A local Devtool host integration. Graphic modules still receive the standard
// OGraf lifecycle, and the Devtool validator/checkers are not involved.
const states = new WeakMap();

function stateFor(layer) {
  let state = states.get(layer);
  if (!state) {
    state = { revision: 0, pendingDisposals: new Set() };
    states.set(layer, state);
  }
  return state;
}

function resetSeek(layer) {
  layer.lastGoToTime = undefined;
  layer.pendingGoToTime = undefined;
  layer.isSeeking = false;
  layer.currentSeekPromise = null;
}

function release(layer, state, graphic) {
  if (!graphic) return Promise.resolve();
  // Detach immediately. A delayed dispose of this instance must never clear a
  // newer instance's DOM or currentGraphic reference.
  if (layer.currentGraphic === graphic) {
    layer.currentGraphic = null;
    layer.customControllers = [];
  }
  graphic.element.remove();
  if (graphic.disposal) return graphic.disposal;
  graphic.disposal = (async () => {
    // dispose after load finishes, including rejected loads. Some graphics create
    // timers and resources at the end of load(), so an earlier dispose can leak.
    try {
      await graphic.loading;
    } catch {
      // The load caller reports its own error.
    }
    try {
      await graphic.element.dispose({});
    } catch (error) {
      console.error('Error disposing GraphicInstance:', error);
    }
  })();
  state.pendingDisposals.add(graphic.disposal);
  void graphic.disposal.finally(() => state.pendingDisposals.delete(graphic.disposal));
  return graphic.disposal;
}

export async function loadLayerGraphic(layer, settings, graphicPath, data, loadModule) {
  const state = stateFor(layer);
  const revision = ++state.revision;
  resetSeek(layer);
  void release(layer, state, layer.currentGraphic);

  let module;
  try {
    module = await loadModule(graphicPath);
  } catch (error) {
    if (revision !== state.revision) return false;
    throw error;
  }
  // Dynamic imports cannot be aborted. A stale import must not instantiate or
  // append a host when it eventually resolves.
  if (revision !== state.revision) return false;
  const element = document.createElement(module.elementName);
  element.setAttribute('drawable', '');
  element.style.display = 'block';
  element.style.width = '100%';
  element.style.height = '100%';
  const graphic = { element, elementName: module.elementName, graphicPath };
  layer.currentGraphic = graphic;
  layer.customControllers = module.customControllers || [];
  layer.shadowRoot.appendChild(element);
  graphic.loading = Promise.resolve().then(() => {
    if (revision !== state.revision) return;
    return element.load({
      renderType: settings.realtime ? 'realtime' : 'non-realtime',
      data,
      renderCharacteristics: {
        resolution: { width: settings.width, height: settings.height },
        _environment: 'OGraf DevTool',
      },
    });
  });
  try {
    await graphic.loading;
  } catch (error) {
    await release(layer, state, graphic);
    if (revision !== state.revision) return false;
    throw error;
  }
  if (revision !== state.revision) {
    await release(layer, state, graphic);
    return false;
  }
  return true;
}

export async function clearLayerGraphic(layer) {
  const state = stateFor(layer);
  ++state.revision;
  resetSeek(layer);
  void release(layer, state, layer.currentGraphic);
  // Capture this clear's instances. A later load is free to proceed and remains
  // owned by its own request, even when an older disposal finishes afterward.
  await Promise.all([...state.pendingDisposals]);
}
