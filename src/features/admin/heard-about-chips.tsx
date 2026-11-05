import { Badge } from '@/components/ui/badge';
import { HEARD_ABOUT_LABELS, HEARD_ABOUT_SHORT_LABELS } from '@/lib/enums';
import type { HeardAboutAnswer } from '@/lib/heard-about';
import { cn } from '@/lib/utils';

/**
 * A student's answer to "How did you hear about us?", for the admin.
 *
 * Says nothing for an account that was never asked — older accounts and
 * free-test leads — rather than "didn't say", which would read as a skipped
 * question. Short names in the chips, the full wording on hover.
 */
export function HeardAboutChips({ answer, className }: { answer: HeardAboutAnswer; className?: string }) {
  if (!answer.asked) return null;

  return (
    <p className={cn('flex flex-wrap items-center gap-1.5 text-xs', className)}>
      <span className="text-muted-foreground">Heard about us:</span>
      {answer.codes.length === 0 ? (
        <span className="italic text-muted-foreground">didn’t say</span>
      ) : (
        answer.codes.map((code) => (
          <Badge key={code} variant="brand" size="sm" title={HEARD_ABOUT_LABELS[code]}>
            <span>
              {HEARD_ABOUT_SHORT_LABELS[code]}
              {code === 'OTHER' && answer.other && (
                <span className="font-normal opacity-90"> — “{answer.other}”</span>
              )}
            </span>
          </Badge>
        ))
      )}
    </p>
  );
}
