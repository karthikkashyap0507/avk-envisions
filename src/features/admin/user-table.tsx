'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, ShieldCheck, ShieldOff, UserCog, UserMinus } from 'lucide-react';
import { toast } from 'sonner';

import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiClientError, api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

/**
 * User list with inline actions.
 *
 * Destructive actions confirm first. The server independently refuses to
 * demote or suspend the last admin, so a mistake here cannot lock the platform
 * out of itself even if this UI is bypassed.
 */
export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  phone: string | null;
  /** REGISTERED | GUEST_FREE_TEST */
  signupSource: string;
  lastLoginAt: string | null;
  createdAt: string;
  attempts: number;
  orders: number;
}

export function UserTable({ rows, currentUserId }: { rows: AdminUserRow[]; currentUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(userId: string, action: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;

    setBusy(userId);
    try {
      const result = await api.patch<{ ok: boolean }>('/api/admin/users', { userId, action });
      void result;
      toast.success('Done.');
      router.refresh();
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError ? caught.message : 'We could not complete that action.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map((user) => {
        const isSelf = user.id === currentUserId;
        // Guests have no real address — the stored one is a generated
        // `.invalid` placeholder, so their number is the useful identifier.
        const isGuest = user.signupSource === 'GUEST_FREE_TEST';

        return (
          <li key={user.id} className="flex items-center gap-4 p-4">
            <UserAvatar name={user.name} src={null} className="size-9 shrink-0" />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                {/* The name opens everything this student has attempted. */}
                <Link href={`/admin/users/${user.id}`} className="truncate font-medium leading-tight hover:text-primary hover:underline">
                  {user.name}
                </Link>
                <Badge variant={user.role === 'ADMIN' ? 'brand' : 'muted'} size="sm">
                  {user.role}
                </Badge>
                <StatusBadge status={user.status} />
                {isGuest ? (
                  <Badge variant="info" size="sm">
                    Free-test lead
                  </Badge>
                ) : (
                  !user.emailVerified && (
                    <Badge variant="warning" size="sm">
                      Unverified
                    </Badge>
                  )
                )}
                {isSelf && (
                  <Badge variant="info" size="sm">
                    You
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {isGuest ? (user.phone ?? 'No number recorded') : user.email}
                {!isGuest && user.phone && ` · ${user.phone}`} · joined{' '}
                {formatDate(user.createdAt, 'short')}
                {user.lastLoginAt && ` · last seen ${formatDate(user.lastLoginAt, 'short')}`}
              </p>
            </div>

            <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
              <p>
                <Link href={`/admin/users/${user.id}`} className="hover:text-primary hover:underline">
                  {user.attempts} attempts
                </Link>
              </p>
              {user.orders > 0 && <p>{user.orders} orders</p>}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy === user.id || isSelf}
                  aria-label={`Actions for ${user.name}`}
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                {user.role === 'STUDENT' ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      act(
                        user.id,
                        'make_admin',
                        `Make ${user.name} an admin? They will get full access to everything, including other admin accounts.`,
                      )
                    }
                  >
                    <ShieldCheck aria-hidden="true" />
                    Make admin
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() =>
                      act(user.id, 'make_student', `Remove admin rights from ${user.name}?`)
                    }
                  >
                    <UserMinus aria-hidden="true" />
                    Make student
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem onSelect={() => act(user.id, 'revoke_sessions')}>
                  <UserCog aria-hidden="true" />
                  Sign out everywhere
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {user.status === 'SUSPENDED' ? (
                  <DropdownMenuItem onSelect={() => act(user.id, 'activate')}>
                    <ShieldCheck aria-hidden="true" />
                    Reactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    destructive
                    onSelect={() =>
                      act(
                        user.id,
                        'suspend',
                        `Suspend ${user.name}? They will be signed out immediately and cannot sign back in.`,
                      )
                    }
                  >
                    <ShieldOff aria-hidden="true" />
                    Suspend
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}
