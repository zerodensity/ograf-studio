import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import {
  buildDataExposureTree,
  exposureFieldPatch,
  flattenExposureFields,
  type ExposureFieldNode,
  type ExposureTreeNode,
} from './dataExposureTree';
import './DataExposureSection.css';

type ExposureFilter = 'all' | 'exposed' | 'internal';
type ExposureCheckState = boolean | 'mixed';

function findNode(nodes: ExposureTreeNode[], id: string): ExposureTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return undefined;
}

function filterTree(
  nodes: ExposureTreeNode[],
  query: string,
  filter: ExposureFilter,
  parentMatches = false,
): ExposureTreeNode[] {
  return nodes.flatMap((node) => {
    const field = node.kind === 'field' ? node : undefined;
    const text = `${node.label} ${node.detail ?? ''} ${field?.keyPath ?? ''}`.toLocaleLowerCase();
    const matches = parentMatches || !query || text.includes(query);
    const children = filterTree(node.children, query, filter, matches);
    const statusMatches =
      filter === 'all' ||
      (filter === 'exposed' ? field?.effectiveExposed : !field?.effectiveExposed);
    if (children.length || (node.kind === 'field' && matches && statusMatches))
      return [{ ...node, children }];
    return [];
  });
}

function TreeIcon({ kind }: { kind: ExposureTreeNode['kind'] }) {
  return (
    <svg className={`exposure-icon exposure-icon-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={
          kind === 'field'
            ? 'M3 2h10v12H3zM5 5h6M5 8h6M5 11h4'
            : kind === 'layer'
              ? 'm8 1 7 4-7 4-7-4 7-4M1 8l7 4 7-4M1 11l7 4 7-4'
              : 'M1 4V2h5l2 2h7v10H1z'
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DataExposureSection() {
  const composition = useActiveComposition();
  const templateName = useProjectStore((state) => state.project.name);
  const updateDataField = useProjectStore((state) => state.updateDataField);
  const tree = useMemo(() => buildDataExposureTree(composition), [composition]);
  const controls = useMemo(() => flattenExposureFields(tree), [tree]);
  const branchControls = useMemo(() => {
    const result = new Map<string, ExposureFieldNode[]>();
    const visit = (nodes: ExposureTreeNode[]) => {
      for (const node of nodes) {
        if (node.kind !== 'field') result.set(node.id, flattenExposureFields([node]));
        visit(node.children);
      }
    };
    visit(tree);
    return result;
  }, [tree]);
  const checkState = (node: ExposureTreeNode): ExposureCheckState => {
    if (node.kind === 'field') return node.authoredExposed;
    const descendants = branchControls.get(node.id) ?? [];
    const count = descendants.filter((field) => field.effectiveExposed).length;
    return count === 0 ? false : count === descendants.length ? true : 'mixed';
  };
  const exposedCount = controls.filter((node) => node.effectiveExposed).length;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ExposureFilter>('all');
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rowsRef = useRef(new Map<string, HTMLDivElement>());
  const filtering = !!query.trim() || filter !== 'all';
  const filteredTree = useMemo(
    () => filterTree(tree, query.trim().toLocaleLowerCase(), filter),
    [tree, query, filter],
  );
  const rows: Array<{ node: ExposureTreeNode; parentId?: string }> = [];
  const visit = (nodes: ExposureTreeNode[], parentId?: string) => {
    for (const node of nodes) {
      rows.push({ node, parentId });
      if (filtering || !collapsed.has(node.id)) visit(node.children, node.id);
    }
  };
  visit(filteredTree);
  const activeId = rows.find(({ node }) => node.id === focusedId)?.node.id ?? rows[0]?.node.id;
  const focusRow = (id: string) => {
    setFocusedId(id);
    rowsRef.current.get(id)?.focus();
  };
  const toggleExpanded = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setExposed = (node: ExposureTreeNode, exposed: boolean) => {
    // Read the latest field so a nested exposure edit cannot overwrite a concurrent value edit.
    const state = useProjectStore.getState();
    if (state.activeCompositionId !== composition.id) return;
    const currentComposition = state.project.compositions.find(
      (candidate) => candidate.id === composition.id,
    );
    if (!currentComposition) return;
    if (node.kind === 'field') {
      const root = currentComposition.dataFields.find((field) => field.id === node.rootFieldId);
      if (root) updateDataField(root.id, exposureFieldPatch(root, node.path, exposed));
    } else {
      // Bulk controls always address the complete branch, independent of the visible filter.
      const currentNode = findNode(buildDataExposureTree(currentComposition), node.id);
      if (!currentNode || currentNode.kind === 'field') return;
      state.setDataFieldsExposure(
        flattenExposureFields([currentNode]).map((field) => field.rootFieldId),
        exposed,
      );
    }
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>, node: ExposureTreeNode) => {
    if (event.target !== event.currentTarget) {
      if (
        !(event.target instanceof HTMLInputElement) ||
        event.target.closest('[role="treeitem"]') !== event.currentTarget
      )
        return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.stopPropagation();
        return;
      }
    }
    const index = rows.findIndex((entry) => entry.node.id === node.id);
    const expanded = filtering || !collapsed.has(node.id);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (rows[index + 1]) focusRow(rows[index + 1]!.node.id);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (rows[index - 1]) focusRow(rows[index - 1]!.node.id);
        break;
      case 'Home':
      case 'End':
        event.preventDefault();
        if (rows.length) focusRow(rows[event.key === 'Home' ? 0 : rows.length - 1]!.node.id);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (!expanded && node.children.length) toggleExpanded(node.id);
        else if (node.children[0]) focusRow(node.children[0].id);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (expanded && node.children.length && !filtering) toggleExpanded(node.id);
        else if (rows[index]?.parentId) focusRow(rows[index]!.parentId!);
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        setExposed(node, checkState(node) !== true);
        break;
      default:
        return;
    }
    event.stopPropagation();
  };
  const renderNodes = (nodes: ExposureTreeNode[], depth = 0) =>
    nodes.map((node) => {
      const expanded = filtering || !collapsed.has(node.id);
      const field = node.kind === 'field' ? node : undefined;
      const descendants = branchControls.get(node.id) ?? [];
      const checked = checkState(node);
      const exposedDescendants = descendants.filter((field) => field.effectiveExposed).length;
      const branchStatus = checked === 'mixed' ? 'Some shown' : checked ? 'All shown' : 'Internal';
      const status = !field?.authoredExposed
        ? 'Internal'
        : field.blockedReason === 'parent'
          ? 'Parent hidden'
          : field.blockedReason === 'items'
            ? 'Items hidden'
            : 'Shown to operator';
      const help = [
        node.label,
        field ? `${field.keyPath} · ${field.field.type}` : node.detail,
        field ? node.detail : undefined,
        field?.blockedBy ? `Not exposed because ${field.blockedBy} is internal.` : undefined,
      ]
        .filter(Boolean)
        .join('\n');
      return (
        <div
          key={node.id}
          className="exposure-item"
          role="treeitem"
          aria-label={`${node.label}, ${field ? status : branchStatus}`}
          aria-level={depth + 1}
          aria-expanded={node.children.length ? expanded : undefined}
          aria-checked={checked}
          tabIndex={activeId === node.id ? 0 : -1}
          ref={(element) => {
            if (element) rowsRef.current.set(node.id, element);
            else rowsRef.current.delete(node.id);
          }}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocusedId(node.id);
          }}
          onKeyDown={(event) => handleKey(event, node)}
        >
          <div
            className={`exposure-row${field ? ' exposure-field' : ' exposure-owner'}${field && !field.effectiveExposed ? ' exposure-internal' : ''}`}
            style={{ paddingLeft: 5 + depth * 14 }}
            title={help}
            onClick={() => {
              focusRow(node.id);
              if (!field && node.children.length && !filtering) toggleExpanded(node.id);
            }}
          >
            <button
              type="button"
              className="exposure-expander"
              tabIndex={-1}
              disabled={!node.children.length || filtering}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
              onClick={(event) => {
                event.stopPropagation();
                focusRow(node.id);
                toggleExpanded(node.id);
              }}
            >
              {node.children.length ? (expanded ? '▾' : '▸') : null}
            </button>
            <TreeIcon kind={node.kind} />
            <span className="exposure-name">{node.label}</span>
            {field ? (
              <>
                <span className="exposure-type" aria-hidden="true">
                  {field.field.type}
                </span>
                <span className={`exposure-status${field.effectiveExposed ? ' is-exposed' : ''}`}>
                  {status}
                </span>
                <input
                  type="checkbox"
                  tabIndex={-1}
                  checked={field.authoredExposed}
                  aria-label={`Show ${node.label} to the operator`}
                  title={
                    field.blockedBy
                      ? `Enable this control locally. ${field.blockedBy} must also be exposed.`
                      : 'Show to the operator. Uncheck to keep this control internal.'
                  }
                  onClick={(event) => event.stopPropagation()}
                  onFocus={() => setFocusedId(node.id)}
                  onChange={(event) => setExposed(node, event.target.checked)}
                />
              </>
            ) : (
              <>
                <span className="exposure-owner-count">
                  {exposedDescendants}/{descendants.length}
                </span>
                <input
                  type="checkbox"
                  tabIndex={-1}
                  checked={checked === true}
                  aria-checked={checked}
                  aria-label={`Show all controls in ${node.label} to the operator`}
                  title={`${checked === true ? 'Hide' : 'Show'} all ${descendants.length} controls in ${node.label}, including collapsed and filtered controls.`}
                  ref={(element) => {
                    if (element) element.indeterminate = checked === 'mixed';
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onFocus={() => setFocusedId(node.id)}
                  onChange={(event) => setExposed(node, event.target.checked)}
                />
              </>
            )}
          </div>
          {expanded && node.children.length > 0 ? (
            <div role="group">{renderNodes(node.children, depth + 1)}</div>
          ) : null}
        </div>
      );
    });

  return (
    <div className="data-exposure">
      <div className="exposure-toolbar">
        <input
          type="search"
          aria-label="Search exposure controls"
          placeholder="Search controls…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filter controls by exposure"
          value={filter}
          onChange={(event) => setFilter(event.target.value as ExposureFilter)}
        >
          <option value="all">All</option>
          <option value="exposed">Shown to operator</option>
          <option value="internal">Internal</option>
        </select>
        <button
          type="button"
          aria-label="Expand all exposure controls"
          title="Expand all"
          disabled={filtering || !controls.length}
          onClick={() => setCollapsed(new Set())}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Collapse all exposure controls"
          title="Collapse all"
          disabled={filtering || !controls.length}
          onClick={() => {
            const ids = new Set<string>();
            const collect = (nodes: ExposureTreeNode[]) => {
              for (const node of nodes) {
                if (node.children.length) ids.add(node.id);
                collect(node.children);
              }
            };
            collect(tree);
            setCollapsed(ids);
          }}
        >
          −
        </button>
      </div>
      <div className="exposure-summary">
        <span title={templateName}>{templateName}</span>
        <span>
          {exposedCount}/{controls.length} shown
        </span>
      </div>
      {controls.length ? (
        filteredTree.length ? (
          <div className="exposure-tree" role="tree" aria-label="OGraf exposure controls">
            {renderNodes(filteredTree)}
          </div>
        ) : (
          <p className="exposure-empty">No controls match these filters.</p>
        )
      ) : (
        <p className="exposure-empty">
          Add data fields or shader controls to manage their exposure here.
        </p>
      )}
    </div>
  );
}
