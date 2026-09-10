"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, FileClock, LogOut, Menu, PenLine, Settings, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "工作台", icon: BarChart3 },
  { href: "/create", label: "创建内容", icon: PenLine },
  { href: "/history", label: "历史记录", icon: FileClock },
  { href: "/settings", label: "设置", icon: Settings },
];
export function AppShell({ children, email }: { children: React.ReactNode; email?: string }) {
  const pathname = usePathname(); const router = useRouter(); const [mobileOpen, setMobileOpen] = useState(false);
  async function signOut() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  const navigation = <>
    <div className="flex h-16 items-center gap-3 border-b px-5"><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-4" /></div><span className="font-semibold tracking-tight">小红书内容助手</span></div>
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="主导航">{navItems.map((item) => { const active = pathname === item.href || (item.href === "/history" && pathname.startsWith("/posts/")); return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={cn("flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", active && "bg-accent text-accent-foreground")}><item.icon className="size-4" />{item.label}</Link>; })}</nav>
    <div className="border-t p-3"><div className="mb-2 truncate px-3 text-xs text-muted-foreground">{email ?? "配置预览模式"}</div>{email ? <Button variant="ghost" className="w-full justify-start" onClick={signOut}><LogOut data-icon="inline-start" />退出登录</Button> : null}</div>
  </>;
  return <div className="min-h-screen bg-muted/20"><aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-sidebar lg:flex">{navigation}</aside><header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden"><div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />小红书内容助手</div><Button variant="ghost" size="icon" onClick={() => setMobileOpen((value) => !value)} aria-label="打开导航">{mobileOpen ? <X /> : <Menu />}</Button></header>{mobileOpen ? <aside className="fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r bg-sidebar shadow-xl lg:hidden">{navigation}</aside> : null}<main className="min-h-screen lg:pl-60">{children}</main></div>;
}
