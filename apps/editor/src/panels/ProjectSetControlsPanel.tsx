import { useEffect, useRef, useState } from 'react';
import type { Asset, FieldValue, Project } from '@ograf-editor/scene-model';
import { ColorInput } from '../components/ColorInput';
import {
  addProjectSetAssetSlot,
  addProjectSetControl,
  bindProjectSetControl,
  removeProjectSetAssetSlot,
  removeProjectSetControl,
  saveProjectSetTemplateEdits,
  setProjectSetAssetBindingInherited,
  setProjectSetAssetSlotSource,
  setProjectSetControlBindingInherited,
  setProjectSetControlValue,
  validateProjectSetDocument,
  type ProjectSetDocument,
  type ProjectSetAssetSlot,
} from '../state/projectSet';
import {
  bindCurrentProjectSetAsset,
  replaceReviewedSharedAsset,
  sharedAssetImpact,
  sharedSourceReferences,
} from '../state/sharedAssetImpact';

function serialized(value: FieldValue): string {
  return JSON.stringify(value);
}

function displayValue(value: FieldValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  return JSON.stringify(value, null, 2);
}

function ControlValueEditor({
  field,
  value,
  assetSlots,
  onCommit,
}: {
  field: ProjectSetDocument['controls'][number]['field'];
  value: FieldValue;
  assetSlots: ProjectSetAssetSlot[];
  onCommit: (value: FieldValue) => void;
}) {
  const valueJson = serialized(value);
  const [draft, setDraft] = useState(displayValue(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(displayValue(value));
    setError('');
  }, [valueJson]);

  const numeric = ['number', 'integer', 'duration-ms', 'percentage'].includes(field.type);
  const structured = ['object', 'array', 'gradient'].includes(field.type);
  const updateText = () => {
    try {
      const nextValue = structured
        ? (JSON.parse(draft) as FieldValue)
        : numeric
          ? draft.trim() === ''
            ? null
            : Number(draft)
          : draft;
      if (numeric && typeof nextValue === 'number' && !Number.isFinite(nextValue))
        throw new Error('Enter a finite number.');
      onCommit(nextValue);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid value.');
    }
  };

  if (field.type === 'boolean') {
    return (
      <label className="project-set-inline-check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onCommit(event.currentTarget.checked)}
        />
        Enabled
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onCommit(event.currentTarget.value)}
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'image-url') {
    const stringValue = typeof value === 'string' ? value : '';
    const sharedSlotId = stringValue.startsWith('asset-slot:')
      ? stringValue.slice('asset-slot:'.length)
      : '';
    return (
      <label className="project-set-value-editor">
        <span>{field.label}</span>
        <select
          value={sharedSlotId}
          onChange={(event) =>
            onCommit(event.currentTarget.value ? `asset-slot:${event.currentTarget.value}` : '')
          }
        >
          <option value="">External URL or path</option>
          {assetSlots.map((slot) => (
            <option key={slot.id} value={slot.id}>
              {slot.label}
            </option>
          ))}
        </select>
        {!sharedSlotId ? (
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={updateText}
          />
        ) : null}
        {error ? <small className="project-set-error">{error}</small> : null}
      </label>
    );
  }
  if (field.type === 'select-multiple') {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
    return (
      <div className="project-set-multi-options">
        {field.options.map((option) => (
          <label key={option.value} className="project-set-inline-check">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                onCommit(
                  event.currentTarget.checked
                    ? [...selected, option.value]
                    : selected.filter((item) => item !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  const inputValue = draft;
  return (
    <label className="project-set-value-editor">
      <span>{field.label}</span>
      {structured || field.type === 'textarea' ? (
        <textarea
          rows={structured ? 3 : 2}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={updateText}
          spellCheck={false}
        />
      ) : field.type === 'color' ? (
        <ColorInput
          label={field.label || field.key}
          value={typeof value === 'string' ? value : ''}
          alpha={field.generatedShaderParameter?.glslType === 'vec4'}
          onChange={onCommit}
        />
      ) : (
        <input
          type={numeric ? 'number' : 'text'}
          step={field.type === 'integer' ? 1 : 'any'}
          value={inputValue}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={updateText}
        />
      )}
      {error ? <small className="project-set-error">{error}</small> : null}
    </label>
  );
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read file.'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function compatibleFile(file: File, kind: Asset['kind']): boolean {
  const mime = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (kind === 'image') return mime.startsWith('image/');
  if (kind === 'audio') return mime.startsWith('audio/');
  if (kind === 'media') return mime.startsWith('audio/') || mime.startsWith('video/');
  if (kind === 'font')
    return (
      mime.startsWith('font/') ||
      ['woff', 'woff2', 'ttf', 'otf'].includes(extension) ||
      mime === 'application/font-sfnt' ||
      mime === 'application/vnd.ms-opentype'
    );
  return true;
}

function acceptForKind(kind: Asset['kind']): string {
  if (kind === 'image') return 'image/*';
  if (kind === 'audio') return 'audio/*';
  if (kind === 'media') return 'audio/*,video/*';
  if (kind === 'font') return '.woff,.woff2,.ttf,.otf';
  return '*/*';
}

export function ProjectSetControlsPanel({
  set,
  activeTemplateId,
  activeProject,
  onChange,
  assetsOnly = false,
}: {
  set: ProjectSetDocument;
  activeTemplateId: string;
  activeProject: Project;
  onChange: (set: ProjectSetDocument, refreshActiveTemplate: boolean) => void;
  assetsOnly?: boolean;
}) {
  const [fieldChoice, setFieldChoice] = useState('');
  const [assetChoice, setAssetChoice] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState<
    | {
        type: 'source';
        slotId: string;
        assetId: string | null;
        base: ProjectSetDocument;
        project: Project;
        templateId: string;
      }
    | {
        type: 'file';
        slotId: string;
        asset: Asset;
        base: ProjectSetDocument;
        project: Project;
        templateId: string;
      }
    | null
  >(null);
  const live = useRef({ set, activeProject, activeTemplateId, mounted: true, read: 0 });
  live.current.set = set;
  live.current.activeProject = activeProject;
  live.current.activeTemplateId = activeTemplateId;
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
      live.current.read++;
    };
  }, []);
  const fieldOptions = activeProject.compositions.flatMap((composition) =>
    composition.dataFields.map((field) => ({ composition, field })),
  );
  const assetOptions = activeProject.compositions.flatMap((composition) =>
    composition.assets.map((asset) => ({ composition, asset })),
  );
  const projectFor = (templateId: string): Project | undefined =>
    templateId === activeTemplateId
      ? activeProject
      : set.templates.find((item) => item.id === templateId)?.project;

  const addControl = () => {
    const [compositionId, fieldId] = JSON.parse(fieldChoice) as [string, string];
    try {
      const next = addProjectSetControl(
        set,
        activeTemplateId,
        compositionId,
        fieldId,
        activeProject,
      );
      setFieldChoice('');
      setError('');
      onChange(next, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add shared control.');
    }
  };

  const addAssetSlot = () => {
    const [compositionId, assetId] = JSON.parse(assetChoice) as [string, string];
    try {
      const next = addProjectSetAssetSlot(
        set,
        activeTemplateId,
        compositionId,
        assetId,
        activeProject,
      );
      setAssetChoice('');
      setError('');
      onChange(next, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add asset slot.');
    }
  };

  const updateSharedAsset = async (slotId: string, file: File | undefined) => {
    if (!file) return;
    const slot = set.assetSlots.find((item) => item.id === slotId);
    if (!slot) return;
    if (!compatibleFile(file, slot.kind)) {
      setError(`Choose a file compatible with the ${slot.kind} asset slot.`);
      return;
    }
    const request = ++live.current.read;
    setReview(null);
    const requestSet = set;
    const requestProject = activeProject;
    const requestTemplateId = activeTemplateId;
    try {
      const dataUri = await readFileAsDataUri(file);
      if (!live.current.mounted || live.current.read !== request) return;
      if (
        live.current.set !== requestSet ||
        live.current.activeProject !== requestProject ||
        live.current.activeTemplateId !== requestTemplateId
      ) {
        setError('The template set changed while the file was loading. Choose the file again.');
        return;
      }
      const existing = set.assets.find((item) => item.id === slot.assetId);
      const asset: Asset = {
        id: existing?.id ?? `setasset-${crypto.randomUUID()}`,
        name: file.name,
        kind: slot.kind,
        dataUri,
        mimeType: file.type || existing?.mimeType || 'application/octet-stream',
        originalFileName: file.name,
        byteSize: file.size,
        ...(existing?.fontFamily ? { fontFamily: existing.fontFamily } : {}),
        ...(existing?.fontWeight ? { fontWeight: existing.fontWeight } : {}),
        ...(existing?.fontStyle ? { fontStyle: existing.fontStyle } : {}),
        ...(existing?.licenseName ? { licenseName: existing.licenseName } : {}),
        ...(existing?.licenseUrl ? { licenseUrl: existing.licenseUrl } : {}),
        ...(existing?.licenseText ? { licenseText: existing.licenseText } : {}),
      };
      setError('');
      setReview({
        type: 'file',
        slotId,
        asset,
        base: requestSet,
        project: requestProject,
        templateId: requestTemplateId,
      });
    } catch (cause) {
      if (!live.current.mounted || live.current.read !== request) return;
      setError(cause instanceof Error ? cause.message : 'Could not add the shared asset.');
    }
  };

  const applyReview = (replaceForAll: boolean) => {
    if (!review) return;
    if (
      review.base !== set ||
      review.project !== activeProject ||
      review.templateId !== activeTemplateId
    ) {
      setError('The template set changed. Review the replacement again.');
      setReview(null);
      return;
    }
    const slot = set.assetSlots.find((item) => item.id === review.slotId);
    if (!slot) return;
    try {
      const currentSet = saveProjectSetTemplateEdits(set, activeTemplateId, activeProject);
      let next: ProjectSetDocument;
      const affected = sharedAssetImpact(
        currentSet,
        slot.id,
        review.type === 'file' && replaceForAll,
        {
          templateId: activeTemplateId,
          project: activeProject,
        },
      );
      if (review.type === 'source') {
        next = setProjectSetAssetSlotSource(currentSet, slot.id, review.assetId);
      } else {
        next = replaceReviewedSharedAsset(
          currentSet,
          slot.id,
          review.asset,
          replaceForAll ? 'all' : 'slot',
          `setasset-${crypto.randomUUID()}`,
        );
      }
      // A direct asset control can depend on this slot even when its template is
      // inactive. Validate the whole set before publishing either choice.
      validateProjectSetDocument(next);
      onChange(
        next,
        (review.type === 'file' && replaceForAll) ||
          affected.some((item) =>
            item.bindings.some(
              (binding) => binding.inherit && binding.templateId === activeTemplateId,
            ),
          ),
      );
      setReview(null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the shared asset.');
    }
  };

  return (
    <section className="project-set-authoring">
      {!assetsOnly ? (
        <>
          <h3>Shared controls</h3>
          <div className="project-set-add-row">
            <select
              value={fieldChoice}
              onChange={(event) => setFieldChoice(event.currentTarget.value)}
            >
              <option value="">Choose a field from this template…</option>
              {fieldOptions.map(({ composition, field }) => (
                <option
                  key={`${composition.id}/${field.id}`}
                  value={JSON.stringify([composition.id, field.id])}
                >
                  {composition.name} · {field.label} ({field.key})
                </option>
              ))}
            </select>
            <button type="button" disabled={!fieldChoice} onClick={addControl}>
              Add
            </button>
          </div>
          {set.controls.map((control) => (
            <article className="project-set-authoring-card" key={control.field.id}>
              <header>
                <strong>{control.field.label}</strong>
                <button
                  type="button"
                  className="project-set-remove"
                  title="Remove shared control"
                  onClick={() => onChange(removeProjectSetControl(set, control.field.id), true)}
                >
                  ×
                </button>
              </header>
              <small>
                {control.field.key} · {control.field.type}
              </small>
              <ControlValueEditor
                field={control.field}
                value={control.value}
                assetSlots={set.assetSlots.filter((slot) =>
                  control.bindings
                    .filter((binding) => binding.inherit)
                    .every((binding) =>
                      slot.bindings.some(
                        (assetBinding) =>
                          assetBinding.templateId === binding.templateId &&
                          assetBinding.compositionId === binding.compositionId,
                      ),
                    ),
                )}
                onCommit={(value) =>
                  onChange(setProjectSetControlValue(set, control.field.id, value), true)
                }
              />
              <div className="project-set-bindings">
                {set.templates.map((template) => {
                  const templateProject = projectFor(template.id);
                  const binding = control.bindings.find((item) => item.templateId === template.id);
                  const bindingsInControl = control.bindings.filter(
                    (item) => item.templateId === template.id,
                  );
                  const compositionId =
                    binding?.compositionId ?? templateProject?.mainCompositionId ?? '';
                  const candidateFields =
                    templateProject?.compositions.flatMap((composition) =>
                      composition.dataFields
                        .filter((field) => field.type === control.field.type)
                        .filter(
                          (field) =>
                            !set.controls.some(
                              (other) =>
                                other.field.id !== control.field.id &&
                                other.bindings.some(
                                  (otherBinding) =>
                                    otherBinding.templateId === template.id &&
                                    otherBinding.compositionId === composition.id &&
                                    otherBinding.fieldId === field.id,
                                ),
                            ) &&
                            !composition.dataFields.some(
                              (otherField) =>
                                otherField.id !== field.id && otherField.key === control.field.key,
                            ),
                        )
                        .map((field) => ({ composition, field })),
                    ) ?? [];
                  const bindingValue = binding
                    ? JSON.stringify([binding.compositionId, binding.fieldId])
                    : '';
                  return (
                    <div className="project-set-binding-row" key={template.id}>
                      <span>{template.name}</span>
                      <select
                        value={bindingValue}
                        onChange={(event) => {
                          const target = event.currentTarget.value
                            ? (JSON.parse(event.currentTarget.value) as [string, string])
                            : null;
                          try {
                            onChange(
                              bindProjectSetControl(
                                set,
                                control.field.id,
                                template.id,
                                target?.[0] ?? compositionId,
                                target?.[1] ?? null,
                              ),
                              template.id === activeTemplateId,
                            );
                            setError('');
                          } catch (cause) {
                            setError(
                              cause instanceof Error ? cause.message : 'Could not link field.',
                            );
                          }
                        }}
                      >
                        <option value="">Not linked</option>
                        {candidateFields.map(({ composition, field }) => (
                          <option
                            key={`${composition.id}/${field.id}`}
                            value={JSON.stringify([composition.id, field.id])}
                          >
                            {composition.name} · {field.label} ({field.key})
                          </option>
                        ))}
                      </select>
                      {binding ? (
                        <label className="project-set-inline-check">
                          <input
                            type="checkbox"
                            checked={binding.inherit}
                            onChange={(event) =>
                              onChange(
                                setProjectSetControlBindingInherited(
                                  set,
                                  control.field.id,
                                  binding.templateId,
                                  binding.compositionId,
                                  binding.fieldId,
                                  event.currentTarget.checked,
                                ),
                                template.id === activeTemplateId,
                              )
                            }
                          />
                          Inherit
                        </label>
                      ) : null}
                      {bindingsInControl.length > 1 ? (
                        <small>Multiple compositions mapped</small>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </>
      ) : null}
      <h3>Shared asset slots</h3>
      <div className="project-set-add-row">
        <select value={assetChoice} onChange={(event) => setAssetChoice(event.currentTarget.value)}>
          <option value="">Choose an asset from this template…</option>
          {assetOptions.map(({ composition, asset }) => (
            <option
              key={`${composition.id}/${asset.id}`}
              value={JSON.stringify([composition.id, asset.id])}
            >
              {composition.name} · {asset.name} ({asset.kind})
            </option>
          ))}
        </select>
        <button type="button" disabled={!assetChoice} onClick={addAssetSlot}>
          Add
        </button>
      </div>
      {set.assetSlots.map((slot) => (
        <article className="project-set-authoring-card" key={slot.id}>
          <header>
            <strong>{slot.label}</strong>
            <button
              type="button"
              className="project-set-remove"
              title="Remove shared asset slot"
              onClick={() => {
                try {
                  onChange(removeProjectSetAssetSlot(set, slot.id), true);
                  setError('');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Could not remove asset slot.');
                }
              }}
            >
              ×
            </button>
          </header>
          <small>
            {slot.key} · {slot.kind}
          </small>
          {(() => {
            const source = set.assets.find((asset) => asset.id === slot.assetId);
            const inherited = slot.bindings.filter((binding) => binding.inherit && source).length;
            const local = slot.bindings.length - inherited;
            return (
              <div className="shared-slot-summary">
                {source?.kind === 'image' && source.dataUri?.startsWith('data:image/') ? (
                  <img src={source.dataUri} alt="" />
                ) : null}
                <span>
                  {inherited} shared · {local} local · {set.templates.length - slot.bindings.length}{' '}
                  not linked
                </span>
              </div>
            );
          })()}
          <label className="project-set-value-editor">
            <span>Set asset</span>
            <select
              value={slot.assetId ?? ''}
              onChange={(event) => {
                const assetId = event.currentTarget.value || null;
                if (assetId === slot.assetId) return;
                live.current.read++;
                setError('');
                setReview({
                  type: 'source',
                  slotId: slot.id,
                  assetId,
                  base: set,
                  project: activeProject,
                  templateId: activeTemplateId,
                });
              }}
            >
              <option value="">Use template fallback</option>
              {set.assets
                .filter((asset) => asset.kind === slot.kind)
                .map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
            </select>
            <input
              type="file"
              accept={acceptForKind(slot.kind)}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                void updateSharedAsset(slot.id, file);
              }}
            />
          </label>
          {review?.slotId === slot.id
            ? (() => {
                const stale =
                  review.base !== set ||
                  review.project !== activeProject ||
                  review.templateId !== activeTemplateId;
                const multipleSlots = review.type === 'file' && Boolean(slot.assetId);
                const impacted = sharedAssetImpact(review.base, slot.id, multipleSlots, {
                  templateId: review.templateId,
                  project: review.project,
                });
                const direct =
                  multipleSlots && slot.assetId
                    ? sharedSourceReferences(review.base, slot.assetId)
                    : null;
                const original = review.base.assets.find((asset) => asset.id === slot.assetId);
                const proposed =
                  review.type === 'file'
                    ? review.asset
                    : review.base.assets.find((asset) => asset.id === review.assetId);
                return (
                  <div
                    className="shared-asset-review"
                    role="region"
                    aria-label={`Review replacement for ${slot.label}`}
                  >
                    <strong>Review replacement</strong>
                    <div className="shared-asset-review-previews">
                      {[
                        ['Current', original],
                        ['New', proposed],
                      ].map(([label, asset]) => {
                        const candidate = asset as Asset | undefined;
                        return (
                          <div key={String(label)}>
                            <span>
                              {String(label)}: {candidate?.name ?? 'Template fallback'}
                            </span>
                            {candidate?.kind === 'image' &&
                            candidate.dataUri?.startsWith('data:image/') ? (
                              <img
                                className="shared-asset-review-image"
                                src={candidate.dataUri}
                                alt=""
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {multipleSlots ? (
                      <small>
                        Replacing the shared source updates every slot listed below. Use only for
                        this slot creates an independent source.
                      </small>
                    ) : null}
                    {impacted.map(({ slot: impactedSlot, bindings }) => (
                      <div key={impactedSlot.id} className="shared-asset-review-slot">
                        <strong>{impactedSlot.label}</strong>
                        {bindings.length ? (
                          bindings.map((binding) => (
                            <div key={binding.id}>
                              {binding.templateName} · {binding.assetName} —{' '}
                              {review.type === 'source' && !review.assetId && binding.inherit
                                ? 'Will use template fallback'
                                : binding.inherit
                                  ? 'Shared'
                                  : 'Local fallback (unchanged)'}
                            </div>
                          ))
                        ) : (
                          <small>No linked templates</small>
                        )}
                      </div>
                    ))}
                    {direct &&
                    (direct.brandKit ||
                      direct.settings ||
                      direct.controls.length ||
                      direct.components.length) ? (
                      <small>
                        Related set references:{' '}
                        {[
                          direct.brandKit ? 'Brand Kit' : '',
                          direct.settings ? 'Template Set settings' : '',
                          ...direct.controls.map((label) => `Control: ${label}`),
                          ...direct.components.map((label) => `Component: ${label}`),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        . Review these when replacing the shared source.
                      </small>
                    ) : null}
                    {stale ? (
                      <span className="project-set-error">
                        The template set changed. Cancel and review the replacement again.
                      </span>
                    ) : null}
                    <div className="shared-asset-review-actions">
                      {review.type === 'file' && slot.assetId ? (
                        <>
                          <button type="button" disabled={stale} onClick={() => applyReview(true)}>
                            Replace for all
                          </button>
                          <button type="button" disabled={stale} onClick={() => applyReview(false)}>
                            Use only for this slot
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={stale} onClick={() => applyReview(false)}>
                          Apply
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          live.current.read++;
                          setReview(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()
            : null}
          <div className="project-set-bindings">
            {set.templates.map((template) => {
              const templateProject = projectFor(template.id);
              const binding = slot.bindings.find((item) => item.templateId === template.id);
              const compositionId =
                binding?.compositionId ?? templateProject?.mainCompositionId ?? '';
              const candidates =
                templateProject?.compositions.flatMap((composition) =>
                  composition.assets
                    .filter((asset) => asset.kind === slot.kind)
                    .filter(
                      (asset) =>
                        !set.assetSlots.some(
                          (other) =>
                            other.id !== slot.id &&
                            other.bindings.some(
                              (otherBinding) =>
                                otherBinding.templateId === template.id &&
                                otherBinding.compositionId === composition.id &&
                                otherBinding.templateAssetId === asset.id,
                            ),
                        ),
                    )
                    .map((asset) => ({ composition, asset })),
                ) ?? [];
              return (
                <div className="project-set-binding-row" key={template.id}>
                  <span>{template.name}</span>
                  <span className="shared-slot-status">
                    {binding
                      ? binding.inherit && slot.assetId
                        ? 'Shared'
                        : 'Local fallback'
                      : 'Not linked'}
                  </span>
                  <select
                    value={
                      binding
                        ? JSON.stringify([binding.compositionId, binding.templateAssetId])
                        : ''
                    }
                    onChange={(event) => {
                      const target = event.currentTarget.value
                        ? (JSON.parse(event.currentTarget.value) as [string, string])
                        : null;
                      try {
                        onChange(
                          bindCurrentProjectSetAsset(
                            set,
                            slot.id,
                            template.id,
                            target?.[0] ?? compositionId,
                            target?.[1] ?? null,
                            { templateId: activeTemplateId, project: activeProject },
                          ),
                          template.id === activeTemplateId,
                        );
                        setError('');
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : 'Could not link asset.');
                      }
                    }}
                  >
                    <option value="">Not linked</option>
                    {candidates.map(({ composition, asset }) => (
                      <option
                        key={`${composition.id}/${asset.id}`}
                        value={JSON.stringify([composition.id, asset.id])}
                      >
                        {composition.name} · {asset.name}
                      </option>
                    ))}
                  </select>
                  {binding ? (
                    <label className="project-set-inline-check">
                      <input
                        type="checkbox"
                        checked={binding.inherit}
                        onChange={(event) =>
                          onChange(
                            setProjectSetAssetBindingInherited(
                              set,
                              slot.id,
                              binding.id,
                              event.currentTarget.checked,
                            ),
                            template.id === activeTemplateId,
                          )
                        }
                      />
                      Inherit
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>
      ))}
      {error ? <p className="project-set-error">{error}</p> : null}
    </section>
  );
}
