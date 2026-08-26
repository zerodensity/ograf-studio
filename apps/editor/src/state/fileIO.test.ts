import { describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import {
  MAX_REMOTE_PROJECT_BYTES,
  openProjectFromUrl,
  parseProjectSource,
  type ProjectFetcher,
} from './fileIO';

describe('remote OGraf Studio project loading', () => {
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
});
