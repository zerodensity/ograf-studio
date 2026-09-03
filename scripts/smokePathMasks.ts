import { writeFile, copyFile } from 'node:fs/promises';
import { createProject } from '../packages/scene-model/src/index';
import { AuthoringSession } from '../packages/authoring-core/src/session';
import { compileDescriptor } from '../packages/codegen/src/compileDescriptor';
const session = new AuthoringSession(createProject(), 'mask-smoke');
const apply = (operations: any[]) =>
  session.apply({ expectedRevision: session.revision, operations });
apply([
  { type: 'set_composition', width: 1120, height: 620, frameRate: 25, backgroundColor: '#22252b' },
]);
const gradient = {
  type: 'linear',
  angle: 90,
  stops: [
    { offset: 0, color: '#ff8020', opacity: 1 },
    { offset: 1, color: '#189fff', opacity: 1 },
  ],
};
const ring = 'M50 0 A50 50 0 1 1 49.99 0 Z M50 25 A25 25 0 1 1 49.99 25 Z';
function add(
  name: string,
  kind: string,
  x: number,
  y: number,
  width: number,
  height: number,
  element: any,
) {
  apply([{ type: 'add_layer', name, kind, transform: { x, y, width, height }, element }]);
  return session.snapshot().project.compositions[0]!.layers.at(-1)!.id;
}
const path = add('Gradient path', 'path', 30, 55, 260, 180, {
  d: ring,
  viewBoxWidth: 100,
  viewBoxHeight: 100,
  fillRule: 'evenodd',
  fill: gradient,
  strokeColor: '#fff',
  strokeWidth: 1,
});
const t1 = add('Path masked', 'rectangle', 390, 55, 280, 180, { fill: gradient });
const m1 = add('Path source', 'path', 415, 55, 200, 180, {
  d: ring,
  viewBoxWidth: 100,
  viewBoxHeight: 100,
  fillRule: 'evenodd',
  fill: '#000',
});
const t2 = add('Alpha gradient masked', 'rectangle', 770, 55, 280, 180, { fill: gradient });
const m2 = add('Soft black alpha', 'ellipse', 770, 55, 280, 180, {
  fill: {
    type: 'linear',
    angle: 90,
    stops: [
      { offset: 0, color: '#000000', opacity: 1 },
      { offset: 1, color: '#000000', opacity: 0 },
    ],
  },
});
const t3 = add('Inverted path', 'rectangle', 30, 365, 280, 180, { fill: gradient });
const m3 = add('Inverted source', 'ellipse', 90, 395, 120, 120, { fill: '#000' });
const t4 = add('Image alpha masked', 'rectangle', 390, 365, 280, 180, { fill: gradient });
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="180"><rect width="140" height="180" fill="black"/><circle cx="210" cy="90" r="65" fill="black" opacity=".5"/></svg>';
const m4 = add('Image alpha', 'image', 390, 365, 280, 180, {
  src: 'data:image/svg+xml,' + encodeURIComponent(svg),
});
const p2 = add('Conic path', 'path', 770, 365, 280, 180, {
  d: ring,
  viewBoxWidth: 100,
  viewBoxHeight: 100,
  fillRule: 'evenodd',
  fill: {
    ...gradient,
    type: 'conic',
    stops: [...gradient.stops, { offset: 1, color: '#ff8020', opacity: 1 }],
  },
});
apply([
  { type: 'set_layer_mask', layerId: t1, sourceLayerId: m1, mode: 'path' },
  { type: 'set_layer_mask', layerId: t2, sourceLayerId: m2, mode: 'alpha' },
  { type: 'set_layer_mask', layerId: t3, sourceLayerId: m3, mode: 'path', inverted: true },
  { type: 'set_layer_mask', layerId: t4, sourceLayerId: m4, mode: 'alpha' },
  { type: 'update_effects', layerId: m2, patch: { blur: 8 } },
  { type: 'set_layer_loop', layerId: m1, durationFrames: 50, repeatCount: null },
  {
    type: 'set_loop_property_track',
    layerId: m1,
    property: 'rotation',
    keys: [
      { frame: 0, value: 0 },
      { frame: 50, value: 360 },
    ],
  },
]);
const descriptor = compileDescriptor(session.snapshot().project.compositions[0]!);
await writeFile('apps/editor/dist/mask-smoke-descriptor.json', JSON.stringify(descriptor));
await copyFile(
  'packages/ograf-runtime/dist/graphic-runtime.js',
  'apps/editor/dist/mask-smoke-runtime.js',
);
await writeFile(
  'apps/editor/dist/mask-smoke.html',
  `<!doctype html><html><head><style>body{margin:0;background:#22252b;color:white;font:15px Arial}#labels{position:absolute;inset:0;pointer-events:none}#labels span{position:absolute}button{margin:10px;padding:10px}#status{font:14px monospace}</style></head><body><div id="stage"></div><div id="labels"><span style="left:30px;top:20px">Gradient path / even-odd</span><span style="left:390px;top:20px">Independent moving path mask</span><span style="left:770px;top:20px">Black alpha + blur</span><span style="left:30px;top:320px">Inverted path</span><span style="left:390px;top:320px">Image alpha: opaque / half</span><span style="left:770px;top:320px">Native conic path</span></div><button id="a">Seek 0 ms</button><button id="b">Seek 750 ms</button><output id="status">Loading</output><script type="module">import {GraphicElement} from './mask-smoke-runtime.js?v=${Date.now()}';const descriptor=await(await fetch('./mask-smoke-descriptor.json')).json();class Probe extends GraphicElement{static descriptor=descriptor;}customElements.define('mask-smoke-probe',Probe);const g=document.createElement('mask-smoke-probe');document.querySelector('#stage').append(g);await g.load({renderType:'non-realtime',data:{},renderCharacteristics:{}});await g.setActionsSchedule({schedule:[{timestamp:0,action:{type:'playAction',params:{goto:0,skipAnimation:true}}}]});async function seek(t){const r=await g.goToTime({timestamp:t});document.querySelector('#status').textContent=JSON.stringify(r)+' at '+t+' ms';}document.querySelector('#a').onclick=()=>seek(0);document.querySelector('#b').onclick=()=>seek(750);await seek(0);</script></body></html>`,
);
console.log({ layers: descriptor.layers.length, path, p2 });
