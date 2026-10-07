import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolvePropertyAddress } from "../assets/hec-address.mjs";
import { buildHomeEnergyCheckSections, renderHomeEnergyCheckDocument } from "../functions/api/_home-energy-check-document.js";
import { sanitise } from "../functions/api/read-bill.js";

const root = new URL("../", import.meta.url);
const [hec, jobPage, enquiryApi, billApi] = await Promise.all([
  readFile(new URL("../home-energy-check.html", import.meta.url), "utf8"),
  readFile(new URL("../mini-fergus-job.html", import.meta.url), "utf8"),
  readFile(new URL("../functions/api/enquiry.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/api/read-bill.js", import.meta.url), "utf8")
]);

test("HEC customer copy is optional and separate from Solectrics privacy consent", () => {
  assert.match(hec, /id="privacyConsent"/);
  assert.match(hec, /id="customerCopyConsent" type="checkbox"/);
  assert.match(hec, /Email me a copy of my completed Home Energy Check/);
  assert.match(hec, /answers\.customerCopyOptIn=Boolean\(document\.getElementById\('customerCopyConsent'\)\?\.checked\)/);
  assert.match(enquiryApi, /if \(customerCopy\.requested\)/);
  assert.match(enquiryApi, /jobId: jobId/);
});

test("bill reader extracts only a clearly identified supply address and flags uncertainty", () => {
  assert.match(billApi, /supply\/property address only when it is clearly identified/);
  assert.match(billApi, /"property_address": string\|null/);
  assert.equal(sanitise({ property_address: "12 Example Road", confidence: 0.9 }).property_address, "12 Example Road");
  const uncertain = sanitise({ property_address: "12 Example Road", needs_review_fields: ["property_address"] });
  assert.equal(uncertain.property_address, null);
  assert.deepEqual(uncertain.needs_review_fields, ["property_address"]);
});

test("address resolver preserves deliberate entry and flags conflicting or uncertain bill addresses", () => {
  const one = resolvePropertyAddress([{ property_address: "12 Example Road" }], "", false, "");
  assert.equal(one.address, "12 Example Road");
  assert.equal(one.canUseExtracted, true);
  const manual = resolvePropertyAddress([{ property_address: "12 Example Road" }], "44 Customer Lane", true, "");
  assert.equal(manual.canUseExtracted, false);
  const conflict = resolvePropertyAddress([
    { property_address: "12 Example Road" }, { property_address: "14 Example Road" }
  ], "12 Example Road", false, "12 Example Road");
  assert.equal(conflict.conflicting, true);
  assert.equal(conflict.canUseExtracted, false);
  assert.equal(conflict.billConflict, true);
  const entryMismatch = resolvePropertyAddress([{ property_address: "12 Example Road" }], "44 Customer Lane", true);
  assert.equal(entryMismatch.addressDiffersFromEntry, true);
  assert.equal(entryMismatch.canUseExtracted, false);
  const uncertain = resolvePropertyAddress([{ property_address: null, needs_review_fields: ["property_address"] }]);
  assert.equal(uncertain.uncertain, true);
  assert.equal(uncertain.canUseExtracted, false);
});

test("Job Hub HEC controls use the linked job's original answers and customer address", () => {
  assert.match(jobPage, /VIEW HOME ENERGY CHECK/);
  assert.match(jobPage, /DOWNLOAD \/ PRINT HOME ENERGY CHECK/);
  assert.match(jobPage, /EMAIL HOME ENERGY CHECK TO CUSTOMER/);
  assert.match(jobPage, /home-energy-check-document\?job_id=\$\{encodeURIComponent\(job\.job_id\)\}/);
  assert.match(jobPage, /home-energy-check-email/);
  assert.match(jobPage, /This is the original Home Energy Check submitted for this enquiry/);
});

test("customer-facing HEC document includes submitted answers but excludes internal Job Hub fields", () => {
  const html = renderHomeEnergyCheckDocument({
    name: "Orna McGill", email: "orna@example.test", address: "12 Example Road",
    loads: ["EV", "Pool"], bills: { summer: { retailer: "Example Power", total_bill_nzd: 250 } },
    enquiryRef: "internal-ref", internal_notes: "Do not show", costing: { supplier_price: 999 }
  });
  assert.match(html, /Orna McGill/);
  assert.match(html, /Example Power/);
  assert.match(html, /12 Example Road/);
  assert.doesNotMatch(html, /internal-ref|Do not show|supplier_price|999/);
  const sections = buildHomeEnergyCheckSections({ internal_notes: "secret", email: "x@example.test" });
  assert.equal(sections.flatMap(section => section.entries).some(([label]) => label === "internal_notes"), false);
  assert.equal(sections.flatMap(section => section.entries).some(([label]) => label === "Email"), true);
});
