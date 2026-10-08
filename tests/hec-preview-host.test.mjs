import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/_middleware.js";

const PREVIEW = "codex-hec-customer-copy-prod.solectrics-jobhub-staging.pages.dev";
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
