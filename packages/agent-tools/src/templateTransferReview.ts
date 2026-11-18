import * as z from 'zod/v4';
import type { BrowserCaptureResult } from './browserCaptureResult';

export const TEMPLATE_TRANSFER_CAPABILITY = 'template-transfer-v1';
export const WORKSPACE_TRANSFER_REVISION_PREFIX = 'workspace-file:';
export const MAX_TEMPLATE_TRANSFER_FILE_BYTES = 64 * 1024 * 1024;

const id = z.string().min(1).max(256);
export const templateTransferMappingSchema = z
  .object({
    kind: z.enum(['token', 'typography', 'background']),
    sourceId: id,
    action: z.enum(['link', 'keep-local', 'import']),
    destinationId: id.optional(),
    destinationKey: id.optional(),
    resetOverrides: z.boolean().optional(),
  })
  .strict();
export const templateTransferOptionsSchema = z
  .object({
    policy: z.enum(['keep-appearance', 'adopt-destination', 'bring-source-branding']),
    inheritSettings: z.boolean().optional(),
    mappings: z.array(templateTransferMappingSchema).max(1536).optional(),
  })
  .strict();

export type TemplateTransferMapping = z.infer<typeof templateTransferMappingSchema>;
export type TemplateTransferOptions = z.infer<typeof templateTransferOptionsSchema>;

export const templateTransferWorkspaceFileSchema = z
  .object({ path: z.string().min(1).max(4096), templateId: id.optional() })
  .strict();
export type TemplateTransferWorkspaceFile = z.infer<typeof templateTransferWorkspaceFileSchema>;
export const templateTransferSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clipboard') }).strict(),
  templateTransferWorkspaceFileSchema.extend({ kind: z.literal('workspace-file') }),
]);

export type TemplateTransferSource =
  | { kind: 'clipboard' }
  | {
      kind: 'workspace-file';
      filename: string;
      bytesBase64: string;
      sourceRevision: string;
      templateId?: string;
    };

interface TemplateTransferPlanReference {
  expectedRevision: string;
  planId: string;
  sourceRevision: string;
}

export type TemplateTransferRequest =
  | {
      action: 'transfer-review';
      expectedRevision: string;
      source: TemplateTransferSource;
      options: TemplateTransferOptions;
      targetTemplateId?: string | null;
      side?: 'before' | 'after';
      originalPrompt?: string;
      offset?: number;
      limit?: number;
    }
  | (TemplateTransferPlanReference & { action: 'transfer-preview' })
  | (TemplateTransferPlanReference & { action: 'transfer-commit' });

export function isTemplateTransferRequest(request: {
  action: string;
}): request is TemplateTransferRequest {
  return (
    request.action === 'transfer-review' ||
    request.action === 'transfer-preview' ||
    request.action === 'transfer-commit'
  );
}

type TemplateTransferCapture = BrowserCaptureResult & { frame: number };
export interface TemplateTransferCaptures {
  before: TemplateTransferCapture;
  after: TemplateTransferCapture;
}
