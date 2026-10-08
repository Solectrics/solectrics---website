import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { siteVisitCompletion } from "../functions/api/_site-visit-completion.js";
import { onRequestPost as saveAssessment } from "../functions/api/assessment.js";
import { onRequestPost as saveSystemDesign } from "../functions/api/system-design.js";

const jobHtml = await readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8");

const COMPLETE_VISIT = {
  visit_date: "2026-10-09",
  visit_by: "Tom Ratcliffe",
  visit_connection_type: "single_phase",
  visit_main_supply: "63",
  visit_switchboard: "suitable",
  visit_roof_length: "10",
  visit_roof_width: "5",
  visit_roof_pitch: "20",
  visit_roof_orientation: "North",
  visit_roof_material: "Long-run metal",
  visit_roof_access: "Ladder access"
};

function makeDb({ jobType = "solar", visit = null } = {}) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() {
          if (/SELECT job_type FROM jobs/i.test(sql)) return { job_type: jobType };
          if (/SELECT data_json, updated_at FROM site_visits/i.test(sql)) {
            return visit ? { data_json: JSON.stringify(visit), updated_at: "2026-10-09T00:00:00Z" } : null;
          }
          return null;
        },
        async run() {
          writes.push({ sql, params: this.params });
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
}

async function post(handler, db, body) {
  const request = new Request("https://staging.example/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const response = await handler({ request, env: { DB: db } });
  return { response, data: await response.json() };
}

test("site visit completion distinguishes fresh, partial and complete visits", () => {
  assert.equal(siteVisitCompletion(null).complete, false);
  assert.equal(siteVisitCompletion({ visit_date: "2026-10-09", visit_by: "Tom Ratcliffe" }).complete, false);
  assert.equal(siteVisitCompletion(COMPLETE_VISIT).complete, true);
});

test("assessment direct API save is rejected before a completed solar site visit", async () => {
  for (const visit of [null, { visit_date: "2026-10-09", visit_by: "Tom Ratcliffe" }]) {
    const db = makeDb({ visit });
    const { response, data } = await post(saveAssessment, db, { job_id: 6, panel_count: 12 });
    assert.equal(response.status, 409);
    assert.match(data.error, /Site Visit must be completed/i);
    assert.equal(db.writes.some(entry => /INSERT INTO assessments/i.test(entry.sql)), false);
  }
});

test("system design direct API save is rejected before a completed solar site visit", async () => {
  for (const visit of [null, { visit_date: "2026-10-09", visit_by: "Tom Ratcliffe" }]) {
    const db = makeDb({ visit });
    const { response, data } = await post(saveSystemDesign, db, {
      job_id: 6,
      system_design: { design_panel_count: "12" }
    });
    assert.equal(response.status, 409);
    assert.match(data.error, /Site Visit must be completed/i);
    assert.equal(db.writes.some(entry => /INSERT INTO system_designs/i.test(entry.sql)), false);
  }
});

test("assessment and system design direct API saves succeed after completed site visit", async () => {
  const assessmentDb = makeDb({ visit: COMPLETE_VISIT });
  const assessmentResult = await post(saveAssessment, assessmentDb, { job_id: 6, panel_count: 12 });
  assert.equal(assessmentResult.response.status, 200);
  assert.equal(assessmentResult.data.ok, true);
  assert.equal(assessmentDb.writes.some(entry => /INSERT INTO assessments/i.test(entry.sql)), true);

  const designDb = makeDb({ visit: COMPLETE_VISIT });
  const designResult = await post(saveSystemDesign, designDb, {
    job_id: 6,
    system_design: { design_panel_count: "12", design_reviewed: false }
  });
  assert.equal(designResult.response.status, 200);
  assert.equal(designResult.data.ok, true);
  assert.equal(designDb.writes.some(entry => /INSERT INTO system_designs/i.test(entry.sql)), true);
});

test("existing completed solar site visits continue to satisfy the prerequisite", async () => {
  const db = makeDb({ visit: { ...COMPLETE_VISIT, visit_general_notes: "Previously saved visit" } });
  const { response, data } = await post(saveAssessment, db, { job_id: 42, panel_count: 10 });
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
});

test("general electrical jobs remain unaffected by the solar site visit prerequisite", async () => {
  const db = makeDb({ jobType: "general_electrical", visit: null });
  const { response, data } = await post(saveAssessment, db, { job_id: 99, panel_count: 0 });
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
});

test("job page orders Site Visit before Assessment & Design before System Design and shows blockers", () => {
  const visit = jobHtml.indexOf('id="siteVisitSection"');
  const assessment = jobHtml.indexOf('id="assessmentSection"');
  const design = jobHtml.indexOf('id="systemDesignSection"');
  assert.ok(visit >= 0 && assessment > visit && design > assessment);
  assert.match(jobHtml, /id="assessmentPrerequisite"/);
  assert.match(jobHtml, /id="systemDesignPrerequisite"/);
  assert.match(jobHtml, /setSiteVisitPrerequisiteState\(Boolean\(data\.site_visit_complete\)/);
  assert.match(jobHtml, /section\.querySelectorAll\("input, select, textarea, button"\)/);
});

test("desktop/mobile layout rules remain present", () => {
  assert.match(jobHtml, /@media \(max-width: 700px\)/);
  assert.match(jobHtml, /\.grid,[\s\S]*?grid-template-columns: 1fr/);
  assert.match(jobHtml, /\.card \{[\s\S]*?padding: 25px 22px/);
});
