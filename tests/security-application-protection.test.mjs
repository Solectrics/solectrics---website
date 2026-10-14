import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  authenticateAccessRequest,
  clearAccessKeyCacheForTests,
  requireExistingJob,
  requireRelatedRecord,
  requireJobFile
} from "../functions/api/_access-security.js";
import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";
import { onRequestGet as downloadJobFile } from "../functions/api/job-file.js";
import { onRequestPost as saveAssessment } from "../functions/api/assessment.js";
import { onRequestPost as saveSiteVisit } from "../functions/api/site-visit.js";
import { onRequestPost as saveSystemDesign } from "../functions/api/system-design.js";
import { onRequestPost as saveCosting } from "../functions/api/job-costing.js";
import { onRequestPost as updateInvoice } from "../functions/api/customer-invoices.js";
import { onRequest as rootMiddleware } from "../functions/_middleware.js";

const ISSUER = "https://security-test.cloudflareaccess.com";
const AUDIENCE = "security-test-audience";
const STAFF = "staff@solectrics.test";
const HOST = "solectrics.co.nz";

let keyPair;
let publicJwk;

function base64url(value) {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return bytes.toString("base64url");
}

async function makeToken(overrides = {}, signingKey = keyPair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: "security-test-key", typ: "JWT" };
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    email: STAFF,
    sub: "synthetic-user",
    iat: now - 10,
    nbf: now - 10,
    exp: now + 300,
    ...overrides
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

function env(extra = {}) {
  return {
    JOBHUB_ACCESS_ISSUER: ISSUER,
    JOBHUB_ACCESS_AUDIENCES: JSON.stringify({
      [HOST]: AUDIENCE,
      "*.solectrics-jobhub-staging.pages.dev": "staging-audience"
    }),
    JOBHUB_STAFF_EMAILS: STAFF,
    ...extra
  };
}

function authRequest(token, url = `https://${HOST}/api/jobs`, method = "GET") {
  return new Request(url, {
    method,
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {}
  });
}

function mockDb(handler) {
  return {
    prepare(sql) {
      return {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() { return handler({ kind: "first", sql, params: this.params }); },
        async all() { return handler({ kind: "all", sql, params: this.params }); },
        async run() { return handler({ kind: "run", sql, params: this.params }); }
      };
    }
  };
}

test.before(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "security-test-key";
  publicJwk.alg = "RS256";
});

test.beforeEach(() => {
  clearAccessKeyCacheForTests();
  globalThis.fetch = async url => {
    assert.equal(String(url), `${ISSUER}/cdn-cgi/access/certs`);
    return Response.json({ keys: [publicJwk] });
  };
});

test("valid signed Access assertion grants approved whole-business staff", async () => {
  const token = await makeToken();
  const result = await authenticateAccessRequest({ request: authRequest(token), env: env() });
  assert.equal(result.ok, true);
  assert.equal(result.identity.email, STAFF);
});

test("missing, forged, wrong-audience, wrong-issuer and unapproved-user assertions fail closed", async () => {
  const missing = await authenticateAccessRequest({ request: authRequest(""), env: env() });
  assert.equal(missing.ok, false);
  assert.equal(missing.response.status, 401);

  const otherPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  clearAccessKeyCacheForTests();
  const forged = await authenticateAccessRequest({ request: authRequest(await makeToken({}, otherPair.privateKey)), env: env() });
  assert.equal(forged.ok, false);

  clearAccessKeyCacheForTests();
  const wrongAud = await authenticateAccessRequest({ request: authRequest(await makeToken({ aud: "wrong" })), env: env() });
  assert.equal(wrongAud.ok, false);

  clearAccessKeyCacheForTests();
  const wrongIssuer = await authenticateAccessRequest({ request: authRequest(await makeToken({ iss: "https://wrong.example" })), env: env() });
  assert.equal(wrongIssuer.ok, false);

  clearAccessKeyCacheForTests();
  const outsider = await authenticateAccessRequest({ request: authRequest(await makeToken({ email: "outsider@example.test" })), env: env() });
  assert.equal(outsider.ok, false);
  assert.equal(outsider.response.status, 403);
});

test("expired and not-yet-valid assertions fail closed", async () => {
  clearAccessKeyCacheForTests();
  const expired = await authenticateAccessRequest({
    request: authRequest(await makeToken({ exp: Math.floor(Date.now() / 1000) - 1 })),
    env: env()
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.response.status, 401);

  clearAccessKeyCacheForTests();
  const future = await authenticateAccessRequest({
    request: authRequest(await makeToken({ nbf: Math.floor(Date.now() / 1000) + 120 })),
    env: env()
  });
  assert.equal(future.ok, false);
  assert.equal(future.response.status, 401);
});

test("JWKS cache refreshes once when a rotated signing key appears", async () => {
  const rotatedPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const rotatedJwk = await crypto.subtle.exportKey("jwk", rotatedPair.publicKey);
  rotatedJwk.kid = "security-test-key";
  rotatedJwk.alg = "RS256";

  const staleJwk = { ...publicJwk, kid: "old-key" };
  let requests = 0;
  clearAccessKeyCacheForTests();
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ keys: requests === 1 ? [staleJwk] : [rotatedJwk] });
  };

  const result = await authenticateAccessRequest({
    request: authRequest(await makeToken({}, rotatedPair.privateKey)),
    env: env()
  });
  assert.equal(result.ok, true);
  assert.equal(requests, 2);
});

test("unknown hostname or missing security configuration fails closed", async () => {
  const token = await makeToken();
  const unknown = await authenticateAccessRequest({
    request: authRequest(token, "https://unknown.example/api/jobs"),
    env: env()
  });
  assert.equal(unknown.ok, false);

  const noConfig = await authenticateAccessRequest({ request: authRequest(token), env: {} });
  assert.equal(noConfig.ok, false);
});

test("API middleware preserves only the approved public HEC methods", async () => {
  for (const path of ["/api/enquiry", "/api/read-bill"]) {
    let called = 0;
    const response = await apiMiddleware({
      request: new Request(`https://${HOST}${path}`, { method: "POST" }),
      env: {},
      next: async () => { called += 1; return new Response("public"); }
    });
    assert.equal(called, 1);
    assert.equal(await response.text(), "public");
  }

  let privateCalled = 0;
  const denied = await apiMiddleware({
    request: new Request(`https://${HOST}/api/jobs`),
    env: {},
    next: async () => { privateCalled += 1; return new Response("should not run"); }
  });
  assert.equal(denied.status, 401);
  assert.equal(privateCalled, 0);
  assert.equal(denied.headers.get("Cache-Control"), "private, no-store");

  const publicGetDenied = await apiMiddleware({
    request: new Request(`https://${HOST}/api/read-bill`),
    env: {},
    next: async () => new Response("should not run")
  });
  assert.equal(publicGetDenied.status, 401);
});

test("private middleware accepts a valid staff assertion and marks response no-store", async () => {
  const token = await makeToken();
  const response = await apiMiddleware({
    request: authRequest(token),
    env: env(),
    next: async () => Response.json({ ok: true })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("job and child-record helpers enforce actual parent relationships", async () => {
  const db = mockDb(({ sql, params }) => {
    if (/FROM jobs WHERE id/.test(sql)) return Number(params[0]) === 6 ? { id: 6, enquiry_id: 6, job_type: "solar" } : null;
    if (/FROM customer_quote_versions related/.test(sql)) return String(params[0]) === "quote-6" ? { id: "quote-6", job_id: 6 } : null;
    if (/FROM job_files/.test(sql)) return String(params[0]) === "file-6" && (params[1] === undefined || Number(params[1]) === 6)
      ? { id: "file-6", job_id: 6, storage_key: "jobs/6/server-key.pdf", original_name: "synthetic.pdf", content_type: "application/pdf", size_bytes: 12, document_role: "power_bill" }
      : null;
    return null;
  });

  assert.equal((await requireExistingJob(db, 6)).id, 6);
  assert.equal(await requireExistingJob(db, 99), null);

  assert.equal((await requireRelatedRecord(db, "customer_quote_versions", "quote-6", { jobId: 6 })).job_id, 6);
  assert.equal(await requireRelatedRecord(db, "customer_quote_versions", "quote-6", { jobId: 7 }), null);

  assert.equal((await requireJobFile(db, "file-6", 6)).storage_key, "jobs/6/server-key.pdf");
  assert.equal(await requireJobFile(db, "file-6", 7), null);
});

test("direct document download uses only the server-resolved storage key", async () => {
  const bucketCalls = [];
  const db = mockDb(({ sql, params }) => {
    if (/FROM job_files/.test(sql) && String(params[0]) === "file-6") {
      return { id: "file-6", job_id: 6, storage_key: "jobs/6/server-key.pdf", original_name: "synthetic.pdf", content_type: "application/pdf", size_bytes: 9, document_role: "power_bill" };
    }
    return null;
  });
  const bucket = {
    async get(key) {
      bucketCalls.push(key);
      return {
        body: "synthetic",
        writeHttpMetadata() {}
      };
    }
  };
  const response = await downloadJobFile({
    request: new Request(`https://${HOST}/api/job-file?id=file-6&storage_key=attacker-choice`),
    env: { DB: db, JOB_FILES: bucket }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(bucketCalls, ["jobs/6/server-key.pdf"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Content-Security-Policy"), "sandbox");
});

test("unknown document ID is denied before any R2 object read", async () => {
  let bucketReads = 0;
  const db = mockDb(() => null);
  const response = await downloadJobFile({
    request: new Request(`https://${HOST}/api/job-file?id=missing`),
    env: { DB: db, JOB_FILES: { async get() { bucketReads += 1; return null; } } }
  });
  assert.equal(response.status, 404);
  assert.equal(bucketReads, 0);
});

test("job-scoped writes reject nonexistent parent jobs before child writes", async () => {
  let assessmentWrites = 0;
  const db = mockDb(({ sql }) => {
    if (/SELECT id, enquiry_id, job_type FROM jobs/.test(sql)) return null;
    if (/INSERT INTO assessments/.test(sql)) assessmentWrites += 1;
    return { meta: { changes: 1 } };
  });
  const response = await saveAssessment({
    request: new Request(`https://${HOST}/api/assessment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: 999, panel_count: 12 })
    }),
    env: { DB: db }
  });
  assert.equal(response.status, 404);
  assert.equal(assessmentWrites, 0);
});


test("Pages hosts retain production redirect unless isolated testing is explicitly enabled", async () => {
  const redirected = await rootMiddleware({
    request: new Request("https://security-test.pages.dev/home-energy-check.html"),
    env: {},
    next: async () => new Response("should not run")
  });
  assert.equal(redirected.status, 308);
  assert.equal(redirected.headers.get("location"), "https://solectrics.co.nz/home-energy-check.html");

  let called = 0;
  const allowed = await rootMiddleware({
    request: new Request("https://security-test.pages.dev/home-energy-check.html"),
    env: { ALLOW_PAGES_DEV_HOST: "true" },
    next: async () => { called += 1; return new Response("isolated"); }
  });
  assert.equal(called, 1);
  assert.equal(await allowed.text(), "isolated");

  const publicPost = await rootMiddleware({
    request: new Request("https://security-test.pages.dev/api/read-bill", { method: "POST" }),
    env: { ALLOW_PAGES_DEV_HOST: "true" },
    next: async () => new Response("bill-reader")
  });
  assert.equal(publicPost.status, 200);
  assert.equal(await publicPost.text(), "bill-reader");
});

test("site visit, system design and costing reject nonexistent parent jobs before writes", async () => {
  const cases = [
    {
      handler: saveSiteVisit,
      body: { job_id: 999, site_visit: { visit_date: "2026-10-01" } },
      writePattern: /INSERT INTO site_visits/
    },
    {
      handler: saveSystemDesign,
      body: { job_id: 999, system_design: { design_panel_count: "12" } },
      writePattern: /INSERT INTO system_designs/
    },
    {
      handler: saveCosting,
      body: { job_id: 999, option: { name: "Synthetic" }, lines: [] },
      writePattern: /INSERT INTO costing_options/
    }
  ];

  for (const item of cases) {
    let writes = 0;
    const db = mockDb(({ sql, kind }) => {
      if (/SELECT id, enquiry_id, job_type FROM jobs/.test(sql)) return null;
      if (item.writePattern.test(sql) && kind === "run") writes += 1;
      if (/PRAGMA table_info/.test(sql)) return { results: [] };
      return kind === "all" ? { results: [] } : { meta: { changes: 1 } };
    });
    db.batch = async statements => {
      writes += statements.length;
      return statements.map(() => ({ meta: { changes: 1 } }));
    };

    const response = await item.handler({
      request: new Request("https://solectrics.co.nz/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body)
      }),
      env: { DB: db }
    });
    assert.equal(response.status, 404);
    assert.equal(writes, 0);
  }
});

test("invoice status mutation resolves the invoice through its owning job first", async () => {
  let directInvoiceLookup = 0;
  let updates = 0;
  const db = mockDb(({ sql, kind }) => {
    if (/FROM customer_invoice_versions related/.test(sql)) return null;
    if (/SELECT job_id, status FROM customer_invoice_versions/.test(sql)) {
      directInvoiceLookup += 1;
      return { job_id: 6, status: "draft" };
    }
    if (/UPDATE customer_invoice_versions/.test(sql) && kind === "run") updates += 1;
    if (/CREATE TABLE|CREATE INDEX|ALTER TABLE/.test(sql)) return { meta: { changes: 0 } };
    if (/PRAGMA table_info/.test(sql)) return { results: [] };
    return kind === "all" ? { results: [] } : { meta: { changes: 1 } };
  });

  const response = await updateInvoice({
    request: new Request("https://solectrics.co.nz/api/customer-invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_status", invoice_id: "wrong-job-invoice", status: "issued" })
    }),
    env: { DB: db }
  });

  assert.equal(response.status, 404);
  assert.equal(directInvoiceLookup, 0);
  assert.equal(updates, 0);
});
