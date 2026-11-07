import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  patchDevtoolRemoteDiscovery,
  patchDevtoolRemoteQuery,
} from './configureDevtoolRemoteRestore.mjs';
import {
  remoteManifestFromGraphicRoute,
  shareableRemoteGraphicUrl,
} from './integrations/ograf-devtool/remoteGraphicLocation.js';

const upstream = JSON.parse(
  await readFile(
    new URL('./integrations/ograf-devtool/remoteRestore.upstream.json', import.meta.url),
    'utf8',
  ),
);
const base = 'http://127.0.0.1:3113/';
const name = 'set-88d9e38e-463a-4c2f-b86f-512b074e3668.ograf.json';
const manifest = base + name;

test('legacy folder deep links recover the current graphic manifest', () => {
  assert.equal(remoteManifestFromGraphicRoute(base, '/graphic/' + name), manifest);
  assert.equal(
    remoteManifestFromGraphicRoute(base + 'package/', '/graphic/nested/Graphic%20one.ograf.json'),
    base + 'package/nested/Graphic%20one.ograf.json',
  );
});

test('recovery never guesses a manifest for absent, malformed, absolute, or traversing routes', () => {
  for (const path of [
    '/',
    '/thumbnails',
    '/graphic/no-manifest.js',
    '/graphic/../escape.ograf.json',
    '/graphic/%2e%2e/escape.ograf.json',
    '/graphic//host/escape.ograf.json',
    '/graphic/http://outside.test/file.ograf.json',
    '/graphic/nested\\escape.ograf.json',
    '/graphic/%QQ.ograf.json',
  ]) {
    assert.equal(remoteManifestFromGraphicRoute(base, path), null, path);
  }
  for (const source of [manifest, 'file:///package/', base + '?token=secret', 'sample-pack'])
    assert.equal(remoteManifestFromGraphicRoute(source, '/graphic/' + name), null);
});

test('manifest source, query parameters, and exact selected manifest remain shareable', () => {
  assert.equal(
    shareableRemoteGraphicUrl({ url: manifest + '?version=2', baseUrl: base }, [], '/'),
    manifest + '?version=2',
  );
  assert.equal(
    shareableRemoteGraphicUrl(
      { url: base, baseUrl: base },
      [{ path: '/' + name, manifestUrl: manifest }],
      '/graphic/' + name,
    ),
    manifest,
  );
  assert.equal(
    shareableRemoteGraphicUrl(
      { url: base, baseUrl: base },
      [{ path: '/' + name, manifestUrl: manifest }],
      '/',
    ),
    manifest,
  );
});

test('catalog, GitHub, OGraf server, and sample-pack source addresses are retained', () => {
  const graphic = { path: '/' + name, manifestUrl: manifest };
  for (const remote of [
    { url: 'sample-pack', baseUrl: base },
    {
      url: 'https://github.com/ebu/ograf/tree/main/v1/examples',
      baseUrl: 'https://github.com/ebu/ograf/blob/main/v1/examples/',
    },
    { url: 'https://server.test/api/ograf/v1/', baseUrl: null },
    { url: 'http://localhost:3100/api/samples', baseUrl: null },
  ])
    assert.equal(shareableRemoteGraphicUrl(remote, [graphic], '/graphic/' + name), remote.url);
});

function discovery(pathname) {
  const calls = [];
  const source = patchDevtoolRemoteDiscovery(upstream.discovery).replace(/^import .*\n/gm, '');
  const context = { URL, window: { location: { pathname } }, remoteManifestFromGraphicRoute };
  runInNewContext(`class Remote { ${source} } this.Remote = Remote`, context);
  const remote = new context.Remote();
  remote.discoverGithub = async (...args) => {
    calls.push(['github', ...args]);
    return ['github'];
  };
  remote.looksLikeOgrafServer = (json) => Boolean(json?.server);
  remote.discoverOgrafServer = async (...args) => {
    calls.push(['server', ...args]);
    return ['server'];
  };
  remote.discover = async (...args) => {
    calls.push(['manifest', ...args]);
    return ['manifest'];
  };
  remote.discoverGenericFileServer = async (...args) => {
    calls.push(['generic', ...args]);
    return ['generic'];
  };
  return { remote, calls };
}

test('generic discovery uses the retained route before unsupported folder discovery', async () => {
  const { remote, calls } = discovery('/graphic/' + name);
  const progress = () => {};
  const options = { forceRefresh: true };
  assert.deepEqual(await remote.discoverGraphicsList(base, null, progress, options), ['manifest']);
  assert.deepEqual(calls, [['manifest', manifest, progress, options]]);
});

test('known server discovery precedes fallback and bad explicit manifests cannot recurse', async () => {
  const { remote, calls } = discovery('/graphic/' + name);
  await remote.discoverGraphicsList('https://github.com/ebu/ograf/', null);
  await remote.discoverGraphicsList(base, { server: true });
  await remote.discoverGraphicsList(manifest, null);
  assert.deepEqual(
    calls.map(([type]) => type),
    ['github', 'server', 'generic'],
  );
});

test('query synchronization retains the exact manifest and current location across activation reload', () => {
  const initial = new URL(
    'http://localhost:3100/graphic/' +
      name +
      '?remoteUrl=' +
      encodeURIComponent(base) +
      '&other=1#preview',
  );
  const navigation = [];
  const app =
    upstream.query + '\nconst view = <RemoteUrlQuerySync graphicsSource={graphicsSource} />';
  const source = patchDevtoolRemoteQuery(app).replace(/^import .*\n/gm, '');
  const context = {
    React: { useEffect: (fn) => fn() },
    useLocation: () => initial,
    useNavigate: () => (location, options) => navigation.push({ location, options }),
    URLSearchParams,
    remoteHandler: { url: base, baseUrl: base },
    shareableRemoteGraphicUrl,
    isSamplePackUrl: () => false,
  };
  runInNewContext(
    source.slice(0, source.indexOf('\nconst view =')) + '\nthis.sync = RemoteUrlQuerySync',
    context,
  );
  context.sync({
    graphicsSource: 'remote',
    graphicsList: [{ path: '/' + name, manifestUrl: manifest }],
  });
  assert.equal(navigation.length, 1);
  const target = navigation[0].location;
  assert.equal(target.pathname, initial.pathname);
  assert.equal(target.hash, '#preview');
  const query = new URLSearchParams(target.search);
  assert.equal(query.get('remoteUrl'), manifest);
  assert.equal(query.get('other'), '1');
  assert.equal(navigation[0].options.replace, true);
  const afterActivation = new URL(target.pathname + target.search + target.hash, initial);
  assert.equal(afterActivation.searchParams.get('remoteUrl'), manifest);
});

test('local-mode query synchronization leaves current location untouched', () => {
  const app =
    upstream.query + '\nconst view = <RemoteUrlQuerySync graphicsSource={graphicsSource} />';
  const source = patchDevtoolRemoteQuery(app).replace(/^import .*\n/gm, '');
  const context = {
    React: { useEffect: (fn) => fn() },
    useLocation: () => new URL('http://localhost:3100/graphic/' + name),
    useNavigate: () => () => assert.fail('local graphics must not gain a remote query'),
    URLSearchParams,
    remoteHandler: { url: manifest, baseUrl: base },
    shareableRemoteGraphicUrl,
    isSamplePackUrl: () => false,
  };
  runInNewContext(
    source.slice(0, source.indexOf('\nconst view =')) + '\nthis.sync = RemoteUrlQuerySync',
    context,
  );
  context.sync({ graphicsSource: 'local', graphicsList: [] });
});

test('guarded patches are repeatable, preserve newlines, and reject unfamiliar source', () => {
  const query = upstream.query + '\n<RemoteUrlQuerySync graphicsSource={graphicsSource} />';
  for (const [transform, source] of [
    [patchDevtoolRemoteQuery, query],
    [patchDevtoolRemoteDiscovery, upstream.discovery],
  ]) {
    const updated = transform(source);
    assert.equal(transform(updated), updated);
    assert.equal(transform(source.replaceAll('\n', '\r\n')).includes('\r\n'), true);
    assert.throws(
      () => transform(source.replace('return', 'return /* upstream changed */')),
      /review before applying/,
    );
  }
});
