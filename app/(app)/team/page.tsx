import { createClient } from "@/lib/supabase/server";
import { listTeamMembers } from "./actions";
import { TeamBoard } from "./team-board";

export default async function TeamPage() {
  const { members, error } = await listTeamMembers();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
      />
    </div>
  );
}
