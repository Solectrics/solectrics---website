import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../mini-fergus-energy-review.html", import.meta.url), "utf8");
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]?.replace(/load\(\);\s*$/, "");
assert.ok(inline, "Inline review page script is present");
const init = new Function("document", "location", "navigator", "URLSearchParams",
  inline + "\nreturn {state,renderRegistryCheck,collectRegistryCheck,updateRegistryWarnings,collectReview,copyCurrentIcp};");

function setup() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: "", checked: false, textContent: "", innerHTML: "", dataset: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}
    });
    return elements.get(id);
  };
  const document = {
    getElementById: get,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {}
  };
  let copied = null;
  const navigator = { clipboard: { writeText: async value => { copied = value; } } };
  const ui = init(document, { search: "?job_id=2" }, navigator, URLSearchParams);
  ui.state.review = {
    current_plan: {
      retailer: "Example Energy",
      registry_check: {
        icp: "000123", network: "Vector", retailer: "Example Energy",
        checked_on: "2026-11-03", controlled_load: "unclear", notes: "Checked manually"
      },
      unrelated_saved_field: "retain"
    },
    baseline: {}, model: { model_ready: false }, proposed_system: {}, assumptions: []
  };
  ui.state.bundle = { icp_evidence: {
    conflicting: false, bill_conflict: false,
    sources: [{ source: "Winter bill", icp: "000-123" }]
  } };
  get("current_retailer").value = "Example Energy";
  get("current_icp").value = "000123";
  return { ui, get, copied: () => copied };
}

test("official Authority links open manually without claiming live API", () => {
  assert.match(html, /https:\/\/www\.ea\.govt\.nz\/your-power\/your-meter\/icp\//);
  assert.match(html, /https:\/\/www\.ea\.govt\.nz\/your-power\/your-meter\/address\//);
  assert.match(html, /not a connected API/);
  assert.match(html, /SAVE ENERGY REVIEW/);
});

test("manually entered registry data restores and persists within current plan JSON", () => {
  const { ui, get } = setup();
  ui.renderRegistryCheck();
  assert.equal(get("registry_icp").value, "000123");
  assert.equal(get("registry_network").value, "Vector");
  assert.equal(get("registry_checked_on").value, "2026-11-03");
  get("registry_notes").value = "Updated observation";
  const review = ui.collectReview();
  assert.equal(review.current_plan.registry_check.notes, "Updated observation");
  assert.equal(review.current_plan.registry_check.controlled_load, "unclear");
  assert.equal(review.current_plan.unrelated_saved_field, "retain");
});

test("ICP comparisons ignore formatting but flag real conflicts", () => {
  const { ui, get } = setup();
  ui.renderRegistryCheck();
  get("registry_icp").value = "000-123";
  ui.updateRegistryWarnings();
  assert.doesNotMatch(get("registryWarnings").textContent, /differs from one or more/);
  get("registry_icp").value = "999999";
  ui.updateRegistryWarnings();
  assert.match(get("registryWarnings").textContent, /differs from one or more/);
});

test("copying ICP works only when the source bills are not conflicting", async () => {
  const { ui, get, copied } = setup();
  await ui.copyCurrentIcp();
  assert.equal(copied(), "000123");
  ui.state.bundle.icp_evidence.bill_conflict = true;
  get("current_icp").value = "999";
  await ui.copyCurrentIcp();
  assert.equal(copied(), "000123", "conflicting bill ICP must not be copied");
  assert.match(get("copyIcpMessage").textContent, /Bills disagree/);
});

test("no default registry date or network is fabricated for a new record", () => {
  const { ui, get } = setup();
  ui.state.review.current_plan.registry_check = {};
  ui.renderRegistryCheck();
  assert.equal(get("registry_network").value, "");
  assert.equal(get("registry_checked_on").value, "");
  assert.equal(get("registry_controlled_load").value, "");
});
