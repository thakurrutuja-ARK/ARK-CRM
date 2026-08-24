import { createClient } from "@/lib/supabase/server";
import { listTeamMembers } from "./actions";
import { TeamBoard } from "./team-board";
import { isAdmin } from "@/lib/auth/role";

export default async function TeamPage() {
  const supabase = await createClient();

  // Fetching the member list and checking who's currently signed in
  // don't depend on each other, so run them at the same time instead
  // of one after the other — saves a full extra round trip to the
  // database on every page load.
  const [{ members, error }, {
    data: { user },
  }] = await Promise.all([listTeamMembers(), supabase.auth.getUser()]);

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.18em] text-brand-amber-dark uppercase mb-2">
        Team
      </p>
      <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-ink tracking-tight">
        Members
      </h1>
      <p className="text-sm text-slate-500 mt-2 mb-8">
        Invite teammates and manage who can sign in to this CRM.
      </p>

      <TeamBoard
        initialMembers={members}
        initialError={error}
        currentUserId={user?.id || null}
        isAdmin={isAdmin(user)}
      />
    </div>
  );
}
