'use client';

import * as React from 'react';
import { Check, ChevronRight, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Chooses where an import should land — one place or several.
 *
 * Questions are created once and linked to each chosen test, so picking a
 * subject drill and a free mock together costs nothing extra and keeps them in
 * step: correct the question later and every test showing it changes.
 *
 * Grouped by series because that is how an admin thinks about the catalogue —
 * "the December papers", not a flat list of ninety tests. Tests belonging to no
 * series are gathered under one heading rather than hidden.
 */

export interface PickerTest {
  id: string;
  title: string;
  questionCount: number;
  status: string;
  accessType: string;
  /** The exam the paper belongs to; questions from any other exam are refused. */
  examId?: string;
}

export interface PickerGroup {
  id: string | null;
  name: string;
  tests: PickerTest[];
}

interface Props {
  groups: PickerGroup[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function DestinationPicker({ groups, selected, onChange }: Props) {
  const [query, setQuery] = React.useState('');
  // Groups start closed except where something is already chosen, so a long
  // catalogue opens as a short list rather than a wall of checkboxes.
  const [open, setOpen] = React.useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const group of groups) {
      if (group.tests.some((test) => selected.includes(test.id))) initial.add(group.name);
    }
    return initial;
  });

  const term = query.trim().toLowerCase();

  const visible = React.useMemo(() => {
    if (term === '') return groups;
    return groups
      .map((group) => ({
        ...group,
        tests: group.tests.filter(
          (test) =>
            test.title.toLowerCase().includes(term) || group.name.toLowerCase().includes(term),
        ),
      }))
      .filter((group) => group.tests.length > 0);
  }, [groups, term]);

  // While searching, every matching group is shown open: hiding matches behind
  // a collapsed heading would make the search look broken.
  const isOpen = (name: string) => term !== '' || open.has(name);

  function toggleGroup(name: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleTest(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  function toggleAll(group: PickerGroup) {
    const ids = group.tests.map((test) => test.id);
    const allOn = ids.every((id) => selected.includes(id));
    onChange(allOn ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tests or series..."
            aria-label="Search destinations"
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto p-1.5">
        {visible.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No test matches “{query}”.
          </p>
        ) : (
          visible.map((group) => {
            const ids = group.tests.map((test) => test.id);
            const chosen = ids.filter((id) => selected.includes(id)).length;

            return (
              <div key={group.name} className="mb-0.5">
                <div className="flex items-center gap-1 rounded-lg px-1 hover:bg-muted/50">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.name)}
                    aria-expanded={isOpen(group.name)}
                    className="rounded p-1 text-muted-foreground"
                    aria-label={isOpen(group.name) ? `Collapse ${group.name}` : `Expand ${group.name}`}
                  >
                    <ChevronRight
                      className={cn('size-4 transition-transform', isOpen(group.name) && 'rotate-90')}
                      aria-hidden="true"
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleAll(group)}
                    className="flex flex-1 items-center gap-2 py-2 text-left"
                  >
                    <Box checked={chosen > 0 && chosen === ids.length} partial={chosen > 0 && chosen < ids.length} />
                    <span className="text-sm font-semibold">{group.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {chosen > 0 ? `${chosen} of ${ids.length} selected` : `${ids.length} test${ids.length === 1 ? '' : 's'}`}
                    </span>
                  </button>
                </div>

                {isOpen(group.name) && (
                  <ul className="ml-7 border-l border-border pl-1">
                    {group.tests.map((test) => {
                      const on = selected.includes(test.id);
                      return (
                        <li key={test.id}>
                          <button
                            type="button"
                            onClick={() => toggleTest(test.id)}
                            aria-pressed={on}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                              on ? 'bg-primary-muted' : 'hover:bg-muted/50',
                            )}
                          >
                            <Box checked={on} />
                            <span className="min-w-0 flex-1 truncate text-sm">{test.title}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {test.questionCount}q
                            </span>
                            {test.status !== 'PUBLISHED' && (
                              <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-warning-foreground">
                                {test.status.toLowerCase()}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Box({ checked, partial }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border',
        checked || partial ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
      )}
    >
      {checked && <Check className="size-3" />}
      {!checked && partial && <span className="h-0.5 w-2 rounded bg-primary-foreground" />}
    </span>
  );
}
