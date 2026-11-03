import Link from 'next/link';
import { ArrowRight, ClipboardList, Trophy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { FdaSdaSummary } from '@/server/services/catalogue-service';

/**
 * The KEA FDA / SDA launch, on the homepage.
 *
 * A banner of its own rather than another card in the track grid: it is a
 * different exam from everything else on the page, and a KAS student scrolling
 * the KAS tracks would otherwise never learn it exists. The counts come from
 * the series' own tests, so the chips cannot promise papers it does not have.
 */
export function FdaSdaBanner({ summary }: { summary: FdaSdaSummary }) {
  return (
    <section className="container pb-2 pt-6 sm:pt-8" aria-labelledby="fda-sda-heading">
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary-muted via-background to-amber-50/70 p-5 shadow-sm sm:p-7 dark:to-amber-950/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-red-600 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-white">
              New
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              KEA FDA / SDA Test Series
            </span>
          </p>
          <span className="rounded-full bg-emerald-600 px-3 py-1 text-[0.7rem] font-bold uppercase tracking-wide text-white">
            Enrolments open
          </span>
        </div>

        <div className="mt-3 grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_15rem] lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div>
            <h2
              id="fda-sda-heading"
              className="text-balance text-2xl font-bold tracking-tight sm:text-3xl"
            >
              Prepare for <span className="text-primary">KEA FDA &amp; SDA</span> 2026
            </h2>

            <ul className="mt-4 flex flex-wrap gap-2">
              <li className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold">
                <ClipboardList className="size-4 text-primary" aria-hidden="true" />
                {summary.sectional} Sectional Tests
              </li>
              <li className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold">
                <Trophy className="size-4 text-primary" aria-hidden="true" />
                {summary.fullLength} Full-Length Mock Tests
              </li>
            </ul>

            <p className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
              Questions based on recently conducted KEA examinations and exam-oriented practice.
            </p>

            <Button asChild size="lg" variant="brand" className="mt-5 w-full sm:w-auto">
              <Link href={summary.href}>
                Explore FDA / SDA Test Series
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <VidhanaSoudha className="mx-auto w-60 sm:w-full" />
        </div>
      </div>
    </section>
  );
}

/**
 * Vidhana Soudha with the national flag, drawn rather than photographed.
 *
 * An illustration keeps the banner light — a few hundred bytes against a
 * photograph's hundreds of kilobytes on the page every visitor opens — and
 * sidesteps licensing a picture of the building. Decorative only.
 */
function VidhanaSoudha({ className }: { className?: string }) {
  const stone = '#f3e5c3';
  const shade = '#e4cf9c';
  const line = '#c4a466';

  return (
    <svg viewBox="0 0 280 200" className={className} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="vs-windows" width="12" height="16" patternUnits="userSpaceOnUse">
          <rect x="3.5" y="2" width="5" height="10" rx="2.5" fill="#8a6a3a" opacity="0.35" />
        </pattern>
      </defs>

      {/* Sun and lawn */}
      <circle cx="198" cy="72" r="56" fill="#fde68a" opacity="0.55" />
      <ellipse cx="140" cy="192" rx="140" ry="12" fill="#bbf7d0" />

      {/* Trees either side */}
      <circle cx="10" cy="168" r="15" fill="#4ade80" />
      <circle cx="26" cy="176" r="11" fill="#22c55e" />
      <circle cx="270" cy="168" r="15" fill="#4ade80" />
      <circle cx="254" cy="176" r="11" fill="#22c55e" />

      {/* Wings */}
      <rect x="18" y="114" width="244" height="6" fill={shade} stroke={line} strokeWidth="0.8" />
      <rect x="22" y="120" width="236" height="62" fill={stone} stroke={line} strokeWidth="0.8" />
      <rect x="28" y="128" width="64" height="16" fill="url(#vs-windows)" />
      <rect x="188" y="128" width="64" height="16" fill="url(#vs-windows)" />
      <rect x="28" y="152" width="64" height="16" fill="url(#vs-windows)" />
      <rect x="188" y="152" width="64" height="16" fill="url(#vs-windows)" />

      {/* Corner towers and their domes */}
      {[34, 246].map((x) => (
        <g key={x}>
          <rect x={x - 11} y="96" width="22" height="18" fill={stone} stroke={line} strokeWidth="0.8" />
          <path d={`M${x - 12} 96 Q${x} 76 ${x + 12} 96 Z`} fill={shade} stroke={line} strokeWidth="0.8" />
          <line x1={x} y1="80" x2={x} y2="73" stroke={line} strokeWidth="1.2" />
        </g>
      ))}

      {/* Central block and portico */}
      <rect x="90" y="98" width="100" height="84" fill="#f7ecd2" stroke={line} strokeWidth="0.8" />
      <rect x="86" y="116" width="108" height="8" fill={shade} stroke={line} strokeWidth="0.8" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          x={96 + i * 12}
          y="124"
          width="4.5"
          height="48"
          fill="#fffaf0"
          stroke={line}
          strokeWidth="0.6"
        />
      ))}
      <rect x="92" y="172" width="96" height="4" fill={shade} />
      <rect x="98" y="176" width="84" height="4" fill={stone} stroke={line} strokeWidth="0.5" />
      <rect x="104" y="180" width="72" height="4" fill={shade} />

      {/* Drum, dome and lantern */}
      <rect x="110" y="80" width="60" height="18" fill={stone} stroke={line} strokeWidth="0.8" />
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={117 + i * 9.2} y1="82" x2={117 + i * 9.2} y2="96" stroke={line} strokeWidth="0.8" />
      ))}
      <path d="M106 81 C106 44 174 44 174 81 Z" fill="#ead293" stroke={line} strokeWidth="0.9" />
      <path d="M140 52 L140 81 M124 56 Q128 68 126 81 M156 56 Q152 68 154 81" stroke={line} strokeWidth="0.7" fill="none" />
      <rect x="134" y="44" width="12" height="8" fill={stone} stroke={line} strokeWidth="0.7" />
      <path d="M132 44 Q140 34 148 44 Z" fill={shade} stroke={line} strokeWidth="0.7" />

      {/* The flag */}
      <line x1="140" y1="37" x2="140" y2="6" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="141" y="7" width="28" height="6" fill="#ff9933" />
      <rect x="141" y="13" width="28" height="6" fill="#ffffff" />
      <rect x="141" y="19" width="28" height="6" fill="#138808" />
      <rect x="141" y="7" width="28" height="18" fill="none" stroke="#d1d5db" strokeWidth="0.5" />
      <circle cx="155" cy="16" r="2.4" fill="none" stroke="#000080" strokeWidth="0.8" />
    </svg>
  );
}
