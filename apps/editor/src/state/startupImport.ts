import type { OgrafImportResult } from './importOgraf';
import { useImportReportStore } from './importReportStore';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { resetHistory } from './historyStore';

/** Use the same editable-source recovery report as File → Import OGraf. */
export function openStartupImportedGraphic(imported: OgrafImportResult): void {
  useProjectSetStore.getState().clearProjectSet();
  useProjectStore.getState().loadProject(imported.project);
  useSelectionStore.getState().select(null);
  resetHistory();
  useImportReportStore.getState().setReport(imported);
}
