// Vector post-commissioning compliance: pure helpers, no production side effects.
export const VECTOR_REQUIRED_DOCUMENTS = Object.freeze([
  "certificate_of_compliance",
  "record_of_inspection",
  "inverter_nameplates"
]);
export const VECTOR_SETTINGS_WARNING = "Do not change generator or protection settings without Vector's prior written approval.";

export function isVectorNetwork(network) {
  return /^vector(?:\s|$)/i.test(String(network || "").trim());
}
export function addWorkingDays(dateString, days = 10, holidays = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ""))) return null;
  const date = new Date(dateString + "T12:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateString) return null;
  const excluded = new Set(holidays);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6 && !excluded.has(date.toISOString().slice(0, 10))) remaining--;
  }
  return date.toISOString().slice(0, 10);
}
export function vectorComplianceStatus(record, holidays = [], today = new Date().toISOString().slice(0, 10)) {
  if (!isVectorNetwork(record?.network)) return { applicable: false, state: "not_applicable" };
  const deadline = addWorkingDays(record?.commissioned_on, 10, holidays);
  const complete = Boolean(record?.coc_file_id && record?.roi_file_id &&
    Array.isArray(record?.inverters) && record.inverters.length > 0 &&
    record.inverters.every(i => i.nameplate_file_id && i.model && i.serial_number) &&
    record?.submitted_on && record?.submission_evidence);
  return { applicable: true, deadline, state: complete ? "submitted" :
    !deadline ? "awaiting_commissioning" : today > deadline ? "overdue" : "pending",
    complete };
}
