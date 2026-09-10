import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase } = await requireUser();
    const asset = await supabase
      .from("assets")
      .select("storage_bucket, storage_path, original_name, mime_type")
      .eq("id", id)
      .single();
    if (asset.error) throw asset.error;

    const signed = await supabase.storage
      .from(asset.data.storage_bucket)
      .createSignedUrl(asset.data.storage_path, 60, {
        download: asset.data.original_name,
      });
    if (signed.error) throw signed.error;

    return Response.redirect(signed.data.signedUrl, 307);
  } catch (error) {
    return jsonError(error);
  }
}
