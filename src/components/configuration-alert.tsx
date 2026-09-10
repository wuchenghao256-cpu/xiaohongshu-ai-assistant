import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export function ConfigurationAlert() { return <Alert><TriangleAlert /><AlertTitle>等待连接 Supabase</AlertTitle><AlertDescription>界面与服务端流程已就绪。填写 .env.local 并执行 migration 后，即可登录、上传、生成和保存真实数据。</AlertDescription></Alert>; }
