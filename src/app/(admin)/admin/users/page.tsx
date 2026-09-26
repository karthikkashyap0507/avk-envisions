import type { Metadata } from 'next';
import Link from 'next/link';
import { Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { UserTable } from '@/features/admin/user-table';
import { enforceAdminPermission } from '@/server/auth/guards';
import { PERMISSIONS } from '@/server/auth/permissions';
import { listUsers } from '@/server/services/admin-service';

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
  const result = await listUsers({
    search: params.q,
    role: params.role,
    source: params.source,
    page,
  });

  // Paging must carry the filters, or page 2 of a search silently becomes
  // page 2 of every user.
  const pageHref = (target: number) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.role) qs.set('role', params.role);
    if (params.source) qs.set('source', params.source);
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
            <Button type="submit" size="sm">
              Apply
            </Button>
            {(params.q || params.role || params.source) && (
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
