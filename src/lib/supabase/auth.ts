import "server-only";
import { getSupabasePublicEnv } from "@/lib/env";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type AuthContext = Awaited<ReturnType<typeof requireUser>>;

export async function requireUser() {
  if (!getSupabasePublicEnv()) throw new Error("SUPABASE_NOT_CONFIGURED");
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  const supabase = await createClient();
  return { user, supabase };
}
