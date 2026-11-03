'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronRight, LayoutDashboard, LogOut, User, X } from 'lucide-react';

import { Logo } from '@/components/site/logo';
import { SocialLinks } from '@/components/site/socials';
import { cn } from '@/lib/utils';

/**
 * The slide-out navigation.
 *
 * A vertical list rather than a row of tabs: the site has nine sections and a
 * horizontal bar could only show them by shrinking the labels until they read
 * as abbreviations. A list gives every section the same weight at any width,
 * which is how the catalogue is actually organised.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Rendered as the row's icon; passed from the server component. */
  icon: React.ReactNode;
  /** A short pill after the label, e.g. "NEW". */
  badge?: string;
  /** Tinted even when not the current page, to draw the eye to a launch. */
  highlight?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  session: { name: string; dashboardHref: string } | null;
  onSignOut: () => void;
  signingOut: boolean;
  pathname: string;
}

export function NavPanel({
  open,
  onClose,
  items,
  session,
  onSignOut,
  signingOut,
  pathname,
}: Props) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Escape closes it, as with any dialog. Without this the only way out on a
  // keyboard is to tab all the way to the close button.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus moves into the panel so a screen reader announces it rather than
  // leaving the reading position behind on the page underneath.
  React.useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Mounted state, because a portal needs a DOM to target and the server has
  // none. Without this the first client render disagrees with the server's.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  // Rendered at the end of <body>, not inside the header.
  //
  // The header applies `backdrop-filter` once the page scrolls, and that
  // establishes a containing block for fixed-position descendants — so the
  // panel sized itself against a sixteen-pixel-tall header instead of the
  // viewport, and everything below its title bar was clipped away. The menu
  // looked empty on any page far enough down to have scrolled.
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-xs flex-col overflow-y-auto bg-background shadow-2xl outline-none animate-slide-in-right sm:max-w-sm"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-3" aria-label="Main">
          <ul className="space-y-0.5">
            {items.map((item) => {
              // Home matches only itself: every path starts with "/", so the
              // prefix rule below would light Home on every page of the site.
              const active =
                item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary-muted text-primary'
                        : item.highlight
                          ? 'bg-primary-muted/60 text-foreground hover:bg-primary-muted'
                          : 'text-foreground hover:bg-muted/70',
                    )}
                  >
                    <span
                      className={cn('shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                    {/* A badged label wraps rather than truncates: on a phone the
                        pill takes the room the name needs, and "KEA FDA / SDA
                        Test S…" hides which test series it is. */}
                    <span className={cn('min-w-0 flex-1', item.badge ? 'leading-snug' : 'truncate')}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-white">
                        {item.badge}
                      </span>
                    )}
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="space-y-4 border-t border-border px-5 py-4">
          <Link
            href={session ? session.dashboardHref : '/register'}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <LayoutDashboard className="size-4" aria-hidden="true" />
            Dashboard
          </Link>

          <SocialLinks className="justify-center" />

          {session ? (
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 disabled:opacity-60"
            >
              <LogOut className="size-4" aria-hidden="true" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          ) : (
            <p className="flex items-center justify-center gap-3 text-sm">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-primary"
              >
                <User className="size-4" aria-hidden="true" />
                Login
              </Link>
              <span className="text-border" aria-hidden="true">
                |
              </span>
              <Link href="/register" className="font-semibold text-primary hover:underline">
                Register
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
