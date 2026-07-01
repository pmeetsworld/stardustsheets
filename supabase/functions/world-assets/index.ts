import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.102.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-world-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function validPath(path: unknown) {
  return typeof path === "string" &&
    path.length > 3 &&
    path.length <= 240 &&
    /^(maps|scenes|tokens)\/[a-z0-9][a-z0-9._-]+$/i.test(path);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceKey) {
    return json({ ok: false, error: "service_not_configured" }, 500);
  }

  const secret = request.headers.get("x-world-secret") || "";
  const admin = createClient(projectUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: valid, error: verifyError } = await admin.rpc(
    "world_verify_admin_secret",
    { p_secret: secret },
  );
  if (verifyError) {
    return json({ ok: false, error: "verification_failed" }, 500);
  }
  if (!valid) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const action = payload.action;
  const path = payload.path;
  if (!validPath(path)) {
    return json({ ok: false, error: "invalid_path" }, 400);
  }

  if (action === "sign-upload") {
    const { data, error } = await admin.storage
      .from("world")
      .createSignedUploadUrl(path as string, { upsert: false });
    if (error || !data) {
      return json({ ok: false, error: error?.message || "sign_failed" }, 400);
    }
    return json({
      ok: true,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
    });
  }

  if (action === "delete") {
    const { error } = await admin.storage.from("world").remove([path as string]);
    if (error) {
      return json({ ok: false, error: error.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
