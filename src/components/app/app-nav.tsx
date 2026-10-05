'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Award,
  BarChart3,
  Bell,
  Bookmark,
  BrainCircuit,
  CalendarCheck,
  CreditCard,
  FileQuestion,
  Home,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Settings,
  ListChecks,
  Trophy,
  User,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Logo } from '@/components/site/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Grouped so the sidebar reads as a workflow, not an alphabetical dump. */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Prepare',
    items: [
      // The public site is where the catalogue lives, and from inside the app
      // shell the only route back was the logo — which does not read as a link.
      { href: '/', label: 'Home', icon: Home },
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/my-tests', label: 'My tests', icon: FileQuestion },
      // "Quiz" is the practice drill: untimed questions from the bank with the
      // solution shown at once. The separate quizzes page is hidden.
      { href: '/practice', label: 'Quiz', icon: ListChecks },
      { href: '/study-planner', label: 'Study planner', icon: CalendarCheck },
    ],
  },
  {
    title: 'Review',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
      { href: '/wrong-questions', label: 'Wrong questions', icon: XCircle },
      { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
    ],
  },
  {
    title: 'More',
    items: [
      { href: '/ai-coach', label: 'AVK AI Coach', icon: BrainCircuit },
      { href: '/achievements', label: 'Achievements', icon: Award },
      { href: '/subscriptions', label: 'Subscription', icon: CreditCard },
      { href: '/support', label: 'Support', icon: LifeBuoy },
    ],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-6 px-3 py-4" aria-label="Student">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="px-3 text-[0.6875rem] font-semibold uppercase tracking-widest text-muted-foreground">
            {group.title}
          </p>
          <ul className="mt-2 space-y-0.5">
            {group.items.map((item) => {
              // Home matches only itself: every path starts with "/", so the
              // prefix rule would mark it active everywhere.
              const active =
                item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary-muted text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export interface AppNavProps {
  user: { name: string; email: string; avatarUrl: string | null };
  unreadCount: number;
}

export function AppSidebar({ user }: { user: AppNavProps['user'] }) {
  return (
    // Shown from `md` rather than `lg`. The list was hidden on a tablet and
    // reachable only through the slide-out, which is where the request to
    // "let it appear like the picture instead of a hidden list" came from —
    // an iPad sits below `lg`. A phone still gets the slide-out, because a
    // fixed 16rem column there would leave no room for the page.
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Logo />
      </div>
      <div className="scrollbar-slim flex flex-1 flex-col overflow-y-auto">
        <NavLinks />
      </div>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <UserAvatar name={user.name} src={user.avatarUrl} className="size-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function AppHeader({ user, unreadCount }: AppNavProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
      // Full reload rather than a client navigation, so every cached server
      // component is discarded along with the session.
      window.location.href = '/login';
    } catch {
      toast.error('We could not sign you out. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-lg sm:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu aria-hidden="true" />
        </Button>

        <div className="md:hidden">
          <Logo showText={false} />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button asChild variant="ghost" size="icon-sm" className="relative">
            <Link href="/notifications" aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}>
              <Bell aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex size-2 rounded-full bg-destructive" />
              )}
            </Link>
          </Button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Account menu"
              >
                <UserAvatar name={user.name} src={user.avatarUrl} className="size-8" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="normal-case">
                <p className="text-sm font-medium text-foreground">{user.name}</p>
                <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <User aria-hidden="true" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings aria-hidden="true" />
                  Settings
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={signOut} disabled={signingOut}>
                <LogOut aria-hidden="true" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            tabIndex={-1}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-card shadow-float animate-fade-in">
            <div className="flex h-16 items-center justify-between border-b border-border px-5">
              <Logo />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="scrollbar-slim flex-1 overflow-y-auto">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
