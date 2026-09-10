import { PageHeader } from "@/components/page-header";
import { CreateWorkspace } from "@/components/create/create-workspace";
import { getImageAiConfigStatus, getSupabasePublicEnv } from "@/lib/env";
export default function CreatePage() { return <><PageHeader title="创建内容" description="填写产品信息，生成 3 个不同角度的小红书内容版本" /><CreateWorkspace configured={Boolean(getSupabasePublicEnv())} imageAiConfigured={getImageAiConfigStatus().configured} /></>; }
