/* Tom's guided onsite view. Presentation only: existing Site Visit and System Design
 * API endpoints, field names, saved documents and design approvals remain unchanged. */
(function () {
  "use strict";

  const steps = ["supply", "hot-water", "roof", "conditions", "locations", "review"];
  let active = "supply";
  let started = false;
  let dirty = false;
  let saving = false;
  let photoUploads = 0;
  let changeVersion = 0;

  const byId = id => document.getElementById(id);
  const value = id => String(byId(id)?.value || "").trim();
  const escape = text => String(text || "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const stepKey = () => "jobhub-site-step-" + (new URLSearchParams(location.search).get("id") || "unknown");
  const textOr = (v, fallback = "Not recorded") => v ? escape(v) : fallback;

  function open(step, scroll = true) {
    if (!steps.includes(step) || !byId("siteVisitSection")) return;
    active = step;
    document.querySelectorAll("#siteVisitSection [data-site-step]").forEach(section => {
      section.hidden = section.dataset.siteStep !== step;
    });
    document.querySelectorAll("#siteVisitSection [data-site-step-tab]").forEach(button => {
      const selected = button.dataset.siteStepTab === step;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-current", selected ? "step" : "false");
    });
    const index = steps.indexOf(step);
    const back = byId("siteGuidePrevious");
    const next = byId("siteGuideNext");
    if (back) back.disabled = index === 0;
    if (next) {
      next.textContent = index === steps.length - 1 ? "REVIEW COMPLETE" : "NEXT STEP";
      next.disabled = index === steps.length - 1;
    }
    if (byId("siteGuidePosition")) byId("siteGuidePosition").textContent =
      "Step " + (index + 1) + " of " + steps.length + " · " +
      (dirty || saving ? "Changes not yet confirmed saved" : "Auto-save when connected");
    try { sessionStorage.setItem(stepKey(), step); } catch (_) { /* optional UI preference only */ }
    if (step === "review") renderChecklist();
    if (scroll) byId("siteVisitSection").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function checks() {
    const result = [
      { step: "supply", name: "Electrical supply, ICP and switchboard", ready:
        Boolean(value("visit_connection_type") && value("visit_icp") && value("visit_switchboard")) },
      { step: "hot-water", name: "Hot-water system checked or recorded", ready: Boolean(value("visit_hw_system")) },
      { step: "conditions", name: "Site hazards and access assessed", ready:
        Boolean(byId("visit_site_hazards_checked")?.checked) },
      { step: "roof", name: "Main roof measurements and orientation", ready:
        Boolean(value("visit_roof_length") && value("visit_roof_width") &&
          value("visit_roof_pitch") && value("visit_roof_orientation")) },
      { step: "locations", name: "Inverter location and cable route", ready:
        Boolean(value("visit_inverter_location") && value("visit_cable_route")) }
    ];
    if (value("visit_battery_model") || value("visit_battery_kwh")) {
      result.push({ step: "locations", name: "Possible battery location", ready:
        Boolean(value("visit_battery_location")) });
    }
    return result;
  }

  function photoCounts() {
    const inputs = Array.from(document.querySelectorAll("#siteVisitSection .site-photo-input"));
    return {
      saved: inputs.filter(input => Boolean(input.closest(".site-photo-item")
        ?.querySelector(".site-photo-status a"))).length,
      total: inputs.length
    };
  }

  function renderChecklist() {
    const el = byId("siteGuideChecklist");
    if (!el) return;
    const items = checks();
    const complete = items.filter(x => x.ready).length;
    const intro = "<p><strong>" + complete + " of " + items.length +
      " core checks recorded.</strong> Missing items can be left for follow-up; they are not silently assumed complete.</p>";
    el.innerHTML = intro + items.map(item =>
      '<div class="site-guide-check"><span>' + (item.ready ? "✓ " : "○ ") +
      escape(item.name) + (item.ready ? " · recorded" : " · needs checking") +
      '</span><button type="button" class="secondary" data-site-jump="' +
      item.step + '">' + (item.ready ? "VIEW" : "CHECK") + "</button></div>").join("");
    const pics = photoCounts();
    const box = byId("siteGuidePhotoCount");
    if (box) box.textContent = pics.saved + " of " + pics.total +
      " photo locations have a saved image. These are onsite evidence suggestions, not installation-completion certificates. Missing images can be added beside each question.";
  }

  function renderDesignHandoff() {
    const target = byId("designSiteHandoffSummary");
    if (!target) return;
    const rows = [
      ["Electrical connection", value("visit_connection_type").replace(/_/g, " ")],
      ["ICP observed", value("visit_icp")],
      ["Roof", [
        value("visit_roof_length") && value("visit_roof_width")
          ? value("visit_roof_length") + " × " + value("visit_roof_width") + " m" : "",
        value("visit_roof_pitch") ? value("visit_roof_pitch") + "°" : "",
        value("visit_roof_orientation")
      ].filter(Boolean).join(" · ")],
      ["Switchboard", value("visit_switchboard").replace(/_/g, " ")],
      ["Hot-water system", value("visit_hw_system").replace(/_/g, " ")],
      ["Inverter location", value("visit_inverter_location")],
      ["Battery location", value("visit_battery_location")],
      ["Cable route", value("visit_cable_route")],
      ["Site equipment discussed", [
        value("visit_panel_count") ? value("visit_panel_count") + " panels" : "",
        value("visit_panel_wattage") ? value("visit_panel_wattage") + " W" : "",
        value("visit_inverter_model"),
        value("visit_battery_model")
      ].filter(Boolean).join(" · ")]
    ].filter(([, v]) => Boolean(v));
    const reviewed = Boolean(byId("design_reviewed")?.checked);
    target.innerHTML = (rows.length
      ? "<ul>" + rows.map(([label, v]) =>
        "<li><strong>" + escape(label) + ":</strong> " + textOr(v) + "</li>").join("") + "</ul>"
      : "<p>No site observations recorded yet. Open Tom's Site Visit to record them.</p>") +
      "<p><strong>" + (reviewed
        ? "System Design is marked reviewed: site values cannot overwrite it."
        : "System Design is still unreviewed: only empty fields may receive site values.") +
      "</strong> Confirm technical details and any discrepancies with Ben before approving.</p>";
  }

  function refresh() {
    if (!byId("siteVisitSection")) return;
    if (active === "review") renderChecklist();
    renderDesignHandoff();
  }

  function markDirty(event) {
    if (!event.target?.closest?.("#siteVisitSection") ||
      event.target.matches?.(".site-photo-input") ||
      event.target.tagName === "BUTTON") return;
    dirty = true;
    changeVersion++;
    if (byId("siteGuidePosition")) byId("siteGuidePosition").textContent =
      "Step " + (steps.indexOf(active) + 1) + " of " + steps.length + " · Changes pending";
    refresh();
  }

  function photoStarted() { photoUploads++; }
  function photoFinished() {
    photoUploads = Math.max(0, photoUploads - 1);
    refresh();
  }
  function saveStarted() { saving = true; return changeVersion; }
  function saveFinished(version, ok) {
    saving = false;
    if (ok && version === changeVersion) dirty = false;
    if (byId("siteGuidePosition")) byId("siteGuidePosition").textContent =
      "Step " + (steps.indexOf(active) + 1) + " of " + steps.length + " · " +
      (dirty ? "Changes pending" : ok ? "Saved" : "Save not confirmed");
  }

  function init() {
    if (started || !byId("siteVisitSection")) return;
    started = true;
    document.querySelectorAll("#siteVisitSection [data-site-step-tab]").forEach(btn =>
      btn.addEventListener("click", () => open(btn.dataset.siteStepTab)));
    byId("siteGuidePrevious")?.addEventListener("click", () =>
      open(steps[Math.max(0, steps.indexOf(active) - 1)]));
    byId("siteGuideNext")?.addEventListener("click", () =>
      open(steps[Math.min(steps.length - 1, steps.indexOf(active) + 1)]));
    byId("siteGuideChecklist")?.addEventListener("click", event => {
      const button = event.target.closest("[data-site-jump]");
      if (button) open(button.dataset.siteJump);
    });
    byId("goToSystemDesignFromVisit")?.addEventListener("click", () => {
      // The handoff should describe the saved survey, not unsaved edits or
      // photographs still in flight. Keep the user in Site Visit for retry.
      if (dirty || saving || photoUploads) {
        const message = byId("siteVisitMessage");
        if (message) message.textContent =
          "Please finish saving the Site Visit and any photographs before opening System Design.";
        return;
      }
      // Existing navigation function owns job-section visibility.
      if (typeof selectJobWorkspace === "function") selectJobWorkspace("design");
      refresh();
    });
    byId("designReturnToSiteVisit")?.addEventListener("click", () => {
      if (typeof selectJobWorkspace === "function") selectJobWorkspace("visit");
    });
    byId("designOpenSiteReview")?.addEventListener("click", () => {
      if (typeof selectJobWorkspace === "function") selectJobWorkspace("visit");
      open("review", false);
    });
    document.addEventListener("input", markDirty);
    document.addEventListener("change", markDirty);
    window.addEventListener("beforeunload", event => {
      if (!dirty && !saving && !photoUploads) return;
      event.preventDefault();
      event.returnValue = "";
    });
    let savedStep = "";
    try { savedStep = sessionStorage.getItem(stepKey()) || ""; } catch (_) { /* okay */ }
    open(steps.includes(savedStep) ? savedStep : "supply", false);
    refresh();
  }

  window.jobhubSiteGuide = { init, open, refresh, checks, saveStarted, saveFinished, photoStarted, photoFinished };
})();
