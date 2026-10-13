import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestPatch } from "../functions/api/job-files.js";

const job = await readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8");
const materials = await readFile(new URL("../assets/jobhub-materials.js", import.meta.url), "utf8");

test("invoice picker opens directly from the iPhone tap and new material visibly resets the form", () => {
  assert.match(materials, /jobFileRole"\)\.value = "supplier_invoice";[\s\S]*?jobFileInput"\)\.click\(\);/);
  assert.doesNotMatch(materials, /jobFilesSection"\)\.scrollIntoView[\s\S]*?jobFileInput"\)\.click/);
  assert.match(materials, /function newMaterial\(\)[\s\S]*?materialsInvoiceFile"\)\.value = ""/);
  assert.match(materials, /materialsDescription"\)\.focus\(\{ preventScroll: true \}\)/);
});

test("planned work pre-fills a new EWRB record and requires review before it can sync", () => {
  assert.match(job, /id="workLogPlannedScopeConfirmation"/);
  assert.match(job, /completedField\.value = plannedWork/);
  assert.match(job, /if \(workLogPlannedScopeNeedsConfirmation\)/);
  assert.match(job, /confirmPlannedWorkCompleted/);
  assert.match(job, /planned_work_unconfirmed/);
});

test("uploaded file categories can be corrected on the job", () => {
  assert.match(job, /class="job-file-category"/);
  assert.match(job, /method: "PATCH"/);
  assert.match(job, /updateJobFileCategory\(event\.target\.dataset\.fileId/);
});

test("PATCH updates only a file belonging to the supplied job and rejects invalid categories", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        run: async () => ({ success: true }),
        bind(...values) {
          statements.push(values);
          return {
            run: async () => ({ meta: { changes: 1 } }),
            first: async () => {
              if (sql.includes("SELECT id, enquiry_id, job_type FROM jobs WHERE id = ?")) {
                return Number(values[0]) === 13 ? { id: 13, enquiry_id: 13, job_type: "solar" } : null;
              }
              if (sql.includes("FROM job_files") && String(values[0]) === "file-1" && Number(values[1]) === 13) {
                return {
                  id: "file-1", job_id: 13, storage_key: "jobs/13/file-1.pdf",
                  original_name: "synthetic.pdf", content_type: "application/pdf",
                  size_bytes: 10, document_role: "general"
                };
              }
              return null;
            }
          };
        }
      };
    }
  };
  const context = body => ({
    env: { DB: db },
    request: new Request("https://example.test/api/job-files", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    })
  });

  const response = await onRequestPatch(context({ job_id: 13, id: "file-1", category: "fixings" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "file-1", category: "fixings" });
  assert.match(statements.find(value => typeof value === "string" && value.includes("UPDATE job_files")), /WHERE id = \? AND job_id = \?/);
  assert.deepEqual(statements.at(-1), ["fixings", "file-1", 13]);

  const invalid = await onRequestPatch(context({ job_id: 13, id: "file-1", category: "banana" }));
  assert.equal(invalid.status, 400);
});
