const JWKS_TTL_MS = 5 * 60 * 1000;
let jwksCache = { issuer: "", expiresAt: 0, keys: [] };

function jsonError(message = "Not authorised", status = 403) {
  return Response.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

function b64urlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(value)));
}

function normaliseIssuer(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  return text || "";
}

function parseAudienceMap(raw) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function expectedAudience(env, hostname) {
  const map = parseAudienceMap(env.JOBHUB_ACCESS_AUDIENCES);
  if (!map) return null;
  if (typeof map[hostname] === "string" && map[hostname]) return map[hostname];
  for (const [pattern, audience] of Object.entries(map)) {
    if (!pattern.startsWith("*.") || typeof audience !== "string" || !audience) continue;
    const suffix = pattern.slice(1);
    if (hostname.endsWith(suffix) && hostname !== suffix.slice(1)) return audience;
  }
  return null;
}

function staffSet(env) {
  return new Set(
    String(env.JOBHUB_STAFF_EMAILS || "")
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function loadJwks(issuer, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache.issuer === issuer && jwksCache.expiresAt > now && jwksCache.keys.length) {
    return jwksCache.keys;
  }
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error("Access key lookup failed");
  const body = await response.json();
  if (!Array.isArray(body?.keys) || !body.keys.length) throw new Error("Access keys unavailable");
  jwksCache = { issuer, expiresAt: now + JWKS_TTL_MS, keys: body.keys };
  return body.keys;
}

async function verifyRs256(signingInput, signature, jwk) {
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(signingInput)
  );
}

export function clearAccessKeyCacheForTests() {
  jwksCache = { issuer: "", expiresAt: 0, keys: [] };
}

export async function authenticateAccessRequest(context) {
  try {
    const request = context.request;
    const env = context.env || {};
    const url = new URL(request.url);
    const issuer = normaliseIssuer(env.JOBHUB_ACCESS_ISSUER);
    const audience = expectedAudience(env, url.hostname);
    const staff = staffSet(env);
    const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";

    if (!issuer || !audience || !staff.size || !token) {
      return { ok: false, response: jsonError("Authentication required", 401) };
    }

    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, response: jsonError("Authentication required", 401) };
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJson(encodedHeader);
    const payload = decodeJson(encodedPayload);

    if (header?.alg !== "RS256" || !header?.kid) {
      return { ok: false, response: jsonError("Authentication required", 401) };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload?.iss !== issuer || !payload?.exp || payload.exp <= now || (payload.nbf && payload.nbf > now + 30)) {
      return { ok: false, response: jsonError("Authentication required", 401) };
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) {
      return { ok: false, response: jsonError("Authentication required", 401) };
    }

    const email = String(payload.email || "").trim().toLowerCase();
    const subject = String(payload.sub || "").trim();
    if (!email || !subject || !staff.has(email)) {
      return { ok: false, response: jsonError("Not authorised", 403) };
    }

    let keys = await loadJwks(issuer);
    let jwk = keys.find(key => key?.kid === header.kid && key?.kty === "RSA");
    if (!jwk) {
      keys = await loadJwks(issuer, true);
      jwk = keys.find(key => key?.kid === header.kid && key?.kty === "RSA");
    }
    if (!jwk) return { ok: false, response: jsonError("Authentication required", 401) };

    const verified = await verifyRs256(
      `${encodedHeader}.${encodedPayload}`,
      b64urlDecode(encodedSignature),
      jwk
    );
    if (!verified) return { ok: false, response: jsonError("Authentication required", 401) };

    return {
      ok: true,
      identity: {
        email,
        subject,
        audience
      }
    };
  } catch {
    return { ok: false, response: jsonError("Authentication required", 401) };
  }
}

export function withPrivateNoStore(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function requireExistingJob(db, jobId) {
  if (!Number.isInteger(Number(jobId)) || Number(jobId) <= 0) return null;
  return db.prepare("SELECT id, enquiry_id, job_type FROM jobs WHERE id = ?")
    .bind(Number(jobId))
    .first();
}

export async function requireRelatedRecord(db, table, recordId, options = {}) {
  const allowed = {
    job_files: "id",
    customer_quote_versions: "id",
    customer_invoice_versions: "id",
    job_materials: "id",
    job_work_logs: "id",
    costing_options: "id",
    job_energy_tariffs: "id"
  };
  if (!allowed[table] || !recordId) return null;
  const idColumn = allowed[table];
  const row = await db.prepare(
    `SELECT related.${idColumn} AS id, related.job_id AS job_id
     FROM ${table} related
     JOIN jobs ON jobs.id = related.job_id
     WHERE related.${idColumn} = ?`
  ).bind(String(recordId)).first();
  if (!row) return null;
  if (options.jobId !== undefined && Number(row.job_id) !== Number(options.jobId)) return null;
  return row;
}

export async function requireJobFile(db, fileId, jobId) {
  if (!fileId) return null;
  const params = [String(fileId)];
  let predicate = "";
  if (jobId !== undefined && jobId !== null) {
    predicate = " AND job_files.job_id = ?";
    params.push(Number(jobId));
  }
  return db.prepare(`
    SELECT job_files.id, job_files.job_id, job_files.storage_key,
           job_files.original_name, job_files.content_type, job_files.size_bytes,
           job_files.document_role
    FROM job_files
    JOIN jobs ON jobs.id = job_files.job_id
    WHERE job_files.id = ?${predicate}
  `).bind(...params).first();
}

export function securityNotFound(label = "Record") {
  return Response.json(
    { ok: false, error: `${label} not found` },
    { status: 404, headers: { "Cache-Control": "private, no-store" } }
  );
}
