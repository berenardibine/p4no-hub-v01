// Secure Cloudinary cleanup for the existing product image pipeline.
//
// Actions (all require a signed-in caller):
//   { action: "delete_product", productId }  → owner/admin only. Deletes the product
//       row, then destroys its Cloudinary images that no other product references.
//   { action: "discard_draft", urls: string[] } → destroys draft images that are NOT
//       referenced by any product (so published assets can never be removed).
//
// Cloudinary API credentials stay server-side (CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const CLOUD_NAME = Deno.env.get("CLOUDINARY_CLOUD_NAME") || "ddwrviw3v";
const API_KEY = Deno.env.get("CLOUDINARY_API_KEY") || "";
const API_SECRET = Deno.env.get("CLOUDINARY_API_SECRET") || "";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete_product"), productId: z.string().uuid() }),
  z.object({ action: z.literal("discard_draft"), urls: z.array(z.string().url().max(1000)).max(10) }),
]);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Extract the Cloudinary public_id from a delivery URL of our own cloud. */
function publicIdFromUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.hostname !== "res.cloudinary.com") return null;
    const parts = url.pathname.split("/").filter(Boolean); // [cloud, image, upload, ...]
    if (parts[0] !== CLOUD_NAME || parts[1] !== "image" || parts[2] !== "upload") return null;
    let rest = parts.slice(3);
    const vIdx = rest.findIndex((p) => /^v\d+$/.test(p));
    if (vIdx >= 0) rest = rest.slice(vIdx + 1);
    else rest = rest.filter((p) => !(p.includes(",") || /^[a-z]{1,3}_[^/]+$/.test(p)));
    if (!rest.length) return null;
    const id = decodeURIComponent(rest.join("/")).replace(/\.[a-z0-9]+$/i, "");
    // Only ever touch our product/watermark upload folders.
    return id.startsWith("smart_market/") ? id : null;
  } catch {
    return null;
  }
}

async function sha1Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function destroy(publicId: string): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await sha1Hex(`invalidate=true&public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`);
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", timestamp);
  form.append("invalidate", "true");
  form.append("api_key", API_KEY);
  form.append("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`, { method: "POST", body: form });
  const out = await res.json().catch(() => ({}));
  return out?.result === "ok" || out?.result === "not found";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!jwt) return json({ error: "Missing auth" }, 401);
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return json({ error: "Invalid auth" }, 401);
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;

    let candidates: string[] = [];
    let excludeId: string | null = null;

    if (body.action === "delete_product") {
      const { data: p } = await admin.from("products").select("id,seller_id,images").eq("id", body.productId).maybeSingle();
      if (!p) return json({ error: "Not found" }, 404);
      if (p.seller_id !== u.user.id) {
        const { data: isAdmin } = await admin.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
        if (!isAdmin) return json({ error: "Forbidden" }, 403);
      }
      const { error: delErr } = await admin.from("products").delete().eq("id", p.id);
      if (delErr) return json({ error: delErr.message }, 400);
      candidates = (p.images as string[] | null) || [];
      excludeId = p.id;
    } else {
      candidates = body.urls;
    }

    if (!API_KEY || !API_SECRET) return json({ ok: true, deleted: 0, skipped: candidates.length, reason: "cloudinary_not_configured" });

    let deleted = 0;
    for (const url of [...new Set(candidates)]) {
      const pid = publicIdFromUrl(url);
      if (!pid) continue;
      // Never delete an image still referenced by any (other) product.
      let q = admin.from("products").select("id", { count: "exact", head: true }).contains("images", [url]);
      if (excludeId) q = q.neq("id", excludeId);
      const { count } = await q;
      if ((count ?? 0) > 0) continue;
      if (await destroy(pid)) deleted++;
    }
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
