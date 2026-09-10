import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSupabasePublicEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) { const configured = Boolean(getSupabasePublicEnv()); const user = configured ? await getCurrentUser() : null; if (configured && !user) redirect("/login"); return <AppShell email={user?.email}>{children}</AppShell>; }
