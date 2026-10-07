function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolvePropertyAddress(bills = [], currentAddress = "", manuallyEntered = false, previousExtracted = "") {
  const rows = (Array.isArray(bills) ? bills : []).filter(bill => bill && typeof bill === "object");
  const extracted = rows.map(bill => String(bill.property_address || "").trim()).filter(Boolean);
  const unique = new Map(extracted.map(address => [normalizeAddress(address), address]));
  const uncertain = rows.some(bill => (bill.needs_review_fields || []).includes("property_address"));
  const billConflict = unique.size > 1;
  const address = unique.size === 1 ? [...unique.values()][0] : "";
  const addressDiffersFromEntry = Boolean(address && String(currentAddress || "").trim() && manuallyEntered &&
    normalizeAddress(currentAddress) !== normalizeAddress(address));
  const conflicting = billConflict || addressDiffersFromEntry;
  const canUseExtracted = Boolean(address) && !conflicting && !manuallyEntered &&
    (!String(currentAddress || "").trim() || String(currentAddress).trim() === String(previousExtracted || "").trim());
  return { address, conflicting, billConflict, addressDiffersFromEntry, uncertain, canUseExtracted, hasExtractedAddress: extracted.length > 0 };
}
