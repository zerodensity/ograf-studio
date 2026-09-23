import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createShaderRenderer } from '@ograf-editor/ograf-runtime';
import {
  MAX_SHADER_SOURCE_BYTES,
  MAX_SHADER_NAME_LENGTH,
  createShaderPaint,
  type ShaderPaint,
} from '@ograf-editor/scene-model';
import { isDomElement, useEditorWindow } from '../layout/EditorWindow';
import { useProjectStore } from '../state/projectStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { SHADER_RESOURCE_MIME, encodeShaderResourceDrag } from '../state/shaderDrag';
import {
  collectStoredShaderResources,
  shaderPaintWithPatch,
  shaderResourcePatchBetween,
  shaderResourceTarget,
  defaultShaderResourceName,
  isStoredShaderResourceTarget,
  type ShaderResourceTarget,
  type ShaderResourceUsage,
} from '../state/shaderResources';
import { ShaderSourceEditor } from './ShaderSourceEditor';
import { ShaderThumbnail } from './ShaderThumbnail';
import { ShaderLivePreview } from './ShaderLivePreview';
import './ShaderResources.css';

interface ShaderEditorRequest {
  key: string;
  target?: ShaderResourceTarget;
  label: string;
  initialPaint: ShaderPaint;
  draftSource?: string;
  loadedName?: string;
}

function editorRequest(resource: ShaderResourceUsage): ShaderEditorRequest {
  return {
    key: resource.key,
    target: shaderResourceTarget(resource),
    label: resource.label,
    initialPaint: structuredClone(resource.paint),
  };
}

function ShaderResourceDialog({
  request,
  resource,
  onClose,
}: {
  request: ShaderEditorRequest;
  resource: ShaderResourceUsage | undefined;
  onClose: () => void;
}) {
  const { document } = useEditorWindow();
  const dialog = useRef<HTMLDialogElement>(null);
  const updateShader = useProjectStore((state) => state.updateShaderResource);
  const createShader = useProjectStore((state) => state.createShaderResource);
  const isNew = request.target === undefined;
  const [baseline] = useState(() => request.initialPaint);
  const [draft, setDraft] = useState(() => {
    try {
      return shaderPaintWithPatch(baseline, {
        fragmentSource: request.draftSource ?? baseline.fragmentSource,
      });
    } catch {
      return structuredClone(baseline);
    }
  });
  const [source, setSource] = useState(request.draftSource ?? baseline.fragmentSource);
  const draftRef = useRef(draft);
  const sourceRef = useRef(source);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(
    () =>
      isNew ||
      (request.draftSource !== undefined && request.draftSource !== baseline.fragmentSource),
  );
  const save = async () => {
    try {
      const next = shaderPaintWithPatch(draftRef.current, { fragmentSource: sourceRef.current });
      const canvas = document.createElement('canvas');
      const renderer = createShaderRenderer(canvas, next, { width: 4, height: 4 });
      try {
        await renderer.ready();
      } finally {
        renderer.dispose();
      }
      const target = request.target;
      runDiscreteHistoryStep(
        () => {
          if (target) updateShader(target, shaderResourcePatchBetween(baseline, next));
          else createShader(next);
        },
        `${isNew ? 'Create' : 'Edit'} shader “${next.name || request.label}”`,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  useEffect(() => {
    const node = dialog.current!;
    const previousFocus = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      if (isDomElement(previousFocus) && previousFocus.isConnected) previousFocus.focus();
    };
  }, [document]);

  return createPortal(
    <dialog
      ref={dialog}
      className="shader-resource-dialog"
      aria-labelledby="shader-resource-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="shader-resource-dialog-header">
        {(isNew || resource) && (
          <ShaderLivePreview
            paint={draft}
            label={draft.name || resource?.usageLabel || request.label}
          />
        )}
        <div className="shader-resource-heading">
          <h2 id="shader-resource-dialog-title">{isNew ? 'New Shader' : 'Edit shader'}</h2>
          <p>
            {isNew
              ? 'Save it, then drag it onto Fill or Outline.'
              : (resource?.usageLabel ?? request.label)}
          </p>
          <label className="shader-resource-name">
            Shader name
            <input
              aria-label="Shader name"
              value={draft.name ?? ''}
              placeholder={resource?.usageLabel ?? request.label}
              maxLength={MAX_SHADER_NAME_LENGTH}
              disabled={(!isNew && !resource) || resource?.locked}
              onChange={(event) => {
                const next = { ...draftRef.current, name: event.target.value };
                draftRef.current = next;
                setDraft(next);
                setError(null);
              }}
            />
          </label>
          {request.loadedName && <p>Loaded: {request.loadedName}</p>}
        </div>
        <button type="button" aria-label="Close shader editor" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="shader-resource-dialog-body">
        {!isNew && !resource ? (
          <p role="alert">This shader is no longer in the project.</p>
        ) : (
          <>
            <p className="shader-resource-context">
              {resource?.compositionName ?? 'Project shader'}
              {resource?.componentName ? ` · Component: ${resource.componentName}` : ''}
            </p>
            {resource?.locked && (
              <p role="status">This object is locked. Unlock it to edit its shader.</p>
            )}
            <fieldset disabled={resource?.locked}>
              <ShaderSourceEditor
                element={draft}
                draftSource={source}
                onDraftSourceChange={(next) => {
                  sourceRef.current = next;
                  setSource(next);
                  setDirty(true);
                  setError(null);
                }}
                applyLabel="Preview shader"
                onChange={(patch) => {
                  const next = shaderPaintWithPatch(draftRef.current, patch);
                  draftRef.current = next;
                  setDraft(next);
                  setDirty(true);
                  setError(null);
                }}
              />
            </fieldset>
          </>
        )}
      </div>
      {error && (
        <p className="shader-source-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <span>Changes stay in this window until saved.</span>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="shader-resource-save"
          disabled={!dirty || (!isNew && !resource) || resource?.locked}
          onClick={() => void save()}
        >
          Save shader
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

export function ShaderResources() {
  const project = useProjectStore((state) => state.project);
  const removeShader = useProjectStore((state) => state.removeShaderResource);
  const resources = useMemo(() => collectStoredShaderResources(project), [project]);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<ShaderEditorRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<ShaderEditorRequest | null>(null);
  const requestVersion = useRef(0);
  const projectId = project.id;
  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [projectId],
  );
  useEffect(() => {
    setEditor(null);
    setError(null);
  }, [projectId]);
  const selected = resources.find((resource) => resource.key === editor?.key);

  return (
    <>
      <details
        className="resources-tree-branch"
        role="treeitem"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="resources-tree-label">Shaders</span>
          <span className="resources-tree-count">{resources.length}</span>
        </summary>
        <div className="resources-tree-group" role="group">
          <button
            type="button"
            onClick={() => {
              requestVersion.current += 1;
              pendingFile.current = null;
              setError(null);
              setOpen(true);
              setEditor({
                key: 'new-shader',
                label: 'New Shader',
                initialPaint: createShaderPaint({ name: defaultShaderResourceName(project) }),
              });
            }}
          >
            New Shader
          </button>
          {open &&
            (resources.length === 0 ? (
              <p className="panel-placeholder">
                Create a saved shader, then drag it onto Fill or Outline.
              </p>
            ) : (
              resources.map((resource) => (
                <div
                  className="resources-shader-item"
                  role="treeitem"
                  aria-label={resource.label}
                  key={resource.key}
                  draggable
                  title="Drag this shader onto Fill or Outline."
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData(
                      SHADER_RESOURCE_MIME,
                      encodeShaderResourceDrag(project.id, resource),
                    );
                  }}
                >
                  <span className="resources-shader-grip" aria-hidden="true">
                    ⠿
                  </span>
                  <ShaderThumbnail paint={resource.paint} label={resource.label} />
                  <div className="resources-shader-copy">
                    <strong title={resource.label}>{resource.label}</strong>
                    {(project.compositions.length > 1 ||
                      resource.paint.name ||
                      resource.componentName ||
                      resource.locked) && (
                      <span title={`${resource.compositionName} · ${resource.usageLabel}`}>
                        {[
                          project.compositions.length > 1 ? resource.compositionName : '',
                          resource.paint.name ? resource.usageLabel : '',
                          resource.componentName ?? '',
                          resource.locked ? 'Locked' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                    <div className="resources-tree-actions">
                      <button
                        type="button"
                        aria-label={`Edit shader: ${resource.label}${resource.paint.name ? ` — ${resource.usageLabel}` : ''}`}
                        disabled={resource.locked}
                        onClick={() => {
                          requestVersion.current += 1;
                          setError(null);
                          setEditor(editorRequest(resource));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Load GLSL: ${resource.label}${resource.paint.name ? ` — ${resource.usageLabel}` : ''}`}
                        disabled={resource.locked}
                        onClick={() => {
                          requestVersion.current += 1;
                          setError(null);
                          pendingFile.current = editorRequest(resource);
                          input.current?.click();
                        }}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="resources-shader-remove"
                        aria-label={`Remove shader: ${resource.label}${resource.paint.name ? ` — ${resource.usageLabel}` : ''}`}
                        title={
                          isStoredShaderResourceTarget(resource)
                            ? 'Remove this project shader. Objects using copies keep their shaders. Undo restores it.'
                            : `Remove the shader from ${resource.usageLabel}. Keep the object and return to its solid paint or original pixels. Undo restores the shader.`
                        }
                        disabled={resource.locked}
                        onClick={() => {
                          try {
                            runDiscreteHistoryStep(
                              () => removeShader(resource),
                              isStoredShaderResourceTarget(resource)
                                ? `Remove shader “${resource.label}”`
                                : `Remove shader “${resource.label}” from ${resource.usageLabel}`,
                            );
                            requestVersion.current += 1;
                            pendingFile.current = null;
                            if (editor?.key === resource.key) setEditor(null);
                            setError(null);
                          } catch (cause) {
                            setError(cause instanceof Error ? cause.message : String(cause));
                          }
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ))}
          {error && (
            <p className="shader-source-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </details>
      <input
        ref={input}
        type="file"
        hidden
        accept=".glsl,.frag,.txt,text/plain"
        aria-label="Load shader GLSL"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const target = pendingFile.current;
          pendingFile.current = null;
          if (!file || !target) return;
          if (file.size > MAX_SHADER_SOURCE_BYTES) {
            setError('Shader source exceeds the 256 KB limit.');
            return;
          }
          const version = ++requestVersion.current;
          void file
            .text()
            .then((source) => {
              if (version !== requestVersion.current) return;
              setEditor({
                ...target,
                draftSource: source.replace(/^\uFEFF/, ''),
                loadedName: file.name,
              });
            })
            .catch((cause: unknown) => {
              if (version === requestVersion.current)
                setError(cause instanceof Error ? cause.message : String(cause));
            });
        }}
      />
      {editor && (
        <ShaderResourceDialog
          key={editor.key}
          request={editor}
          resource={selected}
          onClose={() => {
            requestVersion.current += 1;
            setEditor(null);
          }}
        />
      )}
    </>
  );
}
