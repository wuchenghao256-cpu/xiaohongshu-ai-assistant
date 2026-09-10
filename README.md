# AI 多平台内容生成与聚合发布中心

面向单用户的中文内容工作台。完整保留原小红书 AI 内容助手的 Supabase 登录、商品图片直传、文案与图片生成、人工编辑、历史记录和发布准备能力，并新增合规的多平台聚合发布中心。

当前版本不会自动操作小红书或微信，不抓取 Cookie，不调用私有 API，也不会绕过验证码、风控或平台审核。小红书与微信朋友圈使用人工交接 Provider；抖音与微博只预留官方 API/OAuth 扩展点，没有凭证时不会伪造发布成功。

## 技术栈

- Next.js 16 App Router、React 19、TypeScript strict、Tailwind CSS 4
- shadcn/ui（Base UI）、React Hook Form、Zod
- Supabase Auth、Postgres、Storage、RLS
- 自有 AI Provider 抽象，默认调用 OpenAI Chat Completions 兼容接口

要求 Node.js 22 或更高版本。

## 本地启动

```bash
npm install
copy .env.example .env.local
npm run dev
```

打开 <http://localhost:3000>。未配置 Supabase 时可查看空状态和响应式 UI，但不会生成模拟数据；真实操作会保持禁用或返回明确配置错误。

## Supabase 配置

1. 新建 Supabase 项目。
2. 将 Project URL 和 publishable/anon key 填入 `.env.local`。
3. 应用 `supabase/migrations/20260910024202_initial_xhs_content_mvp.sql`：

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

也可在 Supabase SQL Editor 中完整执行 migration 文件。

4. 在 Authentication → Users 创建唯一使用者。应用第一版不开放注册入口。
5. 确认 Email/Password 登录已启用。

Migration 会创建：`profiles`、`projects`、`content_tasks`、`posts`、`post_variants`、`assets`、`ai_generations`、`publishing_jobs`、`connected_accounts`、`platform_variants`，以及私有 `product-assets` bucket。所有公开 schema 业务表都启用 RLS，并按 `auth.uid() = user_id` 隔离。`connected_accounts` 的 token 密文列不授予 authenticated 客户端读取权限。Storage 对象路径固定为 `用户ID/随机UUID.扩展名`。

`SUPABASE_SERVICE_ROLE_KEY` 仅预留给未来受控服务端维护任务，当前用户流程不使用它，绝不能添加 `NEXT_PUBLIC_` 前缀。

## AI Provider 配置

```dotenv
AI_BASE_URL=https://api.example.com/v1
AI_API_KEY=服务端密钥
AI_MODEL=模型名称
```

`AI_BASE_URL` 应指向包含 `/v1` 的 OpenAI-compatible API 根路径，程序会请求 `${AI_BASE_URL}/chat/completions`。可替换为 OpenAI、DeepSeek、OpenRouter、New API 或其他兼容服务。

页面组件不会直接调用第三方 AI SDK。业务入口统一为：

```ts
generateXiaohongshuPost(input)
```

API Key 只在 `src/lib/ai/client.ts` 的服务端模块读取，该模块使用 `server-only` 防止进入浏览器 bundle。日志只记录 provider、model、HTTP 状态和脱敏错误，不输出 Key。

## 图片上传

- 支持 JPEG、PNG、WebP
- 单张最大 8 MB，最多 9 张
- 浏览器使用当前用户会话直接上传至私有 Supabase Storage，避免图片经过 Vercel Function 请求体
- 数据库只保存 Storage 路径和 metadata，不保存 base64
- AI 生成时服务端创建 10 分钟 signed URL，作为可选多模态图片输入

部分 OpenAI-compatible 模型不支持图片内容。如果所选模型是纯文本模型，请先不上传图片，或在自定义 Provider 中调整消息格式。

## 发布模块

抽象位于：

- `src/lib/publishing/provider.ts`
- `src/lib/publishing/registry.ts`
- `src/lib/publishing/xiaohongshu-publisher.ts`
- `src/lib/publishing/douyin-publisher.ts`
- `src/lib/publishing/weibo-publisher.ts`
- `src/lib/publishing/wechat-moments-publisher.ts`

`/publishing` 按 capability 渲染四个平台，并为每个平台创建独立任务。小红书和微信朋友圈返回 `manual_required`；未连接的抖音和微博返回 `connection_required`。当前没有任何 Provider 返回模拟 `published`。未来获得正式权限后只替换对应 Provider，无需把平台逻辑写进 React 页面。

状态：`draft`、`ready`、`queued`、`publishing`、`published`、`failed`、`manual_required`、`connection_required`。

内容详情和发布中心都提供“一键下载全部图片”。服务端只读取当前用户、当前 post 中 `selected_for_publishing = true` 的图片，并动态返回单个 `post-images.zip`，避免 iOS Safari 多文件下载限制。

图像生成预留接口位于 `src/lib/images/provider.ts`，第一版未启用 AI 生图。

## 质量检查

```bash
npm run typecheck
npm run lint
npm run build
```

## Vercel 部署

1. 将仓库导入 Vercel，Framework 选择 Next.js。
2. Node.js Runtime 选择 22.x 或更高。
3. 在 Project Settings → Environment Variables 添加 `.env.example` 中的全部变量；不要把任何 Secret 添加 `NEXT_PUBLIC_` 前缀。
4. 先在目标 Supabase 项目应用 migration，再部署应用。
5. 在 Supabase Authentication URL Configuration 中加入生产域名。
6. 部署后依次实测：登录 → 创建任务 → 图片上传 → 生成 → 编辑保存 → 设为最终版本 → 历史详情 → 准备发布。

本地 `npm run build` 只证明代码和构建产物有效；没有实际 Supabase/AI 凭证时，不代表云端数据库、Storage、登录或真实 AI 请求已验证。
