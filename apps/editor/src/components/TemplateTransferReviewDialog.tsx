import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  previewTemplateTransfer,
  type TemplateTransferReviewPlan,
  type TemplateTransferReviewSession,
} from '../state/templateTransferReview';
import {
  useTemplateTransferReviewDialogStore,
  type TemplateTransferReviewRequest,
} from '../state/templateTransferReviewDialogStore';
import './TemplateTransferReviewDialog.css';

type Options = Parameters<TemplateTransferReviewSession['plan']>[0];
type Policy = Options['policy'];
type Mapping = NonNullable<Options['mappings']>[number];
type MappingRow = TemplateTransferReviewPlan['report']['mappings'][number];
type Preview = Awaited<ReturnType<typeof previewTemplateTransfer>>;

const POLICIES: Record<Policy, { label: string; hint: string }> = {
  'keep-appearance': {
    label: 'Keep appearance',
    hint: 'Keep the template’s current branding local.',
  },
  'adopt-destination': {
    label: 'Adopt destination Brand Kit',
    hint: 'Link the approved roles to the destination’s definitions.',
  },
  'bring-source-branding': {
    label: 'Bring source branding',
    hint: 'Import approved source definitions into the destination kit.',
  },
};

function ColorValue({ value }: { value: string }) {
  const text = describe(value);
  const hex = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
  return (
    <span className="template-transfer-value">
      {hex && <i aria-hidden="true" style={{ backgroundColor: value }} />}
      {text}
    </span>
  );
}

function describe(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  const text = String(value);
  return text.length > 100 ? text.slice(0, 99) + '…' : text;
}

function label(key: string): string {
  const text = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[.-]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sourceKind(kind: string): string {
  switch (kind) {
    case 'clipboard':
      return 'Copied template';
    case 'resolved-file':
      return 'Resolved standalone template';
    case 'template-set-file':
      return 'Template set member';
    default:
      return label(kind);
  }
}

export function TemplateTransferReviewDialogHost() {
  const request = useTemplateTransferReviewDialogStore((state) => state.request);
  useEffect(() => {
    if (!request) return;
    const close = () => useTemplateTransferReviewDialogStore.getState().close(request);
    if (request.owner.closed) {
      close();
      return;
    }
    request.owner.addEventListener('pagehide', close);
    return () => request.owner.removeEventListener('pagehide', close);
  }, [request]);
  if (!request || request.owner.closed) return null;
  return createPortal(<TransferReviewDialog request={request} />, request.owner.document.body);
}

function TransferReviewDialog({ request }: { request: TemplateTransferReviewRequest }) {
  const [templateId, setTemplateId] = useState(request.members?.[0]?.id);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = () => useTemplateTransferReviewDialogStore.getState().close(request);
  const result = useMemo(() => {
    try {
      return { session: request.session(templateId) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [request, templateId]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (request.trigger?.isConnected) request.trigger.focus();
    };
  }, [request]);

  return (
    <dialog
      ref={ref}
      className="template-transfer-review"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={titleId}>Review template transfer</h2>
      </header>
      {request.members && request.members.length > 1 && (
        <label className="template-transfer-member">
          Source template
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            {request.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {result.session ? (
        <TransferReviewOptions
          key={templateId ?? 'template'}
          request={request}
          session={result.session}
        />
      ) : (
        <>
          <p role="alert" className="template-transfer-alert">
            {result.error}
          </p>
          <footer>
            <button type="button" onClick={close}>
              Cancel
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}

function TransferReviewOptions({
  request,
  session,
}: {
  request: TemplateTransferReviewRequest;
  session: TemplateTransferReviewSession;
}) {
  const [policy, setPolicy] = useState<Policy>('keep-appearance');
  const [inheritSettings, setInheritSettings] = useState(false);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [fallback, setFallback] = useState<TemplateTransferReviewPlan['report'] | null>(null);
  const [applyError, setApplyError] = useState('');
  const result = useMemo(() => {
    try {
      return { plan: session.plan({ policy, inheritSettings, mappings }) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [session, policy, inheritSettings, mappings]);
  const { plan } = result;
  const report = plan?.report ?? fallback;
  const [preview, setPreview] = useState<{
    plan: TemplateTransferReviewPlan;
    images?: Preview;
    error?: string;
  }>();
  const previewQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (!plan) return;
    const controller = new AbortController();
    previewQueue.current = previewQueue.current.then(async () => {
      if (controller.signal.aborted) return;
      try {
        const images = await previewTemplateTransfer(plan, controller.signal);
        if (!controller.signal.aborted) setPreview({ plan, images });
      } catch (error) {
        if (!controller.signal.aborted) setPreview({ plan, error: errorMessage(error) });
      }
    });
    return () => controller.abort();
  }, [plan]);

  const activePreview = preview?.plan === plan ? preview : undefined;
  const close = () => useTemplateTransferReviewDialogStore.getState().close(request);
  const apply = () => {
    if (!plan || plan.blockedReason || !activePreview) return;
    if (useTemplateTransferReviewDialogStore.getState().request !== request) return;
    try {
      const committed = plan.commit();
      useTemplateTransferReviewDialogStore.getState().close(request, committed);
    } catch (error) {
      setApplyError(errorMessage(error));
    }
  };
  const replaceMapping = (row: MappingRow, mapping: Mapping | null) => {
    if (plan) setFallback(plan.report);
    setApplyError('');
    setMappings((current) => {
      const others = current.filter(
        (item) => !(item.kind === row.kind && item.sourceId === row.sourceId),
      );
      return mapping ? [...others, mapping] : others;
    });
  };
  const warnings = new Set([
    ...(report?.warnings ?? []),
    ...(activePreview?.images?.warnings ?? []),
  ]);

  return (
    <>
      <div className="template-transfer-document-pair">
        <div>
          <small>Source</small>
          <strong>{session.source.name}</strong>
          <span>{sourceKind(session.source.kind)}</span>
          {session.source.brandKitName && <span>Brand Kit · {session.source.brandKitName}</span>}
        </div>
        <div>
          <small>Destination</small>
          <strong>{session.destination.name}</strong>
          <span>Brand Kit · {session.destination.brandKitName ?? 'None'}</span>
        </div>
      </div>
      <fieldset className="template-transfer-policies">
        <legend>Branding</legend>
        {session.availablePolicies.map((choice) => (
          <label key={choice.policy}>
            <input
              type="radio"
              name="template-transfer-policy"
              value={choice.policy}
              checked={policy === choice.policy}
              disabled={!choice.enabled}
              onChange={() => {
                setPolicy(choice.policy);
                setMappings([]);
                setFallback(null);
                setApplyError('');
              }}
            />
            <span>
              <strong>{POLICIES[choice.policy].label}</strong>
              <small>{choice.enabled ? POLICIES[choice.policy].hint : choice.reason}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="template-transfer-settings">
        <input
          type="checkbox"
          checked={inheritSettings}
          disabled={!session.destination.hasSettings}
          onChange={(event) => {
            setInheritSettings(event.currentTarget.checked);
            setApplyError('');
          }}
        />
        Use destination canvas settings
      </label>
      {report?.settingsDifferences.length ? (
        <details className="template-transfer-details">
          <summary>Canvas settings comparison</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Source</th>
                <th scope="col">Destination</th>
              </tr>
            </thead>
            <tbody>
              {report.settingsDifferences.map(({ key, source, destination }) => (
                <tr key={key}>
                  <th scope="row">{label(key)}</th>
                  <td>{describe(source)}</td>
                  <td>{describe(destination)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      {report?.mappings.length ? (
        <section className="template-transfer-mappings" aria-label="Brand mappings">
          <h3>Brand mappings</h3>
          {report.brandingSummary && (
            <p className="template-transfer-mapping-totals">
              {report.brandingSummary.linked} linked · {report.brandingSummary.preserved} kept local
              {' · '}
              {report.brandingSummary.overrides} overrides · {report.brandingSummary.unresolved}{' '}
              unresolved roles
            </p>
          )}
          {report.mappings.map((row) => (
            <MappingEditor
              key={`${row.kind}:${row.sourceId}`}
              row={row}
              policy={policy}
              edit={mappings.find(
                (item) => item.kind === row.kind && item.sourceId === row.sourceId,
              )}
              onChange={(mapping) => replaceMapping(row, mapping)}
            />
          ))}
        </section>
      ) : null}
      {plan && <DependencyInventory plan={plan} />}
      {plan && (
        <section
          className="template-transfer-preview"
          aria-label="Appearance preview"
          aria-busy={!activePreview}
        >
          <h3>Appearance preview</h3>
          {!activePreview && <p role="status">Rendering the comparison…</p>}
          {activePreview?.error && <p role="status">Preview unavailable. {activePreview.error}</p>}
          {activePreview?.images && (
            <div className="template-transfer-preview-pair">
              <figure>
                <figcaption>Source · Frame {activePreview.images.before.frame}</figcaption>
                <img
                  src={`data:${activePreview.images.before.mimeType};base64,${activePreview.images.before.data}`}
                  alt="Source appearance"
                />
              </figure>
              <figure>
                <figcaption>After transfer · Frame {activePreview.images.after.frame}</figcaption>
                <img
                  src={`data:${activePreview.images.after.mimeType};base64,${activePreview.images.after.data}`}
                  alt="Appearance after transfer"
                />
              </figure>
            </div>
          )}
        </section>
      )}
      {warnings.size > 0 && (
        <ul className="template-transfer-warnings" aria-label="Transfer warnings">
          {[...warnings].map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {(result.error || plan?.blockedReason || applyError) && (
        <p role="alert" className="template-transfer-alert">
          {applyError || result.error || plan?.blockedReason}
        </p>
      )}
      <footer>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!plan || !!plan.blockedReason || !activePreview || !!applyError}
          onClick={apply}
        >
          Apply transfer
        </button>
      </footer>
    </>
  );
}

function DependencyInventory({ plan }: { plan: TemplateTransferReviewPlan }) {
  const dependencies = plan.report.dependencies;
  if (!dependencies || (!dependencies.assets.length && !dependencies.components.length))
    return null;
  const { assets, components } = dependencies;
  return (
    <details className="template-transfer-details">
      <summary>
        Source dependencies · {assets.length} {assets.length === 1 ? 'asset' : 'assets'} ·{' '}
        {components.length} {components.length === 1 ? 'component' : 'components'}
      </summary>
      {!!assets.length && (
        <ul aria-label="Source assets">
          {assets.slice(0, 20).map((asset) => (
            <li key={`${asset.compositionId}:${asset.id}`}>
              {asset.name} · {label(asset.kind)}
            </li>
          ))}
          {assets.length > 20 && <li>{assets.length - 20} more assets</li>}
        </ul>
      )}
      {!!components.length && (
        <ul aria-label="Source components">
          {components.slice(0, 20).map((component) => (
            <li key={`${component.compositionId}:${component.id}`}>{component.name}</li>
          ))}
          {components.length > 20 && <li>{components.length - 20} more components</li>}
        </ul>
      )}
    </details>
  );
}

function MappingEditor({
  row,
  policy,
  edit,
  onChange,
}: {
  row: MappingRow;
  policy: Policy;
  edit?: Mapping;
  onChange: (mapping: Mapping | null) => void;
}) {
  const identity = { kind: row.kind, sourceId: row.sourceId };
  const suggested: Mapping | null =
    row.action === 'link' && row.destinationId
      ? { ...identity, action: 'link', destinationId: row.destinationId }
      : row.action === 'import'
        ? { ...identity, action: 'import', destinationKey: row.destinationKey }
        : null;
  const chosen = edit ?? suggested;
  const selection = edit?.action === 'link' ? `link:${edit.destinationId}` : (edit?.action ?? '');
  const allowImport = policy === 'bring-source-branding';
  const description = row.destinationLabel
    ? row.destinationLabel
    : row.action === 'keep-local'
      ? 'Keep local'
      : label(row.action);
  const mappingLabel = `${row.sourceLabel} ${label(row.kind)}`;
  return (
    <article>
      <div className="template-transfer-mapping-heading">
        <div>
          <strong>{row.sourceLabel}</strong>
          <small>
            {label(row.kind)}
            {row.sourceType && row.sourceType !== row.kind && ` · ${label(row.sourceType)}`}
            {row.sourceKey && ` · ${row.sourceKey}`}
          </small>
        </div>
        <ColorValue value={row.sourceValue} />
        <div>
          <span>{description}</span>
          {row.destinationKey && <small>{row.destinationKey}</small>}
          {row.destinationValue !== undefined && <ColorValue value={row.destinationValue} />}
        </div>
      </div>
      {policy !== 'keep-appearance' && (
        <div className="template-transfer-mapping-controls">
          <label>
            Mapping
            <select
              aria-label={`Mapping for ${mappingLabel}`}
              value={selection}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (!value) onChange(null);
                else if (value === 'keep-local' || value === 'import')
                  onChange({ ...identity, action: value });
                else if (value.startsWith('link:'))
                  onChange({ ...identity, action: 'link', destinationId: value.slice(5) });
              }}
            >
              <option value="">Use proposed mapping</option>
              <option value="keep-local">Keep local</option>
              {row.candidates.map((candidate) => (
                <option key={candidate.id} value={`link:${candidate.id}`}>
                  Link to {candidate.label}
                  {candidate.key ? ` (${candidate.key})` : ''}
                </option>
              ))}
              {allowImport && <option value="import">Import definition</option>}
            </select>
          </label>
          {allowImport && chosen?.action === 'import' && row.kind === 'token' && (
            <label>
              Destination key
              <input
                key={chosen.destinationKey ?? row.destinationKey ?? row.sourceKey ?? ''}
                aria-label={`Destination key for ${row.sourceLabel}`}
                defaultValue={chosen.destinationKey ?? row.destinationKey ?? row.sourceKey ?? ''}
                onBlur={(event) => {
                  const destinationKey = event.currentTarget.value.trim();
                  const current =
                    chosen.destinationKey ?? row.destinationKey ?? row.sourceKey ?? '';
                  if (destinationKey !== current)
                    onChange({ ...chosen, destinationKey: destinationKey || undefined });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </label>
          )}
          {chosen && chosen.action !== 'keep-local' && row.overridesCount > 0 && (
            <label className="template-transfer-reset">
              <input
                type="checkbox"
                checked={edit?.resetOverrides === true}
                onChange={(event) =>
                  onChange({ ...chosen, resetOverrides: event.currentTarget.checked })
                }
              />
              Reset {row.overridesCount} {row.overridesCount === 1 ? 'override' : 'overrides'}
            </label>
          )}
        </div>
      )}
      {row.affectedCount > 0 && (
        <details>
          <summary>
            {row.affectedCount} {row.affectedCount === 1 ? 'binding' : 'bindings'}
            {row.overridesCount > 0 && ` · ${row.overridesCount} local overrides`}
          </summary>
          <ul>
            {row.uses.map((use) => (
              <li key={`${use.compositionId}:${use.layerId ?? ''}:${use.property}`}>
                {use.layerName ?? 'Composition'} · {label(use.property)}
                {use.overridden && ' · local override'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {row.conflicts.length > 0 && (
        <ul className="template-transfer-warnings">
          {row.conflicts.map((conflict) => (
            <li key={conflict}>{conflict}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
