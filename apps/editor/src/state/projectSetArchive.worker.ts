import {
  createProjectSetArchive,
  type ProjectSetDocument,
  type ProjectSetArchiveProgress,
} from './projectSet';

const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          set: ProjectSetDocument;
          archiveMode?: 'compact' | 'compatible';
        }>,
      ) => void)
    | null;
  postMessage(
    message:
      | { type: 'progress'; progress: ProjectSetArchiveProgress }
      | { type: 'complete'; blob: Blob }
      | { type: 'error'; message: string },
  ): void;
};
scope.onmessage = (event) => {
  void createProjectSetArchive(event.data.set, {
    archiveMode: event.data.archiveMode,
    onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
  }).then(
    (blob) => scope.postMessage({ type: 'complete', blob }),
    (cause) =>
      scope.postMessage({
        type: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  );
};
