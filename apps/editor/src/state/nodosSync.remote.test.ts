import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldDefinition, createProject, type Project } from '@ograf-editor/scene-model';

const transport = vi.hoisted(() => ({ build: vi.fn(), send: vi.fn() }));
vi.mock('./agentBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentBridge')>()),
  sendNodosPreset: transport.send,
}));
vi.mock('./exportPackage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./exportPackage')>()),
  buildNodosPreset: transport.build,
}));

function enterBrowserEnvironment() {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host: 'localhost:5260' },
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('HTMLElement', class {});
}
function leaveBrowserEnvironment() {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
}

// Each case imports the store graph inside its own timeout because of vi.resetModules(). That is
// about 100 ms once the graph is transformed, but the first import takes 3-10 s on a busy machine.
// Pay for it during collection, as a static import would, so no case is charged for it.
enterBrowserEnvironment();
await import('./nodosSync');
leaveBrowserEnvironment();

beforeEach(() => {
  vi.resetModules();
  enterBrowserEnvironment();
  transport.build.mockReset().mockImplementation(async (project: Project) => ({
    preset: { name: 'candidate', menu_info: { display_name: project.name, category: 'OGraf' } },
    files: [{ path: 'main.js', base64: 'eA==' }],
    compatibility: { valid: true },
  }));
  transport.send.mockReset().mockResolvedValue({ ok: true, message: 'ok' });
});
afterEach(leaveBrowserEnvironment);
async function flush() {
  for (let index = 0; index < 15; index++) await Promise.resolve();
}

describe('Nodos sync through actual MCP project publication and history stores', () => {
  it.each([false, true])(
    'sends an agent field edit after debounce (template set: %s)',
    async (inSet) => {
      const { useProjectStore } = await import('./projectStore');
      const { useProjectSetStore } = await import('./projectSetStore');
      const history = await import('./historyStore');
      const { useAgentBridgeStatus } = await import('./agentBridge');
      const { createProjectSet } = await import('./projectSet');
      const project = createProject({ name: 'Live Nodos update' });
      const field = createFieldDefinition('text', {
        key: 'headline',
        defaultValue: 'Original headline',
      });
      project.compositions[0]!.dataFields.push(field);
      useProjectStore.getState().loadProject(project);
      if (inSet) {
        const set = createProjectSet('Live set', useProjectStore.getState().project);
        useProjectSetStore.getState().setProjectSet(set);
        useProjectSetStore.getState().setActiveTemplateId(set.templates[0]!.id);
      }
      history.resetHistory();
      const sync = await import('./nodosSync');
      useAgentBridgeStatus.getState().setStatus({ connected: true });
      sync.chooseNodosTemplate(sync.openTemplates()[0]!, true);
      sync.updateNodosPreferences({ enabled: true });
      await flush();
      expect(transport.send).toHaveBeenCalledOnce();
      expect(transport.build.mock.calls[0]![0].compositions[0].dataFields[0].defaultValue).toBe(
        'Original headline',
      );

      const before = useProjectStore.getState().project;
      const changed = structuredClone(before);
      changed.compositions[0]!.dataFields[0]!.defaultValue = 'Changed by MCP';
      history.applyRemoteProjectUpdate(changed, {
        source: 'agent',
        reason: 'Change headline',
        summary: { operationCount: 1, operationTypes: ['update_data_field'] },
      });
      expect(useProjectStore.getState().project).not.toBe(before);
      expect(useProjectStore.getState().project.compositions[0]!.dataFields[0]!.defaultValue).toBe(
        'Changed by MCP',
      );
      await vi.advanceTimersByTimeAsync(1499);
      expect(transport.send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(transport.send).toHaveBeenCalledTimes(2);
      expect(transport.build.mock.calls[1]![0].compositions[0].dataFields[0].defaultValue).toBe(
        'Changed by MCP',
      );
      expect(transport.send.mock.calls[1]![0].preset.name).toBe(
        transport.send.mock.calls[0]![0].preset.name,
      );
      // An unchanged echo must not retrigger Nodos or restart its nodes again.
      history.applyRemoteProjectUpdate(structuredClone(useProjectStore.getState().project), {
        source: 'agent',
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect(transport.send).toHaveBeenCalledTimes(2);
    },
  );
});
