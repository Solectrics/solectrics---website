import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const page = fs.readFileSync(new URL("../mini-fergus-job.html", import.meta.url), "utf8");
const guideScript = fs.readFileSync(new URL("../assets/jobhub-guided-site-visit.js", import.meta.url), "utf8");

function setup() {
  const elements = new Map();
  const documentEvents = {};
  const windowEvents = {};
  const state = { savedStep: null, selectedWorkspace: null };
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, value: "", checked: false, textContent: "", innerHTML: "",
      hidden: false, disabled: false, dataset: {}, listeners: {}, attrs: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      setAttribute(name, value) { this.attrs[name] = value; },
      scrollIntoView() {}
    });
    return elements.get(id);
  };
  const stages = ["supply", "hot-water", "roof", "conditions", "locations", "review"]
    .map(step => ({ ...element("stage-" + step), dataset: { siteStep: step } }));
  const tabs = stages.map(({ dataset }) => ({
    ...element("tab-" + dataset.siteStep),
    dataset: { siteStepTab: dataset.siteStep }
  }));
  const photos = Array.from({ length: 6 }, (_, index) => ({
    closest: () => ({ querySelector: () => index < 2 ? ({ href: "/saved" }) : null })
  }));
  const doc = {
    getElementById: element,
    querySelectorAll(selector) {
      if (selector === "#siteVisitSection [data-site-step]") return stages;
      if (selector === "#siteVisitSection [data-site-step-tab]") return tabs;
      if (selector === "#siteVisitSection .site-photo-input") return photos;
      return [];
    },
    addEventListener(type, callback) { documentEvents[type] = callback; }
  };
  const win = { addEventListener(type, callback) { windowEvents[type] = callback; } };
  const storage = {
    getItem() { return state.savedStep; },
    setItem(_, value) { state.savedStep = value; }
  };
  const context = {
    document: doc,
    window: win,
    location: { search: "?id=123" },
    sessionStorage: storage,
    URLSearchParams,
    selectJobWorkspace(workspace) { state.selectedWorkspace = workspace; }
  };
  vm.runInNewContext(guideScript, context);
  const guide = win.jobhubSiteGuide;
  guide.init();
  return { guide, element, stages, tabs, state, documentEvents, windowEvents };
}

test("the existing inline photos and fields are grouped without changing their IDs", () => {
  const portion = page.split("<!-- TOM'S SITE VISIT -->")[1].split("<!-- OFFICE FOLLOW-UP")[0];
  const steps = [...portion.matchAll(/data-site-step="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(steps, ["supply", "hot-water", "roof", "conditions", "locations", "review"]);
  assert.equal([...portion.matchAll(/class="site-photo-input"/g)].length, 6);
  for (const id of ["visit_icp", "visit_hw_ripple", "visit_roof_length",
    "visit_inverter_location", "visit_panel_count", "visit_battery_kwh", "siteVisitMessage"]) {
    assert.match(portion, new RegExp('id="' + id + '"'));
  }
  assert.match(page, /window\.jobhubSiteGuide\?\.init\(\)/);
  assert.match(page, /saveFinished\(guideVersion, true\)/);
});

test("only one Site Visit step is displayed on a phone at a time", () => {
  const { guide, stages, tabs, state, element } = setup();
  assert.deepEqual(stages.map(s => s.hidden), [false, true, true, true, true, true]);
  guide.open("roof", false);
  assert.deepEqual(stages.map(s => s.hidden), [true, true, false, true, true, true]);
  assert.equal(tabs[2].attrs["aria-pressed"], "true");
  assert.equal(element("siteGuidePosition").textContent.includes("Step 3 of 6"), true);
  assert.equal(state.savedStep, "roof");
});

test("the finish checklist shows missing physical observations but does not block saving", () => {
  const { guide, element } = setup();
  guide.open("review", false);
  assert.match(element("siteGuideChecklist").innerHTML, /0 of 4 core checks recorded/);
  assert.match(element("siteGuideChecklist").innerHTML, /needs checking/);
  assert.match(element("siteGuidePhotoCount").textContent, /2 of 6 photo locations/);
  element("visit_connection_type").value = "single_phase";
  element("visit_icp").value = "000123";
  element("visit_switchboard").value = "review";
  guide.refresh();
  assert.match(element("siteGuideChecklist").innerHTML, /1 of 4 core checks recorded/);
  element("visit_battery_model").value = "Battery model";
  guide.refresh();
  assert.match(element("siteGuideChecklist").innerHTML, /1 of 5 core checks recorded/);
});

test("design handoff is read-only and respects reviewed System Design", () => {
  const { guide, element } = setup();
  element("visit_roof_length").value = "6.4";
  element("visit_roof_width").value = "3.2";
  element("visit_roof_orientation").value = "North";
  element("visit_icp").value = "01234";
  element("design_reviewed").checked = true;
  element("design_panel_count").value = "20";  // deliberately different
  guide.refresh();
  assert.match(element("designSiteHandoffSummary").innerHTML, /6\.4 × 3\.2 m/);
  assert.match(element("designSiteHandoffSummary").innerHTML, /cannot overwrite it/);
  assert.equal(element("design_panel_count").value, "20");
});

test("pending edits warn on exit, and successful autosave clears the warning", () => {
  const { guide, element, documentEvents, windowEvents } = setup();
  documentEvents.input({ target: { closest: () => ({}), matches: () => false, tagName: "INPUT" } });
  const warn = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: null };
    windowEvents.beforeunload(event);
    return event.prevented;
  };
  assert.equal(warn(), true);
  const version = guide.saveStarted();
  guide.saveFinished(version, true);
  assert.equal(warn(), false);
  assert.match(element("siteGuidePosition").textContent, /Saved/);
});

test("an edit made during a save keeps the exit warning until the newer edit is saved", () => {
  const { guide, documentEvents, windowEvents } = setup();
  const edit = () => documentEvents.input({ target: {
    closest: () => ({}), matches: () => false, tagName: "INPUT"
  } });
  edit();
  const savingEarlier = guide.saveStarted();
  edit();
  guide.saveFinished(savingEarlier, true);
  const event = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: null };
  windowEvents.beforeunload(event);
  assert.equal(event.prevented, true);
});

test("the user can jump directly from the Site Visit finish screen to Design", () => {
  const { element, state } = setup();
  element("goToSystemDesignFromVisit").listeners.click();
  assert.equal(state.selectedWorkspace, "design");
});

test("a photograph upload in progress prevents accidental navigation away", () => {
  const { guide, windowEvents } = setup();
  const exitAttempt = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: null };
    windowEvents.beforeunload(event);
    return event.prevented;
  };
  guide.photoStarted();
  assert.equal(exitAttempt(), true);
  guide.photoFinished();
  assert.equal(exitAttempt(), false);
});

test("System Design opens as five compact sections without changing field IDs", () => {
  const design = page.split('id="systemDesignSection"')[1].split('id="energyTariffReviewSection"')[0];
  assert.equal([...design.matchAll(/class="design-fold"/g)].length, 5);
  for (const id of ["design_icp","designRoofs","design_panel_model",
    "design_battery_kwh","design_string_count","design_reviewed","designReadiness"]) {
    assert.match(design, new RegExp('id="' + id + '"'));
  }
  assert.match(page, /OpenSolar is used to prepare the roof\/panel layout/);
});
