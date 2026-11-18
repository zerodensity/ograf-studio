import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { isProjectSourcePath } from '@ograf-editor/scene-model';
import type { AuthoringWorkspacePort } from './ports';
import {
  MAX_TEMPLATE_TRANSFER_FILE_BYTES,
  WORKSPACE_TRANSFER_REVISION_PREFIX,
  type TemplateTransferWorkspaceFile,
} from './templateTransferReview';

/** Bind a transfer revision to the selected workspace path, archive member and exact bytes. */
export async function readTemplateTransferFile(
  workspace: AuthoringWorkspacePort,
  source: TemplateTransferWorkspaceFile,
) {
  const target = workspace.resolveAllowedPath(source.path);
  if (!isProjectSourcePath(target) && !target.toLowerCase().endsWith('.ogp'))
    throw new Error('Choose an editable OGraf source file, such as .ogs or legacy .ogp.');
  const root = await realpath(workspace.root);
  const file = await realpath(target);
  const memberPath = relative(root, file);
  if (
    !memberPath ||
    memberPath === '..' ||
    memberPath.startsWith(`..${sep}`) ||
    isAbsolute(memberPath)
  )
    throw new Error('The transfer source must resolve to a file inside the workspace.');

  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    const { size } = info;
    if (!info.isFile() || size <= 0)
      throw new Error('A transfer source must be a nonempty editable file.');
    if (size > MAX_TEMPLATE_TRANSFER_FILE_BYTES)
      throw new Error('MCP transfer files are limited to 64 MiB. Review larger files in Studio.');
    const data = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(data, offset, size - offset, offset);
      if (!bytesRead)
        throw new Error('The transfer source changed while reading. Review it again.');
      offset += bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, size)).bytesRead)
      throw new Error('The transfer source changed while reading. Review it again.');
    const digest = createHash('sha256')
      .update(JSON.stringify([memberPath, source.templateId ?? null]))
      .update(data)
      .digest('hex');
    return {
      filename: basename(target),
      data,
      sourceRevision: WORKSPACE_TRANSFER_REVISION_PREFIX + digest,
    };
  } finally {
    await handle.close();
  }
}

export async function assertTemplateTransferFileRevision(
  workspace: AuthoringWorkspacePort,
  sourceRevision: string,
  source?: TemplateTransferWorkspaceFile,
): Promise<void> {
  if (!sourceRevision.startsWith(WORKSPACE_TRANSFER_REVISION_PREFIX)) {
    if (source) throw new Error('The reviewed transfer does not use a workspace file.');
    return;
  }
  if (!source)
    throw new Error('Provide the same workspaceFile path and member used to review the transfer.');
  if ((await readTemplateTransferFile(workspace, source)).sourceRevision !== sourceRevision)
    throw new Error('The workspace transfer source changed. Review it again before applying.');
}
