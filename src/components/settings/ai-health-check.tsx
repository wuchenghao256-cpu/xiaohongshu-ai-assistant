"use client";
import { Activity, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
export function AiHealthCheck({ disabled }: { disabled: boolean }) { const [loading, setLoading] = useState(false); async function check() { setLoading(true); try { const response = await fetch("/api/ai/health", { method: "POST" }); const data = await response.json() as { message?: string; error?: string; latencyMs?: number }; if (!response.ok) throw new Error(data.error); toast.success(`${data.message} · ${data.latencyMs ?? 0}ms`); } catch (error) { toast.error(error instanceof Error ? error.message : "检测失败"); } finally { setLoading(false); } } return <Button variant="outline" onClick={check} disabled={disabled || loading}>{loading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Activity data-icon="inline-start" />}{loading ? "检测中…" : "检测连接"}</Button>; }
