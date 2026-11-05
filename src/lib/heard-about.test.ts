import { describe, expect, it } from 'vitest';

import { registerSchema } from '@/validations/auth';

import { fromStored, summarise, toStored } from './heard-about';

const base = {
  name: 'Ananya Sharma',
  email: 'ananya@example.com',
  phone: '9876543210',
  password: 'a-long-enough-password',
  confirmPassword: 'a-long-enough-password',
  acceptTerms: true as const,
};

describe('the registration form', () => {
  it('accepts no answer at all — the question is optional', () => {
    const parsed = registerSchema.parse(base);
    expect(parsed.heardAbout).toEqual([]);
  });

  it('accepts several options, keeping the form order and dropping repeats', () => {
    const parsed = registerSchema.parse({ ...base, heardAbout: ['YOUTUBE', 'TELEGRAM_TARGET_GROUPS', 'YOUTUBE'] });
    expect(parsed.heardAbout).toEqual(['TELEGRAM_TARGET_GROUPS', 'YOUTUBE']);
  });

  it('refuses an option that is not on the form', () => {
    expect(registerSchema.safeParse({ ...base, heardAbout: ['INSTAGRAM'] }).success).toBe(false);
  });

  it('refuses an "Other" answer longer than 120 characters', () => {
    const result = registerSchema.safeParse({ ...base, heardAbout: ['OTHER'], heardAboutOther: 'x'.repeat(121) });
    expect(result.success).toBe(false);
  });
});

describe('storing an answer', () => {
  it('records a skipped question as [] — asked, nothing ticked', () => {
    expect(toStored([])).toEqual({ heardAboutJson: '[]', heardAboutOther: null });
  });

  it('keeps the "Other" words only when "Other" is ticked', () => {
    expect(toStored(['OTHER'], '  A friend at the library  ')).toEqual({
      heardAboutJson: '["OTHER"]',
      heardAboutOther: 'A friend at the library',
    });
    expect(toStored(['YOUTUBE'], 'typed, then unticked Other')).toEqual({
      heardAboutJson: '["YOUTUBE"]',
      heardAboutOther: null,
    });
    expect(toStored(['OTHER'], '   ').heardAboutOther).toBeNull();
  });
});

describe('reading an answer back', () => {
  it('tells "never asked" apart from "asked and skipped"', () => {
    expect(fromStored(null, null)).toEqual({ asked: false, codes: [], other: null });
    expect(fromStored('[]', null)).toEqual({ asked: true, codes: [], other: null });
  });

  it('round-trips what was stored', () => {
    const stored = toStored(['TELEGRAM_OTHER', 'OTHER'], 'Coaching centre poster');
    expect(fromStored(stored.heardAboutJson, stored.heardAboutOther)).toEqual({
      asked: true,
      codes: ['TELEGRAM_OTHER', 'OTHER'],
      other: 'Coaching centre poster',
    });
  });

  it('drops anything it does not recognise instead of failing', () => {
    expect(fromStored('["YOUTUBE","RETIRED_OPTION",7]', null).codes).toEqual(['YOUTUBE']);
    expect(fromStored('not json', null)).toEqual({ asked: true, codes: [], other: null });
    expect(fromStored('{"YOUTUBE":true}', null).codes).toEqual([]);
  });
});

describe('the admin summary', () => {
  it('counts only students who were asked, and each option they ticked', () => {
    const summary = summarise([
      fromStored(null, null), // an older account: not counted
      fromStored('[]', null), // asked, skipped
      fromStored('["TELEGRAM_TARGET_GROUPS","YOUTUBE"]', null),
      fromStored('["YOUTUBE"]', null),
      fromStored('["OTHER"]', 'friend'),
    ]);

    expect(summary.asked).toBe(4);
    expect(summary.answered).toBe(3);
    expect(summary.byCode).toEqual({ TELEGRAM_TARGET_GROUPS: 1, TELEGRAM_OTHER: 0, YOUTUBE: 2, OTHER: 1 });
  });
});
