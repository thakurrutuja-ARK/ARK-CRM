"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TeamMember = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  invited: boolean;
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
    await requireSignedIn();
    const admin = createAdminClient();
    const siteUrl = await getSiteUrl();

    const { error } = await admin.auth.admin.inviteUserByEmail(trimmed, {
      redirectTo: `${siteUrl}/auth/confirm?next=/set-password`,
    });

    if (error) return { error: error.message };
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
    const user = await requireSignedIn();
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
