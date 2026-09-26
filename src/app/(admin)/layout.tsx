import { AdminHeader, AdminSidebar } from '@/components/admin/admin-nav';
import { enforceAdminArea } from '@/server/auth/guards';

/**
 * Admin shell.
 *
 * `enforceAdminArea` runs on the server before anything renders, so a student
 * who navigates here is redirected to their dashboard rather than briefly
 * seeing admin chrome. Every nested page can therefore assume an admin session.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await enforceAdminArea('/admin');

  const identity = { name: user.name, email: user.email, avatarUrl: user.avatarUrl };

  return (
    <div className="flex min-h-dvh bg-muted/20">
      <AdminSidebar user={identity} permissions={user.permissions} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader user={identity} permissions={user.permissions} />

        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
