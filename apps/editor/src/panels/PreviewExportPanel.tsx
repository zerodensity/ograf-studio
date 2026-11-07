import { useEffect } from 'react';
import { unloadPresenter } from '../state/presenterStore';
import { SingleTemplatePreviewExportPanel } from './SingleTemplatePreviewExportPanel';

/** One preview, driven by the same selected template as the canvas and Templates pane. */
export function PreviewExportPanel() {
  useEffect(() => {
    void unloadPresenter().catch(() => undefined);
  }, []);
  return <SingleTemplatePreviewExportPanel />;
}
