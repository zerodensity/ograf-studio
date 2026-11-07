import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { patchDevtoolResourcePaths } from './configureDevtoolResourcePaths.mjs';

// The integration changes exactly these two upstream statements. Surrounding
// resource routes and absolute-URL handling stay under regression coverage.
const source = String.raw`
export function pathJoin(...paths) {
	return paths.join('/').replace(/([^:]|^)\/{2,}/g, '$1/')
}
export function isAbsoluteUrl(str) {
	return typeof str === 'string' && /^https?:\/\//i.test(str)
}
function safeDecodeURIComponent(str) {
	try { return decodeURIComponent(str) } catch { return str }
}
let resourceSource = 'local'
export function setResourceSource(source) { resourceSource = source }
export function graphicResourcePath(...paths) {
	const raw = paths.join('/')
	if (isAbsoluteUrl(raw)) return raw
	const decoded = safeDecodeURIComponent(raw.replace(/^\//, ''))
	if (isAbsoluteUrl(decoded)) return decoded
	const prefix = window.location.href.includes('https') ? 'https://' : 'http://'
	const basePath = __BASE_PATH__
	const marker = resourceSource === 'remote' ? 'REMOTE' : 'LOCAL'
	return prefix + pathJoin(basePath, marker, ...paths)
}
`.replace(
  '__BASE_PATH__',
  "`${window.location.href}`.replace(/^https?:\\/\\//, '').replace(/\\?.*/, '')",
);

function resourceUrls(href) {
  const location = new URL(href);
  const code = patchDevtoolResourcePaths(source).replaceAll('export ', '');
  const context = { window: { location } };
  runInNewContext(code + '\nthis.api = { graphicResourcePath, setResourceSource };', context);
  return context.api;
}

test('only the two origin statements change and repeated application is a no-op', () => {
  const updated = patchDevtoolResourcePaths(source);
  assert.equal(patchDevtoolResourcePaths(updated), updated);
  assert.equal(
    updated,
    source
      .replace(
        "const prefix = window.location.href.includes('https') ? 'https://' : 'http://'",
        "const prefix = window.location.protocol + '//'",
      )
      .replace(
        "const basePath = `${window.location.href}`.replace(/^https?:\\/\\//, '').replace(/\\?.*/, '')",
        'const basePath = window.location.host',
      ),
  );
  assert.equal(patchDevtoolResourcePaths(source.replaceAll('\n', '\r\n')).includes('\r\n'), true);
});

test('nested manifest route and HTTPS remote query keep the current HTTP origin', () => {
  const api = resourceUrls(
    'http://localhost:3100/graphic/set.ograf.json?remoteUrl=https%3A%2F%2Fexample.test%2F',
  );
  assert.equal(api.graphicResourcePath('main.js'), 'http://localhost:3100/LOCAL/main.js');
  api.setResourceSource('remote');
  assert.equal(api.graphicResourcePath('main.js'), 'http://localhost:3100/REMOTE/main.js');
  assert.equal(
    api.graphicResourcePath('assets/', '/font.woff2'),
    'http://localhost:3100/REMOTE/assets/font.woff2',
  );
});

test('HTTPS page and explicit port use their real origin', () => {
  const api = resourceUrls('https://devtool.example:8443/graphic/set.ograf.json?remoteUrl=x');
  api.setResourceSource('remote');
  assert.equal(api.graphicResourcePath('main.js'), 'https://devtool.example:8443/REMOTE/main.js');
});

test('absolute resource URLs and encoded absolute routes remain unchanged', () => {
  const api = resourceUrls('http://localhost:3100/graphic/set.ograf.json');
  assert.equal(
    api.graphicResourcePath('https://assets.example/main.js'),
    'https://assets.example/main.js',
  );
  assert.equal(
    api.graphicResourcePath('/https%3A%2F%2Fassets.example%2Fmain.js'),
    'https://assets.example/main.js',
  );
});

test('unexpected or partial upstream edits fail closed', () => {
  assert.throws(() =>
    patchDevtoolResourcePaths(source.replace('window.location.href.includes', 'other.includes')),
  );
  assert.throws(() =>
    patchDevtoolResourcePaths(
      source.replace(
        "const prefix = window.location.href.includes('https') ? 'https://' : 'http://'",
        "const prefix = window.location.protocol + '//'",
      ),
    ),
  );
});
