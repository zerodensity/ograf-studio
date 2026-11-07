function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function manifestUrl(value) {
  const url = httpUrl(value);
  return url?.pathname.toLowerCase().endsWith('.ograf.json') ? url.href : null;
}

// Older Devtool links retained only the resource folder in remoteUrl. Recover
// the manifest from the selected /graphic route before generic folder discovery.
export function remoteManifestFromGraphicRoute(baseUrl, pathname) {
  const base = httpUrl(baseUrl);
  if (!base || manifestUrl(baseUrl) || base.search || base.hash) return null;
  if (!pathname?.startsWith('/graphic/')) return null;
  const relative = pathname.slice('/graphic/'.length);
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  if (
    !decoded.toLowerCase().endsWith('.ograf.json') ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    /[\\?#\u0000-\u001f]/.test(decoded) ||
    decoded.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return null;
  base.pathname = base.pathname.replace(/\/?$/, '/');
  const target = new URL(relative, base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) return null;
  return target.href;
}

// Keep a manifest URL shareable across route changes, refreshes, and the
// service-worker activation reload. Resource baseUrl alone is not discoverable
// on an ordinary file server.
export function shareableRemoteGraphicUrl(remote, graphicsList, pathname) {
  const raw = remote.url ?? remote.baseUrl;
  if (!raw || manifestUrl(raw)) return raw;
  if (!remote.baseUrl || raw.replace(/\/+$/, '') !== remote.baseUrl.replace(/\/+$/, '')) return raw;
  const path = pathname?.startsWith('/graphic') ? pathname.slice('/graphic'.length) : null;
  const graphic =
    graphicsList?.find((item) => item.path === path) ??
    (graphicsList?.length === 1 ? graphicsList[0] : null);
  return manifestUrl(graphic?.manifestUrl) ?? raw;
}
