import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Upstream 7d3cb37 lifecycle excerpts are the guarded patch anchors, not a
// replacement Devtool implementation. Unrelated local integrations are retained.
const original = JSON.parse(
  await readFile(
    new URL('./integrations/ograf-devtool/loadLifecycle.upstream.json', import.meta.url),
    'utf8',
  ),
);

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2)
    throw new Error('Devtool lifecycle anchor changed. Review before applying.');
  return source.replace(from, to);
}

const patched = {
  manifest: original.manifest
    .replace(
      'React.useCallback(async () => {',
      'React.useCallback(async (isCurrent = () => true) => {',
    )
    .replace(
      '\t\tconst manifest = await r.json()',
      '\t\tconst manifest = await r.json()\n\t\tif (!isCurrent()) return manifest',
    ),
  layer: `\tasync loadGraphic(settings, graphicPath, data) {
\t\treturn loadLayerGraphic(this, settings, graphicPath, data, (path) => ResourceProvider.loadGraphicModule(path))
\t}
\tasync clearGraphic() {
\t\treturn clearLayerGraphic(this)
\t}
`,
  seek: original.seek
    .replace(
      '\t\tif (!this.currentGraphic) return',
      '\t\tconst seekGraphic = this.currentGraphic\n\t\tif (!seekGraphic) return',
    )
    .replace(
      '\t\t\twhile (targetTimestamp !== undefined) {',
      '\t\t\twhile (targetTimestamp !== undefined && this.currentGraphic === seekGraphic) {',
    )
    .replace(
      'this.currentGraphic?.element?.goToTime({ timestamp: targetTimestamp })',
      'seekGraphic.element.goToTime({ timestamp: targetTimestamp })',
    )
    .replace(
      '\t\t\t\ttargetTimestamp = this.pendingGoToTime',
      '\t\t\t\tif (this.currentGraphic !== seekGraphic) break\n\t\t\t\ttargetTimestamp = this.pendingGoToTime',
    )
    .replace(
      '\t\t})().finally(() => {',
      '\t\t})().finally(() => {\n\t\t\tif (this.currentGraphic !== seekGraphic) return',
    ),
  schedule: `\tasync setActionsSchedule(schedule) {
\t\tconst scheduleGraphic = this.currentGraphic
\t\tif (!scheduleGraphic) return
\t\tconst actionsOnly = Array.isArray(schedule) ? schedule.filter((item) => item.action?.type !== 'initialData') : []
\t\treturn this._handleError('setActionsSchedule', async () => {
\t\t\tconsole.log('setActionsSchedule', actionsOnly)
\t\t\tconst result = await scheduleGraphic.element.setActionsSchedule({ schedule: actionsOnly })
\t\t\t// The same timestamp represents different output after the schedule changes.
\t\t\t// Preserve an in-flight seek's queue, but force its next sample to replay.
\t\t\tif (this.currentGraphic === scheduleGraphic) this.lastGoToTime = undefined
\t\t\treturn result
\t\t})
\t}`,
  rendererLoad: original.rendererLoad
    .replace(/\t\tif \(this.graphicState === 'pre-load'\) \{[\s\S]*?\n\t\t\}\n/, '')
    .replace(
      '\t\tconst mainFile =',
      '\t\tconst requestId = this._loadRequestId = (this._loadRequestId || 0) + 1\n\t\tconst requestData = this.data\n\t\tconst mainFile =',
    )
    .replace('data: this.data, graphicPath', 'data: requestData, graphicPath')
    .replace(
      '\t\t\t\tawait this.layer.loadGraphic(settings, graphicPath, this.data)',
      '\t\t\t\tconst loaded = await this.layer.loadGraphic(settings, graphicPath, requestData)\n\t\t\t\tif (loaded === false || requestId !== this._loadRequestId) return false',
    )
    .replace(
      "\t\t\t\tthis.graphicState = 'error'",
      "\t\t\t\tif (requestId !== this._loadRequestId) return false\n\t\t\t\tthis.graphicState = 'error'",
    ),
  rendererClear: original.rendererClear
    .replace(
      "\t\treturn this._runAction('clearGraphic'",
      "\t\tconst requestId = this._loadRequestId = (this._loadRequestId || 0) + 1\n\t\treturn this._runAction('clearGraphic'",
    )
    .replace(
      '\t\t\t\tawait this.layer.clearGraphic()',
      '\t\t\t\tawait this.layer.clearGraphic()\n\t\t\t\tif (requestId !== this._loadRequestId) return false',
    )
    .replace(
      "\t\t\t\tthis.graphicState = 'error'",
      "\t\t\t\tif (requestId !== this._loadRequestId) return false\n\t\t\t\tthis.graphicState = 'error'",
    ),
  reload: original.reload
    .replace(
      '\tconst reloadGraphic =',
      `\tconst reloadRequestRef = React.useRef(0)
\tReact.useEffect(() => () => {
\t\t++reloadRequestRef.current
\t\trendererRef.current?.clearGraphic().catch(issueTracker.addError)
\t}, [])
\tconst reloadGraphic =`,
    )
    .replace(
      '\t\tawait rendererRef.current.clearGraphic()',
      '\t\tconst requestId = ++reloadRequestRef.current\n\t\tconst renderer = rendererRef.current\n\t\tif (!renderer) return false\n\t\tconst requestSettings = { ...settingsRef.current }\n\t\tawait renderer.clearGraphic()\n\t\tif (requestId !== reloadRequestRef.current) return false',
    )
    .replace(
      '\t\tconst manifest = await reloadGraphicManifest()',
      '\t\tconst manifest = await reloadGraphicManifest(() => requestId === reloadRequestRef.current)\n\t\tif (requestId !== reloadRequestRef.current) return false',
    )
    .replace(
      'const controllers = await rendererRef.current.loadGraphic(settingsRef.current, initialData).catch(issueTracker.addError)',
      'const controllers = await renderer.loadGraphic(requestSettings, initialData).catch(issueTracker.addError)\n\t\tif (controllers === false || requestId !== reloadRequestRef.current) return false',
    )
    .replace('\t\tsetIsReloading(true)', '\t\tsetIsReloading(true)\n\t\treturn true'),
  trigger: original.trigger.replace(
    '.then(async () => {',
    '.then(async (reloaded) => {\n\t\t\t\tif (reloaded === false) return',
  ),
};

function patch(source, keys) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let output = source.replaceAll('\r\n', '\n');
  for (const key of keys) {
    if (output.includes(patched[key]) && !output.includes(original[key])) continue;
    output = replaceOnce(output, original[key], patched[key]);
  }
  return output.replaceAll('\n', newline);
}

export function patchDevtoolLayerLoads(source) {
  let output = patch(source, ['layer', 'seek', 'schedule']);
  const line = "import { clearLayerGraphic, loadLayerGraphic } from './graphicLoadLifecycle.js'";
  if (!output.includes(line)) output = line + (output.includes('\r\n') ? '\r\n' : '\n') + output;
  return output;
}
export const patchDevtoolRendererLoads = (source) =>
  patch(source, ['rendererLoad', 'rendererClear']);
export const patchDevtoolReloadRequests = (source) =>
  patch(source, ['manifest', 'reload', 'trigger']);

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--devtool');
  if (index < 0 || !args[index + 1])
    throw new Error('Usage: node scripts/configureDevtoolLoadLifecycle.mjs --devtool <checkout>');
  const root = resolve(args[index + 1]);
  if (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name !== 'ograf-devtool')
    throw new Error('Target is not an OGraf Devtool checkout.');
  const helper = await readFile(
    new URL('./integrations/ograf-devtool/graphicLoadLifecycle.js', import.meta.url),
    'utf8',
  );
  const helperPath = join(root, 'client/src/renderer/graphicLoadLifecycle.js');
  const entries = [
    ['client/src/renderer/LayerHandler.js', patchDevtoolLayerLoads],
    ['client/src/renderer/Renderer.js', patchDevtoolRendererLoads],
    ['client/src/views/GraphicTester.jsx', patchDevtoolReloadRequests],
  ];
  const changes = [];
  // Validate every source before making any mutation.
  for (const [relativePath, transform] of entries) {
    const path = join(root, relativePath);
    const before = await readFile(path, 'utf8');
    changes.push({ path, before, after: transform(before) });
  }
  try {
    const currentHelper = await readFile(helperPath, 'utf8');
    if (currentHelper !== helper)
      throw new Error('Existing Devtool lifecycle helper differs; review before updating.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const backups = join(root, '.ograf-studio-integration-backups');
  const changedPaths = [];
  for (const { path, before, after } of changes) {
    if (before === after) continue;
    await mkdir(backups, { recursive: true });
    const hash = createHash('sha256').update(before).digest('hex').slice(0, 16);
    const backup = join(backups, `load-lifecycle-${path.split(/[\\/]/).at(-1)}-${hash}`);
    try {
      await access(backup);
    } catch {
      await writeFile(backup, before, { flag: 'wx' });
    }
    await writeFile(path, after);
    changedPaths.push(path);
  }
  await writeFile(helperPath, helper);
  console.log(
    JSON.stringify({ checkout: root, changedPaths, helperPath, rebuildClient: true }, null, 2),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
