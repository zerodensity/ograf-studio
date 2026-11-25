import { createId, layerMotionWindows, type Project } from '@ograf-editor/scene-model';
import {
  MAX_TEMPLATE_TRANSFER_FILE_BYTES,
  templateTransferOptionsSchema,
  type TemplateTransferCaptures,
  type TemplateTransferOptions,
  type TemplateTransferRequest,
} from '@ograf-editor/agent-tools/template-transfer-review';
import { captureAgentPng, measureAgentText } from './agentCapture';
import {
  createProjectSet,
  DEFAULT_PROJECT_SET_NAME,
  resolveProjectSetTemplate,
} from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { parseStudioDocument, type StudioDocument } from './studioDocument';
import {
  captureTemplateSourceBrandKit,
  snapshotOpenTemplateSet,
  useTemplateClipboardStore,
} from './templateCommands';
import { currentTemplateSetRevision } from './templateSetBridge';
import {
  captureTemplateTransferDestination,
  commitTemplateTransfer,
  prepareTemplateTransfer,
  type TemplateTransferReport,
  type TemplateTransferSourceKind,
} from './templateTransfer';
import type { TemplateTransferSourceBrandKit } from './templateTransferBranding';

export type TemplateTransferPolicy = TemplateTransferOptions['policy'];
export const DEFAULT_TEMPLATE_TRANSFER_OPTIONS: TemplateTransferOptions = {
  policy: 'keep-appearance',
  inheritSettings: false,
};

interface ReviewSource {
  project: Project;
  kind: TemplateTransferSourceKind;
  revision: string;
  brandKit?: TemplateTransferSourceBrandKit;
}

interface ReviewPosition {
  targetTemplateId?: string | null;
  side?: 'before' | 'after';
  originalPrompt?: string;
}

interface FileReviewOptions extends ReviewPosition {
  templateId?: string;
  assertCurrentDestination?: () => void;
  sourceRevision?: string;
}

export interface TemplateTransferReviewPlan {
  report: TemplateTransferReport;
  beforeProject: Project;
  afterProject: Project;
  blockedReason?: string;
  assertCurrent(): void;
  commit(): { name: string; transfer: TemplateTransferReport };
}

export interface TemplateTransferReviewSession {
  source: { kind: TemplateTransferSourceKind; name: string; brandKitName?: string };
  sourceRevision: string;
  destination: { name: string; brandKitName?: string; hasSettings: boolean };
  availablePolicies: { policy: TemplateTransferPolicy; enabled: boolean; reason?: string }[];
  plan(options: TemplateTransferOptions): TemplateTransferReviewPlan;
}

function beginReview(
  source: ReviewSource,
  position: ReviewPosition,
  assertSource: () => void = () => {},
): TemplateTransferReviewSession {
  const assertDestination = captureTemplateTransferDestination();
  const existing = snapshotOpenTemplateSet();
  const destination =
    existing ?? createProjectSet(DEFAULT_PROJECT_SET_NAME, useProjectStore.getState().project);
  const assertCurrent = () => {
    assertSource();
    assertDestination();
  };
  const availablePolicies: TemplateTransferReviewSession['availablePolicies'] = [
    { policy: 'keep-appearance', enabled: true },
    {
      policy: 'adopt-destination',
      enabled: !!destination.brandKit,
      reason: destination.brandKit ? undefined : 'Create a Brand Kit in the destination first.',
    },
    {
      policy: 'bring-source-branding',
      enabled: !!source.brandKit,
      reason: source.brandKit
        ? undefined
        : 'This source contains resolved styling without a shared Brand Kit to recover.',
    },
  ];
  return {
    source: {
      kind: source.kind,
      name: source.project.name,
      brandKitName: source.brandKit?.kit.name,
    },
    sourceRevision: source.revision,
    destination: {
      name: destination.name,
      brandKitName: destination.brandKit?.name,
      hasSettings: !!destination.settings,
    },
    availablePolicies,
    plan(input) {
      assertCurrent();
      const options = templateTransferOptionsSchema.parse(input);
      const choice = availablePolicies.find(({ policy }) => policy === options.policy);
      if (!choice?.enabled)
        throw new Error(choice?.reason ?? 'This transfer policy is unavailable.');
      const prepared = prepareTemplateTransfer(destination, source.project, source.kind, {
        targetId: position.targetTemplateId,
        side: position.side,
        originalPrompt: position.originalPrompt,
        sourceBrandKit: source.brandKit,
        review: options,
      });
      const blockedReason = prepared.result.transfer.mappings.some(
        (row) => row.action !== 'keep-local' && !row.destinationId && row.conflicts.length > 0,
      )
        ? 'Resolve the conflicting mappings before applying the transfer.'
        : undefined;
      let committed = false;
      return {
        report: prepared.result.transfer,
        beforeProject: prepared.beforeProject!,
        afterProject: prepared.resolved,
        blockedReason,
        assertCurrent,
        commit() {
          if (committed) throw new Error('This transfer has already been applied.');
          if (blockedReason) throw new Error(blockedReason);
          assertCurrent();
          const result = commitTemplateTransfer(prepared, existing === null);
          committed = true;
          return result;
        },
      };
    },
  };
}

const clipboardRevisions = new WeakMap<object, string>();

/** A same-set copy still uses the regular Paste command. */
export function beginClipboardTransferReview(
  options: ReviewPosition = {},
): TemplateTransferReviewSession | null {
  const copied = useTemplateClipboardStore.getState().copied;
  if (!copied) throw new Error('Copy a template first.');
  if (useProjectSetStore.getState().projectSet?.id === copied.setId) return null;
  let revision = clipboardRevisions.get(copied);
  if (!revision) {
    revision = `clipboard:${createId('template-source')}`;
    clipboardRevisions.set(copied, revision);
  }
  return beginReview(
    {
      kind: 'clipboard',
      revision,
      project: { ...copied.resolved, name: copied.template.name },
      brandKit: copied.sourceBrandKit,
    },
    options,
    () => {
      if (useTemplateClipboardStore.getState().copied !== copied)
        throw new Error('The copied template changed. Open a new transfer review.');
    },
  );
}

export function beginFileTransferReview(
  document: StudioDocument,
  options: FileReviewOptions = {},
): TemplateTransferReviewSession {
  options.assertCurrentDestination?.();
  const revision = options.sourceRevision ?? `file-snapshot:${createId('template-source')}`;
  if (document.kind === 'template') {
    if (options.templateId) throw new Error('This file contains one standalone template.');
    return beginReview(
      { kind: 'resolved-file', revision, project: document.project },
      options,
      options.assertCurrentDestination,
    );
  }
  const set = document.projectSet;
  const id = options.templateId ?? (set.templates.length === 1 ? set.templates[0]?.id : undefined);
  const member = set.templates.find((template) => template.id === id);
  if (!member) throw new Error('Choose a template from the source set.');
  const project = resolveProjectSetTemplate(set, member.id);
  return beginReview(
    {
      kind: 'template-set-file',
      revision,
      project: { ...project, name: member.name },
      brandKit: captureTemplateSourceBrandKit(set, member),
    },
    options,
    options.assertCurrentDestination,
  );
}

function mainComposition(project: Project) {
  const main = project.compositions.find(({ id }) => id === project.mainCompositionId);
  if (!main) throw new Error('The template has no main composition to preview.');
  return main;
}

const previewFrame = (project: Project) =>
  layerMotionWindows(mainComposition(project))?.firstStep ?? 0;

export async function previewTemplateTransfer(
  plan: TemplateTransferReviewPlan,
  signal?: AbortSignal,
): Promise<TemplateTransferCaptures & { warnings: string[] }> {
  plan.assertCurrent();
  signal?.throwIfAborted();
  const capture = async (project: Project) => {
    const frame = previewFrame(project);
    const png = await captureAgentPng(
      { target: 'composition', project, frame, maxDimension: 640, matte: '#101820' },
      signal,
    );
    return { ...png, frame };
  };
  const before = await capture(plan.beforeProject);
  plan.assertCurrent();
  const after = await capture(plan.afterProject);
  const warnings = after.resolvedFonts.flatMap(({ layerName, requestedFamily, resolvedFamily }) => {
    const primary = requestedFamily
      .split(',')[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '');
    return primary && primary.toLowerCase() !== resolvedFamily.trim().toLowerCase()
      ? [
          `Preview found ${resolvedFamily} for “${layerName}”. Its first requested family is ${primary}.`,
        ]
      : [];
  });
  const main = mainComposition(plan.afterProject);
  const affected = new Set(
    plan.report.mappings.flatMap((row) =>
      row.action === 'keep-local'
        ? []
        : row.uses.flatMap(({ layerId }) => (layerId ? [layerId] : [])),
    ),
  );
  for (const layer of main.layers
    .filter(
      ({ id, element }) =>
        element.type === 'text' && (affected.has(id) || plan.report.inheritSettings),
    )
    .slice(0, 8)) {
    signal?.throwIfAborted();
    try {
      const measure = await measureAgentText({
        project: plan.afterProject,
        compositionId: main.id,
        layerId: layer.id,
        frame: after.frame,
      });
      if (measure.degenerate || measure.clippedBy === 'own-box' || measure.overflowsParent)
        warnings.push(`Check text fit on “${layer.name}” in the proposed template.`);
    } catch {
      warnings.push(`Text fit could not be measured for “${layer.name}”.`);
    }
  }
  signal?.throwIfAborted();
  plan.assertCurrent();
  return { before, after, warnings: [...new Set(warnings)].slice(0, 12) };
}

interface ReviewedPlan {
  key: string;
  plan: TemplateTransferReviewPlan;
  expectedRevision: string;
  sourceRevision: string;
  source: TemplateTransferReviewSession['source'];
  destination: TemplateTransferReviewSession['destination'];
  availablePolicies: TemplateTransferReviewSession['availablePolicies'];
}

const reviewedPlans = new Map<string, ReviewedPlan>();

function assertReviewRevision(expectedRevision: string, expiresAt?: number) {
  if (currentTemplateSetRevision() !== expectedRevision)
    throw new Error('Template-set revision conflict. Start a new transfer review.');
  if (expiresAt !== undefined && Date.now() >= expiresAt)
    throw new Error('The transfer request expired. Start a new transfer review.');
}

function describePlan(planId: string, entry: ReviewedPlan, offset: number, limit: number) {
  const { mappings, dependencies, ...report } = entry.plan.report;
  const total = Math.max(
    mappings.length,
    dependencies?.assets.length ?? 0,
    dependencies?.components.length ?? 0,
  );
  const page = mappings.slice(offset, offset + limit).map((row) => ({
    ...row,
    candidates: row.candidates.slice(0, 16),
    uses: row.uses.slice(0, 12),
    candidateCount: row.candidates.length,
  }));
  return {
    planId,
    expectedRevision: entry.expectedRevision,
    sourceRevision: entry.sourceRevision,
    source: entry.source,
    destination: entry.destination,
    availablePolicies: entry.availablePolicies,
    blockedReason: entry.plan.blockedReason,
    report: {
      ...report,
      mappings: page,
      ...(dependencies
        ? {
            dependencies: {
              assets: dependencies.assets.slice(offset, offset + limit),
              components: dependencies.components.slice(offset, offset + limit),
              assetCount: dependencies.assets.length,
              componentCount: dependencies.components.length,
            },
          }
        : {}),
    },
    pagination: {
      total,
      mappingCount: mappings.length,
      offset,
      limit,
      nextOffset: offset + limit < total ? offset + limit : null,
    },
  };
}

/** Keep reviewed candidates in the editor; only bounded metadata and captures cross MCP. */
export async function handleTemplateTransferRequest(
  request: TemplateTransferRequest,
  { expiresAt }: { expiresAt?: number } = {},
): Promise<{ result: Record<string, unknown>; captures?: TemplateTransferCaptures }> {
  assertReviewRevision(request.expectedRevision, expiresAt);
  if (request.action === 'transfer-review') {
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 25;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new Error('Review pagination requires an offset of at least zero and a limit of 1–50.');
    const source = request.source;
    // Clipboard revisions already include the current clipboard through the destination epoch.
    const sourceKey = source.kind === 'clipboard' ? 'clipboard' : source.sourceRevision;
    const key = JSON.stringify([
      request.expectedRevision,
      sourceKey,
      request.options,
      request.targetTemplateId,
      request.side,
      request.originalPrompt,
    ]);
    for (const [planId, entry] of reviewedPlans) {
      if (entry.expectedRevision !== request.expectedRevision) {
        reviewedPlans.delete(planId);
        continue;
      }
      if (entry.key === key) {
        entry.plan.assertCurrent();
        return { result: describePlan(planId, entry, offset, limit) };
      }
    }
    const position = {
      targetTemplateId: request.targetTemplateId,
      side: request.side,
      originalPrompt: request.originalPrompt,
    };
    let session: TemplateTransferReviewSession | null;
    if (source.kind === 'clipboard') {
      session = beginClipboardTransferReview(position);
    } else {
      if (source.bytesBase64.length > Math.ceil(MAX_TEMPLATE_TRANSFER_FILE_BYTES / 3) * 4)
        throw new Error('The source exceeds the supported MCP file size.');
      const assertCurrentDestination = captureTemplateTransferDestination();
      const raw = atob(source.bytesBase64);
      if (raw.length > MAX_TEMPLATE_TRANSFER_FILE_BYTES)
        throw new Error('The source exceeds the supported MCP file size.');
      const document = await parseStudioDocument(
        Uint8Array.from(raw, (byte) => byte.charCodeAt(0)),
        source.filename,
      );
      assertReviewRevision(request.expectedRevision, expiresAt);
      if (
        document.kind === 'template-set' &&
        !source.templateId &&
        document.projectSet.templates.length !== 1
      ) {
        const { name, brandKit, templates } = document.projectSet;
        if (!templates.length) throw new Error('The source set contains no templates.');
        const sourceTemplates = templates
          .slice(offset, offset + limit)
          .map(({ id, name }) => ({ id, name }));
        return {
          result: {
            status: 'select-source-template',
            expectedRevision: request.expectedRevision,
            sourceRevision: source.sourceRevision,
            source: { kind: 'template-set-file', name, brandKitName: brandKit?.name },
            sourceTemplates,
            pagination: {
              total: templates.length,
              offset,
              limit,
              nextOffset:
                offset + sourceTemplates.length < templates.length
                  ? offset + sourceTemplates.length
                  : null,
            },
          },
        };
      }
      session = beginFileTransferReview(document, {
        ...position,
        assertCurrentDestination,
        templateId: source.templateId,
        sourceRevision: source.sourceRevision,
      });
    }
    if (!session) throw new Error('Use paste_template for a copy within the same template set.');
    const plan = session.plan(request.options);
    assertReviewRevision(request.expectedRevision, expiresAt);
    const planId = createId('transfer-plan');
    const entry = {
      key,
      plan,
      expectedRevision: request.expectedRevision,
      sourceRevision: session.sourceRevision,
      source: session.source,
      destination: session.destination,
      availablePolicies: session.availablePolicies,
    };
    reviewedPlans.set(planId, entry);
    if (reviewedPlans.size > 4) reviewedPlans.delete(reviewedPlans.keys().next().value!);
    return { result: describePlan(planId, entry, offset, limit) };
  }

  const entry = reviewedPlans.get(request.planId);
  if (
    !entry ||
    entry.expectedRevision !== request.expectedRevision ||
    entry.sourceRevision !== request.sourceRevision
  )
    throw new Error('The transfer plan or source revision changed. Start a new transfer review.');
  entry.plan.assertCurrent();
  if (request.action === 'transfer-preview') {
    const signal =
      expiresAt === undefined
        ? undefined
        : AbortSignal.timeout(Math.max(1, expiresAt - Date.now()));
    const { before, after, warnings } = await previewTemplateTransfer(entry.plan, signal);
    assertReviewRevision(request.expectedRevision, expiresAt);
    return {
      result: {
        planId: request.planId,
        expectedRevision: entry.expectedRevision,
        sourceRevision: entry.sourceRevision,
        warnings,
      },
      captures: { before, after },
    };
  }
  const { name } = entry.plan.commit();
  const { report, pagination } = describePlan(request.planId, entry, 0, 25);
  reviewedPlans.clear();
  return {
    result: {
      name,
      transfer: report,
      pagination: { ...pagination, nextOffset: null, truncated: pagination.nextOffset !== null },
      planId: request.planId,
      sourceRevision: entry.sourceRevision,
      revision: currentTemplateSetRevision(),
    },
  };
}
