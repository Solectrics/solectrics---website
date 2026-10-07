import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestPost } from "../functions/api/enquiry.js";
import { renderHomeEnergyCheckCopy } from "../functions/api/_hec-customer-copy.js";

const html = await readFile(new URL("../home-energy-check.html", import.meta.url), "utf8");

function makeDb() {
  const inserts = { enquiries: [], jobs: [] };
  let nextId = 100;
  return {
    inserts,
    prepare(sql) {
      return {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async all() { return { results: [{ name: "job_type" }] }; },
        async run() {
          if (/INSERT INTO enquiries/i.test(sql)) {
            inserts.enquiries.push(this.params);
            return { meta: { last_row_id: ++nextId } };
          }
          if (/INSERT INTO jobs/i.test(sql)) {
            inserts.jobs.push(this.params);
            return { meta: { last_row_id: ++nextId } };
          }
          return { meta: { changes: 1 } };
        }
      };
    }
  };
}

async function submit(optIn, env = {}) {
  const db = makeDb();
  const formData = new FormData();
  formData.append("answers", JSON.stringify({
    name: "Alex Customer",
    email: "alex@example.com",
    address: "12 Example Road",
    customerCopyOptIn: optIn,
    internalNotes: "SECRET JOB HUB NOTE",
    supplierPricing: "SECRET SUPPLIER PRICE",
    costing: "SECRET COSTING"
  }));
  const request = new Request("https://solectrics.example/api/enquiry", {
    method: "POST",
    body: formData
  });
  const response = await onRequestPost({ request, env: { DB: db, ...env } });
  return { response, data: await response.json(), db };
}

test("copy choice is separate and optional; privacy consent remains the submission gate", () => {
  const section = html.slice(html.indexOf('id="sendToSolectrics"'));
  const privacy = section.indexOf('id="privacyConsent"');
  const copy = section.indexOf('id="customerCopyConsent"');
  const button = section.indexOf('id="sendCheckButton"');
  assert.ok(privacy >= 0 && copy > privacy && button > copy);
  assert.match(section.slice(copy, button), /type="checkbox"/);
  assert.doesNotMatch(section.slice(copy, button), /required/);
  assert.match(section, /I'm happy for Solectrics to receive and use my Home Energy Check/);
  const handler = html.slice(html.indexOf("async function sendHomeEnergyCheck()"), html.indexOf("function showResult()"));
  assert.ok(handler.indexOf("if (!consent || !consent.checked)") < handler.indexOf("await submitHomeEnergyCheck()"));
  assert.match(html, /customerCopyOptIn = Boolean\(document\.getElementById\('customerCopyConsent'\)\?\.checked\)/);
  assert.equal((html.match(/fetch\s*\(\s*['"]\/api\/enquiry['"]/g) || []).length, 1);
});

test("unticked customer copy still creates exactly one enquiry and one linked solar job", async () => {
  const originalFetch = globalThis.fetch;
  let emailCalls = 0;
  globalThis.fetch = async () => { emailCalls++; throw new Error("unexpected email"); };
  try {
    const { response, data, db } = await submit(false, { RESEND_API_KEY: "test-key" });
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.deepEqual(data.customerCopy, { requested: false, sent: false });
    assert.equal(db.inserts.enquiries.length, 1);
    assert.equal(db.inserts.jobs.length, 1);
    assert.equal(db.inserts.jobs[0][1], "New enquiry");
    assert.equal(db.inserts.jobs[0][2], "Review Home Energy Check");
    assert.equal(db.inserts.jobs[0][3], "solar");
    assert.equal(emailCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ticked customer copy emails the safe HEC and still creates one enquiry/job", async () => {
  const originalFetch = globalThis.fetch;
  const emailRequests = [];
  globalThis.fetch = async (url, options) => {
    emailRequests.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: "email-test-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const { response, data, db } = await submit(true, { RESEND_API_KEY: "test-key" });
    assert.equal(response.status, 200);
    assert.deepEqual(data.customerCopy, { requested: true, sent: true });
    assert.equal(db.inserts.enquiries.length, 1);
    assert.equal(db.inserts.jobs.length, 1);
    assert.equal(emailRequests.length, 1);
    assert.equal(emailRequests[0].url, "https://api.resend.com/emails");
    assert.deepEqual(emailRequests[0].body.to, ["alex@example.com"]);
    assert.match(emailRequests[0].body.html, /12 Example Road/);
    assert.doesNotMatch(emailRequests[0].body.html, /SECRET JOB HUB NOTE|SECRET SUPPLIER PRICE|SECRET COSTING|internalNotes|supplierPricing/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("customer copy renderer escapes customer values and excludes internal fields", () => {
  const rendered = renderHomeEnergyCheckCopy({
    name: "<Alex>",
    email: "alex@example.com",
    address: "12 & 14 Example Road",
    goals: ["Lower bills"],
    internalNotes: "secret",
    costing: { margin: 99 },
    supplierPricing: "secret"
  });
  assert.match(rendered, /&lt;Alex&gt;/);
  assert.match(rendered, /12 &amp; 14 Example Road/);
  assert.match(rendered, /Lower bills/);
  assert.doesNotMatch(rendered, /secret|internalNotes|costing|supplierPricing/);
});

test("failed email does not undo or duplicate the successful HEC submission", async () => {
  const { response, data, db } = await submit(true);
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.deepEqual(data.customerCopy, { requested: true, sent: false });
  assert.equal(db.inserts.enquiries.length, 1);
  assert.equal(db.inserts.jobs.length, 1);
});
