import { useLayoutEffect, useRef, type RefObject } from 'react';

const FILTERABLE_SELECTOR = [
  '[data-property-filter-row]',
  '.inspector-hint',
  '.inspector-error',
  '.inspector-playout-warning',
  '.inspector-evaluated-pose',
  '.inspector-font-preview',
  '.inspector-button-row',
  '.inspector-binding',
  '.effect-stack-add',
  '.effect-stack-drop-hint',
  '.effect-stack-error',
  '.effect-stack-item',
  '.media-paint-import',
  '.media-paint-pending',
  '.paint-stops',
  '.shader-source-actions',
  '.shader-source-label',
].join(',');

export function propertyFilterTokens(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesPropertyFilter(text: string, query: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return propertyFilterTokens(query).every((token) => normalized.includes(token));
}

function filterText(element: HTMLElement): string {
  const help = Array.from(element.querySelectorAll<HTMLElement>('[data-property-help]'))
    .map((candidate) => candidate.dataset.propertyHelp ?? '')
    .join(' ');
  return `${element.textContent ?? ''} ${help}`;
}

export function usePropertiesFilter(
  containerRef: RefObject<HTMLElement | null>,
  query: string,
): void {
  const previousOpen = useRef(new Map<HTMLDetailsElement, boolean>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const candidates = Array.from(container.querySelectorAll<HTMLElement>(FILTERABLE_SELECTOR));
    const sections = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('details.collapsible-section'),
    );
    const filtering = propertyFilterTokens(query).length > 0;
    container.toggleAttribute('data-property-filtering', filtering);

    if (!filtering) {
      for (const candidate of candidates) {
        candidate.hidden = false;
        delete candidate.dataset.propertyFilterHidden;
      }
      for (const section of sections) {
        section.hidden = false;
        delete section.dataset.propertyFilterMatch;
        const saved = previousOpen.current.get(section);
        if (saved !== undefined) section.open = saved;
      }
      previousOpen.current.clear();
      return;
    }

    for (const candidate of candidates) {
      const matches = matchesPropertyFilter(filterText(candidate), query);
      candidate.hidden = !matches;
      candidate.dataset.propertyFilterHidden = matches ? 'false' : 'true';
    }

    // Resolve inner sections before their parents so nested matches keep both disclosure levels.
    for (const section of sections.reverse()) {
      const summary = section.querySelector<HTMLElement>(':scope > summary');
      const titleMatches = matchesPropertyFilter(summary?.textContent ?? '', query);
      const sectionCandidates = candidates.filter((candidate) => section.contains(candidate));
      if (titleMatches) {
        for (const candidate of sectionCandidates) {
          candidate.hidden = false;
          candidate.dataset.propertyFilterHidden = 'false';
        }
      }
      const hasVisibleCandidate = sectionCandidates.some((candidate) => !candidate.hidden);
      const hasVisibleNestedSection = Array.from(
        section.querySelectorAll<HTMLDetailsElement>(':scope .collapsible-section'),
      ).some((nested) => nested !== section && !nested.hidden);
      const matches = titleMatches || hasVisibleCandidate || hasVisibleNestedSection;
      section.hidden = !matches;
      section.dataset.propertyFilterMatch = matches ? 'true' : 'false';
      if (matches) {
        if (!previousOpen.current.has(section)) previousOpen.current.set(section, section.open);
        section.open = true;
      }
    }
  });
}
