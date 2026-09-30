/**
 * Question text in, sentences to translate out - and back again.
 *
 * The translation engine takes one sentence at a time and knows nothing about
 * layout, so everything that is not prose is kept out of its way and put back
 * exactly as it was: line breaks, the "A." / "(ii)" / "•" that starts a
 * statement, codes such as "A-1, B-2, C-3" that have no words to translate,
 * and the tags of an HTML solution.
 *
 * Pure: no database, no engine. `plan*` breaks text into pieces, `render`
 * reassembles them with whatever translations are available - a sentence the
 * engine never returned stays in English rather than vanishing.
 */

export type Piece = { raw: string } | { sentence: string };

/** A statement or list marker at the start of a line, kept verbatim. */
const LINE_MARKER =
  /^(\s*(?:\(\s*(?:[A-Za-z]|\d{1,2}|[ivxIVX]{1,4})\s*\)|(?:[A-Za-z]|\d{1,2}|[ivxIVX]{1,4})[.)]|[•●▪◦*–-])\s+)/;

/** Roman numerals standing alone ("II and III") are labels, not words. */
const ROMAN = /\b(?:I{1,3}|IV|VI{0,3}|IX|XI{0,2})\b/g;

/** Words the sentence splitter must not treat as the end of a sentence. */
const ABBREVIATIONS = new Set(
  [
    'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'no', 'nos', 'art', 'arts', 'vs', 'viz',
    'etc', 'ie', 'eg', 'govt', 'dept', 'ltd', 'co', 'inc', 'fig', 'ch', 'sec', 'secs', 'vol',
    'pp', 'approx', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct',
    'nov', 'dec', 'rs', 'hon', 'smt', 'shri', 'sri', 'gen', 'col', 'lt', 'capt', 'maj', 'rev',
    'mt', 'ft', 'est', 'cf', 'al', 'ibid', 'op', 'cit', 'amdt', 'cl', 'sch', 'para',
  ],
);

/** Longer than this and a sentence is split at commas, to stay in the model's reach. */
const MAX_SENTENCE_CHARS = 600;

/** True when there is prose to translate, not just labels, numbers and punctuation. */
export function isTranslatable(text: string): boolean {
  return /[A-Za-z]{2,}/.test(text.replace(ROMAN, ' '));
}

function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE_CHARS) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, MAX_SENTENCE_CHARS);
    const cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '));
    const at = cut > MAX_SENTENCE_CHARS / 3 ? cut + 1 : window.lastIndexOf(' ');
    if (at <= 0) break;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Splits prose into sentences, keeping the spaces between them as raw pieces.
 *
 * A full stop ends a sentence only when the next word starts a new one, and
 * not after an abbreviation ("Art. 21"), an initial ("M. K. Gandhi"), or a
 * number ("No. 5").
 */
export function splitSentences(text: string): Piece[] {
  const pieces: Piece[] = [];
  const boundary = /([.!?]+["'’”)\]]*)(\s+)(?=["'‘“(\[]?[A-Z0-9])/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[1]!.length;
    const before = text.slice(start, match.index);
    const lastWord = (before.match(/([A-Za-z.]+)$/)?.[1] ?? '').replace(/\./g, '').toLowerCase();
    const isInitial = /(?:^|\s)[A-Z]$/.test(before);
    // "U.S.", "i.e.", "a.m." - a letter-dot run, not the end of a sentence.
    const isDotted = /(?:^|[\s(])(?:[A-Za-z]\.)+[A-Za-z]$/.test(before);
    if (match[1]!.startsWith('.') && (ABBREVIATIONS.has(lastWord) || isInitial || isDotted)) continue;

    const sentence = text.slice(start, end).trim();
    if (sentence) for (const part of splitLong(sentence)) pieces.push({ sentence: part });
    pieces.push({ raw: match[2]! });
    start = end + match[2]!.length;
  }

  const tail = text.slice(start);
  const trimmed = tail.trim();
  if (trimmed) {
    const lead = tail.slice(0, tail.indexOf(trimmed));
    if (lead) pieces.push({ raw: lead });
    for (const [i, part] of splitLong(trimmed).entries()) {
      if (i > 0) pieces.push({ raw: ' ' });
      pieces.push({ sentence: part });
    }
    const trail = tail.slice(tail.indexOf(trimmed) + trimmed.length);
    if (trail) pieces.push({ raw: trail });
  } else if (tail) {
    pieces.push({ raw: tail });
  }
  return pieces;
}

/**
 * Arrows join the items of a chain or a pair ("Levy → Collection", "Bhyrappa →
 * Kambara"), and in a match-the-following question the arrow is the meaning.
 * The engine drops or flattens them into hyphens, so a line is cut at each
 * arrow, the items translated separately, and the arrows put back verbatim.
 */
const ARROW = /(\s*[→⇒←↔⟶➔]\s*)/;

/** Plain text: line by line, markers kept, prose split into sentences. */
export function planPlainText(text: string): Piece[] {
  const pieces: Piece[] = [];
  const lines = text.split(/(\r?\n)/);
  for (const line of lines) {
    if (line === '\n' || line === '\r\n' || line.trim() === '') {
      if (line) pieces.push({ raw: line });
      continue;
    }
    const marker = line.match(LINE_MARKER)?.[1] ?? '';
    if (marker) pieces.push({ raw: marker });
    for (const part of line.slice(marker.length).split(ARROW)) {
      if (!part) continue;
      if (ARROW.test(part) && !isTranslatable(part)) pieces.push({ raw: part });
      else if (isTranslatable(part)) pieces.push(...splitSentences(part));
      else pieces.push({ raw: part });
    }
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// HTML (detailed solutions written in the admin editor)
// ---------------------------------------------------------------------------

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'td', 'th', 'blockquote', 'section', 'article', 'header', 'footer', 'figure',
  'figcaption', 'dl', 'dt', 'dd', 'hr', 'br', 'caption',
]);
/** Their contents are code or markup, never prose. */
const VERBATIM_TAGS = new Set(['pre', 'code', 'script', 'style']);
/** A block wrapped whole in one of these keeps the wrapper around its translation. */
const WRAPPER = /^(\s*)<(strong|b|em|i|u|mark)(\s[^>]*)?>([\s\S]*)<\/\2>(\s*)$/i;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', rarr: '→',
  larr: '←', times: '×', deg: '°', middot: '·', rsaquo: '›', lsaquo: '‹',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pieces rendered inside HTML are escaped, so they are tagged. */
export type HtmlPiece = Piece | { html: Piece[] };

function flushInline(buffer: string, out: HtmlPiece[]) {
  if (!buffer) return;
  const text = decodeEntities(buffer.replace(/<[^>]+>/g, ''));
  if (!isTranslatable(text)) {
    out.push({ raw: buffer });
    return;
  }
  const wrapped = buffer.match(WRAPPER);
  if (wrapped && !/<[^>]+>/.test(wrapped[4]!)) {
    const [, lead, tag, attrs = ''] = wrapped;
    out.push({ raw: `${lead}<${tag}${attrs}>` });
    out.push({ html: planPlainText(decodeEntities(wrapped[4]!)) });
    out.push({ raw: `</${tag}>${wrapped[5]}` });
    return;
  }
  // Inline formatting inside a translated block is dropped: the sentence is
  // rewritten in another word order, so a bold phrase has nowhere to go.
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const trail = text.match(/\s*$/)?.[0] ?? '';
  if (lead) out.push({ raw: lead });
  out.push({ html: planPlainText(text.trim()) });
  if (trail) out.push({ raw: trail });
}

/** HTML: tags kept, each block's text translated as a unit. */
export function planHtml(html: string): HtmlPiece[] {
  const out: HtmlPiece[] = [];
  const tokens = html.match(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|</g) ?? [];
  let buffer = '';
  let verbatimDepth = 0;

  for (const token of tokens) {
    const tag = token.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/)?.[1]?.toLowerCase();

    if (tag && VERBATIM_TAGS.has(tag)) {
      flushInline(buffer, out);
      buffer = '';
      verbatimDepth += token.startsWith('</') ? -1 : token.endsWith('/>') ? 0 : 1;
      if (verbatimDepth < 0) verbatimDepth = 0;
      out.push({ raw: token });
      continue;
    }
    if (verbatimDepth > 0 || token.startsWith('<!--')) {
      out.push({ raw: token });
      continue;
    }
    if (tag && BLOCK_TAGS.has(tag)) {
      flushInline(buffer, out);
      buffer = '';
      out.push({ raw: token });
      continue;
    }
    buffer += token;
  }
  flushInline(buffer, out);
  return out;
}

// ---------------------------------------------------------------------------
// Both
// ---------------------------------------------------------------------------

/** Every sentence a plan needs translated, in order, duplicates included. */
export function sentencesOf(pieces: HtmlPiece[]): string[] {
  const found: string[] = [];
  for (const piece of pieces) {
    if ('sentence' in piece) found.push(piece.sentence);
    else if ('html' in piece) found.push(...sentencesOf(piece.html));
  }
  return found;
}

/** Reassemble, translating what the lookup has and keeping the rest as it was. */
export function render(pieces: HtmlPiece[], lookup: (sentence: string) => string | undefined): string {
  return pieces
    .map((piece) => {
      if ('raw' in piece) return piece.raw;
      if ('sentence' in piece) return lookup(piece.sentence) ?? piece.sentence;
      return escapeHtml(render(piece.html, lookup));
    })
    .join('');
}
