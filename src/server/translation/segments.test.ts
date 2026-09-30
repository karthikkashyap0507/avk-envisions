import { describe, expect, it } from 'vitest';

import {
  decodeEntities,
  isTranslatable,
  planHtml,
  planPlainText,
  render,
  sentencesOf,
  splitSentences,
} from './segments';

/** Renders with a fake translation that just marks each sentence. */
const mark = (s: string) => `«${s}»`;

describe('isTranslatable', () => {
  it('finds prose', () => {
    expect(isTranslatable('B and C only')).toBe(true);
    expect(isTranslatable('1, 2 and 3')).toBe(true);
  });
  it('leaves codes, labels and numbers alone', () => {
    expect(isTranslatable('A-1, B-2, C-3, D-4')).toBe(false);
    expect(isTranslatable('II, III')).toBe(false);
    expect(isTranslatable('1982')).toBe(false);
    expect(isTranslatable('(a) (b)')).toBe(false);
  });
});

describe('splitSentences', () => {
  const sentences = (text: string) => sentencesOf(splitSentences(text));

  it('splits at full stops before a new sentence', () => {
    expect(sentences('The House met. It passed the bill. Then it rose.')).toEqual([
      'The House met.',
      'It passed the bill.',
      'Then it rose.',
    ]);
  });

  it('does not split after abbreviations, initials or dotted forms', () => {
    expect(sentences('Under Art. 21 the right is protected.')).toHaveLength(1);
    expect(sentences('M. K. Gandhi led the movement.')).toHaveLength(1);
    expect(sentences('The U.S. Constitution came into force in 1789.')).toHaveLength(1);
    expect(sentences('Dr. Ambedkar chaired it, i.e. the Drafting Committee.')).toHaveLength(1);
  });

  it('does not split before a lowercase continuation', () => {
    expect(sentences('It rose 2.5 per cent. and then fell.')).toHaveLength(1);
  });

  it('keeps the spacing between sentences, so rendering restores it exactly', () => {
    const text = 'One.  Two!\tThree?';
    expect(render(splitSentences(text), (s) => s)).toBe(text);
  });
});

describe('planPlainText', () => {
  it('keeps line breaks and statement markers outside the sentences', () => {
    const body = 'Consider the following statements:\nA. The Lok Sabha is elected.\nB. The Council is not.\n\nWhich of the above are correct?';
    const plan = planPlainText(body);
    expect(sentencesOf(plan)).toEqual([
      'Consider the following statements:',
      'The Lok Sabha is elected.',
      'The Council is not.',
      'Which of the above are correct?',
    ]);
    expect(render(plan, mark)).toBe(
      '«Consider the following statements:»\nA. «The Lok Sabha is elected.»\nB. «The Council is not.»\n\n«Which of the above are correct?»',
    );
  });

  it('recognises bracketed, roman and bullet markers', () => {
    const plan = planPlainText('(i) First item here\n(iv) Fourth item here\n• A bullet point\n2) Second point');
    expect(render(plan, mark)).toBe(
      '(i) «First item here»\n(iv) «Fourth item here»\n• «A bullet point»\n2) «Second point»',
    );
  });

  it('keeps arrows verbatim, translating the items between them', () => {
    const plan = planPlainText('S.L. Bhyrappa → Chandrashekara Kambara\nLevy → Collection → Distribution');
    expect(sentencesOf(plan)).toEqual(['S.L. Bhyrappa', 'Chandrashekara Kambara', 'Levy', 'Collection', 'Distribution']);
    expect(render(plan, mark)).toBe(
      '«S.L. Bhyrappa» → «Chandrashekara Kambara»\n«Levy» → «Collection» → «Distribution»',
    );
  });

  it('keeps an arrow between numbers as it is', () => {
    expect(render(planPlainText('₹3 lakh → ₹3.5 lakh'), mark)).toBe('«₹3 lakh» → «₹3.5 lakh»');
  });

  it('passes pure codes through untranslated', () => {
    const plan = planPlainText('Codes:\nA-1, B-2, C-3, D-4');
    expect(render(plan, mark)).toBe('«Codes:»\nA-1, B-2, C-3, D-4');
  });

  it('falls back to the English for any sentence without a translation', () => {
    const plan = planPlainText('Known sentence. Unknown sentence.');
    expect(render(plan, (s) => (s === 'Known sentence.' ? 'ತಿಳಿದ' : undefined))).toBe('ತಿಳಿದ Unknown sentence.');
  });

  it('splits an overlong sentence at a comma rather than feeding it whole', () => {
    const long = `${'The committee examined the matter in detail, '.repeat(20)}and reported.`;
    const parts = sentencesOf(planPlainText(long));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 600)).toBe(true);
  });
});

describe('planHtml', () => {
  it('keeps tags and translates each block', () => {
    const html = '<h2>Statement B — correct</h2>\n<p>In a State Legislature the Houses are <strong>not co-equal</strong>. The Council can delay.</p>';
    const plan = planHtml(html);
    expect(sentencesOf(plan)).toEqual([
      'Statement B — correct',
      'In a State Legislature the Houses are not co-equal.',
      'The Council can delay.',
    ]);
    expect(render(plan, mark)).toBe(
      '<h2>«Statement B — correct»</h2>\n<p>«In a State Legislature the Houses are not co-equal.» «The Council can delay.»</p>',
    );
  });

  it('keeps a wrapper that encloses the whole block', () => {
    expect(render(planHtml('<p><strong>Conclusion</strong></p>'), mark)).toBe('<p><strong>«Conclusion»</strong></p>');
  });

  it('escapes the translation and decodes entities before translating', () => {
    const plan = planHtml('<p>Tom &amp; Jerry &lt;3</p>');
    expect(sentencesOf(plan)).toEqual(['Tom & Jerry <3']);
    expect(render(plan, (s) => `${s} ok`)).toBe('<p>Tom &amp; Jerry &lt;3 ok</p>');
  });

  it('leaves code and lists of labels alone', () => {
    const html = '<pre>let x = 1;</pre><ul><li>A-1</li><li>Correct answer here</li></ul>';
    expect(render(planHtml(html), mark)).toBe('<pre>let x = 1;</pre><ul><li>A-1</li><li>«Correct answer here»</li></ul>');
  });

  it('handles line breaks inside a paragraph', () => {
    expect(render(planHtml('<p>First line<br>Second line</p>'), mark)).toBe('<p>«First line»<br>«Second line»</p>');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('&ldquo;A&rdquo; &#8594; &#x2192; &nbsp;x')).toBe('“A” → →  x');
  });
});
