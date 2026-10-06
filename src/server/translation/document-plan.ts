/**
 * One paragraph of an analysis PDF in, the pieces to translate out.
 *
 * The analysis documents are built from the same few dozen headings over and
 * over - ANSWER, HOW TO SOLVE, CORE, FUTURE ANGLE, and running headers such as
 * "KAS PRELIMS 2024 • PAPER-I • PYQ ANALYSIS". Those are never sent to the
 * engine: they get one fixed Kannada rendering, the same on every page of
 * every document, which a model translating them one at a time could not
 * promise (and capitals throw it badly). Everything else is prose, and goes
 * through the same sentence splitter as the questions - so the two share one
 * translation memory.
 *
 * Pure: no database, no engine. Used by the server and by the scripts that
 * prepare the shipped translation memory, which must split exactly alike.
 */

import { isTranslatable, planPlainText, type Piece } from './segments';

/** Headings and labels, matched whole and case-insensitively. */
const PHRASES: Record<string, string> = {
  'ANSWER': 'ಉತ್ತರ',
  'ANSWERS': 'ಉತ್ತರಗಳು',
  'QUESTION': 'ಪ್ರಶ್ನೆ',
  'QUESTIONS': 'ಪ್ರಶ್ನೆಗಳು',
  'OPTIONS': 'ಆಯ್ಕೆಗಳು',
  'OPTIONS /': 'ಆಯ್ಕೆಗಳು /',
  'ALL OPTIONS': 'ಎಲ್ಲಾ ಆಯ್ಕೆಗಳು',
  'COMPLETE QUESTION': 'ಸಂಪೂರ್ಣ ಪ್ರಶ್ನೆ',
  'ABOUT THE QUESTION': 'ಪ್ರಶ್ನೆಯ ಕುರಿತು',
  'HOW TO SOLVE': 'ಬಿಡಿಸುವ ವಿಧಾನ',
  'SOLVING APPROACH': 'ಬಿಡಿಸುವ ವಿಧಾನ',
  'ABOUT / HOW TO SOLVE': 'ಪ್ರಶ್ನೆಯ ಕುರಿತು / ಬಿಡಿಸುವ ವಿಧಾನ',
  'CORE': 'ಮೂಲ ಅಂಶ',
  'CORE CONCEPT': 'ಮೂಲ ಪರಿಕಲ್ಪನೆ',
  'CORE CONCEPT / EXAM-RELEVANT BRIEFING': 'ಮೂಲ ಪರಿಕಲ್ಪನೆ / ಪರೀಕ್ಷೆಗೆ ಉಪಯುಕ್ತ ಸಾರಾಂಶ',
  'FUTURE ANGLE': 'ಭವಿಷ್ಯದ ದೃಷ್ಟಿಕೋನ',
  'FUTURE ANGLE — RELATED QUESTIONS': 'ಭವಿಷ್ಯದ ದೃಷ್ಟಿಕೋನ — ಸಂಬಂಧಿತ ಪ್ರಶ್ನೆಗಳು',
  'FUTURE ANGLE — RELATED REVISION': 'ಭವಿಷ್ಯದ ದೃಷ್ಟಿಕೋನ — ಸಂಬಂಧಿತ ಪುನರಾವರ್ತನೆ',
  'EXAM TRAP': 'ಪರೀಕ್ಷೆಯ ಬಲೆ',
  'EXAM TRAP / MEMORY HOOK': 'ಪರೀಕ್ಷೆಯ ಬಲೆ / ನೆನಪಿನ ಸೂತ್ರ',
  'MEMORY HOOK': 'ನೆನಪಿನ ಸೂತ್ರ',
  'EXAM SKILL': 'ಪರೀಕ್ಷಾ ಕೌಶಲ',
  'EXPLANATION': 'ವಿವರಣೆ',
  'SOURCE TYPE': 'ಮೂಲದ ಪ್ರಕಾರ',
  'KPSC RELEVANCE': 'KPSC ಪ್ರಸ್ತುತತೆ',
  'FOR ENHANCED LEARNING': 'ಉತ್ತಮ ಕಲಿಕೆಗಾಗಿ',
  'REVISION FORMAT': 'ಪುನರಾವರ್ತನೆಯ ಸ್ವರೂಪ',
  'REVISION PRINCIPLE': 'ಪುನರಾವರ್ತನೆಯ ತತ್ವ',
  'PYQ-FIRST LEARNING': 'PYQ-ಮೊದಲ ಕಲಿಕೆ',
  'PASSAGE / SOURCE CONTEXT': 'ಗದ್ಯಭಾಗ / ಮೂಲ ಸಂದರ್ಭ',
  'CODES': 'ಸಂಕೇತಗಳು',
  'Q ANS': 'ಪ್ರಶ್ನೆ ಉತ್ತರ',
  'MATCH THE FOLLOWING': 'ಹೊಂದಿಸಿ ಬರೆಯಿರಿ',
  'PURPOSE': 'ಉದ್ದೇಶ',
  'CONTENTS': 'ಪರಿವಿಡಿ',
  'ANSWER KEY': 'ಉತ್ತರ ಸೂಚಿ',
  'READING NOTE': 'ಓದುವ ಸೂಚನೆ',
  'NOTE': 'ಸೂಚನೆ',
  'SUMMARY': 'ಸಾರಾಂಶ',
  'INTRODUCTION': 'ಪರಿಚಯ',
  'KEY POINTS': 'ಪ್ರಮುಖ ಅಂಶಗಳು',
  'LEARN': 'ಕಲಿಯಿರಿ',
  'PRACTICE': 'ಅಭ್ಯಾಸ ಮಾಡಿ',
  'EXCEL': 'ಸಾಧಿಸಿ',
  'LEARN • PRACTICE • EXCEL': 'ಕಲಿಯಿರಿ • ಅಭ್ಯಾಸ ಮಾಡಿ • ಸಾಧಿಸಿ',
};

/**
 * Words of the running headers, for composing them word by word. A heading
 * is composed only when every word in it is known; otherwise it goes to the
 * engine like any other text.
 */
const WORDS: Record<string, string> = {
  'PRELIMS': 'ಪ್ರಿಲಿಮ್ಸ್',
  'PRELIMINARY': 'ಪೂರ್ವಭಾವಿ',
  'PAPER': 'ಪತ್ರಿಕೆ',
  'ANALYSIS': 'ವಿಶ್ಲೇಷಣೆ',
  'SYNOPSIS': 'ಸಾರಾಂಶ',
  'COMPLETE': 'ಸಂಪೂರ್ಣ',
  'PREMIUM': 'ಪ್ರೀಮಿಯಂ',
  'STUDENT': 'ವಿದ್ಯಾರ್ಥಿ',
  'JANUARY': 'ಜನವರಿ',
  'FEBRUARY': 'ಫೆಬ್ರವರಿ',
  'MARCH': 'ಮಾರ್ಚ್',
  'APRIL': 'ಏಪ್ರಿಲ್',
  'MAY': 'ಮೇ',
  'JUNE': 'ಜೂನ್',
  'JULY': 'ಜುಲೈ',
  'AUGUST': 'ಆಗಸ್ಟ್',
  'SEPTEMBER': 'ಸೆಪ್ಟೆಂಬರ್',
  'OCTOBER': 'ಅಕ್ಟೋಬರ್',
  'NOVEMBER': 'ನವೆಂಬರ್',
  'DECEMBER': 'ಡಿಸೆಂಬರ್',
  'CURRENT AFFAIRS': 'ಪ್ರಚಲಿತ ವಿದ್ಯಮಾನಗಳು',
  'SCIENCE & TECHNOLOGY': 'ವಿಜ್ಞಾನ ಮತ್ತು ತಂತ್ರಜ್ಞಾನ',
  'SCIENCE AND TECHNOLOGY': 'ವಿಜ್ಞಾನ ಮತ್ತು ತಂತ್ರಜ್ಞಾನ',
  'SCIENCE': 'ವಿಜ್ಞಾನ',
  'TECHNOLOGY': 'ತಂತ್ರಜ್ಞಾನ',
  'ECONOMY': 'ಅರ್ಥವ್ಯವಸ್ಥೆ',
  'INDIAN ECONOMY': 'ಭಾರತೀಯ ಅರ್ಥವ್ಯವಸ್ಥೆ',
  'GEOGRAPHY': 'ಭೂಗೋಳ',
  'POLITY': 'ರಾಜ್ಯಶಾಸ್ತ್ರ',
  'INDIAN POLITY': 'ಭಾರತೀಯ ರಾಜ್ಯಶಾಸ್ತ್ರ',
  'POLITY & GOVERNANCE': 'ರಾಜ್ಯಶಾಸ್ತ್ರ ಮತ್ತು ಆಡಳಿತ',
  'GOVERNANCE': 'ಆಡಳಿತ',
  'HISTORY': 'ಇತಿಹಾಸ',
  'ENVIRONMENT': 'ಪರಿಸರ',
  'ECOLOGY': 'ಪರಿಸರ ವಿಜ್ಞಾನ',
  'ENVIRONMENT & ECOLOGY': 'ಪರಿಸರ ಮತ್ತು ಪರಿಸರ ವಿಜ್ಞಾನ',
  'GENERAL STUDIES': 'ಸಾಮಾನ್ಯ ಅಧ್ಯಯನ',
  'MENTAL ABILITY': 'ಮಾನಸಿಕ ಸಾಮರ್ಥ್ಯ',
  'LOGICAL REASONING': 'ತಾರ್ಕಿಕ ಚಿಂತನೆ',
  'LINEAR ARRANGEMENT': 'ರೇಖೀಯ ಜೋಡಣೆ',
  'QUANTITATIVE APTITUDE': 'ಪರಿಮಾಣಾತ್ಮಕ ಸಾಮರ್ಥ್ಯ',
  'ETHICS': 'ನೀತಿಶಾಸ್ತ್ರ',
  'COMPREHENSION': 'ಗ್ರಹಿಕೆ',
  'MOCK TEST': 'ಅಣಕು ಪರೀಕ್ಷೆ',
  'TEST': 'ಪರೀಕ್ಷೆ',
  'SECTION': 'ವಿಭಾಗ',
  'PASSAGE': 'ಗದ್ಯಭಾಗ',
  'QUESTIONS': 'ಪ್ರಶ್ನೆಗಳು',
  'QUESTION': 'ಪ್ರಶ್ನೆ',
  'ANSWER': 'ಉತ್ತರ',
  'FOCUS': 'ಕೇಂದ್ರಿತ',
  'AND': 'ಮತ್ತು',
  '&': 'ಮತ್ತು',
};

/** Names and abbreviations that stay as they are. */
const KEEP_WORDS = new Set(['AVK', 'ENVISIONS', 'KAS', 'PYQ', 'PYQS', 'CSAT', 'KPSC', 'UPSC', 'GS', 'IAS']);
const BRAND = /^AVK\s+ENVISIONS?$/i;

/** "Page 3", "Page 3 of 12". */
const PAGE = /^page\s+(\d+)(?:\s*(?:of|\/)\s*(\d+))?$/i;
/** "ANSWER: B", "ANSWER — (3) 24". */
const LABELLED = /^([A-Za-z][A-Za-z /&-]{1,40}?)\s*[:–—]\s+(.+)$/;
/** "Q12." at the start of a heading. */
const QUESTION_NUMBER = /^Q\.?\s?(\d+)([.:)]?)$/i;

/** Items run together on one line: "Learn • Practice • Excel", "Q1. HISTORY | PYQ ANALYSIS". */
const SEPARATOR = /(\s+[•·|]\s+|\s+[•·|]\s*$|^\s*[•·|]\s+)/;

function key(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[–-]{2,}|―/g, '—').trim().toUpperCase();
}

const PHRASE_INDEX = new Map(Object.entries(PHRASES).map(([k, v]) => [key(k), v]));
const WORD_INDEX = new Map(Object.entries(WORDS).map(([k, v]) => [key(k), v]));
const LONGEST_WORD_PHRASE = Math.max(...Object.keys(WORDS).map((w) => w.split(' ').length));

function isRoman(word: string): boolean {
  return /^(?:I{1,3}|IV|V|VI{1,3}|IX|X)$/.test(word);
}

/**
 * A code or a file name - "KAS-PYQ-2011-PAPER-1-Q1", "KAS-Q3199",
 * "kas-50-days-1" - which the engine would spell out in Kannada letters. Parts
 * joined by - _ . or /, with a number among them, and either three parts or
 * more or a part running letters into digits. "PAPER-1" and "COVID-19" are
 * still words.
 */
function isCode(token: string): boolean {
  if (!/\d/.test(token) || !/[A-Za-z]/.test(token)) return false;
  const parts = token.split(/[-_./]/);
  if (parts.length < 2 || parts.some((part) => !/^[A-Za-z0-9]+$/.test(part))) return false;
  return parts.length >= 3 || parts.some((part) => /[A-Za-z]/.test(part) && /\d/.test(part));
}

/** Nothing but codes and numbers: "1 KAS-PYQ-2011-PAPER-1-Q1", "kas-50-days-1". */
function isCodeLine(text: string): boolean {
  const tokens = text.split(' ').map((token) => token.replace(/^[("“'#]+|[)"”'.,:;]+$/g, ''));
  return tokens.some(isCode) && tokens.every((token) => !/[A-Za-z]/.test(token) || isCode(token));
}

/**
 * A heading in capitals, composed word by word - or null if any word is
 * unknown. Order stays as in English, which reads naturally for a heading
 * ("KAS ಪ್ರಿಲಿಮ್ಸ್ 2024 • ಪತ್ರಿಕೆ-I • PYQ ವಿಶ್ಲೇಷಣೆ").
 */
function composeHeading(text: string): string | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let n = Math.min(LONGEST_WORD_PHRASE, tokens.length - i); n >= 2; n -= 1) {
      const phrase = WORD_INDEX.get(key(tokens.slice(i, i + n).join(' ')));
      if (phrase) {
        out.push(phrase);
        i += n;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const token = tokens[i]!;
    const word = composeWord(token);
    if (word === null) return null;
    out.push(word);
    i += 1;
  }
  return out.join(' ');
}

function composeWord(token: string): string | null {
  // Punctuation around a word comes along with it: "(PAPER-I)", "SYNOPSIS:".
  const match = token.match(/^([("“']*)(.*?)([)"”'.,:;]*)$/);
  const [, lead = '', core = '', trail = ''] = match ?? [];
  if (!core) return token;
  const q = core.match(QUESTION_NUMBER);
  if (q) return `${lead}ಪ್ರಶ್ನೆ ${q[1]}${q[2] ?? ''}${trail}`;
  if (!/[A-Za-z]/.test(core) || KEEP_WORDS.has(core.toUpperCase()) || isRoman(core) || isCode(core)) return token;
  // "PAPER-II", "MOCK-TEST": the parts either side of a hyphen.
  if (core.includes('-')) {
    const parts = core.split('-').map((part) => {
      if (!part || !/[A-Za-z]/.test(part) || KEEP_WORDS.has(part.toUpperCase()) || isRoman(part)) return part;
      return WORD_INDEX.get(key(part)) ?? null;
    });
    return parts.every((p) => p !== null) ? `${lead}${parts.join('-')}${trail}` : null;
  }
  if (core === '/' || core === '—' || core === '-' || core === '–') return token;
  const known = WORD_INDEX.get(key(core));
  return known ? `${lead}${known}${trail}` : null;
}

/** Abbreviations long enough to be mistaken for words. */
const ACRONYMS = new Set([
  'NALSA', 'SEBI', 'NABARD', 'ISRO', 'DRDO', 'NITI', 'AAYOG', 'UNESCO', 'UNICEF', 'BRICS', 'SAARC', 'ASEAN',
  'NATO', 'OPEC', 'IUCN', 'NCERT', 'NAFED', 'FSSAI', 'TRAI', 'IRDAI', 'KPSC', 'UPSC', 'CSAT', 'NCRB', 'NHRC',
  'SIDBI', 'EXIM', 'GATT', 'UNFCCC', 'UNEP', 'IPCC', 'CITES', 'NASA', 'BIMSTEC', 'MSME', 'FDI', 'NREGA',
  'MGNREGA', 'GST', 'PDS', 'NFSA', 'AIIMS', 'CBI', 'CVC', 'CAG',
]);

/**
 * Capitals lower-cased for the engine, which reads "The role of NALSA" far
 * better than "THE ROLE OF NALSA". Abbreviations stay in capitals: words of
 * three letters or fewer (GDP, RBI), words with no vowel (NCRB), and the
 * known longer ones.
 */
function sentenceCase(text: string): string {
  let first = true;
  return text.replace(/[A-Z][A-Z'’]*/g, (word) => {
    const abbreviation =
      ACRONYMS.has(word) ||
      KEEP_WORDS.has(word) ||
      !/[AEIOU]/.test(word) ||
      (word.length <= 3 && !['THE', 'AND', 'FOR', 'ARE', 'WAS', 'ITS', 'NOT', 'ALL', 'ONE', 'TWO', 'NEW', 'OLD', 'WHO', 'WHY', 'HOW', 'OF', 'IN', 'TO', 'ON', 'AT', 'BY', 'AS', 'IS', 'IT', 'OR', 'AN', 'BE', 'NO', 'A', 'KEY', 'MAP', 'TIP', 'AID', 'OUT', 'USE'].includes(word));
    const out = abbreviation ? word : first ? word[0] + word.slice(1).toLowerCase() : word.toLowerCase();
    first = false;
    return out;
  });
}

function fixed(text: string): Piece[] {
  return [{ raw: text }];
}

/** One run of text between separators. */
function planSegment(segment: string): Piece[] {
  const text = segment.replace(/\s+/g, ' ').trim();
  if (!text) return fixed(segment);
  const lead = segment.match(/^\s*/)![0];
  const trail = segment.match(/\s*$/)![0];
  const wrap = (pieces: Piece[]): Piece[] => [
    ...(lead ? [{ raw: lead }] : []),
    ...pieces,
    ...(trail ? [{ raw: trail }] : []),
  ];

  if (!isTranslatable(text) || BRAND.test(text) || isCodeLine(text)) return fixed(segment);

  const phrase = PHRASE_INDEX.get(key(text));
  if (phrase) return wrap(fixed(phrase));
  // "How to solve:" - a heading with its colon.
  const colon = text.match(/^(.+?)\s*:$/);
  const labelOnly = colon ? PHRASE_INDEX.get(key(colon[1]!)) : undefined;
  if (labelOnly) return wrap(fixed(`${labelOnly}:`));

  // "Q3. Where was the conference held?" - the number becomes ಪ್ರಶ್ನೆ 3.
  const numbered = text.match(/^Q\.?\s?(\d+)([.:)])\s+(.+)$/i);
  if (numbered) return wrap([{ raw: `ಪ್ರಶ್ನೆ ${numbered[1]}${numbered[2]} ` }, ...planSegment(numbered[3]!)]);

  const page = text.match(PAGE);
  if (page) return wrap(fixed(page[2] ? `ಪುಟ ${page[1]} / ${page[2]}` : `ಪುಟ ${page[1]}`));

  const labelled = text.match(LABELLED);
  if (labelled) {
    const label = PHRASE_INDEX.get(key(labelled[1]!));
    if (label) {
      const separator = text.slice(labelled[1]!.length, text.length - labelled[2]!.length);
      return wrap([{ raw: label + separator }, ...planSegment(labelled[2]!)]);
    }
  }

  // A heading: in capitals, or a few words that are all known ones
  // ("Paper 1 Premium Synopsis").
  const capitals = !/[a-z]/.test(text);
  if (capitals || text.split(' ').length <= 6) {
    const composed = composeHeading(text);
    if (composed !== null) return wrap(fixed(composed));
  }
  if (capitals) return wrap(planPlainText(sentenceCase(text)));

  return wrap(planPlainText(text));
}

/**
 * The pieces for one paragraph, or null when it stays exactly as it is - a
 * code, a number, the brand, a list of option letters.
 */
export function planBlock(text: string): Piece[] | null {
  const normalised = text.replace(/\s+/g, ' ').trim();
  if (!normalised || !isTranslatable(normalised) || BRAND.test(normalised)) return null;

  const whole = PHRASE_INDEX.get(key(normalised));
  const pieces: Piece[] = whole
    ? fixed(whole)
    : normalised
        .split(SEPARATOR)
        .filter((part) => part !== '')
        .flatMap((part, index, parts) =>
          SEPARATOR.test(part) && parts.length > 1 ? fixed(part) : planSegment(part),
        );

  // Nothing changed: leave the paragraph's own text on the page.
  const rendered = pieces.map((p) => ('raw' in p ? p.raw : p.sentence)).join('');
  const hasWork = pieces.some((p) => 'sentence' in p) || rendered !== normalised;
  return hasWork ? pieces : null;
}
