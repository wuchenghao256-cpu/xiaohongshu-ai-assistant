"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FileClock,
  FileText,
  Images,
  Loader2,
  LogOut,
  Menu,
  PenLine,
  Send,
  Settings,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/create", label: "创作", icon: PenLine },
  { href: "/assets", label: "素材库", icon: Images },
  { href: "/drafts", label: "草稿箱", icon: FileText },
  { href: "/video", label: "AI视频", icon: Video },
  { href: "/history", label: "历史记录", icon: FileClock },
  { href: "/publishing", label: "发布管理", icon: Send },
  { href: "/settings", label: "系统设置", icon: Settings },
];

/** 高频页面提前预热，避免第一次点击要等一个完整服务端渲染往返。 */
const prefetchOnIdle = ["/create", "/assets", "/drafts"];

function isActiveHref(href: string, pathname: string) {
  return (
    pathname === href || (href === "/history" && pathname.startsWith("/posts/"))
  );
}

/**
 * 点击瞬间就点亮：路由本身要等目标页面渲染完才提交，这段等待里如果导航项没有任何
 * 变化，用户就会以为没点上。乐观高亮由点击直接写入 state，路由一旦提交（pathname
 * 变化）就清掉，交还给真实的 pathname 判断。
 */
function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof PenLine;
  active: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <Link
      href={href}
      onClick={(event) => {
        onNavigate(href);
        // 点击当前页或组合键（新标签页等）：不动路由，也不该出现乐观高亮。
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          active
        ) {
          event.preventDefault();
        }
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <NavPendingHint />
    </Link>
  );
}

/**
 * `useLinkStatus` 必须是 Link 的后代组件。只在 loading.tsx 还没接住导航的这段空档里
 * 显示，用来告诉用户「点到了，正在加载」。固定尺寸占位，不产生布局位移。
 */
function NavPendingHint() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      className="shrink-0 text-muted-foreground"
      role="status"
      aria-label="页面加载中"
    >
      <Loader2 className="size-3.5 animate-spin" />
    </span>
  );
}

export function AppShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<{
    href: string;
    from: string;
  } | null>(null);

  // 预热高频页面的路由段。页面本身读 cookies() 属于动态路由，默认 prefetch 只会
  // 预取到最近的 loading 边界；这里的 prefetch 负责把 JS/CSS 也提前拿下来。
  useEffect(() => {
    const prefetch = () => {
      for (const href of prefetchOnIdle) router.prefetch(href);
    };
    // 用 typeof 而不是 `in window`：后者会把 window 收窄成 never，取不到 setTimeout。
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(prefetch);
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(prefetch, 200);
    return () => window.clearTimeout(timer);
  }, [router]);

  // pathname 一变就说明导航已经提交，乐观高亮交给真实路由状态。
  const optimisticHref = optimistic?.from === pathname ? optimistic.href : null;

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const navigation = (
    <>
      <div className="flex h-16 items-center gap-3 border-b px-5">
        <div className="flex size-8 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
          XS
        </div>
        <span className="text-sm font-semibold tracking-tight">
          内容创作工作室
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="主导航">
        {navItems.map((item) => {
          const routeActive = isActiveHref(item.href, pathname);
          return (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              // 点击后立刻高亮目标项；目标页面渲染完成后 pathname 接管。
              active={routeActive || optimisticHref === item.href}
              onNavigate={(href) => {
                setMobileOpen(false);
                setOptimistic({ href, from: pathname });
              }}
            />
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 truncate px-3 text-xs text-muted-foreground">
          {email ?? "配置预览模式"}
        </div>
        {email ? (
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={signOut}
          >
            <LogOut data-icon="inline-start" />
            退出登录
          </Button>
        ) : null}
      </div>
    </>
  );
  return (
    <div className="min-h-screen bg-muted/25">
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r bg-sidebar lg:flex">
        {navigation}
      </aside>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-[10px] text-background">
            XS
          </span>
          内容创作工作室
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen((value) => !value)}
          aria-label="打开导航"
        >
          {mobileOpen ? <X /> : <Menu />}
        </Button>
      </header>
      {mobileOpen ? (
        <>
          {/* 固定用黑色而不是 bg-foreground：遮罩在深色主题下会翻成白色。
              项目目前没有挂 ThemeProvider，但颜色不该依赖这个前提。 */}
          <div
            className="fixed inset-0 z-20 bg-black/40 lg:hidden"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-30 flex w-72 max-w-[86vw] flex-col border-r bg-sidebar shadow-lg lg:hidden">
            {navigation}
          </aside>
        </>
      ) : null}
      <main className="min-h-screen min-w-0 lg:pl-56">{children}</main>
    </div>
  );
}
