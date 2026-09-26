import { AppError, errors } from '@/lib/api';
import { AUDIT_ACTIONS, audit } from '@/server/audit';
import { parseBody, route } from '@/server/api-handler';
import { requirePermission } from '@/server/auth/guards';
import { PERMISSIONS, type Permission } from '@/server/auth/permissions';
import { revokeAllSessions } from '@/server/auth/session';
import { db } from '@/server/db';
import { userActionSchema } from '@/validations/admin';

/**
 * PATCH /api/admin/users — act on a user.
 *
 * Two guards matter here and both are about not locking the platform out of
 * itself: an admin cannot act on their own account, and the last remaining
 * admin cannot be demoted or suspended.
 */
/**
 * What each action needs beyond being able to manage users at all. Checked on
 * the server, so a staff account with user access revoked is refused here
 * even with the Users page hidden from it.
 */
const ACTION_PERMISSION: Record<string, Permission> = {
  suspend: PERMISSIONS.USER_SUSPEND,
  activate: PERMISSIONS.USER_SUSPEND,
  make_admin: PERMISSIONS.USER_ASSIGN_ROLE,
  make_student: PERMISSIONS.USER_ASSIGN_ROLE,
  revoke_sessions: PERMISSIONS.SESSION_REVOKE_ANY,
};

export const PATCH = route(async ({ request, ip }) => {
  const admin = await requirePermission(PERMISSIONS.USER_UPDATE);
  const input = await parseBody(request, userActionSchema);

  const needed = ACTION_PERMISSION[input.action];
  if (needed && !admin.permissions.includes(needed)) {
    throw new AppError('FORBIDDEN', 'Your account is not permitted to do that.');
  }

  if (input.userId === admin.id) {
    throw new AppError(
      'FORBIDDEN',
      'You cannot change your own role or status here. Ask another admin.',
    );
  }

  const target = await db.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true, name: true, email: true, role: true, status: true },
  });
  if (!target) throw errors.notFound('User');

  // Guard against removing the last admin.
  if (
    target.role === 'ADMIN' &&
    (input.action === 'make_student' || input.action === 'suspend')
  ) {
    const otherAdmins = await db.user.count({
      where: { role: 'ADMIN', deletedAt: null, status: 'ACTIVE', NOT: { id: target.id } },
    });
    if (otherAdmins === 0) {
      throw new AppError(
        'FORBIDDEN',
        'This is the only active admin. Promote another account before changing this one.',
      );
    }
  }

  let message = '';

  switch (input.action) {
    case 'suspend':
      await db.user.update({ where: { id: target.id }, data: { status: 'SUSPENDED' } });
      // A suspended user must lose their live sessions immediately, or the
      // suspension does nothing until their cookie expires.
      await revokeAllSessions(target.id);
      message = `${target.name} suspended and signed out everywhere.`;
      break;

    case 'activate':
      await db.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
      message = `${target.name} reactivated.`;
      break;

    case 'make_admin':
      await db.user.update({ where: { id: target.id }, data: { role: 'ADMIN' } });
      message = `${target.name} is now an admin.`;
      break;

    case 'make_student':
      await db.user.update({ where: { id: target.id }, data: { role: 'STUDENT' } });
      await revokeAllSessions(target.id);
      message = `${target.name} is now a student.`;
      break;

    case 'revoke_sessions':
      await revokeAllSessions(target.id);
      message = `${target.name} signed out on all devices.`;
      break;
  }

  await audit({
    actor: { id: admin.id, email: admin.email, role: admin.role },
    action:
      input.action === 'suspend'
        ? AUDIT_ACTIONS.USER_SUSPENDED
        : AUDIT_ACTIONS.SESSIONS_REVOKED,
    entityType: 'User',
    entityId: target.id,
    meta: { action: input.action, targetEmail: target.email, previousRole: target.role },
    ipAddress: ip,
  });

  return { data: { ok: true }, message };
});
