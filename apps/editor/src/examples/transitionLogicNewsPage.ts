import { compileDescriptor } from '@ograf-editor/codegen';
import {
  FramePlayer,
  mountTransitionLogicComposition,
  sharedLayerKey,
  type TransitionLogicMount,
} from '@ograf-editor/ograf-runtime';
import {
  createComposition,
  createTransitionLogicSession,
  prepareTransitionLogicDefinition,
  reduceTransitionLogic,
  replayTransitionLogic,
  sampleTransitionLogic,
  type TransitionLogicEvent,
  type TransitionLogicSelection,
} from '@ograf-editor/scene-model';
import { createProjectSetArchive } from '../state/projectSet';
import {
  createTransitionLogicNewsExample,
  NEWS_DEFAULT_DATA,
  NEWS_FRAME_RATE,
} from './transitionLogicNews';
import './transitionLogicNewsPage.css';
import { newsVisibilityGate } from './transitionLogicNewsVisibility';

const clockEpoch = Date.now();
const example = createTransitionLogicNewsExample(clockEpoch);
const definition = prepareTransitionLogicDefinition(example.transitionLogic!);
let session = createTransitionLogicSession(definition);
const history: TransitionLogicEvent[] = [];
let requestNumber = 0;
let lastLiveFrame = 0;
let reviewing = false;
let playing = true;
let disposed = false;
let failNext = false;
let sequence: Array<{ frame: number; stateId: string | null; slotId: string }> = [];
const instanceMounts = new Map<string, MountedInstance>();
const sharedMounts = new Map<string, TransitionLogicMount>();
const selectionStarts = new Map<string, number>();
const slotPresentation = new Map<string, string>();
const revealAfterRender = new WeakMap<TransitionLogicMount, () => void>();
const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="news-header">
    <a class="news-wordmark" href="/" aria-label="Return to OGraf Studio"><span>O</span>Graf <small>STUDIO</small></a>
    <div class="news-heading"><span class="news-eyebrow">PLAYOUT REHEARSAL</span><h1>Northline News</h1></div>
    <div class="news-header-actions"><span class="news-experimental">Transition Logic · Experimental</span><a class="news-editor-link" href="/?pane=transition-logic" target="_blank" rel="noopener noreferrer">Open Transition Logic editor</a><button id="download">Download example .ogs</button></div>
  </header>
  <section class="news-workspace">
    <section class="news-program-panel" aria-label="Program output">
      <div class="news-section-head"><h2><span class="news-dot"></span> Program</h2><span id="program-time">00:00:00:00</span></div>
      <div class="news-stage-viewport"><div class="news-stage">
        <div class="news-backdrop"><span class="news-backdrop-title">THE WORLD<br>IN FOCUS.</span><span class="news-backdrop-subtitle">NORTHLINE INTERNATIONAL</span><div class="news-globe"></div></div>
        <div class="news-output" id="shared-output"></div><div class="news-output" id="template-output"></div>
      </div></div>
      <div class="news-transport"><button id="sequence">Run news sequence</button><button id="pause">Pause</button><button id="return-live" hidden>Return to live</button><label class="news-scrub-label" for="scrub">Replay</label><input id="scrub" aria-label="Replay recorded requests" type="range" min="0" max="1" value="0" step="1"/><output id="frame-label">0f</output></div>
      <p class="news-caption">One shared glass panel, logo and clock. The lower third makes room first, then the scrolling ticker enters. On exit, the ticker leaves before the panel expands.</p>
      <div id="status" class="news-status" role="status" aria-live="polite">Ready. Take a template or run the news sequence.</div>
      <section class="news-slots"><article><h3>Lower third</h3><div id="lower-third-status"></div></article><article><h3>Ticker</h3><div id="ticker-status"></div></article></section>
    </section>
    <aside class="news-controls" aria-label="Operator controls">
      <div class="news-section-head"><h2>Take to air</h2><span class="news-key-label">50 fps</span></div>
      <div class="news-take-grid"><button class="news-take" data-take="name"><span>01</span>Correspondent<small>Panel + name + role</small></button><button class="news-take" data-take="headline"><span>02</span>Headline<small>Wider panel + editorial text</small></button><button class="news-take news-breaking" data-take="breaking"><span>03</span>Breaking news<small>Taller panel + breaking strap</small></button></div>
      <div class="news-button-row"><button id="out">Take lower third out</button><button class="news-danger" id="clear">Clear all</button></div>
      <details class="news-data" open><summary>On-air data</summary><label>Correspondent<input name="name" value="MAYA BENNETT" maxlength="120"/></label><label>Role<input name="role" value="INTERNATIONAL AFFAIRS CORRESPONDENT" maxlength="180"/></label><label>Headline<textarea name="headline" rows="2" maxlength="220">WORLD LEADERS AGREE ON CLIMATE FRAMEWORK</textarea></label><label>Breaking news<textarea name="breaking" rows="2" maxlength="220">LANDMARK AGREEMENT REACHED IN GENEVA</textarea></label><label>Detail<input name="detail" value="Live coverage · Global summit" maxlength="180"/></label><button id="update">Update current lower third</button></details>
      <section class="news-ticker"><h3>Independent ticker</h3><textarea name="ticker" aria-label="Ticker text" rows="2" maxlength="300">GLOBAL SUMMIT  /  Leaders commit to a new climate framework  •  More coverage throughout the evening</textarea><div class="news-button-row"><button data-take="ticker">Take ticker in / update</button><button id="ticker-out">Out</button></div></section>
      <label class="news-failure"><input type="checkbox" id="fail-next"/> Simulate next preparation failure</label>
    </aside>
  </section>
  <section class="news-bottom"><article><div class="news-section-head"><h2>Transition activity</h2><span>Newest first</span></div><ol id="events" aria-live="off"><li>No requests yet.</li></ol></article><article class="news-explainer"><h2>What to try</h2><p>Take Correspondent → Headline → Breaking news. Watch the panel reshape while the sheen and rolling clock keep their phase.</p><p>Take the ticker in and out while the lower third is visible. The panel shrinks and clock rises over 0.6 seconds, then the ticker appears over 1 second. On Out, the ticker disappears over 0.7 seconds before the panel and clock return over 0.6 seconds. The text keeps scrolling inside its clipped window.</p><p>Take several templates quickly. The active transition finishes, then the latest prepared request runs. Record a few takes, then scrub Replay. A failed preparation keeps the current graphic on air.</p><p class="news-scope">This rehearsal uses the portable planner and the same composition renderer as coordinated packages. The downloaded .ogs contains editable templates, shared component assets and transition definitions. Open the .ogs in Studio, then use the Transition Logic pane to export one coordinated .ograf.zip package.</p></article></section>
`;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
const sharedOutput = element('shared-output');
const templateOutput = element('template-output');
const stage = document.querySelector<HTMLElement>('.news-stage')!;
const stageViewport = document.querySelector<HTMLElement>('.news-stage-viewport')!;
const scrub = element<HTMLInputElement>('scrub');
const eventList = element<HTMLOListElement>('events');
eventList.replaceChildren();
const status = element('status');
const fields = [
  ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    '.news-controls input[name], .news-controls textarea[name]',
  ),
];

interface MountedInstance extends TransitionLogicMount {
  instanceId: string;
}

for (const instance of definition.sharedInstances) {
  const asset = example.componentAssets!.find(
    (candidate) => candidate.id === instance.componentAssetId,
  )!;
  const composition = createComposition({
    id: `news-shared-${instance.id}`,
    name: instance.name,
    width: 1920,
    height: 1080,
    frameRate: NEWS_FRAME_RATE,
    backgroundColor: 'transparent',
    layers: asset.layers,
    dataFields: asset.dataFields,
    assets: asset.resources ?? [],
    patterns: asset.patterns ?? [],
    ...(asset.context ?? {}),
  });
  const mounted = mountTransitionLogicComposition({
    parent: sharedOutput,
    descriptor: compileDescriptor(composition),
    data: Object.fromEntries(asset.dataFields.map((field) => [field.key, field.defaultValue])),
    startFrame: 0,
    clockEpoch,
    sharedKeys: new Map(
      asset.layers.map((layer) => [layer.id, sharedLayerKey(instance.id, layer.id)]),
    ),
    deterministic: true,
  });
  mounted.render(0, definition.initialSharedValues, false);
  sharedMounts.set(instance.id, mounted);
  revealAfterRender.set(
    mounted,
    newsVisibilityGate(
      mounted,
      () => !disposed && sharedMounts.get(instance.id) === mounted,
      refreshAfterPreparation,
    ),
  );
}

function refreshAfterPreparation(): void {
  if (reviewing) {
    const frame = Number(scrub.value);
    renderSession(replayTransitionLogic(definition, history, frame), frame);
  } else renderSession(session, frameNow());
}

function selectionKey(selection: TransitionLogicSelection): string {
  return JSON.stringify([selection.instanceId, selection.requestId]);
}

function mountSelection(selection: TransitionLogicSelection): MountedInstance {
  const key = selectionKey(selection);
  const existing = instanceMounts.get(key);
  if (existing) return existing;
  const template = example.templates.find((candidate) => candidate.id === selection.templateId);
  if (!template) throw new Error(`Template not found: ${selection.templateId}`);
  const composition = template.project.compositions.find(
    (item) => item.id === template.project.mainCompositionId,
  )!;
  const hiddenLayers = new Set<string>();
  const sharedKeys = new Map<string, string>();
  for (const layer of composition.layers) {
    const instance = definition.sharedInstances.find(
      (candidate) =>
        layer.componentLink?.instanceId === candidate.id &&
        layer.componentLink.componentId === candidate.componentAssetId,
    );
    if (!instance || !layer.componentLink) continue;
    hiddenLayers.add(layer.id);
    sharedKeys.set(layer.id, sharedLayerKey(instance.id, layer.componentLink.sourceLayerId));
  }
  const renderer = mountTransitionLogicComposition({
    parent: templateOutput,
    descriptor: compileDescriptor(composition),
    data: selection.data,
    startFrame: selectionStarts.get(key) ?? session.frame,
    clockEpoch,
    hiddenLayers,
    sharedKeys,
    deterministic: true,
  });
  renderer.host.dataset.instanceId = selection.instanceId;
  renderer.host.style.opacity = '0';
  renderer.host.style.zIndex = String(
    definition.slots.find(
      (slot) =>
        slot.id === definition.states.find((state) => state.id === selection.stateId)?.slotId,
    )?.order ?? 0,
  );
  const mounted = Object.assign(renderer, { instanceId: selection.instanceId });
  instanceMounts.set(key, mounted);
  revealAfterRender.set(
    mounted,
    newsVisibilityGate(
      mounted,
      () => !disposed && instanceMounts.get(key) === mounted,
      refreshAfterPreparation,
    ),
  );
  return mounted;
}

function releaseMount(key: string): void {
  const mounted = instanceMounts.get(key);
  if (!mounted) return;
  mounted.dispose();
  instanceMounts.delete(key);
}

function releaseInstance(instanceId: string): void {
  for (const [key, mounted] of instanceMounts)
    if (mounted.instanceId === instanceId) releaseMount(key);
}

function data(): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.name, field.value]));
}

function frameNow(): number {
  return Math.floor(player.frame());
}

function log(message: string, kind = ''): void {
  const row = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = `${(frameNow() / NEWS_FRAME_RATE).toFixed(2)}s`;
  const body = document.createElement('span');
  body.textContent = message;
  row.className = kind;
  row.append(time, body);
  eventList.prepend(row);
  while (eventList.children.length > 80) eventList.lastElementChild?.remove();
}

function dispatch(event: TransitionLogicEvent, record = true): void {
  const result = reduceTransitionLogic(definition, session, event);
  if (record && event.type !== 'advance') history.push(structuredClone(event));
  session = result.session;
  for (const effect of result.effects) {
    if (effect.type === 'prepare') {
      const simulateFailure = failNext;
      failNext = false;
      element<HTMLInputElement>('fail-next').checked = false;
      const { selection, slotId } = effect;
      log(`Preparing ${stateName(selection.stateId)} · ${selection.requestId}`);
      void (async () => {
        try {
          if (simulateFailure) throw new Error('Simulated resource preparation failure.');
          const mounted = mountSelection(selection);
          await document.fonts.ready;
          await Promise.all([
            mounted.ready,
            ...[...sharedMounts.values()].map((shared) => shared.ready),
          ]);
          if (disposed || session.slots[slotId]?.pending?.request.requestId !== selection.requestId)
            return;
          dispatch({
            type: 'ready',
            frame: Math.max(session.frame, frameNow()),
            slotId,
            requestId: selection.requestId,
          });
        } catch (error) {
          if (disposed || session.slots[slotId]?.pending?.request.requestId !== selection.requestId)
            return;
          const message = error instanceof Error ? error.message : String(error);
          dispatch({
            type: 'failed',
            frame: Math.max(session.frame, frameNow()),
            slotId,
            requestId: selection.requestId,
            message,
          });
          log(message, 'news-event-failed');
          status.textContent = `${message} Current output retained.`;
        }
        if (!reviewing) renderSession(session, frameNow());
      })();
    } else if (effect.type === 'release') releaseInstance(effect.instanceId);
    else if (effect.type === 'started') {
      if (effect.plan.to) {
        selectionStarts.set(selectionKey(effect.plan.to), effect.plan.startFrame);
        const mounted = mountSelection(effect.plan.to);
        mounted.startFrame = effect.plan.startFrame;
        mounted.setOnAir(true, effect.plan.startFrame);
      }
      log(
        `${slotName(effect.slotId)}: ${stateName(effect.plan.from?.stateId)} → ${stateName(effect.plan.to?.stateId)} · ${effect.plan.transitionId}`,
      );
    } else if (effect.type === 'settled')
      log(`${slotName(effect.slotId)} settled: ${stateName(effect.selection?.stateId)}`);
  }
  if (!reviewing) pruneMounts();
}

function slotName(id: string): string {
  return definition.slots.find((slot) => slot.id === id)?.name ?? id;
}
function stateName(id?: string | null): string {
  return definition.states.find((state) => state.id === id)?.name ?? 'Off';
}
function sendTake(
  stateId: string | null,
  slotId = stateId === 'ticker' ? 'ticker' : 'lower-third',
): void {
  if (reviewing) returnLive();
  if (!playing) {
    playing = true;
    player.play();
    element('pause').textContent = 'Pause';
  }
  status.textContent = `${slotName(slotId)} requested: ${stateName(stateId)}.`;
  try {
    dispatch({
      type: 'request',
      frame: frameNow(),
      requestId: `take-${++requestNumber}`,
      slotId,
      stateId,
      data: { ...NEWS_DEFAULT_DATA, ...data() },
    });
  } catch (error) {
    // A rejected operator request must not escape the render callback and stop its clock.
    sequence = [];
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Request not applied: ${message}`;
    log(message, 'news-event-failed');
  }
}

function renderSession(current: typeof session, frame: number): void {
  const sample = sampleTransitionLogic(definition, current, frame);
  const active = new Set<string>();
  for (const instance of instanceMounts.values()) instance.host.style.opacity = '0';
  for (const slot of sample.slots) {
    for (const [selection, opacity] of [
      [slot.outgoing, slot.outgoingOpacity],
      [slot.incoming, slot.incomingOpacity],
    ] as const) {
      if (!selection) continue;
      const mounted = mountSelection(selection);
      mounted.host.style.opacity = String(opacity);
      active.add(selectionKey(selection));
    }
    const display = element(`${slot.slotId}-status`);
    const pending = current.slots[slot.slotId]?.pending;
    const lines = [
      ['Settled', stateName(slot.settled?.stateId)],
      ['Requested', stateName(slot.desired?.stateId)],
      ['Pending', pending ? stateName(pending.selection?.stateId) : '—'],
    ];
    const progressValue = slot.transitionId ? slot.progress : 1;
    const detail =
      slot.error ??
      (slot.transitionId
        ? `${slot.transitionId} · ${Math.round(slot.progress * 100)}%`
        : slot.readiness === 'preparing'
          ? 'Preparing incoming resources'
          : 'Settled');
    const signature = JSON.stringify([lines, detail, Math.round(progressValue * 100)]);
    if (slotPresentation.get(slot.slotId) === signature) continue;
    slotPresentation.set(slot.slotId, signature);
    display.replaceChildren();
    for (const [label, value] of lines) {
      const row = document.createElement('p');
      const key = document.createElement('span');
      const text = document.createElement('strong');
      key.textContent = label!;
      text.textContent = value!;
      row.append(key, text);
      display.append(row);
    }
    const progress = document.createElement('progress');
    progress.max = 1;
    progress.value = progressValue;
    progress.setAttribute('aria-label', `${slotName(slot.slotId)} transition progress`);
    display.append(progress);
    const state = document.createElement('small');
    state.textContent = detail;
    display.append(state);
  }
  for (const [instanceId, mount] of sharedMounts) {
    const owner = definition.sharedInstances.find((instance) => instance.id === instanceId)?.slotId;
    const slot = sample.slots.find((candidate) => candidate.slotId === owner);
    mount.setOnAir(owner ? Boolean(slot?.outgoing || slot?.incoming) : true, frame);
    mount.render(frame, sample.sharedValues, playing && !reviewing);
    revealAfterRender.get(mount)?.();
  }
  for (const [key, mount] of instanceMounts) {
    mount.setOnAir(active.has(key), frame);
    if (active.has(key)) {
      mount.render(frame, sample.sharedValues, playing && !reviewing);
      revealAfterRender.get(mount)?.();
    }
  }
  const seconds = Math.floor(frame / NEWS_FRAME_RATE);
  element('program-time').textContent =
    `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame % NEWS_FRAME_RATE).padStart(2, '0')}`;
  element('frame-label').textContent = `${frame}f`;
  if (!reviewing) {
    scrub.max = String(Math.max(1, lastLiveFrame));
    scrub.value = String(frame);
  }
}

const player = new FramePlayer({
  frameRate: NEWS_FRAME_RATE,
  durationFrames: NEWS_FRAME_RATE * 60 * 60 * 24,
  renderFrame: (raw) => {
    if (reviewing) return;
    const frame = Math.floor(raw);
    lastLiveFrame = Math.max(lastLiveFrame, frame);
    dispatch({ type: 'advance', frame }, false);
    const due = sequence.filter((item) => item.frame <= frame);
    sequence = sequence.filter((item) => item.frame > frame);
    for (const item of due) sendTake(item.stateId, item.slotId);
    renderSession(session, frame);
  },
});

function returnLive(): void {
  reviewing = false;
  element('return-live').hidden = true;
  player.seek(Math.max(lastLiveFrame, session.frame)).play();
  playing = true;
  element('pause').textContent = 'Pause';
  status.textContent = 'Live rehearsal resumed.';
  // Replay can mount historical instances; keep only current participants and pending preparation.
  pruneMounts();
}

function pruneMounts(): void {
  const retained = new Set(
    Object.values(session.slots).flatMap((slot) =>
      [slot.settled, slot.transition?.from, slot.transition?.to, slot.pending?.selection]
        .filter((selection): selection is TransitionLogicSelection => !!selection)
        .map(selectionKey),
    ),
  );
  for (const key of instanceMounts.keys()) if (!retained.has(key)) releaseMount(key);
}

document.querySelectorAll<HTMLButtonElement>('[data-take]').forEach((button) =>
  button.addEventListener('click', () => {
    sequence = [];
    sendTake(button.dataset.take!);
  }),
);
element('out').addEventListener('click', () => {
  sequence = [];
  sendTake(null);
});
element('ticker-out').addEventListener('click', () => sendTake(null, 'ticker'));
element('clear').addEventListener('click', () => {
  if (reviewing) returnLive();
  sequence = [];
  dispatch({ type: 'clear', frame: frameNow() });
  log('Clear all · immediate');
  renderSession(session, frameNow());
  status.textContent = 'All slots cleared. Shared clocks remain mounted.';
});
element('update').addEventListener('click', () => {
  const slot = session.slots['lower-third'];
  const stateId = slot?.desired?.stateId ?? slot?.settled?.stateId;
  if (stateId) sendTake(stateId);
  else status.textContent = 'Take a lower-third template before updating its data.';
});
element<HTMLInputElement>('fail-next').addEventListener('change', (event) => {
  failNext = (event.currentTarget as HTMLInputElement).checked;
});
element('pause').addEventListener('click', () => {
  if (reviewing) returnLive();
  else if (!playing) {
    playing = true;
    player.play();
    element('pause').textContent = 'Pause';
  } else {
    player.pause();
    playing = false;
    element('pause').textContent = 'Resume';
  }
});
element('sequence').addEventListener('click', () => {
  if (reviewing) returnLive();
  dispatch({ type: 'clear', frame: frameNow() });
  const start = frameNow();
  sequence = [
    { frame: start, stateId: 'name', slotId: 'lower-third' },
    { frame: start + 4 * NEWS_FRAME_RATE, stateId: 'ticker', slotId: 'ticker' },
    { frame: start + 7 * NEWS_FRAME_RATE, stateId: 'headline', slotId: 'lower-third' },
    { frame: start + 12 * NEWS_FRAME_RATE, stateId: 'breaking', slotId: 'lower-third' },
    { frame: start + 16 * NEWS_FRAME_RATE, stateId: null, slotId: 'ticker' },
    { frame: start + 19 * NEWS_FRAME_RATE, stateId: 'ticker', slotId: 'ticker' },
    { frame: start + 22 * NEWS_FRAME_RATE, stateId: null, slotId: 'lower-third' },
    { frame: start + 25 * NEWS_FRAME_RATE, stateId: null, slotId: 'ticker' },
  ];
  player.play();
  playing = true;
  element('pause').textContent = 'Pause';
  status.textContent =
    'Playing the news sequence. Individual takes override the scheduled sequence.';
});
scrub.addEventListener('input', () => {
  player.pause();
  playing = false;
  reviewing = true;
  element('return-live').hidden = false;
  element('pause').textContent = 'Return to live';
  const frame = Number(scrub.value);
  renderSession(replayTransitionLogic(definition, history, frame), frame);
  status.textContent = 'Reviewing recorded requests. Return to live to resume operator control.';
});
element('return-live').addEventListener('click', returnLive);
element<HTMLButtonElement>('download').addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  try {
    const blob = await createProjectSetArchive(example);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Northline News - Transition Logic.ogs';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent =
      'Example saved as .ogs. Open it in Studio to edit its templates and shared components.';
  } catch (error) {
    status.textContent = `Unable to save example: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
  }
});
const observer = new ResizeObserver(() => {
  stage.style.transform = `scale(${stageViewport.clientWidth / 1920})`;
});
observer.observe(stageViewport);
window.addEventListener('pagehide', () => {
  disposed = true;
  observer.disconnect();
  player.dispose();
  for (const key of instanceMounts.keys()) releaseMount(key);
  for (const mount of sharedMounts.values()) mount.dispose();
});
player.render().play();
