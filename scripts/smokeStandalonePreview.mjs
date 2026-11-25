import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Chrome } from './lib/chromeCdp.mjs';

const viewport = { width: 1280, height: 720 };
const fullscreen = '.preview-stage-wrap:is(:fullscreen, [data-preview-overlay])';

async function waitFor(description, read, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function unusedPorts() {
  const editor = await reservePort();
  try {
    const playout = await reservePort();
    try {
      return [editor.address().port, playout.address().port];
    } finally {
      await new Promise((done) => playout.close(done));
    }
  } finally {
    await new Promise((done) => editor.close(done));
  }
}

async function readEndpoint(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return result?.ok ? result.json() : null;
}

async function checkPreview(chrome, origin) {
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => chrome.send(method, params, sessionId);
  const evaluate = async (fn, ...args) => {
    const response = await send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      );
    }
    return response.result.value;
  };

  // Real input retains the user activation needed by the toolbar's fullscreen action.
  async function click(selector, label) {
    const point = await waitFor(label ?? selector, () =>
      evaluate(
        (query, text) => {
          const button = Array.from(document.querySelectorAll(query)).find(
            (element) =>
              !element.disabled &&
              element.getClientRects().length &&
              (!text || element.textContent.trim() === text),
          );
          if (!button) return null;
          button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const { x, y, width, height } = button.getBoundingClientRect();
          const point = { x: x + width / 2, y: y + height / 2 };
          return button.contains(document.elementFromPoint(point.x, point.y)) ? point : null;
        },
        selector,
        label ?? null,
      ),
    );
    await send('Input.dispatchMouseEvent', {
      ...point,
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
      ...point,
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
    });
  }

  async function enterPreview() {
    await click('button[title^="Open fullscreen preview"]');
    await waitFor('fullscreen Preview', () =>
      evaluate((selector) => Boolean(document.querySelector(selector)), fullscreen),
    );
  }

  async function exitPreview() {
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
    await send('Input.dispatchKeyEvent', { ...escape, type: 'rawKeyDown' });
    await send('Input.dispatchKeyEvent', { ...escape, type: 'keyUp' });
    await waitFor('Preview to exit', () =>
      evaluate((selector) => !document.querySelector(selector), fullscreen),
    );
  }

  async function samplePreview(region) {
    const clip = await evaluate(
      (selector, [left, top, right, bottom]) => {
        const stage = document.querySelector(`${selector} .preview-stage`);
        if (!stage) return null;
        const { x, y, width, height } = stage.getBoundingClientRect();
        if (width < 100 || height < 100) return null;
        return {
          x: Math.round(x + left * width),
          y: Math.round(y + top * height),
          width: Math.max(1, Math.round((right - left) * width)),
          height: Math.max(1, Math.round((bottom - top) * height)),
          scale: 1,
        };
      },
      fullscreen,
      region,
    );
    if (!clip) return null;
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    // Decode Chrome's screenshot to measure the rendered output.
    return evaluate(async (png) => {
      const bytes = Uint8Array.from(atob(png), (byte) => byte.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      image.close();
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let white = 0;
      let ellipse = 0;
      let black = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        if (r > 220 && g > 220 && b > 220) white++;
        if (Math.abs(r - 59) <= 8 && Math.abs(g - 63) <= 8 && Math.abs(b - 74) <= 8) ellipse++;
        if (r < 10 && g < 10 && b < 10) black++;
      }
      return { white, ellipse, black, pixels: data.length / 4 };
    }, data);
  }

  const textRegion = [0.36, 0.42, 0.47, 0.58];
  const center = [0.495, 0.49, 0.505, 0.51];
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const navigated = new Promise((done) => chrome.on('Page.loadEventFired', done));
  const navigation = await send('Page.navigate', { url: origin });
  assert(!navigation.errorText, navigation.errorText);
  await Promise.race([
    navigated,
    delay(15000, false, { ref: false }).then(() => {
      throw new Error('Studio did not finish loading');
    }),
  ]);

  await click('button.project-explorer-primary', 'Create blank project');
  await click('button[aria-label="Add Text"]');
  await enterPreview();
  await waitFor('the newly added text to render in Preview', async () => {
    const sample = await samplePreview(textRegion);
    return sample && sample.white > 12;
  });
  const before = await samplePreview(center);
  assert(
    before && before.black === before.pixels,
    'Expected black at center before adding ellipse',
  );
  console.log('Preview rendered the first edit.');

  // The regression appears after Live has captured the first edit.
  await waitFor('the first Shared Live publication', async () => {
    const state = await readEndpoint(`${origin}/api/shared-playout/state`);
    return state?.publicationId;
  });
  await exitPreview();
  await click('button[aria-label="Add Ellipse"]');
  await enterPreview();
  await waitFor('the second edit to render in Preview without a reload', async () => {
    const sample = await samplePreview(center);
    return sample && sample.ellipse >= sample.pixels * 0.95;
  });
  console.log('Preview rendered the second edit without a reload.');
}

const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/smokeStandalonePreview.mjs <executable>');
const workspace = await mkdtemp(join(tmpdir(), 'ograf-preview-smoke-'));
let server;
let chrome;
try {
  const [port, playoutPort] = await unusedPorts();
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(
    resolve(executable),
    [
      '--port',
      String(port),
      '--playout-port',
      String(playoutPort),
      '--playout-host',
      '127.0.0.1',
      '--workspace',
      workspace,
      '--no-open',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  let spawnError;
  server.on('error', (error) => (spawnError = error));
  await waitFor('the packaged Studio server', async () => {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`Studio exited with status ${server.exitCode}`);
    return (await readEndpoint(`${origin}/health`))?.ok;
  });
  chrome = await Chrome.launch(viewport);
  await checkPreview(chrome, origin);
} finally {
  try {
    await chrome?.close();
  } finally {
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await Promise.race([exited, delay(3000, undefined, { ref: false })]);
    }
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  }
}
