import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const START_TIMEOUT_MS = 45_000;
const COMMAND_TIMEOUT_MS = 30_000;

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const path = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!path) throw new Error('Chrome was not found. Set CHROME_PATH to Chrome or Chromium.');
  return path;
}

async function openSocket(socket) {
  let timeout;
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      const closed = () => reject(new Error('Could not connect to Chrome DevTools.'));
      socket.addEventListener('error', closed, { once: true });
      socket.addEventListener('close', closed, { once: true });
      timeout = setTimeout(() => {
        reject(
          new Error(`Chrome DevTools did not connect within ${START_TIMEOUT_MS / 1000} seconds.`),
        );
      }, START_TIMEOUT_MS);
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function closeProcess(child, exited, profile) {
  const running = () => child?.pid && child.exitCode === null && child.signalCode === null;
  if (running()) {
    await Promise.race([exited, delay(3_000, undefined, { ref: false })]);
    if (running()) {
      child.kill();
      await Promise.race([exited, delay(3_000, undefined, { ref: false })]);
    }
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
}

/** Isolated headless Chrome with a browser-level DevTools Protocol connection. */
export class Chrome {
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();
  #socket;
  #child;
  #exited;
  #profile;
  #closing;

  constructor(socket, child, exited, profile) {
    this.#socket = socket;
    this.#child = child;
    this.#exited = exited;
    this.#profile = profile;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id === undefined) {
        this.#listeners.get(message.method)?.(message.params);
        return;
      }
      const waiting = this.#pending.get(message.id);
      if (!waiting) return;
      this.#pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });
    const disconnected = () => {
      for (const waiting of this.#pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error('Chrome DevTools disconnected.'));
      }
      this.#pending.clear();
    };
    socket.addEventListener('error', disconnected);
    socket.addEventListener('close', disconnected);
  }

  /** @param {{ width: number, height: number }} viewport */
  static async launch({ width, height }) {
    const executable = chromePath();
    const profile = await mkdtemp(join(tmpdir(), 'ograf-preview-chrome-'));
    let child;
    let exited;
    let socket;
    try {
      child = spawn(
        executable,
        [
          '--headless=new',
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--hide-scrollbars',
          '--mute-audio',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--ignore-gpu-blocklist',
          `--window-size=${width},${height}`,
          'about:blank',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
      );
      let spawnError;
      exited = new Promise((resolve) => {
        child.once('exit', resolve);
        child.once('error', (error) => {
          spawnError = error;
          resolve();
        });
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data) => {
        stderr = (stderr + data).slice(-3000);
      });

      const portFile = join(profile, 'DevToolsActivePort');
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`Chrome exited during startup. ${stderr.trim()}`);
        const portInfo = await readFile(portFile, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        });
        const [port, path] = portInfo.trim().split(/\r?\n/u);
        if (/^\d+$/u.test(port) && path?.startsWith('/devtools/browser/')) {
          socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
          await openSocket(socket);
          return new Chrome(socket, child, exited, profile);
        }
        await delay(100);
      }
      throw new Error(
        `Chrome did not start its debugging port within ${START_TIMEOUT_MS / 1000} seconds. ${stderr.trim()}`,
      );
    } catch (error) {
      socket?.close();
      await closeProcess(child, exited, profile).catch(() => undefined);
      throw error;
    }
  }

  /** @param {string} method @param {object} params @param {string} [sessionId] */
  send(method, params = {}, sessionId) {
    if (this.#socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error(`Chrome DevTools is disconnected while sending ${method}.`));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Chrome DevTools command ${method} timed out.`));
      }, COMMAND_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  on(method, listener) {
    this.#listeners.set(method, listener);
  }

  close() {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close() {
    await this.send('Browser.close').catch(() => undefined);
    this.#socket.close();
    await closeProcess(this.#child, this.#exited, this.#profile);
  }
}
