import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();
const MAX_CODE_LENGTH = 128;

type Control = {
  enabled: boolean;
  max_payload_bytes: number;
  max_per_client_hour: number;
  max_global_hour: number;
  max_global_day: number;
  max_active_logs: number;
  retention_days: number;
};

function cors(origin: string | null, allowPost = false) {
  const allowed = Deno.env.get("GITAI_ALLOWED_ORIGIN")
    || "https://ganyujapan.github.io";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type,x-gitai-tester-code",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin",
  };
  if (!origin || origin === allowed || !allowPost) {
    headers["Access-Control-Allow-Origin"] = allowPost ? allowed : "*";
  }
  return headers;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

async function sha256Hex(value: string) {
  const bytes = encoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(bytes = 18) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function getClientIp(req: Request) {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

function basicPayloadValid(value: any) {
  if (!value || typeof value !== "object") return false;
  if (value.schema !== "gitailab-preview-diagnostic-v1") return false;
  if (!Array.isArray(value.generations)) return false;
  if (!value.environment || typeof value.environment !== "object") return false;
  if (!value.evolution || typeof value.evolution !== "object") return false;
  if (!value.run || typeof value.run !== "object") return false;
  if (value.generations.length > 1000) return false;
  return true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const postCors = cors(origin, true);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: postCors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) {
    return json(503, { error: "service_not_configured" }, cors(origin));
  }

  const db = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);

  if (req.method === "GET") {
    const token = (url.searchParams.get("token") || "").trim();
    if (!token) {
      const { data } = await db
        .from("gitai_preview_log_control")
        .select("enabled,auto_disabled_at")
        .eq("id", 1)
        .single();
      return json(200, {
        service: "gitailab-preview-diagnostic-log",
        enabled: Boolean(data?.enabled),
        auto_disabled_at: data?.auto_disabled_at || null,
      }, cors(origin));
    }

    const tokenHash = await sha256Hex(token);
    const { data, error } = await db
      .from("gitai_preview_diagnostic_logs")
      .select("log_id,created_at,expires_at,environment_id,evolution_model_id,run_id,current_generation_id,payload")
      .eq("share_token_hash", tokenHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) return json(500, { error: "read_failed" }, cors(origin));
    if (!data) return json(404, { error: "not_found_or_expired" }, cors(origin));

    return json(200, {
      log_id: data.log_id,
      created_at: data.created_at,
      expires_at: data.expires_at,
      environment_id: data.environment_id,
      evolution_model_id: data.evolution_model_id,
      run_id: data.run_id,
      current_generation_id: data.current_generation_id,
      diagnostic_log: data.payload,
    }, cors(origin));
  }

  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, postCors);
  }

  const allowedOrigin = Deno.env.get("GITAI_ALLOWED_ORIGIN")
    || "https://ganyujapan.github.io";
  if (origin !== allowedOrigin) {
    return json(403, { error: "origin_not_allowed" }, postCors);
  }

  const { data: controlData, error: controlError } = await db
    .from("gitai_preview_log_control")
    .select("*")
    .eq("id", 1)
    .single();

  if (controlError || !controlData) {
    return json(503, { error: "control_unavailable" }, postCors);
  }

  const control = controlData as Control;
  if (!control.enabled) {
    return json(503, {
      error: "uploads_disabled",
      message: "テスト用ログ受付は現在停止中です。",
    }, postCors);
  }

  const code = (req.headers.get("x-gitai-tester-code") || "").trim();
  if (!code || code.length > MAX_CODE_LENGTH) {
    return json(401, { error: "tester_code_required" }, postCors);
  }

  const acceptedHashes = (Deno.env.get("GITAI_TESTER_CODE_HASHES") || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  const codeHash = await sha256Hex(code);
  if (!acceptedHashes.includes(codeHash)) {
    return json(401, { error: "invalid_tester_code" }, postCors);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > control.max_payload_bytes) {
    return json(413, { error: "payload_too_large" }, postCors);
  }

  const raw = await req.text();
  const payloadBytes = encoder.encode(raw).byteLength;
  if (payloadBytes <= 0 || payloadBytes > control.max_payload_bytes) {
    return json(413, { error: "payload_too_large" }, postCors);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid_json" }, postCors);
  }

  if (!basicPayloadValid(payload)) {
    return json(400, { error: "invalid_diagnostic_schema" }, postCors);
  }

  const ipSalt = Deno.env.get("GITAI_IP_SALT");
  if (!ipSalt) {
    return json(503, { error: "service_not_configured" }, postCors);
  }
  const clientKeyHash = await sha256Hex(
    ipSalt + ":" + getClientIp(req) + ":" + codeHash
  );

  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const [
    perClient,
    globalHour,
    globalDay,
    activeLogs,
  ] = await Promise.all([
    db.from("gitai_preview_diagnostic_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_key_hash", clientKeyHash)
      .gte("created_at", hourAgo),
    db.from("gitai_preview_diagnostic_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", hourAgo),
    db.from("gitai_preview_diagnostic_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgo),
    db.from("gitai_preview_diagnostic_logs")
      .select("id", { count: "exact", head: true })
      .gt("expires_at", nowIso),
  ]);

  async function autoDisable(reason: string) {
    await db.from("gitai_preview_log_control").update({
      enabled: false,
      auto_disabled_at: new Date().toISOString(),
      auto_disabled_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
  }

  if ((globalHour.count || 0) >= control.max_global_hour) {
    await autoDisable("global_hour_limit");
    return json(503, { error: "auto_disabled_global_hour_limit" }, postCors);
  }

  if ((globalDay.count || 0) >= control.max_global_day) {
    await autoDisable("global_day_limit");
    return json(503, { error: "auto_disabled_global_day_limit" }, postCors);
  }

  if ((activeLogs.count || 0) >= control.max_active_logs) {
    await autoDisable("active_log_limit");
    return json(503, { error: "auto_disabled_storage_guard" }, postCors);
  }

  if ((perClient.count || 0) >= control.max_per_client_hour) {
    return json(429, {
      error: "rate_limited",
      message: "このテスターからの送信回数が上限に達しました。",
    }, postCors);
  }

  const logId = "GTL-" + randomToken(8).toUpperCase();
  const shareToken = randomToken(24);
  const shareTokenHash = await sha256Hex(shareToken);
  const expiresAt = new Date(
    now + control.retention_days * 24 * 60 * 60 * 1000
  ).toISOString();

  const { error: insertError } = await db
    .from("gitai_preview_diagnostic_logs")
    .insert({
      log_id: logId,
      share_token_hash: shareTokenHash,
      expires_at: expiresAt,
      client_key_hash: clientKeyHash,
      payload_bytes: payloadBytes,
      environment_id: String(payload.environment?.environment_id || ""),
      evolution_model_id: String(payload.evolution?.model_id || ""),
      run_id: String(payload.run?.run_id || ""),
      current_generation_id: String(payload.current_generation_id || ""),
      payload,
    });

  if (insertError) {
    return json(500, { error: "save_failed" }, postCors);
  }

  // Opportunistic cleanup; no user request depends on this completing.
  await db
    .from("gitai_preview_diagnostic_logs")
    .delete()
    .lt("expires_at", nowIso);

  const readUrl = new URL(req.url);
  readUrl.search = "";
  readUrl.searchParams.set("token", shareToken);

  return json(201, {
    ok: true,
    log_id: logId,
    expires_at: expiresAt,
    read_url: readUrl.toString(),
  }, postCors);
});
