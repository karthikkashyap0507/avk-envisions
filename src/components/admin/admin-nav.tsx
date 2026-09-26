'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ListChecks,
  ClipboardList,
  FileQuestion,
  FileText,
  FileUp,
  LayoutDashboard,
  LayoutGrid,
  Flag,
  LifeBuoy,
  LogOut,
  Menu,
  MessageSquare,
  Newspaper,
  Receipt,
  Settings,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Logo } from '@/components/site/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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

/**
 * Admin navigation.
 *
 * Grouped by the job being done rather than by database table, so the sidebar
 * reads as "build content / run the business / keep the lights on" instead of
 * an alphabetical model listing.
 */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to an admin holding this permission; the page checks it too. */
  permission?: string;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Content',
    items: [
      { href: '/admin/questions', label: 'Question bank', icon: FileQuestion },
      { href: '/admin/import', label: 'Import from PDF', icon: FileUp },
      { href: '/admin/synopsis', label: 'Analysis PDFs', icon: FileText },
      { href: '/admin/tests', label: 'Tests', icon: ClipboardList },
      { href: '/admin/test-series', label: 'Test series', icon: LayoutGrid },
      { href: '/admin/free-tests', label: 'Free test series', icon: Sparkles },
      { href: '/admin/50-days', label: '50 Days challenge', icon: CalendarDays },
      { href: '/admin/quiz', label: 'Quizzes', icon: ListChecks },
      { href: '/admin/exams', label: 'Exams & syllabus', icon: BookOpen },
    ],
  },
  {
    title: 'People & money',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users, permission: 'user.read' },
      { href: '/admin/orders', label: 'Orders', icon: Receipt, permission: 'order.read' },
      { href: '/admin/support', label: 'Support', icon: LifeBuoy },
      { href: '/admin/reports', label: 'Reported questions', icon: Flag },
      { href: '/admin/feedback', label: 'Feedback', icon: MessageSquare },
    ],
  },
  {
    title: 'Platform',
    items: [
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/admin/blog', label: 'Blog', icon: Newspaper },
      { href: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function NavLinks({
  permissions,
  onNavigate,
}: {
  permissions: readonly string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  // A link to a page the admin cannot open is only a way to be bounced back.
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <nav className="flex-1 space-y-6 px-3 py-4" aria-label="Admin">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="px-3 text-[0.6875rem] font-semibold uppercase tracking-widest text-muted-foreground">
            {group.title}
          </p>
          <ul className="mt-2 space-y-0.5">
            {group.items.map((item) => {
              // `/admin` must match exactly, or it would light up on every child.
              const active =
                item.href === '/admin'
                  ? pathname === '/admin'
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

export interface AdminNavProps {
  user: { name: string; email: string; avatarUrl: string | null };
  /** The signed-in admin's effective permissions, after any revocations. */
  permissions: readonly string[];
}

export function AdminSidebar({ user, permissions }: AdminNavProps) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <Logo href="/admin" />
      </div>
      <div className="scrollbar-slim flex flex-1 flex-col overflow-y-auto">
        <NavLinks permissions={permissions} />
      </div>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <UserAvatar name={user.name} src={user.avatarUrl} className="size-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">Administrator</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function AdminHeader({ user, permissions }: AdminNavProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
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
          className="lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu aria-hidden="true" />
        </Button>

        <div className="lg:hidden">
          <Logo href="/admin" showText={false} />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* A quick way back to the public site, which admins check constantly. */}
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/" target="_blank" rel="noreferrer">
              View site
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
                <Link href="/admin/settings">
                  <Settings aria-hidden="true" />
                  Platform settings
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

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            tabIndex={-1}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-card shadow-float animate-fade-in">
            <div className="flex h-16 items-center justify-between border-b border-border px-5">
              <Logo href="/admin" />
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
              <NavLinks permissions={permissions} onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
