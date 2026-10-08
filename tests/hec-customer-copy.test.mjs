import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestPost } from "../functions/api/enquiry.js";
import { renderHomeEnergyCheckCopy } from "../functions/api/_hec-customer-copy.js";

const html = await readFile(new URL("../home-energy-check.html", import.meta.url), "utf8");

function makeDb() {
  const inserts = { enquiries: [], jobs: [] };
  const writes = [];
  let nextId = 100;
  return {
    inserts,
    writes,
    prepare(sql) {
      return {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async all() { return { results: [{ name: "job_type" }] }; },
        async run() {
          writes.push(sql);
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

test("copy choice is separate; unticked copy sends to Solectrics, while privacy remains required", async () => {
  const section = html.slice(html.indexOf('id="sendToSolectrics"'));
  const privacy = section.indexOf('id="privacyConsent"');
  const copy = section.indexOf('id="customerCopyConsent"');
  const button = section.indexOf('id="sendCheckButton"');
  assert.ok(privacy >= 0 && copy > privacy && button > copy);
  assert.match(section.slice(copy, button), /type="checkbox"/);
  assert.doesNotMatch(section.slice(copy, button), /required/);
  assert.match(section, /I'm happy for Solectrics to receive and use my Home Energy Check/);
  assert.ok(html.includes("answers.customerCopyOptIn = Boolean(document.getElementById('customerCopyConsent')?.checked);"));
  assert.equal(html.split("'/api/enquiry'").length - 1, 1);

  const handlerStart = html.indexOf("async function sendHomeEnergyCheck()");
  const handlerEnd = html.indexOf("function showResult()", handlerStart);
  const handler = html.slice(handlerStart, handlerEnd);
  const runHandler = (privacyChecked, submit) => new Function(
    "document", "submitHomeEnergyCheck", "console",
    `${handler}; return sendHomeEnergyCheck();`
  )({
    getElementById(id) {
      return ({
        privacyConsent: { checked: privacyChecked, disabled: false },
        sendCheckButton: { disabled: false, textContent: "" },
        sendCheckStatus: { className: "", textContent: "" }
      })[id];
    }
  }, submit, { error() {} });

  let submitCalls = 0;
  await runHandler(false, async () => { submitCalls++; });
  assert.equal(submitCalls, 0, "privacy consent unchecked must block submission");

  const result = { customerCopy: { requested: false, sent: false } };
  await runHandler(true, async () => { submitCalls++; return result; });
  assert.equal(submitCalls, 1, "privacy consent alone must allow HEC submission when customer copy is unticked");
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
    assert.equal(db.inserts.jobs[0][0], data.enquiryRef);
    assert.equal(db.writes.length, 2);
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
    assert.equal(db.inserts.jobs[0][0], data.enquiryRef);
    assert.equal(db.writes.length, 2);
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
  assert.equal(db.writes.length, 2);
});

for (const failure of ["provider rejection", "network failure"]) {
  test(`${failure} leaves one enquiry/job saved without rollback or retry`, async () => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    let emailCalls = 0;
    globalThis.fetch = async () => {
      emailCalls++;
      if (failure === "network failure") throw new Error("simulated network failure");
      return new Response("simulated provider rejection", { status: 403 });
    };
    console.error = () => {};
    try {
      const { response, data, db } = await submit(true, { RESEND_API_KEY: "test-key" });
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.deepEqual(data.customerCopy, { requested: true, sent: false });
      assert.equal(emailCalls, 1);
      assert.equal(db.inserts.enquiries.length, 1);
      assert.equal(db.inserts.jobs.length, 1);
      assert.equal(db.inserts.jobs[0][0], data.enquiryRef);
      assert.equal(db.writes.length, 2, "only the two original inserts; no rollback or additional write");
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalError;
    }
  });
}

test("saved submission with failed email keeps Send disabled and shows completion", async () => {
  const start = html.indexOf("async function sendHomeEnergyCheck()");
  const handler = html.slice(start, html.indexOf("function showResult()", start));
  const elements = {
    privacyConsent: { checked: true, disabled: false },
    sendCheckButton: { disabled: false, textContent: "" },
    sendCheckStatus: { className: "", textContent: "" }
  };
  let calls = 0;
  await new Function("document", "submitHomeEnergyCheck", "console",
    `${handler}; return sendHomeEnergyCheck();`
  )({ getElementById: id => elements[id] }, async () => {
    calls++;
    return { customerCopy: { requested: true, sent: false } };
  }, { error() {} });
  assert.equal(calls, 1);
  assert.equal(elements.sendCheckButton.disabled, true);
  assert.equal(elements.privacyConsent.disabled, true);
  assert.match(elements.sendCheckStatus.textContent, /submission is complete/);
  assert.doesNotMatch(elements.sendCheckButton.textContent, /TRY/);
});

test("file copy allowlist includes escaped names but excludes keys and other metadata", () => {
  const rendered = renderHomeEnergyCheckCopy({
    name: "Alex",
    energyDataUploads: {
      recentBills: [{ name: "<summer>.pdf", storage_key: "SECRET_STORAGE", internalNotes: "SECRET_FILE_NOTE" }],
      annualUsage: [{ name: "annual.csv", costing: "SECRET_FILE_COST" }],
      other: "SECRET_OTHER"
    },
    unknownField: "SECRET_UNKNOWN"
  });
  assert.match(rendered, /&lt;summer&gt;\.pdf/);
  assert.match(rendered, /annual\.csv/);
  assert.doesNotMatch(rendered, /SECRET_|storage_key|internalNotes|costing|unknownField/);
});

test("submission payload passes the actual customer-copy choice without adding a second request", async () => {
  const start = html.indexOf("async function submitHomeEnergyCheck()");
  const handler = html.slice(start, html.indexOf("async function sendHomeEnergyCheck()", start));
  for (const checked of [false, true]) {
    const answers = { name: "Alex", email: "alex@example.invalid" };
    const payloads = [];
    await new Function("document", "answers", "FormData", "fetch", "console",
      `${handler}; return submitHomeEnergyCheck();`
    )({ getElementById: id => id === "customerCopyConsent" ? { checked } : { files: [] } },
    answers, FormData, async (url, options) => {
      assert.equal(url, "/api/enquiry");
      payloads.push(JSON.parse(options.body.get("answers")));
      return Response.json({ ok: true, enquiryRef: 101, jobId: 102 });
    }, { log() {}, error() {} });
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].customerCopyOptIn, checked);
  }
});

