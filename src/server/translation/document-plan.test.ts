import { describe, expect, it } from 'vitest';

import { planBlock } from './document-plan';
import { render, sentencesOf, splitSentences } from './segments';

/** What a paragraph becomes, with every engine sentence marked. */
function kannada(text: string): string | null {
  const pieces = planBlock(text);
  return pieces ? render(pieces, (s) => `«${s}»`) : null;
}

function sentences(text: string): string[] {
  return sentencesOf(planBlock(text) ?? []);
}

describe('planBlock', () => {
  it('gives the box headings one fixed Kannada, whatever their case', () => {
    expect(kannada('ANSWER')).toBe('ಉತ್ತರ');
    expect(kannada('HOW TO SOLVE')).toBe('ಬಿಡಿಸುವ ವಿಧಾನ');
    expect(kannada('How to Solve')).toBe('ಬಿಡಿಸುವ ವಿಧಾನ');
    expect(kannada('FUTURE ANGLE — RELATED QUESTIONS')).toBe('ಭವಿಷ್ಯದ ದೃಷ್ಟಿಕೋನ — ಸಂಬಂಧಿತ ಪ್ರಶ್ನೆಗಳು');
    expect(sentences('ABOUT THE QUESTION')).toEqual([]);
  });

  it('composes running headers word by word, keeping KAS, PYQ and numerals', () => {
    expect(kannada('KAS PRELIMS 2024 • PAPER-I • COMPLETE PYQ SYNOPSIS')).toBe(
      'KAS ಪ್ರಿಲಿಮ್ಸ್ 2024 • ಪತ್ರಿಕೆ-I • ಸಂಪೂರ್ಣ PYQ ಸಾರಾಂಶ',
    );
    expect(kannada('KAS PRELIMS 2024 · AUGUST · PAPER-II · PYQ ANALYSIS')).toBe(
      'KAS ಪ್ರಿಲಿಮ್ಸ್ 2024 · ಆಗಸ್ಟ್ · ಪತ್ರಿಕೆ-II · PYQ ವಿಶ್ಲೇಷಣೆ',
    );
    expect(kannada('Q12. HISTORY | PYQ ANALYSIS')).toBe('ಪ್ರಶ್ನೆ 12. ಇತಿಹಾಸ | PYQ ವಿಶ್ಲೇಷಣೆ');
    expect(kannada('AVK Envisions • KAS Prelims 2026 • Paper 1 Premium Synopsis')).toBe(
      'AVK Envisions • KAS ಪ್ರಿಲಿಮ್ಸ್ 2026 • ಪತ್ರಿಕೆ 1 ಪ್ರೀಮಿಯಂ ಸಾರಾಂಶ',
    );
  });

  it('keeps the brand, and turns page numbers and the tagline', () => {
    expect(planBlock('AVK ENVISIONS')).toBeNull();
    expect(kannada('Page 4')).toBe('ಪುಟ 4');
    expect(kannada('AVK ENVISIONS • Learn • Practice • Excel')).toBe('AVK ENVISIONS • ಕಲಿಯಿರಿ • ಅಭ್ಯಾಸ ಮಾಡಿ • ಸಾಧಿಸಿ');
  });

  it('labels a labelled answer and leaves its code alone', () => {
    expect(kannada('ANSWER: B')).toBe('ಉತ್ತರ: B');
    expect(kannada('ANSWER · Option 3')).toBe('ಉತ್ತರ · «Option 3»');
  });

  it('leaves option codes and numbers exactly as they are', () => {
    expect(planBlock('(1) A, C,D, B')).toBeNull();
    expect(planBlock('(4) II I IV III')).toBeNull();
    expect(planBlock('1982')).toBeNull();
  });

  it('sends prose through the sentence splitter, markers and arrows kept', () => {
    expect(kannada('• Third gender recognition → NALSA v. Union of India')).toBe(
      '• «Third gender recognition» → «NALSA v. Union of India»',
    );
    expect(sentences('This tests the relative size of the budget. Compare the magnitudes.')).toEqual([
      'This tests the relative size of the budget.',
      'Compare the magnitudes.',
    ]);
  });

  it('splits items run together on one line', () => {
    expect(kannada('Lothal → Gujarat • Mandu → Madhya Pradesh •')).toBe(
      '«Lothal» → «Gujarat» • «Mandu» → «Madhya Pradesh» •',
    );
  });

  it('lower-cases a heading in capitals for the engine, keeping abbreviations', () => {
    expect(sentences('THE ROLE OF NALSA IN LEGAL AID')).toEqual(['The role of NALSA in legal aid']);
  });
});

describe('case names', () => {
  it('does not end a sentence at the v of a case name', () => {
    expect(sentencesOf(splitSentences('It points to NALSA v. Union of India. Then read on.'))).toEqual([
      'It points to NALSA v. Union of India.',
      'Then read on.',
    ]);
  });
});

describe('headings with their punctuation', () => {
  it('keeps the colon of a label', () => {
    expect(kannada('How to solve:')).toBe('ಬಿಡಿಸುವ ವಿಧಾನ:');
    expect(kannada('Options:')).toBe('ಆಯ್ಕೆಗಳು:');
    expect(kannada('How to solve: Read each statement.')).toBe('ಬಿಡಿಸುವ ವಿಧಾನ: «Read each statement.»');
  });

  it('numbers a question in Kannada and translates the rest', () => {
    expect(kannada('Q3. Where was the 14th World Sanskrit Conference held?')).toBe(
      'ಪ್ರಶ್ನೆ 3. «Where was the 14th World Sanskrit Conference held?»',
    );
  });
});
