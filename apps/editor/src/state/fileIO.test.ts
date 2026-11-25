import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  createAsset,
  createLayerOfKind,
  createMediaPaint,
  createProject,
  getElementMediaPaint,
} from '@ograf-editor/scene-model';
import {
  MAX_REMOTE_PROJECT_BYTES,
  openProjectFromUrl,
  openStudioDocumentFromFile,
  openStudioDocumentFromUrl,
  parseProjectSource,
  saveAutosave,
  loadAutosave,
  saveProjectSetAutosave,
  loadProjectSetAutosave,
  saveProjectSetToFile,
  saveProjectSourceToFile,
  type ProjectFetcher,
} from './fileIO';
import { createProjectSet, addProjectSetTemplate, createProjectSetArchive } from './projectSet';
import { parseStudioDocument } from './studioDocument';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('unified local Studio document opening', () => {
  it('retains independent output layers in standalone and set recovery saves', async () => {
    const records = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => records.set(key, value),
      removeItem: (key: string) => records.delete(key),
    });
    const project = createProject({ outputLayer: -12 });
    saveAutosave(project);
    expect(loadAutosave()?.outputLayer).toBe(-12);
    const set = createProjectSet('Recovery', project);
    set.outputLayer = 34;
    const activeTemplateId = set.templates[0]!.id;
    expect(await saveProjectSetAutosave({ projectSet: set, activeTemplateId })).toBe(true);
    const recovered = await loadProjectSetAutosave();
    expect(recovered?.projectSet.outputLayer).toBe(34);
    expect(recovered?.projectSet.templates[0]!.project.outputLayer).toBe(-12);
  });
  it('opens a single template and a complete multi-template set through the same picker', async () => {
    const first = createProject({ name: 'News' });
    const second = createProject({ name: 'Sports' });
    const set = addProjectSetTemplate(createProjectSet('Broadcast', first), second);
    const archive = await createProjectSetArchive(set);
    const picker = vi
      .fn()
      .mockResolvedValueOnce([
        { name: 'News.ogs', getFile: async () => new Blob([JSON.stringify(first)]) },
      ])
      .mockResolvedValueOnce([{ name: 'Broadcast.ogs', getFile: async () => archive }]);
    const ownerWindow = { showOpenFilePicker: picker } as unknown as Window;

    const single = await openStudioDocumentFromFile(ownerWindow);
    const multiple = await openStudioDocumentFromFile(ownerWindow);
    expect(single).toEqual({ kind: 'template', project: first });
    expect(multiple?.kind).toBe('template-set');
    if (multiple?.kind !== 'template-set') throw new Error('Expected a template set');
    expect(multiple.projectSet.templates.map((template) => template.name)).toEqual([
      'News',
      'Sports',
    ]);
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker.mock.calls[0]![0]).toMatchObject({ multiple: false });
    const accepted = Object.values(picker.mock.calls[0]![0].types[0].accept).flat();
    expect(accepted).toEqual(['.ogs', '.ogeproj']);
  });

  it('treats a cancelled picker as a no-op', async () => {
    const picker = vi.fn().mockRejectedValue({ name: 'AbortError' });
    await expect(
      openStudioDocumentFromFile({ showOpenFilePicker: picker } as unknown as Window),
    ).resolves.toBeNull();
  });

  it('rejects a legacy filename selected through the native picker before reading it', async () => {
    const getFile = vi.fn();
    const showOpenFilePicker = vi.fn().mockResolvedValue([{ name: 'News.OGP', getFile }]);
    await expect(
      openStudioDocumentFromFile({ showOpenFilePicker } as unknown as Window),
    ).rejects.toThrow(/no longer supports \.ogp/i);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('opens a set through the standard file-input fallback without converting it', async () => {
    const first = createProject({ name: 'News' });
    const set = addProjectSetTemplate(createProjectSet('Broadcast', first), createProject());
    const archive = await createProjectSetArchive(set);
    const input = {
      type: '',
      accept: '',
      files: [archive],
      onchange: null as (() => void) | null,
      addEventListener: vi.fn(),
      click() {
        this.onchange?.();
      },
    };
    const ownerWindow = {
      document: { createElement: vi.fn(() => input) },
    } as unknown as Window;
    const opened = await openStudioDocumentFromFile(ownerWindow);
    expect(input.accept).toBe('.ogs,.ogeproj,.json');
    expect(opened?.kind).toBe('template-set');
    if (opened?.kind !== 'template-set') throw new Error('Expected a template set');
    expect(opened.projectSet.templates).toHaveLength(2);
  });

  it('rejects a legacy filename chosen through the file-input fallback', async () => {
    const arrayBuffer = vi.fn();
    const input = {
      files: [{ name: 'News.ogp', arrayBuffer }],
      onchange: null as (() => void) | null,
      addEventListener: vi.fn(),
      click() {
        this.onchange?.();
      },
    };
    const ownerWindow = {
      document: { createElement: vi.fn(() => input) },
    } as unknown as Window;
    await expect(openStudioDocumentFromFile(ownerWindow)).rejects.toThrow(
      /no longer supports \.ogp/i,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe('remote OGraf Studio project loading', () => {
  it('preserves packaged Media paint through an editable source save and reopen round trip', () => {
    const project = createProject({ name: 'Media source round trip' });
    const composition = project.compositions[0]!;
    const asset = createAsset({
      id: 'clip',
      name: 'Opening clip',
      kind: 'media',
      mimeType: 'video/mp4',
      dataUri: 'data:video/mp4;base64,AAAA',
      byteSize: 3,
      originalFileName: 'opening.mp4',
    });
    const layer = createLayerOfKind('rectangle');
    if (!('fill' in layer.element)) throw new Error('Expected a fill-capable layer.');
    layer.element.fill = createMediaPaint({
      source: { kind: 'clip', src: 'asset:clip' },
      fit: 'contain',
      positionX: 0.25,
      positionY: 0.75,
      loop: false,
      speed: 1.5,
      offsetMs: 420,
    });
    composition.assets.push(asset);
    composition.layers.push(layer);

    const reopened = parseProjectSource(JSON.stringify(project));
    const reopenedComposition = reopened.compositions[0]!;
    expect(reopenedComposition.assets[0]).toMatchObject({
      id: 'clip',
      kind: 'media',
      dataUri: 'data:video/mp4;base64,AAAA',
      originalFileName: 'opening.mp4',
    });
    expect(getElementMediaPaint(reopenedComposition.layers.at(-1)!.element)).toEqual(
      getElementMediaPaint(layer.element),
    );
  });

  it('downloads a valid HTTP project without credentials', async () => {
    const project = createProject();
    project.name = 'Remote News';
    const fetchProject = vi.fn<ProjectFetcher>(async () =>
      Promise.resolve(
        new Response(JSON.stringify(project), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      openProjectFromUrl('https://graphics.example/news.ogs', fetchProject),
    ).resolves.toMatchObject({ id: project.id, name: 'Remote News' });
    expect(fetchProject).toHaveBeenCalledWith(
      new URL('https://graphics.example/news.ogs'),
      expect.objectContaining({
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
      }),
    );
  });

  it('rejects non-web schemes before fetching', async () => {
    const fetchProject = vi.fn<ProjectFetcher>();

    await expect(openProjectFromUrl('file:///C:/graphics/news.ogs', fetchProject)).rejects.toThrow(
      'HTTP or HTTPS',
    );
    expect(fetchProject).not.toHaveBeenCalled();
  });

  it('rejects percent-encoded legacy URL filenames before downloading', async () => {
    const fetchProject = vi.fn<ProjectFetcher>();
    await expect(
      openStudioDocumentFromUrl('https://graphics.example/news%2EOGP?version=1', fetchProject),
    ).rejects.toThrow(/no longer supports \.ogp/i);
    expect(fetchProject).not.toHaveBeenCalled();
  });

  it('rejects a redirect to a legacy filename', async () => {
    const response = Response.json(createProject());
    Object.defineProperty(response, 'url', { value: 'https://graphics.example/news.ogp' });
    await expect(
      openStudioDocumentFromUrl('https://graphics.example/current.ogs', async () => response),
    ).rejects.toThrow(/no longer supports \.ogp/i);
    expect(response.bodyUsed).toBe(false);
  });

  it.each([
    // A semicolon inside a quoted filename is part of the filename, not a separator.
    'attachment; filename="Local news; special.OGP"',
    "attachment; filename*=UTF-8''News%2eogp",
  ])('rejects a legacy download named in Content-Disposition', async (disposition) => {
    const response = Response.json(createProject(), {
      headers: { 'Content-Disposition': disposition },
    });
    await expect(
      openStudioDocumentFromUrl('https://graphics.example/download', async () => response),
    ).rejects.toThrow(/no longer supports \.ogp/i);
    expect(response.bodyUsed).toBe(false);
  });

  it('continues to open supported project bytes at an extensionless URL', async () => {
    const project = createProject();
    const response = Response.json(project, {
      headers: { 'Content-Disposition': 'attachment; filename="Current.ogs"' },
    });
    await expect(
      openStudioDocumentFromUrl('https://graphics.example/download', async () => response),
    ).resolves.toEqual({ kind: 'template', project });
  });

  it('reports HTTP, CORS/network, and malformed-project failures', async () => {
    await expect(
      openProjectFromUrl(
        'https://graphics.example/missing.ogs',
        async () => new Response('', { status: 404 }),
      ),
    ).rejects.toThrow('HTTP 404');
    await expect(
      openProjectFromUrl('https://graphics.example/cors.ogs', async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toThrow('server CORS policy');
    expect(() => parseProjectSource('{broken')).toThrow('not valid JSON');
    expect(() => parseProjectSource(JSON.stringify({ name: 'Not a project' }))).toThrow(
      'not a valid OGraf Studio project',
    );
  });

  it('rejects declared and streamed payloads above the remote size limit', async () => {
    await expect(
      openProjectFromUrl(
        'https://graphics.example/huge.ogs',
        async () =>
          new Response('{}', {
            headers: { 'content-length': String(MAX_REMOTE_PROJECT_BYTES + 1) },
          }),
      ),
    ).rejects.toThrow('32 MiB');

    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REMOTE_PROJECT_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await expect(
      openProjectFromUrl(
        'https://graphics.example/streamed.ogs',
        async () => new Response(oversizedStream),
      ),
    ).rejects.toThrow('32 MiB');
  });

  it('sniffs a streamed ZIP .ogs without decoding binary bytes as UTF-8 or dropping members', async () => {
    const set = addProjectSetTemplate(
      createProjectSet('Newsroom', createProject({ name: 'First' })),
      createProject({ name: 'Second' }),
    );
    const bytes = new Uint8Array(await (await createProjectSetArchive(set)).arrayBuffer());
    const fetchDocument: ProjectFetcher = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 7)
              controller.enqueue(bytes.slice(offset, offset + 7));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    const opened = await openStudioDocumentFromUrl(
      'https://graphics.example/newsroom.ogs',
      fetchDocument,
    );
    if (opened.kind !== 'template-set') throw new Error('Expected set document');
    expect(opened.projectSet.templates.map((template) => template.name)).toEqual([
      'First',
      'Second',
    ]);
    await expect(
      openProjectFromUrl('https://graphics.example/newsroom.ogs', fetchDocument),
    ).rejects.toThrow('multiple templates');
  });

  it('keeps split multibyte UTF-8 text intact in remote JSON sources', async () => {
    const project = createProject({ name: 'İstanbul – Édition spéciale' });
    const bytes = new TextEncoder().encode(JSON.stringify(project));
    const opened = await openStudioDocumentFromUrl(
      'https://graphics.example/news.ogeproj',
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
              controller.close();
            },
          }),
        ),
    );
    expect(opened).toEqual({ kind: 'template', project });
  });
});

describe('editable Studio set save format', () => {
  it('defaults to .ogs and applies the exact native filename to the saved set name', async () => {
    const authoringPrompts = [
      { id: 'initial', text: 'Make a scoreboard.' },
      { id: 'follow-up', text: 'data:text/plain,Keep%20four%20team%20colors.' },
    ];
    const set = createProjectSet(
      'Old title.ogs',
      createProject({ name: 'First', authoringPrompts }),
    );
    const write = vi.fn();
    const close = vi.fn();
    const picker = vi.fn(async () => ({
      name: 'New title.ogs',
      createWritable: async () => ({ write, close, abort: vi.fn() }),
    }));
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    const result = await saveProjectSetToFile(set);
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'Old title.ogs',
        types: [
          expect.objectContaining({ accept: { 'application/x-ograf-template-set': ['.ogs'] } }),
        ],
      }),
    );
    expect(result).toMatchObject({
      status: 'saved',
      fileName: 'New title.ogs',
      projectSet: { name: 'New title' },
    });
    expect(set.name).toBe('Old title.ogs');
    const blob = write.mock.calls[0]![0] as Blob;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'));
    const savedSource = JSON.parse(await zip.file(manifest.templates[0].source)!.async('text'));
    expect(savedSource.authoringPrompts).toEqual(authoringPrompts);
    const document = await parseStudioDocument(blob);
    expect(document).toMatchObject({
      kind: 'template-set',
      projectSet: { name: 'New title', templates: [{ project: { authoringPrompts } }] },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['existing handle', 'picker result'])(
    'rejects a legacy save destination from %s in both editable save routes',
    async (source) => {
      const handle = {
        name: 'Legacy.OGP',
        requestPermission: vi.fn(),
        createWritable: vi.fn(),
      } as unknown as FileSystemFileHandle;
      const ownerWindow = { showSaveFilePicker: vi.fn(async () => handle) } as unknown as Window;
      const options = { ownerWindow, ...(source === 'existing handle' ? { handle } : {}) };
      const project = createProject();
      await expect(saveProjectSourceToFile(project, options)).rejects.toThrow(
        /no longer supports \.ogp/i,
      );
      await expect(
        saveProjectSetToFile(createProjectSet('Current set', project), options),
      ).rejects.toThrow(/no longer supports \.ogp/i);
      expect(handle.requestPermission).not.toHaveBeenCalled();
      expect(handle.createWritable).not.toHaveBeenCalled();
    },
  );
});
