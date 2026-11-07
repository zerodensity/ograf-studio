// A service worker can stop between graphic loads. Keep source configuration in
// its controlled page and request it for the client that made each remote fetch.
export const REMOTE_CONFIG_MESSAGE = 'ograf-studio:remote-client-config';

export function installRemoteClientConfigResponder(serviceWorker, readConfiguration) {
  if (!serviceWorker?.addEventListener) return;
  serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== REMOTE_CONFIG_MESSAGE || !event.ports?.[0]) return;
    event.ports[0].postMessage(readConfiguration());
    event.ports[0].close();
  });
}

export async function requestRemoteClientConfig(clients, clientId, options = {}) {
  if (!clientId) return null;
  let client;
  try {
    client = await clients.get(clientId);
  } catch {
    return null;
  }
  if (!client) return null;
  const channel = options.createMessageChannel?.() ?? new MessageChannel();
  return new Promise((resolve) => {
    let timer;
    const finish = (configuration) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(configuration);
    };
    channel.port1.onmessage = (event) => {
      const configuration = event.data;
      if (
        !configuration ||
        (configuration.baseUrl !== null && typeof configuration.baseUrl !== 'string') ||
        !Array.isArray(configuration.allowedOrigins) ||
        !configuration.allowedOrigins.every((origin) => typeof origin === 'string')
      ) {
        finish(null);
        return;
      }
      finish(configuration);
    };
    timer = setTimeout(() => finish(null), options.timeoutMs ?? 2000);
    try {
      client.postMessage({ type: REMOTE_CONFIG_MESSAGE }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}
