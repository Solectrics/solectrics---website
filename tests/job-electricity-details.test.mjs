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

test('reviewed design handoff remains explicit rather than changing saved observations',()=>{
 const html=fs.readFileSync(new URL('../mini-fergus-job.html',import.meta.url),'utf8');
 assert.match(html,/refreshDesignDataReview/);assert.doesNotMatch(html,/function applySharedElectricityDetails/);
 for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(script);
});
