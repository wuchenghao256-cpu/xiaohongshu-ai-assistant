import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSupabasePublicEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
export default async function LoginPage() { const configured = Boolean(getSupabasePublicEnv()); if (configured && await getCurrentUser()) redirect("/dashboard"); return <LoginForm configured={configured} />; }
