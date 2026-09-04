import graphicRuntimeSource from '@ograf-editor/ograf-runtime/dist/graphic-runtime.js?raw';
import {
  buildExportArtifactsWithRuntime,
  validatePackageLayout,
  type ExportArtifacts,
  type ExportProfile,
} from '@ograf-editor/codegen';
import type { CompiledGraphicDescriptor, Graphic, OGrafManifest } from '@ograf-editor/ograf-types';
import {
  lottiePlayerFrameAtTime,
  type Composition,
  type Element,
  type Project,
} from '@ograf-editor/scene-model';

export type { ExportArtifacts } from '@ograf-editor/codegen';

/** The checks mirror ograf-devtool's manifest/module checks and its in-depth lifecycle exercise. */
export interface OGrafCompatibilityCheck {
  id: 'project' | 'manifest' | 'package' | 'module' | 'lifecycle';
  label: string;
  valid: boolean;
  errors: string[];
}

export interface OGrafCompatibilityResult {
  valid: boolean;
  checks: OGrafCompatibilityCheck[];
  errors: string[];
}

/** Compiles the exact files that will be certified and, only after certification, saved. */
export function buildExportArtifacts(
  project: Project,
  composition: Composition,
  profile?: ExportProfile,
): ExportArtifacts {
  return buildExportArtifactsWithRuntime(project, composition, graphicRuntimeSource, profile);
}

function defaultsFromManifest(manifest: OGrafManifest): Record<string, unknown> {
  const schema = manifest.schema;
  if (!schema || typeof schema !== 'object') return {};
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return {};
  return Object.fromEntries(
    Object.entries(properties as Record<string, unknown>).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object' || !('default' in value)) return [];
      return [[key, (value as { default: unknown }).default]];
    }),
  );
}

export function certificationSeekTimestamps(elements: Element[]): {
  target: number;
  rewind: number;
  exercisesAllLotties: boolean;
} {
  const target = 5_000;
  const lotties = elements.filter(
    (element): element is Extract<Element, { type: 'lottie' }> =>
      element.type === 'lottie' && !!element.animationData && element.speed > 0,
  );
  if (lotties.length === 0) return { target, rewind: 2_000, exercisesAllLotties: true };
  for (let attempt = 0; attempt < 1_999; attempt += 1) {
    const rewind = 1_000.5 + attempt;
    if (
      lotties.every(
        (element) =>
          Math.abs(
            lottiePlayerFrameAtTime(element, target) - lottiePlayerFrameAtTime(element, rewind),
          ) > 1e-6,
      )
    ) {
      return { target, rewind, exercisesAllLotties: true };
    }
  }
  return { target, rewind: 2_000.5, exercisesAllLotties: false };
}

function promiseWithTimeout<T>(promise: Promise<T>, method: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`${method}() did not resolve within the devtool's 3000 ms limit.`)),
      3000,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function validateReturnPayload(
  method: string,
  payload: unknown,
  extraKeys: string[] = [],
): string[] {
  if (payload === undefined) return [];
  if (payload === null || typeof payload !== 'object') {
    return [`${method}() must return an object or undefined.`];
  }
  const errors: string[] = [];
  const record = payload as Record<string, unknown>;
  const allowed = new Set(['statusCode', 'statusMessage', ...extraKeys]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key) && !key.startsWith('v_')) {
      errors.push(
        `${method}() returned non-standard key "${key}" (vendor keys must start with "v_").`,
      );
    }
  }
  if (typeof record.statusCode !== 'number')
    errors.push(`${method}() statusCode must be a number.`);
  if (record.statusMessage !== undefined && typeof record.statusMessage !== 'string') {
    errors.push(`${method}() statusMessage must be a string when present.`);
  }
  if (typeof record.statusCode === 'number' && record.statusCode >= 400) {
    errors.push(
      `${method}() returned error ${record.statusCode}: ${String(record.statusMessage ?? '')}`,
    );
  }
  return errors;
}

type CallableGraphic = HTMLElement & Graphic & Record<string, unknown>;

async function canvasPixelSignatures(
  graphic: CallableGraphic,
): Promise<{ signatures: string[]; errors: string[] }> {
  const signatures: string[] = [];
  const errors: string[] = [];
  const canvases = [...(graphic.shadowRoot?.querySelectorAll<HTMLCanvasElement>('canvas') ?? [])];
  for (const [index, canvas] of canvases.entries()) {
    if (canvas.width <= 0 || canvas.height <= 0) {
      errors.push(
        `Canvas ${index + 1} has invalid backing dimensions ${canvas.width}x${canvas.height}.`,
      );
      continue;
    }
    try {
      const context = canvas.getContext('2d');
      if (!context) {
        errors.push(`Canvas ${index + 1} does not expose a 2D rendering context.`);
        continue;
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      const hash = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      signatures.push(`${canvas.width}x${canvas.height}:${hash}`);
    } catch (error) {
      errors.push(
        `Canvas ${index + 1} pixels could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { signatures, errors };
}

interface CertificationRealm {
  frame: HTMLIFrameElement;
  window: Window;
  document: Document;
}

function createCertificationRealm(): CertificationRealm {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText =
    'position:fixed;left:-100000px;top:-100000px;width:1px;height:1px;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const realmWindow = frame.contentWindow;
  const realmDocument = frame.contentDocument;
  if (!realmWindow || !realmDocument) {
    frame.remove();
    throw new Error('Could not create the disposable certification document.');
  }
  return { frame, window: realmWindow, document: realmDocument };
}

async function importModuleInRealm(
  realm: CertificationRealm,
  moduleUrl: string,
): Promise<{ default?: CustomElementConstructor }> {
  const resultKey = `__ografCertification_${crypto.randomUUID().replaceAll('-', '_')}`;
  const eventName = `${resultKey}_ready`;
  return new Promise((resolve, reject) => {
    const finish = () => {
      realm.window.removeEventListener(eventName, finish);
      const result = (realm.window as unknown as Record<string, unknown>)[resultKey] as
        { module?: { default?: CustomElementConstructor }; error?: string } | undefined;
      delete (realm.window as unknown as Record<string, unknown>)[resultKey];
      if (result?.module) resolve(result.module);
      else reject(new Error(result?.error || 'The certification module did not return a result.'));
    };
    realm.window.addEventListener(eventName, finish, { once: true });
    const script = realm.document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import(${JSON.stringify(moduleUrl)}).then(
        (module) => { window[${JSON.stringify(resultKey)}] = { module }; window.dispatchEvent(new Event(${JSON.stringify(eventName)})); },
        (error) => { window[${JSON.stringify(resultKey)}] = { error: error instanceof Error ? error.message : String(error) }; window.dispatchEvent(new Event(${JSON.stringify(eventName)})); }
      );
    `;
    realm.document.head.appendChild(script);
  });
}

async function callGraphicMethod(
  graphic: CallableGraphic,
  method: keyof Graphic,
  params: unknown,
  extraKeys: string[] = [],
): Promise<string[]> {
  const fn = graphic[method];
  if (typeof fn !== 'function') return [`Graphic does not have a ${method}() method.`];
  try {
    const payload = await promiseWithTimeout(
      (fn as (params: unknown) => Promise<unknown>).call(graphic, params),
      method,
    );
    return validateReturnPayload(method, payload, extraKeys);
  } catch (error) {
    return [`${method}() failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

async function validateModuleAndLifecycle(
  artifacts: ExportArtifacts,
): Promise<{ moduleErrors: string[]; lifecycleErrors: string[] }> {
  const moduleErrors: string[] = [];
  const lifecycleErrors: string[] = [];
  const moduleUrl = URL.createObjectURL(new Blob([artifacts.mainJs], { type: 'text/javascript' }));
  let realm: CertificationRealm | null = null;
  try {
    realm = createCertificationRealm();
    const graphicModule = await importModuleInRealm(realm, moduleUrl);
    if (typeof graphicModule.default !== 'function') {
      moduleErrors.push('main.js must default-export a Graphic custom-element class.');
      return { moduleErrors, lifecycleErrors };
    }

    const tagName = `ograf-compatibility-${crypto.randomUUID()}`;
    realm.window.customElements.define(tagName, graphicModule.default);
    const methodProbe = realm.document.createElement(tagName) as CallableGraphic;
    const requiredMethods: (keyof Graphic)[] = [
      'load',
      'dispose',
      'updateAction',
      'playAction',
      'stopAction',
      'customAction',
      ...(artifacts.manifest.supportsNonRealTime
        ? (['goToTime', 'setActionsSchedule'] as (keyof Graphic)[])
        : []),
    ];
    for (const method of requiredMethods) {
      if (typeof methodProbe[method] !== 'function') {
        moduleErrors.push(`Graphic does not have a ${method}() method.`);
      }
    }
    if (moduleErrors.length > 0) return { moduleErrors, lifecycleErrors };

    const initialData = defaultsFromManifest(artifacts.manifest);
    const compiledDescriptor = (
      graphicModule.default as CustomElementConstructor & {
        descriptor?: CompiledGraphicDescriptor;
      }
    ).descriptor;
    const descriptorElements = [
      ...(compiledDescriptor?.layers.map((layer) => layer.element) ?? []),
      ...(compiledDescriptor?.collections?.flatMap((collection) =>
        collection.prototypeLayers.map((layer) => layer.element),
      ) ?? []),
    ];
    const seekTimestamps = certificationSeekTimestamps(descriptorElements);
    const expectedLottieCanvases =
      (compiledDescriptor?.layers.filter(
        (layer) => layer.element.type === 'lottie' && !!layer.element.animationData,
      ).length ?? 0) +
      (compiledDescriptor?.collections?.reduce(
        (count, collection) =>
          count +
          collection.capacity *
            collection.prototypeLayers.filter(
              (layer) => layer.element.type === 'lottie' && !!layer.element.animationData,
            ).length,
        0,
      ) ?? 0);
    const reducedArrayData = Object.fromEntries(
      Object.entries(initialData).map(([key, value]) => [
        key,
        Array.isArray(value) && value.length > 1 ? value.slice(0, 1) : value,
      ]),
    );
    const renderTypes = [
      ...(artifacts.manifest.supportsRealTime ? (['realtime'] as const) : []),
      ...(artifacts.manifest.supportsNonRealTime ? (['non-realtime'] as const) : []),
    ];

    for (const renderType of renderTypes) {
      const graphic = realm.document.createElement(tagName) as CallableGraphic;
      graphic.style.cssText = 'position:fixed;left:-100000px;top:-100000px;visibility:hidden;';
      realm.document.body.appendChild(graphic);
      lifecycleErrors.push(...(await callGraphicMethod(graphic, 'load', { renderType })));
      if (renderType === 'realtime') {
        lifecycleErrors.push(
          ...(await callGraphicMethod(graphic, 'updateAction', { data: initialData })),
          ...(await callGraphicMethod(graphic, 'playAction', {}, ['currentStep'])),
          ...(await callGraphicMethod(graphic, 'stopAction', {})),
        );
      } else {
        if (!seekTimestamps.exercisesAllLotties) {
          lifecycleErrors.push(
            'Certification could not choose a backward timestamp that changes every animated Lottie frame.',
          );
        }
        lifecycleErrors.push(
          ...(await callGraphicMethod(graphic, 'setActionsSchedule', {
            schedule: [
              { timestamp: 0, action: { type: 'updateAction', params: { data: initialData } } },
              { timestamp: 1000, action: { type: 'playAction', params: {} } },
              {
                timestamp: 3000,
                action: { type: 'updateAction', params: { data: reducedArrayData } },
              },
              { timestamp: 7000, action: { type: 'stopAction', params: {} } },
            ],
          })),
          ...(await callGraphicMethod(graphic, 'goToTime', {
            timestamp: seekTimestamps.target,
          })),
        );
        const canvasSnapshot = await canvasPixelSignatures(graphic);
        lifecycleErrors.push(...canvasSnapshot.errors);
        if (canvasSnapshot.signatures.length < expectedLottieCanvases) {
          lifecycleErrors.push(
            `Expected at least ${expectedLottieCanvases} Lottie Canvas${expectedLottieCanvases === 1 ? '' : 'es'}, found ${canvasSnapshot.signatures.length}.`,
          );
        }
        const collectionSnapshot = [
          ...(graphic.shadowRoot?.querySelectorAll<HTMLElement>('[data-ograf-collection-id]') ??
            []),
        ]
          .filter((element) => element.style.display !== 'none')
          .map(
            (element) =>
              `${element.dataset.ografCollectionId}:${element.dataset.ografCollectionIndex}`,
          );
        lifecycleErrors.push(
          ...(await callGraphicMethod(graphic, 'goToTime', {
            timestamp: seekTimestamps.rewind,
          })),
          ...(await callGraphicMethod(graphic, 'goToTime', {
            timestamp: seekTimestamps.target,
          })),
        );
        const replayedCollectionSnapshot = [
          ...(graphic.shadowRoot?.querySelectorAll<HTMLElement>('[data-ograf-collection-id]') ??
            []),
        ]
          .filter((element) => element.style.display !== 'none')
          .map(
            (element) =>
              `${element.dataset.ografCollectionId}:${element.dataset.ografCollectionIndex}`,
          );
        if (JSON.stringify(collectionSnapshot) !== JSON.stringify(replayedCollectionSnapshot)) {
          lifecycleErrors.push(
            'Non-realtime collection visibility changed after backward and repeated goToTime seeking.',
          );
        }
        const replayedCanvasSnapshot = await canvasPixelSignatures(graphic);
        lifecycleErrors.push(...replayedCanvasSnapshot.errors);
        if (replayedCanvasSnapshot.signatures.length < expectedLottieCanvases) {
          lifecycleErrors.push(
            `Expected at least ${expectedLottieCanvases} replayed Lottie Canvas${expectedLottieCanvases === 1 ? '' : 'es'}, found ${replayedCanvasSnapshot.signatures.length}.`,
          );
        }
        if (
          canvasSnapshot.signatures.length > 0 &&
          JSON.stringify(canvasSnapshot.signatures) !==
            JSON.stringify(replayedCanvasSnapshot.signatures)
        ) {
          lifecycleErrors.push(
            'Canvas pixels changed after backward and repeated non-realtime goToTime seeking.',
          );
        }
      }
      lifecycleErrors.push(...(await callGraphicMethod(graphic, 'dispose', { renderType })));
      graphic.remove();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const recovery = /CustomElementRegistry|already been used|custom element/i.test(detail)
      ? ' Reload the editor tab to restore a fresh certification registry, then retry.'
      : '';
    moduleErrors.push(`main.js could not be imported: ${detail}${recovery}`);
  } finally {
    realm?.frame.remove();
    URL.revokeObjectURL(moduleUrl);
  }
  return { moduleErrors, lifecycleErrors };
}

/** Mandatory pre-save gate: no file writer is called unless every OGraf devtool-equivalent check passes. */
export async function certifyExportArtifacts(
  artifacts: ExportArtifacts,
): Promise<OGrafCompatibilityResult> {
  const projectErrors = artifacts.projectErrors;
  const manifestErrors = artifacts.manifestErrors;
  const packageErrors = validatePackageLayout(artifacts);
  const staticChecksPassed = artifacts.valid && packageErrors.length === 0;
  const { moduleErrors, lifecycleErrors } = staticChecksPassed
    ? await validateModuleAndLifecycle(artifacts)
    : {
        moduleErrors: ['Not run because project, manifest, or package validation failed.'],
        lifecycleErrors: ['Not run because project, manifest, or package validation failed.'],
      };
  const checks: OGrafCompatibilityCheck[] = [
    {
      id: 'project',
      label: 'Project semantics',
      valid: projectErrors.length === 0,
      errors: projectErrors,
    },
    {
      id: 'manifest',
      label: 'Official OGraf v1 manifest schema',
      valid: manifestErrors.length === 0,
      errors: manifestErrors,
    },
    {
      id: 'package',
      label: 'OGraf package layout',
      valid: packageErrors.length === 0,
      errors: packageErrors,
    },
    {
      id: 'module',
      label: 'Graphic module/default export/API',
      valid: moduleErrors.length === 0,
      errors: moduleErrors,
    },
    {
      id: 'lifecycle',
      label: 'Real-time and non-real-time lifecycle',
      valid: lifecycleErrors.length === 0,
      errors: lifecycleErrors,
    },
  ];
  const errors = checks.flatMap((check) => check.errors.map((error) => `${check.label}: ${error}`));
  return { valid: errors.length === 0, checks, errors };
}

export async function certifyProject(project: Project): Promise<OGrafCompatibilityResult> {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
  if (!composition) {
    const error = 'The project mainCompositionId does not reference an existing composition.';
    return {
      valid: false,
      errors: [error],
      checks: [{ id: 'project', label: 'Project semantics', valid: false, errors: [error] }],
    };
  }
  return certifyExportArtifacts(buildExportArtifacts(project, composition));
}
