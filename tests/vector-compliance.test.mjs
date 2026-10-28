import test from "node:test";
import assert from "node:assert/strict";
import {addWorkingDays, isVectorNetwork, vectorComplianceStatus} from "../assets/vector-compliance.mjs";

test("Vector applicability is network-specific", () => {
  assert.equal(isVectorNetwork("Vector"), true);
  assert.equal(isVectorNetwork("Other network"), false);
});
test("ten working days skip weekends and supplied holidays", () => {
  assert.equal(addWorkingDays("2026-10-29", 10), "2026-11-12");
  assert.equal(addWorkingDays("2026-10-29", 10, ["2026-11-02"]), "2026-11-13");
});
test("submission requires certificates and each inverter nameplate", () => {
  const base = {network:"Vector", commissioned_on:"2026-10-29", coc_file_id:"1", roi_file_id:"2", inverters:[{nameplate_file_id:"3", model:"ABC", serial_number:"123"}], submitted_on:"2026-11-01", submission_evidence:"receipt"};
  assert.equal(vectorComplianceStatus(base, [], "2026-11-03").state, "submitted");
  assert.equal(vectorComplianceStatus({...base, submission_evidence:""}, [], "2026-11-13").state, "overdue");
  assert.equal(vectorComplianceStatus({...base, network:"Other"}, [], "2026-11-13").state, "not_applicable");
});
