"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
const schema = z.object({ email: z.string().email("请输入有效邮箱"), password: z.string().min(6, "密码至少 6 位") }); type LoginInput = z.infer<typeof schema>;
export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter(); const [serverError, setServerError] = useState(""); const form = useForm<LoginInput>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  async function submit(input: LoginInput) { setServerError(""); try { const { error } = await createClient().auth.signInWithPassword(input); if (error) throw error; router.replace("/dashboard"); router.refresh(); } catch (error) { setServerError(error instanceof Error ? error.message : "登录失败，请重试。"); } }
  return <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4"><Card className="w-full max-w-md"><CardHeader className="items-center text-center"><div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-5" /></div><CardTitle className="text-xl">登录 AI 内容发布中心</CardTitle><CardDescription>使用 Supabase 后台已创建的账户登录</CardDescription></CardHeader><CardContent>{!configured ? <Alert className="mb-5"><AlertTitle>尚未配置 Supabase</AlertTitle><AlertDescription>请先复制 .env.example 为 .env.local 并填写项目凭证。</AlertDescription></Alert> : null}<form onSubmit={form.handleSubmit(submit)}><FieldGroup><Field data-invalid={Boolean(form.formState.errors.email)}><FieldLabel htmlFor="email">邮箱</FieldLabel><Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} /><FieldError errors={[form.formState.errors.email]} /></Field><Field data-invalid={Boolean(form.formState.errors.password)}><FieldLabel htmlFor="password">密码</FieldLabel><Input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register("password")} /><FieldError errors={[form.formState.errors.password]} /></Field>{serverError ? <p role="alert" className="text-sm text-destructive">{serverError}</p> : null}<Button type="submit" size="lg" disabled={!configured || form.formState.isSubmitting}>{form.formState.isSubmitting ? "正在登录…" : "登录"}</Button></FieldGroup></form></CardContent></Card></main>;
}
