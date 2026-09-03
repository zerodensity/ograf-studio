import type { ReactNode } from 'react';
export function ResourceTreeBranch({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="resources-tree-branch" role="treeitem">
      <summary>
        <span className="resources-tree-label">{label}</span>
        <span className="resources-tree-count">{count}</span>
      </summary>
      <div className="resources-tree-group" role="group">
        {children}
      </div>
    </details>
  );
}

export function ResourceTreeItem({
  label,
  meta,
  preview,
  children,
}: {
  label: string;
  meta?: string;
  preview?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="resources-tree-item" role="treeitem">
      <summary title={label}>
        {preview ?? <span className="resources-tree-item-icon">R</span>}
        <span className="resources-tree-item-copy">
          <span className="resources-tree-item-name">{label}</span>
          {meta && <span className="resources-tree-item-meta">{meta}</span>}
        </span>
      </summary>
      <div className="resources-tree-item-editor">{children}</div>
    </details>
  );
}
