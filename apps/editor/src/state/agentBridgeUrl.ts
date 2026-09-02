export interface BrowserLocation {
  protocol: string;
  host: string;
}

export function resolveAgentBridgeUrl(
  configuredUrl: string | undefined,
  location: BrowserLocation,
): string {
  if (configuredUrl && configuredUrl !== 'same-origin') return configuredUrl;
  if (configuredUrl === 'same-origin') {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/editor`;
  }
  return 'ws://127.0.0.1:4318/editor';
}
