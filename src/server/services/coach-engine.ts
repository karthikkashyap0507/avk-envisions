/**
 * The AVK AI Coach's built-in answers.
 *
 * Used when no AI model is connected (there is no API key, and the 2 GB
 * server has no room to run a model of its own beside the translation
 * engine). Grounded exactly as a model would be: every figure it states is
 * taken from the student's record passed in, and where that record is thin it
 * says so instead of guessing. The advice around the figures is written by
 * hand - answers to the questions KAS aspirants actually ask - and chosen by
 * what the question is about.
 *
 * Pure: no database and no engine, so it can be tested on its own.
 */

export interface CoachRecord {
  questionsAnswered: number;
  correct: number;
  accuracy: number;
  avgTimeSeconds: number;
  testsCompleted: number;
  practiceSessions: number;
  subjects: { name: string; total: number; accuracy: number; isReliable: boolean }[];
  weakTopics: { name: string; total: number; accuracy: number }[];
  strongTopics: { name: string; total: number; accuracy: number }[];
  /** Recent test percentages, oldest first. */
  recentScores: { title: string; percentage: number }[];
  /** Answers a topic needs before its accuracy is worth judging. */
  minAnswers: number;
}

/** A full-length paper here gives 1.2 minutes a question. */
const SECONDS_PER_QUESTION = 72;
/** Below this many answers, a record says little about a student. */
const THIN = 30;

type Subject = 'polity' | 'history' | 'geography' | 'economy' | 'environment' | 'science' | 'current' | 'mental' | 'karnataka';

/** What a question about each subject looks like, and how record subjects are named. */
const SUBJECTS: Record<Subject, { words: RegExp; label: string; matches: RegExp; tips: string[] }> = {
  polity: {
    words: /\b(polity|constitution|laxmikanth|parliament|fundamental rights?|amendment|governance|panchayat|judiciary|preamble)\b/,
    label: 'Indian Polity',
    matches: /polity|constitution|governance/i,
    tips: [
      'Go through the Constitution part by part - Preamble, Fundamental Rights, DPSPs, Parliament, Executive, Judiciary, federalism, local government - with M. Laxmikanth as the base book.',
      'Keep a one-page table of important Articles and Amendments, and revise it every week.',
      'KAS likes Karnataka local government: revise the Karnataka Panchayat Raj Act and the 73rd and 74th Amendments.',
      'Solve every polity question from past papers - the same Articles and bodies come back year after year.',
    ],
  },
  history: {
    words: /\b(history|ancient|medieval|modern|freedom (struggle|movement)|culture|vijayanagara|mysore|hoysala|chalukya|wodeyar|kadamba)\b/,
    label: 'History',
    matches: /history|culture/i,
    tips: [
      'Split it into ancient, medieval and modern India, plus Karnataka history - Kadambas, Gangas, Chalukyas, Rashtrakutas, Hoysalas, Vijayanagara, the Wodeyars and Karnataka unification.',
      'Make timelines: KAS often asks which came first, or who ruled when.',
      'Use Spectrum for modern India and the NCERT books for the basics of ancient and medieval India.',
      'Art and culture - temples, literature, Jnanpith awardees from Karnataka - is worth a separate short note.',
    ],
  },
  geography: {
    words: /\b(geography|maps?|rivers?|climate|soils?|monsoon|physical geography|dams?)\b/,
    label: 'Geography',
    matches: /geograph/i,
    tips: [
      'Build the base from the class 11 and 12 NCERT geography books.',
      'Look at a map every day - rivers, dams, national parks, mountain passes - and Karnataka\'s districts, rivers and reservoirs in particular.',
      'Link physical geography to the economy: soils to crops, rivers to irrigation and power.',
      'Past papers show which map facts KAS keeps asking; revise those first.',
    ],
  },
  economy: {
    words: /\b(econom(y|ics)|budget|economic survey|inflation|banking|gdp|fiscal|monetary|rbi|tax|gst)\b/,
    label: 'Indian Economy',
    matches: /econom/i,
    tips: [
      'Get the concepts clear first - GDP, inflation, fiscal and monetary policy, banking, the budget terms - before the facts.',
      'Then read the latest Union and Karnataka budgets and the Economic Survey for the figures and schemes.',
      'Learn each government scheme with its ministry, its year and who it is for.',
      'Statement questions in economy hide traps in words like "only" and "all" - read them slowly.',
    ],
  },
  environment: {
    words: /\b(environment|ecology|biodiversity|climate change|pollution|wildlife|national parks?|ramsar|tiger reserves?|species)\b/,
    label: 'Environment',
    matches: /environment|ecolog/i,
    tips: [
      'Use Shankar IAS for the basics of ecology and biodiversity.',
      'Know the protected areas, especially Karnataka\'s tiger reserves, national parks and Ramsar sites.',
      'Revise the international conventions and climate agreements, with their years.',
      'Species and reports in the news turn up every year - keep a running list.',
    ],
  },
  science: {
    words: /\b(science|technology|s ?& ?t|isro|space|biology|physics|chemistry|health|diseases?|defence|vaccines?)\b/,
    label: 'Science & Technology',
    matches: /science|technolog/i,
    tips: [
      'The basics up to class 10 NCERT science cover most of the static questions.',
      'Current science carries more weight: space missions, defence, health and biotechnology in the news.',
      'For each development in the news, note what it is, who made it and why it matters.',
    ],
  },
  current: {
    words: /\b(current affairs|news|newspapers?|magazines?|monthly compilation)\b/,
    label: 'Current Affairs',
    matches: /current/i,
    tips: [
      'Read one newspaper every day - about 45 minutes - and make short notes.',
      'Revise with a monthly compilation; for prelims, cover the last 12 to 18 months.',
      'Give Karnataka news its own notes: state schemes, appointments, awards, sports and reports.',
      'Link each news item to its static topic - a new Ramsar site to environment, a judgement to polity.',
    ],
  },
  mental: {
    words: /\b(mental ability|reasoning|aptitude|csat|maths|quant(itative)?|comprehension|puzzles?|number series|data interpretation)\b/,
    label: 'Mental Ability',
    matches: /mental|reasoning|aptitude/i,
    tips: [
      'Practise 20 to 30 questions every day rather than a lot once a week.',
      'Learn the quick methods for percentages, ratios, averages and time-speed-distance.',
      'For comprehension, read the passage for the author\'s point, then answer only from the passage.',
      'Time yourself: these questions eat into the time for the rest of the paper.',
    ],
  },
  karnataka: {
    words: /\b(karnataka)\b/,
    label: 'Karnataka',
    matches: /karnataka/i,
    tips: [
      'KAS rewards Karnataka-specific knowledge in every subject.',
      'History: the Karnataka dynasties and the unification movement. Geography: rivers, dams and districts.',
      'Economy: the state budget, the Karnataka Economic Survey and state schemes.',
      'Culture and current affairs: literature, Jnanpith awardees, state awards and the year\'s state news.',
    ],
  },
};

function bullets(lines: string[]): string {
  return lines.map((line) => `• ${line}`).join('\n');
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Subjects with enough answers to judge, weakest first. */
function weakestSubjects(record: CoachRecord): CoachRecord['subjects'] {
  return record.subjects.filter((s) => s.isReliable).sort((a, b) => a.accuracy - b.accuracy);
}

/** One sentence on where the student stands, from their record only. */
function standing(record: CoachRecord): string {
  if (record.questionsAnswered === 0) {
    return "You haven't answered any questions yet, so I have no results of yours to go on.";
  }
  const base = `So far you have answered ${plural(record.questionsAnswered, 'question')} with ${record.accuracy}% accuracy, across ${plural(record.testsCompleted, 'test')} and ${plural(record.practiceSessions, 'quiz', 'quizzes')}.`;
  return record.questionsAnswered < THIN ? `${base} That is still too little to judge your strengths reliably.` : base;
}

/** Whether recent test scores are rising or falling, if there are enough of them. */
function trend(record: CoachRecord): string | null {
  const scores = record.recentScores.map((s) => s.percentage);
  if (scores.length < 4) return null;
  const earlier = (scores[0]! + scores[1]!) / 2;
  const later = (scores[scores.length - 1]! + scores[scores.length - 2]!) / 2;
  const change = Math.round(later - earlier);
  if (Math.abs(change) < 3) return `Your test scores have been steady, around ${Math.round(later)}%.`;
  return change > 0
    ? `Your test scores are rising: your last two averaged ${Math.round(later)}%, up from ${Math.round(earlier)}%.`
    : `Your test scores have dipped: your last two averaged ${Math.round(later)}%, down from ${Math.round(earlier)}%.`;
}

function subjectLine(record: CoachRecord, subject: Subject): string | null {
  const found = record.subjects.find((s) => SUBJECTS[subject].matches.test(s.name));
  if (!found) return null;
  return found.isReliable
    ? `In ${found.name} you are at ${found.accuracy}% over ${plural(found.total, 'question')}.`
    : `You have answered only ${plural(found.total, 'question')} in ${found.name} so far - not enough to judge yet.`;
}

const TALK_TO_SOMEONE =
  'Preparing for KAS is a long, demanding stretch, and feeling this way at times is very common. Take a proper break, sleep well, and talk to someone you trust - a friend, a family member or a mentor. If it feels overwhelming, please reach out to a counsellor or a helpline near you.\n\nWhen you feel ready, ask me to break the next week into small steps - one subject a day is enough to get going again.';

const MENU = bullets([
  'What should I focus on this week?',
  'How can I improve my accuracy?',
  'How do I answer faster?',
  'How should I prepare Polity / History / Geography / Economy / Environment / Science / Current Affairs / Mental Ability?',
  'How should I use previous year papers?',
  'How should I revise?',
]);

/** The coach's answer to one question. */
export function coachAnswer(question: string, record: CoachRecord): string {
  const q = ` ${question.toLowerCase().replace(/\s+/g, ' ').trim()} `;

  if (/[ಀ-೿]/.test(question) && !/[a-z]{3}/i.test(question)) {
    return `I can only answer in English for now - please ask your question in English.\n\nYou can still take every test, and read every analysis PDF, in Kannada: use the ಕನ್ನಡ button on the test or the analysis page.`;
  }

  if (/\b(stress(ed)?|anxious|anxiety|depress(ed|ion)?|demotivated|hopeless|give up|giving up|scared|nervous|panic|can'?t cope|burn(ed|t)? ?out|lonely|crying)\b/.test(q)) {
    return TALK_TO_SOMEONE;
  }

  if (/^ (hi|hello|hey|namaskara|namaste|good (morning|afternoon|evening))[ !.,]*$/.test(q)) {
    return `Hello! I'm your AVK AI Coach. ${standing(record)}\n\nAsk me things like:\n${MENU}`;
  }

  if (/\b(thank(s| you)|thx|ok(ay)? thanks)\b/.test(q) && q.trim().split(' ').length <= 6) {
    return "You're welcome! Come back after your next test and I'll look at your new results with you.";
  }

  if (/\bkannada\b/.test(q)) {
    return 'Yes - you can take any test in Kannada: tap "ಕನ್ನಡದಲ್ಲಿ ಪರೀಕ್ಷೆ ಬರೆಯಿರಿ" on the start screen, or switch between EN and ಕನ್ನಡ at any point during the test. The analysis PDFs have an English | ಕನ್ನಡ switch too, and your choice is remembered.';
  }

  // A topic the record knows about: "How do I improve at Fundamental Rights?"
  const topics = [...record.weakTopics, ...record.strongTopics];
  const topic = topics.find((t) => q.includes(t.name.toLowerCase()));
  if (topic) {
    const weak = record.weakTopics.includes(topic);
    return [
      `${topic.name}: you are at ${topic.accuracy}% over ${plural(topic.total, 'question')}.`,
      weak
        ? 'That is one of your weakest topics, so it is worth a focused week:'
        : 'That is one of your stronger topics - keep it warm, but your time is better spent on weaker ones:',
      bullets(
        weak
          ? [
              'Open Wrong questions and read the full solution of every question you missed in this topic. Write one line on why you got each wrong.',
              'Re-read the basics of the topic from your standard book before attempting more questions.',
              'Then take a Quiz on its subject and check that your accuracy here climbs above 70%.',
              'Come back to it a week later - one revision is never enough.',
            ]
          : ['A short Quiz on it once a week is enough to keep it.', 'Ask me "What should I focus on this week?" to find the topics that need you more.'],
      ),
    ].join('\n');
  }

  const subject = (Object.keys(SUBJECTS) as Subject[]).find((key) => SUBJECTS[key].words.test(q));
  if (subject) {
    const info = SUBJECTS[subject];
    const line = subjectLine(record, subject);
    return [
      `How to prepare ${info.label} for KAS:`,
      bullets(info.tips),
      line ? `\n${line} Take a Quiz on ${info.label} to practise it with the solution shown after every answer.` : `\nTake a Quiz on ${info.label} to practise it with the solution shown after every answer.`,
    ].join('\n');
  }

  if (/\b(time|speed|fast(er)?|slow|quick(ly|er)?|finish|time management|run out)\b/.test(q)) {
    const lines: string[] = [];
    if (record.questionsAnswered >= THIN) {
      const avg = Math.round(record.avgTimeSeconds);
      if (avg > 90) {
        lines.push(`You are taking about ${avg} seconds a question - slower than the ${SECONDS_PER_QUESTION} seconds a full-length paper gives you.`);
      } else if (avg < 40 && record.accuracy < 60) {
        lines.push(`You are fast (about ${avg} seconds a question) but your accuracy is ${record.accuracy}% - slowing down a little will earn you more marks than speed.`);
      } else {
        lines.push(`You are taking about ${avg} seconds a question, within the ${SECONDS_PER_QUESTION} seconds a full-length paper allows.`);
      }
    } else {
      lines.push(`A full-length paper here gives you about ${SECONDS_PER_QUESTION} seconds a question. Answer a few more questions and I can tell you how your own pace compares.`);
    }
    lines.push(
      bullets([
        'Go through the paper twice: answer what you are sure of first, mark the doubtful ones, and come back to them.',
        'Never spend more than two minutes on one question in the first round.',
        'Take every full-length test under exam timing - pace is a habit that only timed practice builds.',
        'For mental ability, learn the quick methods for percentages and ratios; they save the most time.',
      ]),
    );
    return lines.join('\n');
  }

  if (/\b(accura|mistakes?|wrong|negative|careless|silly|guess(ing)?|eliminat)/.test(q)) {
    const lines: string[] = [];
    if (record.questionsAnswered === 0) {
      lines.push("I don't have any of your answers yet, so here is what works for most students:");
    } else {
      lines.push(`Your overall accuracy is ${record.accuracy}% across ${plural(record.questionsAnswered, 'question')}.`);
      const weakest = weakestSubjects(record)[0];
      if (weakest) lines.push(`Your weakest subject is ${weakest.name}, at ${weakest.accuracy}% over ${plural(weakest.total, 'question')}.`);
    }
    lines.push(
      bullets([
        'Answer only when you can rule out at least two options - wrong answers can cost marks, so a blind guess is a bad bet. Check the rule on each test\'s start screen.',
        'Read statement questions slowly: words like "only", "all" and "not" decide the answer.',
        'After every test, open Wrong questions and write one line for each mistake: did not know, misread, or guessed. The pattern tells you what to fix.',
        'Re-take weak subjects in Quiz until your accuracy there crosses 70%.',
      ]),
    );
    return lines.join('\n');
  }

  if (/\b(this week|week|focus|plan|schedule|timetable|what (should|do) i (study|do|read|start)|next|priorit)/.test(q)) {
    if (record.questionsAnswered < THIN) {
      return [
        `${standing(record)} Here is a general week until you have more results:`,
        bullets([
          'Mon - Tue: Indian Polity basics, then a 20-question Quiz.',
          'Wed - Thu: History (include Karnataka history), then a Quiz.',
          'Fri: one full-length test under exam timing.',
          'Sat: go through every wrong answer and its solution.',
          'Sun: revise the week\'s notes and current affairs.',
          'Every day: about 45 minutes of current affairs.',
        ]),
        'Use the Study planner to put it on your calendar.',
      ].join('\n');
    }
    const weak = weakestSubjects(record);
    const first = weak[0];
    const second = weak[1];
    const weakTopic = record.weakTopics[0];
    return [
      'Here is a week built from your results:',
      bullets([
        first
          ? `Mon - Tue: ${first.name} - you are at ${first.accuracy}% there. Re-read the basics, then take a Quiz on it.`
          : 'Mon - Tue: your least-practised subject, then a Quiz on it.',
        second
          ? `Wed - Thu: ${second.name} (${second.accuracy}%).${weakTopic ? ` Spend one session on ${weakTopic.name}, your weakest topic at ${weakTopic.accuracy}%.` : ''}`
          : weakTopic
            ? `Wed - Thu: ${weakTopic.name}, your weakest topic at ${weakTopic.accuracy}%.`
            : 'Wed - Thu: a new subject you have not practised yet.',
        'Fri: one full-length test under exam timing.',
        'Sat: go through every wrong answer and its solution in Wrong questions.',
        'Sun: revise the week\'s notes and current affairs.',
        'Every day: about 45 minutes of current affairs.',
      ]),
      trend(record) ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (/\b(how many (mock|tests?)|mock tests?|full[- ]length|test series)\b/.test(q)) {
    return [
      'Early in your preparation, one full-length test a week is enough - what matters is the analysis afterwards. In the last two or three months, take two a week, along with past papers under exam timing.',
      bullets([
        'Spend as long going through a test as you spent taking it.',
        'Read the analysis for every question you got wrong or guessed.',
        'Track your score from test to test; the trend matters more than any one result.',
      ]),
      record.testsCompleted > 0 ? `You have completed ${plural(record.testsCompleted, 'test')} so far.${trend(record) ? ` ${trend(record)}` : ''}` : 'You have not completed a test yet - the free tests are a good place to start.',
    ].join('\n');
  }

  if (/\b(pyq|previous years?|past (years?|papers?)|old (papers?|questions?)|question papers?)\b/.test(q)) {
    return [
      'Previous year papers show exactly what KPSC asks and how. Use them from the very start, not just at the end:',
      bullets([
        'Take each year\'s paper under exam timing in KAS PYQ Tests.',
        'Then read its analysis PDF - every question with its answer and reasoning (in Kannada too).',
        'Note the topics that keep coming back; they deserve extra revision.',
        'Re-take a paper a month later and see how much more you get right.',
      ]),
    ].join('\n');
  }

  if (/\b(revis|notes?|remember|forget|memori[sz]e|retain)/.test(q)) {
    return [
      'Revision is what turns reading into marks. A simple plan:',
      bullets([
        'Revise each topic three times: the same day, a week later, and a month later.',
        'Keep short notes - a page or two per topic - so a revision takes minutes, not hours.',
        'Bookmark questions you want to see again, and quiz yourself on your bookmarks every week.',
        'Go through Wrong questions every weekend; the questions you missed are the ones you will miss again.',
      ]),
    ].join('\n');
  }

  if (/\b(start|begin(ner)?|new to|from scratch|how (to|do i|should i) prepare|strategy|roadmap|syllabus|first time)\b/.test(q)) {
    return [
      'A good way to start KAS Prelims preparation:',
      bullets([
        'Read the syllabus and a couple of past papers first, so you know what is asked.',
        'Build the base from NCERT books, then the standard books: Laxmikanth for polity, Spectrum for modern history, the NCERT geography books, Shankar IAS for environment.',
        'Give Karnataka its own notes in every subject - KAS rewards it.',
        'Read current affairs every day from the first week.',
        'Take one test a week and spend as long analysing it as taking it.',
      ]),
      record.questionsAnswered > 0 ? standing(record) : 'Take a free test and a few Quizzes, and I can start giving you advice based on your own results.',
    ].join('\n');
  }

  if (/\b(how am i doing|progress|performance|my (score|scores|results?|marks)|report|strong|weak(ness|est)?|analy[sz])/.test(q)) {
    if (record.questionsAnswered === 0) {
      return `${standing(record)} Take a test or a Quiz and ask me again - I'll show you your strong and weak areas.`;
    }
    const weak = weakestSubjects(record);
    return [
      standing(record),
      trend(record) ?? '',
      weak.length > 0 ? `By subject: ${weak.map((s) => `${s.name} ${s.accuracy}%`).join(', ')}.` : '',
      record.weakTopics.length > 0
        ? `Weakest topics: ${record.weakTopics.slice(0, 3).map((t) => `${t.name} (${t.accuracy}%)`).join(', ')}.`
        : `No topic has reached ${record.minAnswers} answers yet, so I can't name weak topics with confidence.`,
      record.strongTopics.length > 0
        ? `Strongest: ${record.strongTopics.slice(0, 3).map((t) => `${t.name} (${t.accuracy}%)`).join(', ')}.`
        : '',
      'Ask me "What should I focus on this week?" for a plan built from these.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    "I don't have a ready answer for that one, but here is where you stand:",
    standing(record),
    'You can ask me, for example:',
    MENU,
  ].join('\n');
}
