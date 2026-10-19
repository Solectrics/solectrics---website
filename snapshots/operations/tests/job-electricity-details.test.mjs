import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { resolveElectricityDetails, loadElectricityDetails } from "../functions/api/_job-electricity-details.js";
import { onRequestGet as getJob } from "../functions/api/job.js";
import { onRequestGet as getReview, onRequestPost as saveReview } from "../functions/api/energy-review.js";
import { onRequestGet as getOperations, onRequestPost as saveOperations } from "../functions/api/job-tasks.js";

const answers = { bills: { summer: { icp: " 000 123 ABC ", retailer: "Retailer A", plan_name: "Controlled plan" }, winter: { icp: "000123abc", retailer: "retailer a", plan_name: "Controlled plan" } } };
const job = { job_id: 7, customer_name: "Synthetic", address: "Synthetic address", answers_json: JSON.stringify(answers), icp: null, retailer: null, retailer_plan: null };

function database({ confirmed = {}, legacyPlan = {}, fail = false } = {}) {
  const writes = [];
  const db = { writes, prepare(sql) {
    return { values: [], bind(...values) { this.values = values; return this; },
      async first() {
        if (fail && sql.includes("site_visits")) throw new Error("database unavailable");
        if (sql.includes("FROM jobs") && sql.includes("JOIN enquiries")) return { ...job, ...confirmed };
        if (sql.includes("FROM energy_reviews")) return sql.startsWith("SELECT current_plan_json")
          ? { current_plan_json: JSON.stringify(legacyPlan) } : null;
        return null;
      },
      async all() { return { results: sql.includes("table_info(jobs)") ? [{ name: "job_type" }] : [] }; },
      async run() { writes.push({ sql, values: this.values }); return { success: true }; }
    };
  }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } };
  return db;
}

test("matching HEC bills fill shared details without requiring re-entry", () => {
  const resolved = resolveElectricityDetails(job);
  assert.equal(resolved.icp, "000123ABC");
  assert.equal(resolved.retailer, "Retailer A");
  assert.equal(resolved.retailer_plan, "Controlled plan");
  assert.deepEqual(resolved.conflicts, []);
});

test("conflicting unconfirmed ICPs stay blank and retain both values for confirmation", () => {
  const result = resolveElectricityDetails(job, { visit: { visit_icp: "OTHER-ICP" } });
  assert.equal(result.icp, "");
  assert.equal(result.conflicts[0].confirmed, false);
  assert.equal(result.conflicts[0].candidates.length, 3);
});

test("job corrections override older snapshots and disagreements remain visible", () => {
  const result = resolveElectricityDetails({ ...job, icp: "CONFIRMED-ICP", retailer: "Retailer B" });
  assert.equal(result.icp, "CONFIRMED-ICP");
  assert.equal(result.retailer, "Retailer B");
  assert.equal(result.conflicts[0].confirmed, true);
  assert.equal(result.retailer_plan, "", "do not attach the previous retailer's plan to a corrected retailer");
});

test("shared detail reads perform no writes and do not hide database errors", async () => {
  const db = database();
  assert.equal((await loadElectricityDetails(db, 7)).icp, "000123ABC");
  assert.equal(db.writes.length, 0);
  await assert.rejects(loadElectricityDetails(database({ fail: true }), 7), /database unavailable/);
});

test("job and tariff review display the same identity; saving a review cannot overwrite it", async () => {
  const db = database({ confirmed: { icp: "CONFIRMED-ICP", retailer: "Retailer B", retailer_plan: "Confirmed plan" }, legacyPlan: { icp: "LEGACY-ICP" } });
  const jobResponse = await getJob({ env: { DB: db }, request: new Request("https://example.invalid/api/job?id=7") });
  const jobData = await jobResponse.json();
  const reviewResponse = await getReview({ env: { DB: db }, request: new Request("https://example.invalid/api/energy-review?job_id=7") });
  const reviewData = await reviewResponse.json();
  assert.equal(jobData.electricity_details.icp, reviewData.review.current_plan.icp);
  assert.equal(reviewData.review.current_plan.retailer, "Retailer B");
  const response = await saveReview({ env: { DB: db }, request: new Request("https://example.invalid/api/energy-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: 7, action: "save_review", review: { current_plan: { icp: "BAD-ICP", retailer: "BAD-RETAILER", daily_charge_cents: 123 } } }) }) });
  assert.equal(response.status, 200);
  const saved = db.writes.find(write => /INSERT INTO energy_reviews/.test(write.sql));
  const savedPlan = JSON.parse(saved.values[2]);
  assert.equal(savedPlan.icp, "LEGACY-ICP", "existing source is retained, not silently overwritten");
  assert.equal(savedPlan.retailer, undefined);
  assert.equal(savedPlan.daily_charge_cents, 123);
  assert.ok(!db.writes.some(write => /UPDATE jobs|INSERT INTO (jobs|enquiries)/.test(write.sql)));
});

test("job template generates a real tariff URL and shared fields stay read-only after section loads", async () => {
  const html = fs.readFileSync(new URL("../mini-fergus-job.html", import.meta.url), "utf8");
  const fields = new Map();
  const document = { getElementById(id) { if (!fields.has(id) && id.endsWith("_sharedLink")) return null; if (!fields.has(id)) fields.set(id, { value: "old snapshot", innerHTML: "", insertAdjacentElement(_position, element) { fields.set(element.id, element); } }); return fields.get(id); }, createElement() { return {}; } };
  const context = vm.createContext({ document, jobId: "7", sharedElectricityDetails: resolveElectricityDetails(job), fetch: async () => ({ ok: true, json: async () => ({ ok: true, job, electricity_details: resolveElectricityDetails(job) }) }), parseAnswers: JSON.parse, escapeHtml: value => String(value || ""), formatStatus: value => value || "", prettyValue: value => String(value || ""), renderObject: () => "", prettyLabel: value => value, applyJobTypeVisibility: () => {}, window: {}, console, encodeURIComponent });
  const start = html.indexOf("function applySharedElectricityDetails()");
  const end = html.indexOf("function applyJobTypeVisibility(", start);
  vm.runInContext(html.slice(start, end), context);
  await vm.runInContext("loadJob()", context);
  assert.match(fields.get("page").innerHTML, /mini-fergus-energy-review\.html\?job_id=7/);
  assert.doesNotMatch(fields.get("page").innerHTML, /id="quote_icp"|id="quote_deposit_percent"|id="quote_finance_type"/);
  vm.runInContext("applySharedElectricityDetails()", context);
  for (const id of ["visit_icp", "design_icp"]) {
    assert.equal(fields.get(id).value, "000123ABC");
    assert.equal(fields.get(id).readOnly, true);
    assert.equal(fields.get(id + "_sharedLink").href, "#jobElectricityDetails");
  }
});

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { /* Older supported Node versions run the portable tests above. */ }
test("real post-0021 schema carries one job identity through Operations and tariff review", { skip: !DatabaseSync }, async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(fs.readFileSync(new URL("../staging/pre-0015-baseline.sql", import.meta.url), "utf8"));
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of fs.readdirSync(directory).filter(name => /^00(15|16|17|18|19|20|21)_/.test(name)).sort()) sqlite.exec(fs.readFileSync(new URL(file, directory), "utf8"));
    sqlite.prepare("INSERT INTO enquiries(enquiry_ref,customer_name,answers_json) VALUES(?,?,?)").run("local-only", "SYNTHETIC", JSON.stringify(answers));
    sqlite.exec("INSERT INTO jobs(enquiry_id,job_type) VALUES(1,'solar')");
    // Like D1, prepare builds a request; execution occurs in ordered batch/run.
    const db = { prepare(sql) { let values = []; return { bind(...v) { values = v; return this; }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { return sqlite.prepare(sql).run(...values); } }; }, async batch(statements) { const result = []; for (const statement of statements) result.push(await statement.run()); return result; } };
    async function get(handler, path) { const response = await handler({ env: { DB: db }, request: new Request("https://example.invalid" + path) }); const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data; }
    assert.equal((await get(getJob, "/api/job?id=1")).electricity_details.icp, "000123ABC");
    assert.equal((await get(getOperations, "/api/job-tasks?job_id=1")).electricity_details.icp, "000123ABC");
    assert.equal((await get(getReview, "/api/energy-review?job_id=1")).review.current_plan.icp, "000123ABC");
    const response = await saveOperations({ env: { DB: db }, request: new Request("https://example.invalid/api/job-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: 1, action: "update_job_stage", icp: "CORRECTED-ICP", retailer: "Retailer B", retailer_plan: "Confirmed plan" }) }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal((await get(getJob, "/api/job?id=1")).electricity_details.icp, "CORRECTED-ICP");
    assert.equal((await get(getOperations, "/api/job-tasks?job_id=1")).jobs[0].icp, "CORRECTED-ICP");
    const review = await get(getReview, "/api/energy-review?job_id=1");
    assert.equal(review.review.current_plan.icp, "CORRECTED-ICP");
    assert.equal(review.review.current_plan.retailer, "Retailer B");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM enquiries").get().n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM jobs").get().n, 1);
    assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { sqlite.close(); }
});

test("job and tariff page browser scripts parse, including Operations controls", () => {
  for (const page of ["mini-fergus-job.html", "mini-fergus-energy-review.html"]) {
    const html = fs.readFileSync(new URL("../" + page, import.meta.url), "utf8");
    for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script, { filename: page });
  }
});
