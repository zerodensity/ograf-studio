import { embedStyleUrls, readAsDataUrl, splitList } from './selfStyledCapture';

/** `CSSRule.FONT_FACE_RULE`, read as a number so a rule of another window's document matches too. */
const FONT_FACE_RULE = 5;
/** The order a browser of today is offered a face's files in. */
const FORMAT_PREFERENCE = ['woff2', 'woff', 'opentype', 'truetype'];

interface FontFaceSource {
  /** The rule's family, lower-cased and without quotes. */
  family: string;
  unicodeRange: string;
  /** The whole rule, with one file chosen and its address made absolute. */
  css: string;
}

/** Faces that script registered and no stylesheet holds, per document, by the caller's key. */
const declaredFaces = new WeakMap<Document, Map<string, FontFaceSource[]>>();
/** Rules with their file embedded, per document, by rule text. A rule is embedded once. */
const embeddedRules = new WeakMap<Document, Map<string, Promise<string>>>();

function normalizeFamily(family: string): string {
  return family
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .toLowerCase();
}

/** One file of a face's `src` list, the one a browser of today reads first, with an absolute address. */
function preferredSource(src: string, base: string): string | null {
  const files = splitList(src).filter((entry) => /^url\(/i.test(entry));
  if (!files.length) return null;
  const rank = (entry: string) => {
    const format = /format\(\s*["']?([\w-]+)/i.exec(entry)?.[1]?.toLowerCase();
    const extension = /\.(woff2|woff|otf|ttf)(?:[?#"')]|$)/i.exec(entry)?.[1]?.toLowerCase();
    const kind =
      format ?? (extension === 'otf' ? 'opentype' : extension === 'ttf' ? 'truetype' : extension);
    const index = kind ? FORMAT_PREFERENCE.indexOf(kind) : -1;
    return index < 0 ? FORMAT_PREFERENCE.length : index;
  };
  const chosen = [...files].sort((a, b) => rank(a) - rank(b))[0]!;
  return chosen.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/i, (match, _quote, url: string) =>
    url.startsWith('data:') ? match : `url("${new URL(url, base).href}")`,
  );
}

function fontFaceSource(rule: CSSFontFaceRule, base: string): FontFaceSource | null {
  const style = rule.style;
  const source = preferredSource(style.getPropertyValue('src'), base);
  const family = normalizeFamily(style.getPropertyValue('font-family'));
  if (!source || !family) return null;
  const descriptors: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    if (name !== 'src') descriptors.push(`${name}: ${style.getPropertyValue(name)};`);
  }
  return {
    family,
    unicodeRange: style.getPropertyValue('unicode-range'),
    css: `@font-face { ${descriptors.join(' ')} src: ${source}; }`,
  };
}

function fontFaceSources(sheet: CSSStyleSheet, base: string): FontFaceSource[] {
  const sources: FontFaceSource[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule.type === FONT_FACE_RULE) {
        const source = fontFaceSource(rule as CSSFontFaceRule, base);
        if (source) sources.push(source);
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  try {
    visit(sheet.cssRules);
  } catch {
    // A stylesheet from another origin keeps its rules to itself; its fonts cannot be embedded.
  }
  return sources;
}

/**
 * Tells pictures drawn from markup about faces that script registered, which no stylesheet shows.
 * `css` holds their `@font-face` rules. Returns what withdraws them again.
 */
export function declareFontFaces(target: Document, key: string, css: string): () => void {
  const view = target.defaultView as (Window & typeof globalThis) | null;
  let faces = declaredFaces.get(target);
  if (!faces) declaredFaces.set(target, (faces = new Map()));
  if (view && typeof view.CSSStyleSheet === 'function') {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(css);
    faces.set(key, fontFaceSources(sheet, target.baseURI));
  }
  return () => {
    declaredFaces.get(target)?.delete(key);
  };
}

/** The families text under `root` may be set in: its descendants', and what it inherits if asked. */
function usedFamilies(root: HTMLElement, view: Window, inherited: boolean): Set<string> {
  const families = new Set<string>();
  const add = (value: string | null | undefined) => {
    for (const family of splitList(value ?? '')) families.add(normalizeFamily(family));
  };
  add(inherited ? view.getComputedStyle(root).fontFamily : root.style.fontFamily);
  for (const element of root.querySelectorAll<HTMLElement | SVGElement>('[style*="font"]'))
    add(element.style.fontFamily);
  for (const element of root.querySelectorAll('[font-family]'))
    add(element.getAttribute('font-family'));
  return families;
}

/** Whether a face that covers only `unicodeRange` has a glyph for any character of `text`. */
export function unicodeRangeCovers(unicodeRange: string, text: string): boolean {
  const ranges = splitList(unicodeRange)
    .map((entry) => /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(entry))
    .filter((match) => match !== null)
    .map((match) => {
      const [, from, to] = match;
      return from!.includes('?')
        ? [
            Number.parseInt(from!.replaceAll('?', '0'), 16),
            Number.parseInt(from!.replaceAll('?', 'f'), 16),
          ]
        : [Number.parseInt(from!, 16), Number.parseInt(to ?? from!, 16)];
    });
  if (!ranges.length) return true;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (ranges.some(([from, to]) => code >= from! && code <= to!)) return true;
  }
  return false;
}

/**
 * The `@font-face` rules that text under `root` is set in, with their fonts embedded, for a picture
 * drawn from markup: such a picture can load nothing and sees no font of the page.
 *
 * Faces come from the stylesheets of the document and of the shadow tree `root` is in, and from
 * `declareFontFaces`. A face the text has no character for is left out, and so is one whose file
 * cannot be read, such as any file of a graphic opened from disk. A tree that is a whole picture
 * takes no font from the page around it: pass `inherited` as false for it.
 */
export async function usedFontFaceCss(root: HTMLElement, inherited = true): Promise<string> {
  const owner = root.ownerDocument;
  const view = owner.defaultView;
  if (!view) return '';
  const families = usedFamilies(root, view, inherited);
  const text = root.textContent ?? '';
  const scope = root.getRootNode() as Document | ShadowRoot;
  const sheets = [
    ...(scope !== owner && 'styleSheets' in scope ? scope.styleSheets : []),
    ...owner.styleSheets,
  ];
  const sources = [
    ...sheets.flatMap((sheet) => fontFaceSources(sheet, sheet.href ?? owner.baseURI)),
    ...[...(declaredFaces.get(owner)?.values() ?? [])].flat(),
  ].filter(
    (source) => families.has(source.family) && unicodeRangeCovers(source.unicodeRange, text),
  );
  if (!sources.length) return '';

  let rules = embeddedRules.get(owner);
  if (!rules) embeddedRules.set(owner, (rules = new Map()));
  const embedded = await Promise.all(
    [...new Set(sources.map((source) => source.css))].map((css) => {
      let rule = rules.get(css);
      if (!rule) {
        // A font that cannot be read is left out, and the text falls back to its authored stack as
        // it does in the page when a font does not load. The next picture asks for it again.
        rule = embedStyleUrls(css, (url) => readAsDataUrl(view, url)).catch(() => {
          rules.delete(css);
          return '';
        });
        rules.set(css, rule);
      }
      return rule;
    }),
  );
  return embedded.join('\n');
}
