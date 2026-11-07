import { create } from 'zustand';
import type { OgrafImportResult } from './importOgraf';

/** Shared by both the start screen and File menu so lossy imports always show their report. */
export const useImportReportStore = create<{
  report: OgrafImportResult | null;
  setReport: (report: OgrafImportResult | null) => void;
}>((set) => ({ report: null, setReport: (report) => set({ report }) }));
