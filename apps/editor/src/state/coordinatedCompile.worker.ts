import { buildCoordinatedProjectSetArtifacts } from './coordinatedCompile';
import type { ProjectSetDocument } from './projectSet';
import type { ExportProfile } from '@ograf-editor/codegen';
const scope = self as unknown as {
  onmessage:
    ((event: MessageEvent<{ set: ProjectSetDocument; profile?: ExportProfile }>) => void) | null;
  postMessage(value: unknown): void;
};
scope.onmessage = (event) => {
  try {
    const started = performance.now();
    const artifacts = buildCoordinatedProjectSetArtifacts(event.data.set, event.data.profile);
    scope.postMessage({ type: 'complete', artifacts, elapsedMs: performance.now() - started });
  } catch (cause) {
    scope.postMessage({
      type: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
