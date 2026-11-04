import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../mini-fergus-job.html", import.meta.url), "utf8");
function segment(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a + start.length);
  assert.ok(a !== -1 && b > a, "Expected section not found: " + start);
  return html.slice(a, b);
}

test("inline page script is valid JavaScript", () => {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [];
  const inline = scripts.map(x => x.replace(/^<script\b[^>]*>/, "").replace(/<\/script>$/, "")).filter(x => x.trim());
  assert.ok(inline.length);
  for (const script of inline) new Function(script);
});

test("mobile Site Visit contains the consolidated sections, camera and final follow-up", () => {
  const visit = segment('<section class="card site-visit', '<!-- OFFICE FOLLOW-UP:');
  for (const heading of [
    "Hot Water &amp; Heating", "Hot Water Supply &amp; Ripple Control",
    "Other Electrical Loads &amp; EV Charging", "Final Checks &amp; Supervisor Follow-up"
  ]) assert.ok(visit.includes(heading));
  assert.ok(visit.includes('value="trace">Unable to confirm — further electrical check needed'));
  assert.ok(visit.includes('id="visit_photo_hot_water_equipment"'));
  assert.ok(visit.includes('capture="environment"'));
  assert.ok(visit.indexOf('id="visit_hw_outstanding"') > visit.indexOf('id="visit_general_notes"'));
  assert.ok(!visit.includes('id="visit_panel_count"'));
  assert.ok(!visit.includes("Equipment discussed on site (optional)"));
  assert.match(html, /@media\s*\(max-width:\s*700px\)[\s\S]*?\.grid/);
});

test("EV safety and hot-water exceptions generate follow-ups without false EV flags", () => {
  const fn = new Function(
    segment("function siteVisitFollowupItems(visit) {", "function renderSiteVisitFollowups()") +
    "\nreturn siteVisitFollowupItems;"
  )();
  assert.ok(fn({ visit_hw_meter_circuit: "trace" }).some(x => x.includes("hot-water circuit")));
  assert.equal(fn({ visit_ev_existing: "no" }).length, 0);
  assert.equal(fn({ visit_ev_existing: "yes" }).filter(x => x.includes("not checked")).length, 4);
  assert.equal(fn({
    visit_ev_existing: "yes", visit_ev_circuit: "yes", visit_ev_protection: "yes",
    visit_ev_isolator: "not_applicable", visit_ev_cable: "yes"
  }).length, 0);
  assert.ok(fn({ visit_hw_physical_match: "no_office_info" }).some(x => x.includes("electricity bill")));
});

test("removed equipment IDs stay in legacy records but not active Site Visit fields", () => {
  const active = new Function(segment("const siteVisitFieldIds = [", "let loadedSiteVisit = {};") +
    "\nreturn siteVisitFieldIds;")();
  for (const id of ["visit_ev_existing", "visit_ev_future_interest", "visit_hw_outstanding", "visit_heating_arrangement"]) {
    assert.ok(active.includes(id));
  }
  for (const id of ["visit_panel_count", "visit_panel_wattage", "visit_inverter_model", "visit_inverter_kw",
    "visit_battery_model", "visit_battery_kwh"]) {
    assert.ok(!active.includes(id));
  }
  assert.ok(html.includes("const visit = { ...loadedSiteVisit };"));
});

test("legacy equipment prefill respects edited and reviewed System Design", () => {
  const f = new Function("document", "loadedSiteVisit",
    segment("function prefillLegacySiteVisitEquipment() {", "function collectSiteVisit() {") +
    "\nreturn prefillLegacySiteVisitEquipment;");
  const fields = {
    design_reviewed: { checked: false },
    design_panel_count: { value: "14" },
    design_panel_wattage: { value: "" },
    design_battery_kwh: { value: "18" }
  };
  const document = { getElementById: id => fields[id] || null };
  assert.equal(f(document, {
    visit_panel_count: "10", visit_panel_wattage: "475", visit_battery_kwh: "9"
  })(), true);
  assert.equal(fields.design_panel_count.value, "14");
  assert.equal(fields.design_panel_wattage.value, "475");
  assert.equal(fields.design_battery_kwh.value, "18");
  fields.design_reviewed.checked = true;
  fields.design_panel_wattage.value = "";
  assert.equal(f(document, { visit_panel_wattage: "500" })(), false);
  assert.equal(fields.design_panel_wattage.value, "");
});

test("future EV interest prefills draft quote only, preserving manual or sent text", () => {
  const fields = {
    quote_status: { value: "draft" },
    design_panel_count: { value: "14" },
    design_panel_wattage: { value: "475" },
    visit_ev_future_interest: { value: "yes" },
    quote_solar_system: { value: "", dataset: {} },
    quote_inverter: { value: "", dataset: {} },
    quote_battery: { value: "", dataset: {} },
    quote_smart_energy: { value: "", dataset: {} }
  };
  const document = { getElementById: id => fields[id] || null };
  const prefill = new Function("document",
    segment("function prefillLinkedQuoteField(id, value) {", "function syncDesignFromAssessment() {") +
    "\nreturn prefillQuoteFromDesign;"
  )(document);
  assert.equal(prefill(), true);
  assert.match(fields.quote_smart_energy.value, /EV charging point requested/);
  fields.quote_smart_energy.value = "Manually changed scope";
  fields.visit_ev_future_interest.value = "no";
  prefill();
  assert.equal(fields.quote_smart_energy.value, "Manually changed scope");
  fields.quote_status.value = "sent";
  fields.quote_inverter.value = "Approved description";
  prefill();
  assert.equal(fields.quote_inverter.value, "Approved description");
});


test("one shared inverter/battery photo and 900 mm check; legacy notes survive", () => {
  const visit = segment('<section class="card site-visit', '<!-- OFFICE FOLLOW-UP:');
  assert.ok(visit.includes('id="visit_inverter_location"'));
  assert.ok(visit.includes('id="visit_clearance_900mm"'));
  assert.ok(visit.includes('id="visit_photo_inverter_location"'));
  assert.ok(!visit.includes('id="visit_photo_battery_location"'));
  assert.ok(!visit.includes('id="visit_battery_location"'));
  assert.ok(visit.includes('900 mm side clearance confirmed?'));
  const fields = new Function(segment("const siteVisitFieldIds = [", "let loadedSiteVisit = {};") +
    "\nreturn siteVisitFieldIds;")();
  assert.ok(fields.includes("visit_clearance_900mm"));
  assert.ok(!fields.includes("visit_battery_location"));
  assert.ok(html.includes("const visit = { ...loadedSiteVisit };"));
  const followups = new Function(
    segment("function siteVisitFollowupItems(visit) {", "function renderSiteVisitFollowups()") +
    "\nreturn siteVisitFollowupItems;"
  )();
  assert.ok(followups({visit_clearance_900mm:"no"}).some(x=>x.includes("900 mm")));
  assert.ok(followups({visit_inverter_location:"Garage wall"}).some(x=>x.includes("not checked")));
  assert.ok(!followups({visit_inverter_location:"Garage wall",visit_clearance_900mm:"yes"}).some(x=>x.includes("900 mm")));
});

test("ripple and hot-water circuit checks are together at meter inspection, with no duplicate questions", () => {
  const visit = segment('<section class="card site-visit', '<!-- OFFICE FOLLOW-UP:');
  const meter = visit.slice(visit.indexOf('<h3>1. Visit and electrical supply'), visit.indexOf('<h3>2. Hot Water &amp; Heating'));
  const otherHotWater = visit.slice(visit.indexOf('<h3>3. Hot-Water Wiring'), visit.indexOf('<h3>4. Other Electrical Loads'));
  assert.ok(meter.includes('id="visit_hw_ripple"'));
  assert.ok(meter.includes('id="visit_hw_meter_circuit"'));
  assert.ok(meter.includes('id="visit_photo_meter_ICP"'));
  assert.ok(meter.indexOf('id="visit_hw_ripple"') < meter.indexOf('id="visit_photo_meter_ICP"'));
  assert.ok(!otherHotWater.includes('id="visit_hw_ripple"'));
  assert.ok(!otherHotWater.includes('id="visit_hw_meter_circuit"'));
  assert.equal((visit.match(/id="visit_hw_ripple"/g) || []).length, 1);
  assert.equal((visit.match(/id="visit_hw_meter_circuit"/g) || []).length, 1);
});
