import type { Metadata } from 'next';
import Link from 'next/link';
import { Megaphone, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { UserTable } from '@/features/admin/user-table';
import { HEARD_ABOUT_LABELS, HEARD_ABOUT_SHORT_LABELS, HeardAbout } from '@/lib/enums';
import { fromStored as readHeardAbout } from '@/lib/heard-about';
import { cn } from '@/lib/utils';
import { enforceAdminPermission } from '@/server/auth/guards';
import { PERMISSIONS } from '@/server/auth/permissions';
import {
  HEARD_ABOUT_FILTER_NONE,
  getHeardAboutSummary,
  listUsers,
} from '@/server/services/admin-service';
import { boughtCourses } from '@/server/services/purchased-service';

export const metadata: Metadata = {
  title: 'Users',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const admin = await enforceAdminPermission(PERMISSIONS.USER_READ, '/admin/users');
  const params = await searchParams;

  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const [result, heard] = await Promise.all([
    listUsers({
      search: params.q,
      role: params.role,
      source: params.source,
      heard: params.heard,
      page,
    }),
    getHeardAboutSummary(),
  ]);

  // The breakdown, as rows that each filter the list to those students.
  const heardRows = [
    ...HeardAbout.values.map((code) => ({
      key: code as string,
      label: HEARD_ABOUT_SHORT_LABELS[code],
      title: HEARD_ABOUT_LABELS[code],
      count: heard.byCode[code],
    })),
    {
      key: HEARD_ABOUT_FILTER_NONE,
      label: 'Didn’t say',
      title: 'Asked, and ticked nothing',
      count: heard.asked - heard.answered,
    },
  ];
  const share = (count: number) => (heard.asked === 0 ? 0 : Math.round((count / heard.asked) * 100));

  // Paging must carry the filters, or page 2 of a search silently becomes
  // page 2 of every user.
  const pageHref = (target: number) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.role) qs.set('role', params.role);
    if (params.source) qs.set('source', params.source);
    if (params.heard) qs.set('heard', params.heard);
    qs.set('page', String(target));
    return `/admin/users?${qs.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.total} {result.total === 1 ? 'account' : 'accounts'}
        </p>
      </header>

      {/* Everyone who was asked — not just this page of the list — so the
          figures hold still while an admin pages or filters below. */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Megaphone className="size-4 text-primary" aria-hidden="true" />
              How students heard about us
            </h2>
            <p className="text-xs text-muted-foreground">
              {heard.asked === 0
                ? 'No one has been asked yet — it is on the sign-up form from now on'
                : `${heard.answered} of ${heard.asked} students who signed up since it was added answered · they can tick more than one`}
            </p>
          </div>

          {heard.asked > 0 && (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {heardRows.map((row) => {
                const active = params.heard === row.key;
                return (
                  <li key={row.key}>
                    <Link
                      href={active ? '/admin/users' : `/admin/users?heard=${row.key}`}
                      title={row.title}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'block rounded-lg border p-3 transition-colors',
                        active ? 'border-primary bg-primary-muted' : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <span className="block truncate text-xs text-muted-foreground">{row.label}</span>
                      <span className="mt-0.5 flex items-baseline gap-1.5">
                        <span className="text-lg font-semibold tabular-nums">{row.count}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{share(row.count)}%</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
                Search
              </label>
              <input
                id="q"
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Name, email or phone"
                className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="role" className="text-xs font-medium text-muted-foreground">
                Role
              </label>
              <select
                id="role"
                name="role"
                defaultValue={params.role ?? ''}
                className="mt-1 h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="ADMIN">Admin</option>
                <option value="STUDENT">Student</option>
              </select>
            </div>
            <div>
              <label htmlFor="source" className="text-xs font-medium text-muted-foreground">
                Source
              </label>
              <select
                id="source"
                name="source"
                defaultValue={params.source ?? ''}
                className="mt-1 h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="REGISTERED">Registered</option>
                <option value="GUEST_FREE_TEST">Free-test leads</option>
              </select>
            </div>
            <div>
              <label htmlFor="heard" className="text-xs font-medium text-muted-foreground">
                Heard about us
              </label>
              <select
                id="heard"
                name="heard"
                defaultValue={params.heard ?? ''}
                className="mt-1 h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                {HeardAbout.values.map((code) => (
                  <option key={code} value={code}>
                    {HEARD_ABOUT_SHORT_LABELS[code]}
                  </option>
                ))}
                <option value={HEARD_ABOUT_FILTER_NONE}>Didn’t say</option>
              </select>
            </div>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {(params.q || params.role || params.source || params.heard) && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/users">Clear</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users match"
          description="Try a different search, or clear the filters."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <UserTable
              currentUserId={admin.id}
              rows={result.rows.map((user) => ({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                status: user.status,
                emailVerified: Boolean(user.emailVerified),
                phone: user.phone,
                signupSource: user.signupSource,
                lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
                createdAt: user.createdAt.toISOString(),
                attempts: user._count.attempts,
                orders: user._count.orders,
                courses: boughtCourses(user.entitlements),
                heardAbout: readHeardAbout(user.heardAboutJson, user.heardAboutOther),
              }))}
            />
          </CardContent>
        </Card>
      )}

      {result.totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Pagination">
          <Button asChild variant="outline" size="sm" disabled={page <= 1}>
            <Link href={pageHref(page - 1)}>Previous</Link>
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            Page {page} of {result.totalPages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page >= result.totalPages}>
            <Link href={pageHref(page + 1)}>Next</Link>
          </Button>
        </nav>
      )}
    </div>
  );
}
