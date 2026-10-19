import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { identifyEnergyDataDetail } from "../functions/api/job-files.js";

const hec = await readFile(new URL("../home-energy-check.html", import.meta.url), "utf8");
const job = await readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8");

test("Home Energy Check keeps bills and adds optional annual usage upload help", () => {
  assert.match(hec, /id="summerBill"/);
  assert.match(hec, /id="winterBill"/);
  assert.match(hec, /id="annualUsageFiles"[^>]*multiple/);
  assert.match(hec, /I don’t know how to get this/);
  assert.match(hec, /You don’t need to understand the spreadsheet/);
  assert.match(hec, /Recommended for a more accurate solar and battery assessment/);
  assert.match(hec, /formData\.append\('annual_usage_files'/);
  assert.match(hec, /Your current electricity plan/);
  assert.match(hec, /EV \/ night rate/);
  assert.match(hec, /Known exit \/ switching cost/);
  assert.match(hec, /Anything the bill does not show clearly will be marked/);
});

test("Job Hub exposes a dedicated energy area and all energy document roles", () => {
  assert.match(job, /Energy Usage \/ Bills/);
  assert.match(job, /value="annual_usage"/);
  assert.match(job, /value="additional_power_bill"/);
  assert.match(job, /Detailed \/ half-hourly data received/);
  assert.match(job, /More information required/);
  assert.match(job, /Energy → Retailer &amp; Tariff Review/);
  assert.match(job, /mini-fergus-energy-review\.html\?job_id=/);
});

test("detailed CSV usage is identified without treating ordinary bills as interval data", async () => {
  const rows = ["date,time,kWh", ...Array.from({ length: 120 }, (_, index) => `2026-01-01,${String(index % 24).padStart(2, "0")}:00,0.5`)];
  const detailedFile = new File([rows.join("\n")], "electricity-usage.csv", { type: "text/csv" });
  const billFile = new File(["bill"], "latest-bill.pdf", { type: "application/pdf" });
  assert.equal(await identifyEnergyDataDetail(detailedFile, "annual_usage"), "half_hourly");
  assert.equal(await identifyEnergyDataDetail(billFile, "power_bill"), null);
});
