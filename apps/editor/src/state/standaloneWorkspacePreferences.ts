import {
  hydrateWorkspaceState,
  serializeWorkspaceState,
  useWorkspaceStore,
} from './workspaceStore';
import { parseWorkspaceState } from './workspaceModel';

const ENDPOINT = '/api/studio/workspaces';
const PENDING_KEY = 'ograf-studio:workspace-profile-pending:v1';
const HEADERS = { 'Content-Type': 'application/json', 'X-OGraf-Workspace-Profile': '1' };

/** Standalone builds also keep the profile in the OS user's application-data directory. */
export async function initializeStandaloneWorkspacePreferences(): Promise<void> {
  if (import.meta.env.MODE !== 'standalone') return;
  let revision = '';
  let previousData = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;
  let inflight = '';
  let uncertain = false;
  let blocked = false;
  let pending = '';
  const snapshot = () => JSON.stringify(serializeWorkspaceState(useWorkspaceStore.getState()));
  const journal = () => {
    try {
      if (pending)
        localStorage.setItem(
          PENDING_KEY,
          JSON.stringify({
            revision,
            data: JSON.parse(pending),
            ...(inflight ? { inflight: JSON.parse(inflight) } : {}),
          }),
        );
      else localStorage.removeItem(PENDING_KEY);
    } catch {
      // The workspace store reports browser-storage errors independently.
    }
  };
  const report = (message: string) => useWorkspaceStore.getState().setStorageError(message);
  const save = async (leaving = false): Promise<void> => {
    if (writing || blocked || !pending) return;
    const data = pending;
    // Browsers cap keepalive requests. Large preset libraries have already been saved
    // while Studio is open; the browser journal retains any final unsent session change.
    if (leaving && (uncertain || new TextEncoder().encode(data).byteLength > 59_000)) return;
    writing = true;
    let confirmed = false;
    try {
      if (uncertain) {
        const probe = await fetch(ENDPOINT, {
          headers: HEADERS,
          cache: 'no-store',
          signal: AbortSignal.timeout(2000),
        });
        if (!probe.ok) throw new Error('Could not reconnect to the workspace profile.');
        const remote = (await probe.json()) as { revision?: unknown; data?: unknown };
        if (typeof remote.revision !== 'string')
          throw new Error('The workspace profile response was invalid.');
        if (remote.revision !== revision && JSON.stringify(remote.data) !== inflight) {
          blocked = true;
          pending = '';
          journal();
          throw new Error(
            'Workspace settings changed in another Studio window. Export your current presets before reloading.',
          );
        }
        revision = remote.revision;
        uncertain = false;
      }
      inflight = data;
      journal();
      const body = JSON.stringify({ expectedRevision: revision, data: JSON.parse(data) });
      const response = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: HEADERS,
        body,
        credentials: 'same-origin',
        keepalive: leaving,
        signal: AbortSignal.timeout(5000),
      });
      const result = (await response.json()) as { revision?: string; error?: string };
      if (response.status === 409) {
        blocked = true;
        pending = '';
        journal();
        throw new Error(
          'Workspace settings changed in another Studio window. Your layout remains in this tab; export any presets you want to keep, then reload to use the shared profile.',
        );
      }
      if (!response.ok || typeof result.revision !== 'string')
        throw new Error(result.error || 'The standalone workspace profile could not be saved.');
      revision = result.revision;
      confirmed = true;
      previousData = data;
      if (pending === data) pending = '';
      journal();
      if (useWorkspaceStore.getState().storageError?.startsWith('Studio profile:'))
        useWorkspaceStore.getState().setStorageError(null);
    } catch (error) {
      uncertain = !blocked;
      report(
        `Studio profile: ${error instanceof Error ? error.message : 'Save failed.'} Browser session recovery remains available.`,
      );
    } finally {
      writing = false;
      if (confirmed || blocked) inflight = '';
      journal();
      if (confirmed && !blocked && pending && pending !== data && !leaving) void save();
    }
  };
  const queue = () => {
    const data = snapshot();
    if (blocked || data === pending) return;
    if (!writing && data === previousData) {
      pending = '';
      journal();
      if (timer) clearTimeout(timer);
      return;
    }
    pending = data;
    journal();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void save();
    }, 300);
  };
  try {
    const response = await fetch(ENDPOINT, {
      headers: HEADERS,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error('The standalone workspace profile could not be loaded.');
    const result = (await response.json()) as { revision?: unknown; data?: unknown };
    if (typeof result.revision !== 'string')
      throw new Error('The workspace profile response was invalid.');
    revision = result.revision;
    let recovery: { revision: string; data: unknown; inflight?: unknown } | undefined;
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw && raw.length < 4 * 1024 * 1024 + 1024) {
        const candidate = JSON.parse(raw) as {
          revision?: unknown;
          data?: unknown;
          inflight?: unknown;
        } | null;
        const data = parseWorkspaceState(candidate?.data);
        const sent = parseWorkspaceState(candidate?.inflight);
        if (candidate && typeof candidate.revision === 'string' && data)
          recovery = { revision: candidate.revision, data, ...(sent ? { inflight: sent } : {}) };
      }
    } catch {
      /* A malformed optional journal cannot prevent the regular profile from loading. */
    }
    if (
      recovery?.data &&
      (recovery.revision === revision ||
        (recovery.inflight && JSON.stringify(recovery.inflight) === JSON.stringify(result.data)))
    ) {
      hydrateWorkspaceState(recovery.data);
      previousData = JSON.stringify(result.data);
    } else {
      if (result.data) hydrateWorkspaceState(result.data);
      previousData = result.data ? snapshot() : '';
      pending = '';
      journal();
      if (recovery?.data && JSON.stringify(recovery.data) !== JSON.stringify(result.data)) {
        // Preserve recoverable custom presets in the browser until the user has exported them.
        hydrateWorkspaceState(recovery.data);
        blocked = true;
        report(
          'Studio profile: Another window saved newer settings. Your recovered browser layout is open; export presets you want to keep before reloading the shared profile.',
        );
      }
    }
    useWorkspaceStore.subscribe(queue);
    queue();
    const leaving = () => {
      window.dispatchEvent(new Event('ograf-workspace-capture'));
      if (timer) clearTimeout(timer);
      queue();
      if (timer) clearTimeout(timer);
      void save(true);
    };
    window.addEventListener('pagehide', leaving);
    window.addEventListener('beforeunload', leaving);
  } catch (error) {
    report(
      `Studio profile: ${error instanceof Error ? error.message : 'Load failed.'} Workspace changes are saved in this browser until Studio is restarted.`,
    );
  }
}
