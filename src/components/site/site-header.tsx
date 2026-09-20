'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  Crown,
  FileText,
  Gift,
  HelpCircle,
  Home,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  PenSquare,
  Search,
  Tag,
  Target,
  CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';

import { Logo } from '@/components/site/logo';
import { NavPanel } from '@/components/site/nav-panel';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * The sections, in the order the panel lists them.
 *
 * Labels are the client's own wording — "KAS PYQ Tests", "KAS-50 (Daily tests)",
 * "KAS Full Length Tests" — so the site reads the way their students hear it
 * described, even where that differs from the page titles.
 */
const NAV_LINKS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/courses', label: 'Courses', icon: BookOpen },
  // Same order as the cards everywhere else.
  { href: '/pyq', label: 'KAS PYQ Tests', icon: FileText },
  { href: '/test-series/kas-prelims-free-test-series', label: 'Free Tests', icon: Gift },
  { href: '/50-days', label: 'KAS-50 (Daily tests)', icon: Target },
  { href: '/test-series/kas-prelims-paid-test-series', label: 'KAS Full Length Tests', icon: Crown },
  { href: '/chapterwise', label: 'Chapter-wise', icon: Layers },
  { href: '/quiz', label: 'Quiz', icon: HelpCircle },
  { href: '/pricing', label: 'Pricing and Payment Details', icon: Tag },
  { href: '/success-stories', label: 'Results', icon: BarChart3 },
  { href: '/blog', label: 'Blog', icon: PenSquare },
] as const;

export interface SiteHeaderProps {
  /** Present when a session exists, so the CTA reflects signed-in state. */
  session: { name: string; dashboardHref: string } | null;
}

export function SiteHeader({ session }: SiteHeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  // Signing out used to live only in the app shell, so anyone reading a PYQ
  // page, a synopsis or the catalogue had no way to leave their session without
  // first navigating to the dashboard. On a shared or borrowed device that is
  // not a minor inconvenience.
  async function signOut() {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
      // A full reload, not a client navigation: every cached server component
      // has to be discarded along with the session.
      window.location.href = '/';
    } catch {
      toast.error('We could not sign you out. Please try again.');
      setSigningOut(false);
    }
  }

  // Elevate the header once the page scrolls, so it separates from content.
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile sheet on navigation, otherwise it covers the new page.
  React.useEffect(() => setMobileOpen(false), [pathname]);

  // Lock body scroll while the mobile menu is open.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b transition-all duration-200',
        scrolled
          ? 'border-border bg-background/85 backdrop-blur-lg supports-[backdrop-filter]:bg-background/70'
          : 'border-transparent bg-background',
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-3">
        <Logo />

        {/* The sections live in the panel, not along the top. Nine of them
            could only fit a bar by shrinking the labels until they read as
            abbreviations, and the client's students know these by their full
            names. */}
        <div className="flex items-center gap-1.5">
          {/* Points at the catalogue rather than a search page: there is no
              public search yet, and a magnifier that 404s is worse than one
              that lands somewhere a visitor can browse. */}
          <Link
            href="/courses"
            aria-label="Browse courses"
            className="flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Search className="size-4" aria-hidden="true" />
          </Link>

          <ThemeToggle className="hidden sm:inline-flex" />

          {session && (
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href={session.dashboardHref}>
                <LayoutDashboard aria-hidden="true" />
                Dashboard
              </Link>
            </Button>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-expanded={mobileOpen}
            aria-controls="site-nav-panel"
            aria-label="Open menu"
            className="flex size-10 items-center justify-center rounded-full border border-border transition-colors hover:bg-muted"
          >
            <Menu className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div id="site-nav-panel">
        <NavPanel
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          items={NAV_LINKS.map((link) => ({
            href: link.href,
            label: link.label,
            icon: <link.icon className="size-[1.15rem]" />,
          }))}
          session={session}
          onSignOut={signOut}
          signingOut={signingOut}
          pathname={pathname}
        />
      </div>

    </header>
  );
}
