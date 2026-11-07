import JSZip from 'jszip';
import { getExportProfile, EXPORTED_RESOURCE_URLS_KEY } from '@ograf-editor/codegen';
import type { Graphic, ReturnPayload, ScheduledAction } from '@ograf-editor/ograf-types';
import { createTransitionLogicNewsExample } from './transitionLogicNews';
import {
  createCertifiedCoordinatedPackage,
  type CertifiedCoordinatedPackage,
} from '../state/coordinatedExport';
import { canvasPixelSignatures } from '../state/ografCompatibility';
import { createCertificationResourceUrls } from '../state/certificationResources';
import { openProjectSetArchive } from '../state/projectSet';

const status = document.querySelector<HTMLElement>('#status')!;
const results = document.querySelector<HTMLElement>('#results')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const output = document.querySelector<HTMLElement>('#output')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
let source = createTransitionLogicNewsExample(Date.UTC(2026, 9, 15, 9));
let packaged: CertifiedCoordinatedPackage | null = null;
let zipUrl = '';
let cleanup = async () => {};
let graphic: (HTMLElement & Graphic) | null = null;
let busy = false;
let passed = 0;
const controls = ['live', 'offline', 'show'];
function log(message: string) {
  results.textContent += `${message}\n`;
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  ++passed;
  log(`PASS ${message}`);
}
function elements<T extends HTMLElement>(root: ShadowRoot | null, selector: string): T[] {
  if (!root) return [];
  return [
    ...root.querySelectorAll<T>(selector),
    ...[...root.querySelectorAll('*')].flatMap((node) => elements<T>(node.shadowRoot, selector)),
  ];
}
function text(): string {
  return elements<HTMLElement>(graphic!.shadowRoot, '[data-transition-layer-id]')
    .map((node) => node.textContent)
    .join(' ');
}
function visibleStates(): string[] {
  return elements<HTMLElement>(graphic!.shadowRoot, '[data-ograf-transition-state]')
    .filter((host) => Number(host.style.opacity) > 0.999)
    .map((host) => host.dataset.ografTransitionState!);
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function call(method: keyof Graphic, params: unknown): Promise<ReturnPayload | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      (graphic![method] as (value: unknown) => Promise<ReturnPayload | undefined>).call(
        graphic,
        params,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${method} did not finish within 8 seconds`)),
          8000,
        );
      }),
    ]);
    if (value && value.statusCode >= 400)
      throw new Error(`${method}: ${value.statusCode} ${value.statusMessage}`);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function fit() {
  if (!packaged?.artifacts.transitionDescriptor) return;
  const { width, height } = packaged.artifacts.transitionDescriptor;
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `scale(${output.clientWidth / width})`;
  output.style.aspectRatio = `${width}/${height}`;
}
new ResizeObserver(fit).observe(output);
async function mount(renderType: 'realtime' | 'non-realtime') {
  await cleanup();
  check(packaged, 'Certified package available');
  const zip = await JSZip.loadAsync(await packaged.blob.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const manifestEntry = entries.find((entry) => entry.name.endsWith('.ograf.json'))!;
  const manifest = JSON.parse(await manifestEntry.async('string'));
  const main = await zip.file(manifest.main)!.async('string');
  const resources = await Promise.all(
    entries
      .filter((entry) => entry.name !== manifest.main && entry.name !== manifestEntry.name)
      .map(async (entry) => ({
        path: entry.name,
        data: await entry.async('base64'),
        base64: true,
        mimeType: packaged!.artifacts.resources.find((resource) => resource.path === entry.name)
          ?.mimeType,
      })),
  );
  const urls = createCertificationResourceUrls(resources);
  const moduleUrl = URL.createObjectURL(new Blob([main], { type: 'text/javascript' }));
  const globals = globalThis as unknown as Record<string, unknown>;
  const registry = (globals[EXPORTED_RESOURCE_URLS_KEY] ??= {}) as Record<
    string,
    Record<string, string>
  >;
  registry[moduleUrl] = urls.urls;
  let importUrl = moduleUrl;
  if (document.querySelector<HTMLInputElement>('#deployed')!.checked) {
    const base = new URL('/coordinated-news-review/', location.href);
    importUrl = new URL(manifest.main, base).href;
    const deployedMain = await fetch(importUrl, { cache: 'no-store' });
    check(
      deployedMain.ok && (await deployedMain.text()) === main,
      'HTTP module matches the certified ZIP bytes',
    );
    importUrl += `?review=${crypto.randomUUID()}`;
  }
  const module = await import(/* @vite-ignore */ importUrl);
  const tag = `ograf-news-review-${crypto.randomUUID()}`;
  customElements.define(tag, module.default);
  const instance = document.createElement(tag) as HTMLElement & Graphic;
  graphic = instance;
  stage.replaceChildren(instance);
  fit();
  cleanup = async () => {
    await instance.dispose({});
    instance.remove();
    urls.dispose();
    URL.revokeObjectURL(moduleUrl);
    delete registry[moduleUrl];
  };
  await call('load', {
    renderType,
    renderCharacteristics: {
      resolution: {
        width: packaged.artifacts.transitionDescriptor!.width,
        height: packaged.artifacts.transitionDescriptor!.height,
      },
      frameRate: packaged.artifacts.transitionDescriptor!.frameRate,
    },
  });
  check(true, `Exact ${importUrl === moduleUrl ? 'ZIP' : 'HTTP package'} loaded as ${renderType}`);
}
async function run(name: string, operation: () => Promise<void>) {
  if (busy) return;
  busy = true;
  passed = 0;
  results.textContent = '';
  status.textContent = `${name} running…`;
  for (const button of document.querySelectorAll<HTMLButtonElement>('button'))
    button.disabled = true;
  try {
    await operation();
    status.textContent = `${name}: ${passed} checks passed`;
  } catch (error) {
    status.textContent = `${name}: FAILED`;
    log(error instanceof Error ? (error.stack ?? error.message) : String(error));
  } finally {
    busy = false;
    for (const button of document.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = controls.includes(button.id) && !packaged;
  }
}
document.querySelector('#build')!.addEventListener(
  'click',
  () =>
    void run('Package certification', async () => {
      await cleanup();
      graphic = null;
      packaged = null;
      download.hidden = true;
      packaged = await createCertifiedCoordinatedPackage(source, getExportProfile('dual'));
      for (const item of packaged.compatibility.checks) check(item.valid, item.label);
      const zip = await JSZip.loadAsync(await packaged.blob.arrayBuffer());
      check(
        Object.keys(zip.files).filter((path) => path.endsWith('.ograf.json')).length === 1,
        'One OGraf manifest',
      );
      check(
        !!zip.file('main.js') && !!zip.file('README.md'),
        'Controller and operator guide packaged',
      );
      if (zipUrl) URL.revokeObjectURL(zipUrl);
      zipUrl = URL.createObjectURL(packaged.blob);
      download.href = zipUrl;
      download.download = 'Northline News - Coordinated.ograf.zip';
      download.hidden = false;
      log(
        `Package: ${packaged.blob.size} bytes; ${packaged.artifacts.transitionDescriptor!.templates.length} templates; ${packaged.artifacts.transitionDescriptor!.sharedInstances.length} retained shared instances.`,
      );
    }),
);
document.querySelector('#live')!.addEventListener(
  'click',
  () =>
    void run('Live playback', async () => {
      await mount('realtime');
      const shared = elements<HTMLElement>(graphic!.shadowRoot, '[data-ograf-transition-shared]');
      const retained = () => shared.every((node) => node.isConnected);
      check(visibleStates().length === 0, 'Load starts Off');
      await call('playAction', { goto: 0 });
      check(
        visibleStates().includes('name') && visibleStates().includes('ticker'),
        'Play takes correspondent and ticker',
      );
      await call('customAction', {
        id: 'transition.take',
        payload: { slotId: 'lower-third', stateId: 'headline' },
      });
      check(
        visibleStates().includes('headline') && retained(),
        'Headline replaces content and retains shared DOM',
      );
      await call('customAction', {
        id: 'transition.take',
        payload: { slotId: 'lower-third', stateId: 'breaking' },
      });
      check(
        visibleStates().includes('breaking') && retained(),
        'Breaking news retains panel, logo and clock',
      );
      await call('updateAction', {
        data: { slots: { 'lower-third': { data: { breaking: 'EXPORT DATA UPDATE VERIFIED' } } } },
      });
      check(text().includes('EXPORT DATA UPDATE VERIFIED'), 'Data update reaches rendered text');
      const before = await canvasPixelSignatures(graphic!);
      await wait(350);
      const after = await canvasPixelSignatures(graphic!);
      check(
        before.shaderCanvasCount > 0 &&
          before.errors.length === 0 &&
          after.errors.length === 0 &&
          JSON.stringify(before.signatures) !== JSON.stringify(after.signatures),
        'Shader reflection advances on the shared clock',
      );
      const requests = [
        call('customAction', {
          id: 'transition.take',
          payload: { slotId: 'lower-third', stateId: 'headline' },
        }),
      ];
      await wait(70);
      requests.push(
        call('customAction', {
          id: 'transition.take',
          payload: { slotId: 'lower-third', stateId: 'breaking' },
        }),
      );
      requests.push(
        call('customAction', {
          id: 'transition.take',
          payload: { slotId: 'lower-third', stateId: 'name' },
        }),
      );
      await Promise.all(requests);
      check(
        visibleStates().includes('name') && !visibleStates().includes('breaking'),
        'Rapid takes settle on latest request',
      );
      const ticker = elements<HTMLElement>(
        graphic!.shadowRoot,
        '[data-ograf-transition-state]',
      ).find((node) => node.dataset.ografTransitionState === 'ticker');
      await call('customAction', { id: 'transition.out', payload: { slotId: 'lower-third' } });
      check(
        visibleStates().join() === 'ticker' && ticker?.isConnected,
        'Lower-third Out preserves independent ticker',
      );
      const take = call('customAction', {
        id: 'transition.take',
        payload: { slotId: 'lower-third', stateId: 'name' },
      });
      await wait(70);
      await call('customAction', { id: 'transition.clear', payload: { slotId: 'lower-third' } });
      await take;
      check(
        !visibleStates().includes('name') && retained(),
        'Clear interrupts immediately and retains shared objects',
      );
      await call('stopAction', {});
      check(visibleStates().length === 0, 'Stop takes all slots Out');
      await call('playAction', { goto: 0, skipAnimation: true });
      check(visibleStates().includes('name'), 'Playback can restart after Stop');
    }),
);
document.querySelector('#offline')!.addEventListener(
  'click',
  () =>
    void run('Offline replay', async () => {
      await mount('non-realtime');
      const schedule: ScheduledAction[] = [
        { timestamp: 0, action: { type: 'playAction', params: {} } },
        {
          timestamp: 1500,
          action: {
            type: 'customAction',
            params: {
              id: 'transition.take',
              payload: { slotId: 'lower-third', stateId: 'headline' },
            },
          },
        },
        {
          timestamp: 2500,
          action: {
            type: 'customAction',
            params: {
              id: 'transition.take',
              payload: { slotId: 'lower-third', stateId: 'breaking' },
            },
          },
        },
        {
          timestamp: 3500,
          action: {
            type: 'updateAction',
            params: {
              data: { slots: { 'lower-third': { data: { breaking: 'OFFLINE DATA VERIFIED' } } } },
            },
          },
        },
        { timestamp: 6000, action: { type: 'stopAction', params: {} } },
      ];
      await call('setActionsSchedule', { schedule });
      for (const [timestamp, state] of [
        [1000, 'name'],
        [2300, 'headline'],
        [3300, 'breaking'],
      ] as const) {
        await call('goToTime', { timestamp });
        check(visibleStates().includes(state), `Scheduled ${state} at ${timestamp} ms`);
      }
      await call('goToTime', { timestamp: 4800 });
      check(text().includes('OFFLINE DATA VERIFIED'), 'Scheduled data update renders');
      const reference = await canvasPixelSignatures(graphic!);
      const referenceText = text();
      await call('goToTime', { timestamp: 1100 });
      await call('goToTime', { timestamp: 4800 });
      const repeated = await canvasPixelSignatures(graphic!);
      check(
        reference.errors.length === 0 &&
          repeated.errors.length === 0 &&
          JSON.stringify(reference.signatures) === JSON.stringify(repeated.signatures),
        'Shader pixels identical after backward/repeated seek',
      );
      check(referenceText === text(), 'Text and clock identical after backward/repeated seek');
      await call('goToTime', { timestamp: 7000 });
      check(visibleStates().length === 0, 'Scheduled Stop reaches Off');
      await call('goToTime', { timestamp: 4800 });
      check(visibleStates().includes('breaking'), 'Seek restores earlier on-air state');
    }),
);
document.querySelector('#show')!.addEventListener(
  'click',
  () =>
    void run('News preview', async () => {
      await mount('realtime');
      await call('playAction', { goto: 0 });
      check(true, 'News package on air');
    }),
);
const fileInput = document.querySelector<HTMLInputElement>('#source-file')!;
document.querySelector('#source')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener(
  'change',
  () =>
    void run('Source import', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      source = await openProjectSetArchive(file);
      document.querySelector('#source-label')!.textContent = `Source: ${file.name}`;
      packaged = null;
      download.hidden = true;
      check(source.transitionLogic, `Loaded ${file.name}`);
      check(source.templates.length === 4, 'Four news templates present');
    }),
);
