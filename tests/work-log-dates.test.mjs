import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const job = await readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8");
const api = await readFile(new URL("../functions/api/job-work-logs.js", import.meta.url), "utf8");

test("work record accepts multiple dates, days and total hours without time fields", () => {
  assert.match(job, /id="workLogDates"/);
  assert.match(job, /id="addWorkLogDate"/);
  assert.match(job, /id="workLogDays"/);
  assert.match(job, /Total hours worked/);
  assert.doesNotMatch(job, /id="workLogStartTime"/);
  assert.doesNotMatch(job, /id="workLogFinishTime"/);
  assert.match(job, /work_dates: workDates/);
  assert.match(api, /JSON\.stringify\(workDates\)/);
  assert.match(api, /total_days: totalDays/);
});
