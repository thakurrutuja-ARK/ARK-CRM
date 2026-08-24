"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Mail, X, Clock, CheckCircle2, ShieldCheck, Shield } from "lucide-react";
import {
  inviteTeamMember,
  removeTeamMember,
  setTeamMemberRole,
  type TeamMember,
} from "./actions";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function TeamBoard({
  initialMembers,
  initialError,
  currentUserId,
  isAdmin,
}: {
  initialMembers: TeamMember[];
  initialError?: string;
  currentUserId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [error, setError] = useState(initialError || null);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Keep the list in sync with the server's data (real UUIDs and all)
  // whenever this page re-fetches, e.g. after router.refresh().
  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  function closeInviteModal() {
    setShowInvite(false);
    setEmail("");
    setInviteError(null);
    setInviteSent(null);
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    startTransition(async () => {
      const result = await inviteTeamMember(email);
      if (result.error) {
        setInviteError(result.error);
        return;
      }
      setInviteSent(email.trim());
      setEmail("");
      // Re-fetch the real member list from the server (with the new
      // teammate's actual UUID) instead of guessing at a fake local one.
      router.refresh();
    });
  }

  function handleRemove(member: TeamMember) {
    if (!confirm(`Remove ${member.email} from the team? They'll lose access immediately.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await removeTeamMember(member.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      router.refresh();
    });
  }

  function handleToggleRole(member: TeamMember) {
    const nextRole = member.role === "admin" ? "member" : "admin";
    if (
      !confirm(
        nextRole === "admin"
          ? `Make ${member.email} an admin? They'll be able to delete clients and manage categories.`
          : `Remove admin access from ${member.email}? They'll keep normal member access.`
      )
    ) {
      return;
    }
    setError(null);
    setChangingRoleId(member.id);
    startTransition(async () => {
      const result = await setTeamMemberRole(member.id, nextRole);
      setChangingRoleId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, role: nextRole } : m))
      );
      router.refresh();
    });
  }

  return (
    <div>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 mb-6">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>
        {isAdmin && (
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2.5 shadow-md hover:bg-black hover:shadow-lg transition-all whitespace-nowrap"
          >
            <UserPlus className="h-4 w-4" />
            Invite teammate
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-white shadow-md ring-1 ring-black/[0.06] divide-y divide-black/5 overflow-hidden">
        {members.length === 0 ? (
          <div className="text-center text-slate-500 text-sm py-12">
            No team members found.
          </div>
        ) : (
          members.map((member) => (
            <div
              key={member.id}
              className="group flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-amber/15 text-brand-amber-dark">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-ink truncate">
                    {member.email}
                    {member.id === currentUserId && (
                      <span className="ml-2 text-xs font-medium text-slate-400">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {member.invited
                      ? `Invited ${formatDate(member.created_at)}`
                      : `Joined ${formatDate(member.created_at)}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {member.role === "admin" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 text-[11px] font-semibold px-2.5 py-1">
                    <ShieldCheck className="h-3 w-3" />
                    Admin
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold px-2.5 py-1">
                    <Shield className="h-3 w-3" />
                    Member
                  </span>
                )}
                {member.invited ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold px-2.5 py-1">
                    <Clock className="h-3 w-3" />
                    Invited
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2.5 py-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Active
                  </span>
                )}
                {isAdmin && member.id !== currentUserId && (
                  <>
                    <button
                      onClick={() => handleToggleRole(member)}
                      disabled={isPending}
                      title={member.role === "admin" ? "Remove admin access" : "Make admin"}
                      className="opacity-0 group-hover:opacity-100 text-[11px] font-semibold text-slate-400 hover:text-brand-amber-dark transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      {changingRoleId === member.id
                        ? "…"
                        : member.role === "admin"
                        ? "Remove admin"
                        : "Make admin"}
                    </button>
                    <button
                      onClick={() => handleRemove(member)}
                      disabled={isPending}
                      title="Remove from team"
                      className="opacity-0 group-hover:opacity-100 h-7 w-7 rounded-full flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showInvite && (
        <div
          className="fixed inset-0 z-20 bg-brand-ink/50 flex items-center justify-center p-4"
          onClick={closeInviteModal}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-bold text-brand-ink mb-1">
              Invite a teammate
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              They'll get an email to set a password and sign in.
            </p>

            {inviteSent ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-3 mb-4">
                Invite sent to <span className="font-semibold">{inviteSent}</span>.
              </div>
            ) : (
              <form onSubmit={handleInvite} className="space-y-4">
                {inviteError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
                    {inviteError}
                  </div>
                )}
                <div>
                  <label
                    htmlFor="invite-email"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    Email address
                  </label>
                  <input
                    id="invite-email"
                    type="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                    placeholder="teammate@arkpeoplesolutions.com"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeInviteModal}
                    className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !email.trim()}
                    className="rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2 shadow-md hover:bg-black transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isPending ? "Sending…" : "Send invite"}
                  </button>
                </div>
              </form>
            )}

            {inviteSent && (
              <div className="flex justify-end">
                <button
                  onClick={closeInviteModal}
                  className="rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2 shadow-md hover:bg-black transition-all"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
