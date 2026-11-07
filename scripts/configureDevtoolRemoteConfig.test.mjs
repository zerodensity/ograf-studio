import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import {
  patchDevtoolWorkerConfig,
  patchDevtoolPageConfig,
} from './configureDevtoolRemoteConfig.mjs';
import {
  installRemoteClientConfigResponder,
  requestRemoteClientConfig,
} from './integrations/ograf-devtool/remoteClientConfig.js';

// The upstream routing statements touched by the integration, with an ordinary
// fetch stand-in. The actual upstream checkout is also guarded before mutation.
const workerSource = `const SW_VERSION = '__BUILD_VERSION__' // Generated at build time
let remoteBaseUrl = null
const extraAllowedOrigins = new Set()
const broadcastToParent = { postMessage: message => notices.push(message) }
const joinRemoteUrl = (base, relative) => base.replace(/\\/+$/, '') + relative
const fetchAndFixup = async (url, init) => { fetched.push({ url, init }); return new Response('module', {status:200}) }
self.addEventListener('fetch', function (event) {
 const url = event.request.url
 let newUrl = url
 {
  const m = url.match(/(REMOTE)(\\/.*)/i)
  if (m) {
\t\t\tif (!remoteBaseUrl) {
\t\t\t\tevent.respondWith(new Response(null, { status: 500, statusText: 'No remote base url has been set' }))
\t\t\t\treturn
\t\t\t}
\t\t\tconst targetUrl = joinRemoteUrl(remoteBaseUrl, decodeURIComponent(m[2]))
\t\t\tevent.respondWith(
\t\t\t\tfetchAndFixup(targetUrl, {
\t\t\t\t\tcache: 'no-store',
\t\t\t\t\tmethod: event.request.method,
\t\t\t\t\theaders: event.request.headers,
\t\t\t\t})
\t\t\t)
   return
  }
 }
 {
  event.respondWith(fetchAndFixup(newUrl, {}))
\t\tconst allowedOrigins = [
   self.location.origin,
   'https://json-schema.org',
\t\t\t...extraAllowedOrigins,
  ]
  let ok = allowedOrigins.some(origin => url.startsWith(origin))
  if (!ok) {
\t\t\tbroadcastToParent.postMessage({
\t\t\t\ttype: 'fetch-from-outside',
\t\t\t\turl: newUrl,
\t\t\t})
\t\t}
\t}
})`;

const pageSource = `import { SW_VERSION } from './lib/sw-version.js'
class ServiceWorkerHandler {
 constructor() {
\t\tthis.previousMessageReplyId = -1
  this.broadcastToSW = {postMessage() {}}
 }
\taddAllowedOrigin(origin) {
  this.broadcastToSW.postMessage({ type: 'add-allowed-origin', origin })
 }
\tsetRemoteBaseUrl(baseUrl) {
  this.broadcastToSW.postMessage({ type: 'set-remote-base-url', baseUrl })
 }
}
this.Handler = ServiceWorkerHandler`;

function pageConfiguration(baseUrl, allowedOrigins = []) {
  let listener;
  const serviceWorker = {
    addEventListener: (type, fn) => {
      assert.equal(type, 'message');
      listener = fn;
    },
  };
  const state = { baseUrl, allowedOrigins };
  installRemoteClientConfigResponder(serviceWorker, () => state);
  return {
    state,
    postMessage: (data, ports) => listener({ data, ports }),
  };
}

function workerRuntime(source, pages = {}) {
  let fetchListener;
  const context = {
    fetched: [],
    notices: [],
    Response,
    URL,
    requestRemoteClientConfig: (clients, id) =>
      requestRemoteClientConfig(clients, id, {
        createMessageChannel: () => new MessageChannel(),
        timeoutMs: 50,
      }),
    self: {
      clients: { get: async (id) => pages[id] },
      location: { origin: 'http://localhost:3100' },
      addEventListener: (type, listener) => {
        assert.equal(type, 'fetch');
        fetchListener = listener;
      },
    },
  };
  runInNewContext(
    source.replace(/^import .*\n/gm, '') +
      '\nthis.setLegacyConfiguration = (base, origin) => { remoteBaseUrl = base; extraAllowedOrigins.add(origin) }',
    context,
  );
  return {
    ...context,
    async fetch(url, clientId = 'client-a') {
      let result;
      const background = [];
      fetchListener({
        request: { url, method: 'GET', headers: {} },
        clientId,
        respondWith: (response) => {
          result = response;
        },
        waitUntil: (promise) => background.push(promise),
      });
      const response = await result;
      await Promise.all(background);
      return response;
    },
  };
}

test('restart reproduces upstream failure and patched worker imports later instances', async () => {
  const pages = {
    'client-a': pageConfiguration('http://127.0.0.1:3111/', ['http://127.0.0.1:3111']),
  };
  const url = 'http://localhost:3100/REMOTE/main.js?componentId=graphic-component3';
  assert.equal((await workerRuntime(workerSource, pages).fetch(url)).status, 500);
  const patched = patchDevtoolWorkerConfig(workerSource);
  for (let restart = 0; restart < 3; restart++) {
    // A fresh worker has no global remoteBaseUrl. The requesting page survives.
    const worker = workerRuntime(patched, pages);
    assert.equal((await worker.fetch(url)).status, 200);
    assert.equal(
      worker.fetched[0].url,
      'http://127.0.0.1:3111/main.js?componentId=graphic-component3',
    );
    assert.equal(worker.fetched[0].init.cache, 'no-store');
  }
});

test('two controlled pages resolve their own sources and closing a source rejects it', async () => {
  const first = pageConfiguration('http://127.0.0.1:3111/');
  const second = pageConfiguration('http://127.0.0.1:3112/');
  const worker = workerRuntime(patchDevtoolWorkerConfig(workerSource), {
    'client-a': first,
    'client-b': second,
  });
  const url = 'http://localhost:3100/REMOTE/main.js?componentId=graphic-component4';
  await worker.fetch(url, 'client-a');
  await worker.fetch(url, 'client-b');
  assert.deepEqual(
    worker.fetched.map((request) => request.url),
    [
      'http://127.0.0.1:3111/main.js?componentId=graphic-component4',
      'http://127.0.0.1:3112/main.js?componentId=graphic-component4',
    ],
  );
  first.state.baseUrl = null;
  assert.equal((await worker.fetch(url, 'client-a')).status, 500);
});

test('allowed package origin survives worker restart without suppressing unrelated resource warnings', async () => {
  const pages = {
    'client-a': pageConfiguration('http://127.0.0.1:3111/', ['http://127.0.0.1:3111']),
  };
  const worker = workerRuntime(patchDevtoolWorkerConfig(workerSource), pages);
  await worker.fetch('http://127.0.0.1:3111/shared/font.ttf');
  assert.equal(worker.notices.length, 0);
  await worker.fetch('https://unrelated.test/resource');
  assert.equal(worker.notices.length, 1);
  assert.equal(worker.notices[0].url, 'https://unrelated.test/resource');
});

test('unavailable controlled page does not inherit a different page source or permissions', async () => {
  const worker = workerRuntime(patchDevtoolWorkerConfig(workerSource));
  worker.setLegacyConfiguration('http://127.0.0.1:3112/', 'http://127.0.0.1:3112');
  assert.equal(
    (
      await worker.fetch(
        'http://localhost:3100/REMOTE/main.js?componentId=graphic-component5',
        'closed-page',
      )
    ).status,
    500,
  );
  assert.equal(worker.fetched.length, 0);
  await worker.fetch('http://127.0.0.1:3112/font.ttf', 'closed-page');
  assert.equal(worker.notices.length, 1);
  assert.equal(worker.notices[0].url, 'http://127.0.0.1:3112/font.ttf');
});

test('page responder retains current configuration and source clearing', async () => {
  let listener;
  const navigator = {
    serviceWorker: {
      addEventListener: (type, fn) => {
        listener = fn;
      },
    },
  };
  const context = { navigator, installRemoteClientConfigResponder };
  runInNewContext(patchDevtoolPageConfig(pageSource).replace(/^import .*\n/gm, ''), context);
  const handler = new context.Handler();
  handler.addAllowedOrigin('http://127.0.0.1:3111');
  handler.setRemoteBaseUrl('http://127.0.0.1:3111/');
  const clients = {
    get: async () => ({ postMessage: (data, ports) => listener({ data, ports }) }),
  };
  const options = { createMessageChannel: () => new MessageChannel(), timeoutMs: 50 };
  assert.deepEqual(await requestRemoteClientConfig(clients, 'client-a', options), {
    baseUrl: 'http://127.0.0.1:3111/',
    allowedOrigins: ['http://127.0.0.1:3111'],
  });
  handler.setRemoteBaseUrl(null);
  assert.equal((await requestRemoteClientConfig(clients, 'client-a', options)).baseUrl, null);
});

test('missing, unresponsive or malformed clients do not leave pending requests', async () => {
  installRemoteClientConfigResponder(undefined, () => null);
  assert.equal(
    await requestRemoteClientConfig(
      {
        get: async () => {
          throw new Error('client closed');
        },
      },
      'closed',
    ),
    null,
  );
  assert.equal(await requestRemoteClientConfig({ get: async () => null }, 'missing'), null);
  assert.equal(
    await requestRemoteClientConfig(
      {
        get: async () => {
          throw new Error('unused');
        },
      },
      '',
    ),
    null,
  );
  const options = { createMessageChannel: () => new MessageChannel(), timeoutMs: 5 };
  assert.equal(
    await requestRemoteClientConfig({ get: async () => ({ postMessage() {} }) }, 'idle', options),
    null,
  );
  const bad = {
    postMessage: (_data, ports) => {
      ports[0].postMessage({ baseUrl: 42 });
      ports[0].close();
    },
  };
  assert.equal(await requestRemoteClientConfig({ get: async () => bad }, 'bad', options), null);
});

test('integrations preserve newline format, are repeatable, and reject upstream drift', () => {
  for (const [patch, source] of [
    [patchDevtoolWorkerConfig, workerSource],
    [patchDevtoolPageConfig, pageSource],
  ]) {
    const updated = patch(source);
    assert.equal(patch(updated), updated);
    assert.ok(patch(source.replaceAll('\n', '\r\n')).includes('\r\n'));
    assert.throws(() => patch(source.replace('SW_VERSION', 'OTHER_VERSION')));
    assert.throws(() => patch(updated.replace('allowedOrigins', 'otherAllowedOrigins')));
  }
});
