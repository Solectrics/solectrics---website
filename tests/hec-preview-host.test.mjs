import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/_middleware.js";

const PREVIEW = "codex-hec-customer-copy-bran.solectrics-jobhub-staging.pages.dev";
const STAGING_ENV = { JOBHUB_STAGING_ONLY: "true", ALLOW_PAGES_DEV_HOST: "true" };

async function request(hostname, { method = "GET", env = {}, path = "/home-energy-check?review=1" } = {}) {
  let nextCalls = 0;
  const nextResponse = new Response("Application response", { status: 200 });
  const response = await onRequest({
    request: new Request(`https://${hostname}${path}`, { method }),
    env,
    next() { nextCalls++; return nextResponse; }
  });
  return { response, nextCalls, nextResponse };
}

test("exact HEC preview passes GET, HEAD and HEC POST only with both staging flags", async () => {
  for (const method of ["GET", "HEAD", "POST"]) {
    const { response, nextCalls, nextResponse } = await request(PREVIEW, {
      method, env: STAGING_ENV, path: method === "POST" ? "/api/enquiry" : undefined
    });
    assert.equal(response, nextResponse);
    assert.equal(nextCalls, 1);
    assert.equal(response.headers.get("Location"), null);
  }
});

test("staging refuses every non-allowlisted hostname without redirecting or reaching the app", async () => {
  const denied = [
    "solectrics-jobhub-staging.pages.dev",
    "codex-hec-customer-copy-prod.solectrics-jobhub-staging.pages.dev",
    "codex-jobhub-solar-operation.solectrics-jobhub-staging.pages.dev",
    "other-preview.solectrics-jobhub-staging.pages.dev",
    "random-id.solectrics-jobhub-staging.pages.dev",
    `prefix-${PREVIEW}`,
    `${PREVIEW}.example.com`,
    "solectrics---website.pages.dev",
    "solectrics.co.nz",
    "www.solectrics.co.nz",
    "pages.dev"
  ];
  for (const hostname of denied) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const { response, nextCalls } = await request(hostname, { method, env: STAGING_ENV });
      assert.equal(response.status, 403, `${hostname} ${method}`);
      assert.equal(nextCalls, 0);
      assert.equal(response.headers.get("Location"), null);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(await response.text(), "Staging hostname is not allowed");
    }
  }
});

test("missing, false or non-string staging flags never enable the bypass", async () => {
  const environments = [
    undefined,
    {},
    { ALLOW_PAGES_DEV_HOST: "true" },
    { JOBHUB_STAGING_ONLY: "false", ALLOW_PAGES_DEV_HOST: "true" },
    { JOBHUB_STAGING_ONLY: true, ALLOW_PAGES_DEV_HOST: "true" },
    { JOBHUB_STAGING_ONLY: "true" },
    { JOBHUB_STAGING_ONLY: "true", ALLOW_PAGES_DEV_HOST: "false" },
    { JOBHUB_STAGING_ONLY: "true", ALLOW_PAGES_DEV_HOST: true }
  ];
  for (const env of environments) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const { response, nextCalls } = await request(PREVIEW, { method, env });
      assert.equal(response.status, method === "POST" ? 404 : 308);
      assert.equal(nextCalls, 0);
    }
  }
});

test("production pages.dev GET and HEAD retain the canonical redirect and path/query", async () => {
  for (const hostname of [PREVIEW, "solectrics---website.pages.dev", "other.pages.dev", "pages.dev"]) {
    for (const method of ["GET", "HEAD"]) {
      const { response, nextCalls } = await request(hostname, { method });
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("Location"), "https://solectrics.co.nz/home-energy-check?review=1");
      assert.equal(nextCalls, 0);
    }
  }
});

test("production pages.dev writes remain blocked with the original 404", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const { response, nextCalls } = await request(PREVIEW, { method, path: "/api/enquiry" });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "Not found");
    assert.equal(nextCalls, 0);
  }
});

test("production custom domains still reach the app even if only ALLOW_PAGES_DEV_HOST is set", async () => {
  for (const hostname of ["solectrics.co.nz", "www.solectrics.co.nz", "example.com"]) {
    for (const env of [{}, { ALLOW_PAGES_DEV_HOST: "true" }]) {
      const { response, nextCalls, nextResponse } = await request(hostname, { env });
      assert.equal(response, nextResponse);
      assert.equal(nextCalls, 1);
    }
  }
});

test("temporary exact-host diagnostic reports only flag presence and strict string enablement", async () => {
  const cases = [
    [{}, [false, false, false, false]],
    [{ JOBHUB_STAGING_ONLY: "true" }, [true, true, false, false]],
    [STAGING_ENV, [true, true, true, true]],
    [{ JOBHUB_STAGING_ONLY: true, ALLOW_PAGES_DEV_HOST: "false" }, [true, false, true, false]]
  ];
  for (const [flags, expected] of cases) {
    const env = new Proxy(flags, {
      get(target, key) {
        if (!["JOBHUB_STAGING_ONLY", "ALLOW_PAGES_DEV_HOST"].includes(key)) {
          throw new Error("Diagnostic read an unrelated binding");
        }
        return target[key];
      }
    });
    const { response, nextCalls } = await request(PREVIEW, { env, path: "/__staging/hec-host-flags" });
    assert.equal(response.status, 200);
    assert.equal(nextCalls, 0, "must not invoke app, database or email handlers");
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      JOBHUB_STAGING_ONLY: { present: expected[0], enabled: expected[1] },
      ALLOW_PAGES_DEV_HOST: { present: expected[2], enabled: expected[3] }
    });
  }
});

test("temporary diagnostic handles HEAD and refuses write methods without invoking the app", async () => {
  const head = await request(PREVIEW, { method: "HEAD", path: "/__staging/hec-host-flags" });
  assert.equal(head.response.status, 200);
  assert.equal(await head.response.text(), "");
  assert.equal(head.nextCalls, 0);
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const { response, nextCalls } = await request(PREVIEW, {
      method, env: STAGING_ENV, path: "/__staging/hec-host-flags"
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
    assert.equal(nextCalls, 0);
  }
});

test("temporary diagnostic never exposes flags on production or another staging hostname", async () => {
  for (const hostname of ["solectrics.co.nz", "solectrics---website.pages.dev",
    "solectrics-jobhub-staging.pages.dev",
    "codex-hec-customer-copy-prod.solectrics-jobhub-staging.pages.dev",
    PREVIEW + ".example.com"]) {
    for (const env of [{}, STAGING_ENV]) {
      const { response, nextCalls } = await request(hostname, { env, path: "/__staging/hec-host-flags" });
      assert.notEqual(response.headers.get("Content-Type"), "application/json; charset=utf-8");
      assert.equal(nextCalls, !hostname.endsWith(".pages.dev") && env !== STAGING_ENV ? 1 : 0);
      if (env === STAGING_ENV) assert.equal(response.status, 403);
      else if (hostname.endsWith(".pages.dev")) assert.equal(response.status, 308);
    }
  }
});
