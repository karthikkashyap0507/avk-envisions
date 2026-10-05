import { redirect } from 'next/navigation';

/**
 * `/quiz` - the old quizzes page, hidden.
 *
 * "Quiz" in the student menu is the practice drill at /practice now, and the
 * separate quizzes list is no longer shown to students. Its address still
 * works for anyone with an old link or bookmark: it leads to the Quiz.
 */
export default function QuizPage() {
  redirect('/practice');
}
