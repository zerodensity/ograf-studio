import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-ext-400.css';
import '@fontsource/nunito/vietnamese-400.css';
// Italic face for the few italic UI labels; the app disables synthetic italics.
import '@fontsource/nunito/latin-400-italic.css';
import '@fontsource/nunito/latin-ext-400-italic.css';
import './index.css';
import App from './App.tsx';
import { initializeEditorSession } from './state/editorStartup';
import { useProjectStore } from './state/projectStore';
import { initializeStandaloneWorkspacePreferences } from './state/standaloneWorkspacePreferences';
import { initializeDataConnectionRuntime } from './state/dataConnectionRuntime';
import { registerWebcamPreviewAdapter } from './state/webcamPreview';
import { initializeWebcamPreviewSession } from './state/webcamPreviewSession';
import { initializePresentationBackgroundSession } from './state/presentationBackgroundStore';
import {
  registerRendererPluginPolicy,
  useRendererPluginSettingsStore,
} from './state/pluginSettingsStore';

registerRendererPluginPolicy();
const pluginsReady = useRendererPluginSettingsStore.getState().initialize();
registerWebcamPreviewAdapter();
initializeWebcamPreviewSession();
const root = createRoot(document.getElementById('root')!);
const renderApp = () => {
  initializeDataConnectionRuntime();
  initializePresentationBackgroundSession();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};
// Recover the project in parallel but wait for the user profile before deciding
// whether an otherwise empty session should show its welcome screen.
const workspaceReady = initializeStandaloneWorkspacePreferences().catch(() => undefined);
const bootCreatedProject = useProjectStore.getState().project;
void Promise.all([
  initializeEditorSession(undefined, workspaceReady, bootCreatedProject),
  workspaceReady,
  pluginsReady,
]).then(renderApp, renderApp);
