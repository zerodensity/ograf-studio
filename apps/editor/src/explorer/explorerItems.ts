import type { CatalogExample, ExampleCatalog, ExampleLevel } from './exampleCatalog';

/** A starter built by Studio itself, so it follows the canvas size and frame rate you choose. */
export interface RecipeItem {
  kind: 'recipe';
  id: string;
  title: string;
  summary: string;
  category: string;
  level: ExampleLevel;
  tags: string[];
  method: 'addLowerThird' | 'addBug' | 'addTicker' | 'addScoreboard' | 'addClock' | 'addCountdown';
}

export interface ExampleItem extends CatalogExample {
  kind: 'example';
}

export type ExplorerItem = RecipeItem | ExampleItem;

export const RECIPES: readonly RecipeItem[] = [
  {
    kind: 'recipe',
    id: 'recipe-lower-third',
    title: 'Lower Third',
    summary: 'A name strap with a name, a role and a live tag.',
    category: 'Lower thirds',
    level: 'Basic',
    tags: ['Text fields'],
    method: 'addLowerThird',
  },
  {
    kind: 'recipe',
    id: 'recipe-bug',
    title: 'Bug / DOG',
    summary: 'A channel identifier that sits in a corner of the picture.',
    category: 'Branding',
    level: 'Basic',
    tags: ['Branding'],
    method: 'addBug',
  },
  {
    kind: 'recipe',
    id: 'recipe-ticker',
    title: 'Ticker',
    summary: 'A crawl of headlines along the bottom of the picture.',
    category: 'Tickers',
    level: 'Basic',
    tags: ['Native ticker'],
    method: 'addTicker',
  },
  {
    kind: 'recipe',
    id: 'recipe-scoreboard',
    title: 'Scoreboard',
    summary: 'Two teams, their scores, the period and a match clock.',
    category: 'Sport',
    level: 'Intermediate',
    tags: ['Sport', 'Timer'],
    method: 'addScoreboard',
  },
  {
    kind: 'recipe',
    id: 'recipe-clock',
    title: 'Clock / Timer',
    summary: 'A live clock that can show any time zone.',
    category: 'Clocks & timers',
    level: 'Basic',
    tags: ['Clock'],
    method: 'addClock',
  },
  {
    kind: 'recipe',
    id: 'recipe-countdown',
    title: 'Countdown',
    summary: 'A countdown to a moment, with start, pause and reset.',
    category: 'Clocks & timers',
    level: 'Intermediate',
    tags: ['Timer'],
    method: 'addCountdown',
  },
];

export const EXPLORER_SORTS = ['featured', 'updated', 'name'] as const;
export type ExplorerSort = (typeof EXPLORER_SORTS)[number];
export const EXPLORER_SORT_LABELS: Record<ExplorerSort, string> = {
  featured: 'Featured',
  updated: 'Latest updated',
  name: 'Name',
};

export type ExplorerBrowse = 'all' | 'recipes' | 'examples';

export interface ExplorerFilter {
  browse: ExplorerBrowse;
  category: string | null;
  level: ExampleLevel | null;
  query: string;
}

/** How long a newly released example carries the "New" mark. */
const NEW_FOR_DAYS = 30;

export function isNewExample(example: Pick<CatalogExample, 'released'>, now: Date): boolean {
  const released = Date.parse(`${example.released}T00:00:00Z`);
  const age = now.getTime() - released;
  return age >= 0 && age < NEW_FOR_DAYS * 86_400_000;
}

function searchText(item: ExplorerItem): string {
  return [
    item.title,
    item.summary,
    item.category,
    item.level,
    ...item.tags,
    item.kind === 'example' ? item.author : 'recipe',
  ]
    .join(' ')
    .toLocaleLowerCase();
}

/** Every word of the query must appear somewhere in the item's title, summary, tags or category. */
export function matchesQuery(item: ExplorerItem, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = searchText(item);
  return words.every((word) => haystack.includes(word));
}

function matchesFilter(item: ExplorerItem, filter: ExplorerFilter): boolean {
  return (
    (!filter.category || item.category === filter.category) &&
    (!filter.level || item.level === filter.level) &&
    matchesQuery(item, filter.query)
  );
}

function sortExamples(
  examples: readonly ExampleItem[],
  featured: readonly string[],
  sort: ExplorerSort,
): ExampleItem[] {
  const byName = (a: ExampleItem, b: ExampleItem) => a.title.localeCompare(b.title);
  const byUpdated = (a: ExampleItem, b: ExampleItem) =>
    b.updated.localeCompare(a.updated) || byName(a, b);
  if (sort === 'name') return examples.toSorted(byName);
  if (sort === 'updated') return examples.toSorted(byUpdated);
  const rank = new Map(featured.map((id, index) => [id, index]));
  return examples.toSorted(
    (a, b) =>
      (rank.get(a.id) ?? Number.POSITIVE_INFINITY) - (rank.get(b.id) ?? Number.POSITIVE_INFINITY) ||
      byUpdated(a, b),
  );
}

export interface ExplorerListing {
  recipes: RecipeItem[];
  examples: ExampleItem[];
}

/** The cards to show, in order. Unlisted examples never appear. */
export function listExplorerItems(
  catalog: ExampleCatalog,
  filter: ExplorerFilter,
  sort: ExplorerSort,
): ExplorerListing {
  const recipes =
    filter.browse === 'examples' ? [] : RECIPES.filter((item) => matchesFilter(item, filter));
  const examples =
    filter.browse === 'recipes'
      ? []
      : catalog.examples
          .filter((example) => !example.unlisted)
          .map((example): ExampleItem => ({ ...example, kind: 'example' }))
          .filter((item) => matchesFilter(item, filter));
  return {
    recipes: sort === 'name' ? recipes.toSorted((a, b) => a.title.localeCompare(b.title)) : recipes,
    examples: sortExamples(examples, catalog.featured, sort),
  };
}

/** Categories with how many listed items each holds, for the sidebar. */
export function explorerCategories(catalog: ExampleCatalog): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  const items: { category: string }[] = [
    ...RECIPES,
    ...catalog.examples.filter((example) => !example.unlisted),
  ];
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
