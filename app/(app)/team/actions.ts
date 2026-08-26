"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, type Role } from "@/lib/auth/role";

export type TeamMember = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  invited: boolean;
  role: Role;
};

async function getSiteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = host.includes("localhost")
    ? "http"
    : h.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

/** Every route action here is privileged — always confirm the caller is signed in first. */
async function requireSignedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("You must be signed in.");
  }
  return user;
}

// Team management (inviting, removing, changing roles) is admin-only —
// unlike client/document actions, which stay open to every signed-in
// teammate. See lib/auth/role.ts for how the role is read.
async function requireAdmin() {
  const user = await requireSignedIn();
  if (!isAdmin(user)) {
    throw new Error("Only an admin can do that.");
  }
  return user;
}

export async function listTeamMembers(): Promise<{
  members: TeamMember[];
  error?: string;
}> {
  try {
    await requireSignedIn();
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) return { members: [], error: error.message };

    const members = (data?.users || [])
      .map((u) => ({
        id: u.id,
        email: u.email || "",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        invited: !u.last_sign_in_at,
        role: (u.app_metadata?.role === "admin" ? "admin" : "member") as Role,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));

    return { members };
  } catch (err) {
    return {
      members: [],
      error: err instanceof Error ? err.message : "Couldn't load team members.",
    };
  }
}

export async function inviteTeamMember(
  email: string
): Promise<{ success?: true; error?: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
    return { error: "Enter a valid email address." };
  }

  try {
    await requireAdmin();
    const admin = createAdminClient();
    const siteUrl = await getSiteUrl();

    // Accepting the invite takes them to /set-password so they can choose
    // a password once — from then on they sign in with email + password
    // like everyone else (see lib/auth/role.ts for the separate
    // admin/member *permission* distinction, which is unrelated to this).
    const { data, error } = await admin.auth.admin.inviteUserByEmail(trimmed, {
      redirectTo: `${siteUrl}/auth/confirm?next=/set-password`,
    });

    if (error) return { error: error.message };

    // New teammates start as regular members — an admin promotes them
    // later from this page if needed. inviteUserByEmail has no way to set
    // app_metadata directly, so it's a follow-up call.
    if (data?.user) {
      await admin.auth.admin.updateUserById(data.user.id, {
        app_metadata: { role: "member" },
      });
    }

    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Couldn't send the invite.",
    };
  }
}

export async function removeTeamMember(
  userId: string
): Promise<{ success?: true; error?: string }> {
  try {
    const user = await requireAdmin();
    if (user.id === userId) {
      return { error: "You can't remove your own account." };
    }
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return { error: error.message };
    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Couldn't remove that teammate.",
    };
  }
}

export async function setTeamMemberRole(
  userId: string,
  role: Role
): Promise<{ success?: true; error?: string }> {
  try {
    const user = await requireAdmin();
    if (user.id === userId) {
      return { error: "You can't change your own role." };
    }
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    });
    if (error) return { error: error.message };
    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Couldn't update that teammate's role.",
    };
  }
}
