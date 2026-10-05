function normalized(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function referenceMatches(bank, candidate) {
  const reference = normalized(`${bank.reference || ""} ${bank.description || ""}`);
  const invoiceReference = normalized(candidate.reference_number);
  return invoiceReference.length >= 4 && reference.includes(invoiceReference);
}

function sameIdentity(bank, candidate) {
  const payee = normalized(bank.counterparty);
  const contact = normalized(candidate.contact_name);
  return Boolean(payee && contact && (payee === contact || payee.includes(contact) || contact.includes(payee)));
}

export function rankReconciliationCandidates(bank, candidates) {
  const expectedKind = bank.direction === "inflow" ? "sales_invoice" : "supplier_bill";
  return (candidates || []).filter(candidate => candidate.kind === expectedKind && Number(candidate.outstanding_amount) > 0)
    .map(candidate => {
      const exactReference = referenceMatches(bank, candidate);
      const exactAmount = Math.round(Number(bank.amount) * 100) === Math.round(Number(candidate.outstanding_amount) * 100);
      const exactIdentity = sameIdentity(bank, candidate);
      const partialAmount = Number(bank.amount) > 0 && Number(bank.amount) < Number(candidate.outstanding_amount);
      const score = (exactReference ? 60 : 0) + (exactAmount ? 40 : partialAmount ? 15 : 0) + (exactIdentity ? 25 : 0);
      return { ...candidate, score, exact_reference: exactReference, exact_amount: exactAmount, exact_identity: exactIdentity };
    })
    .sort((a, b) => b.score - a.score || String(a.transaction_date || "").localeCompare(String(b.transaction_date || "")));
}

export function decideReconciliationMatch(rankedCandidates) {
  const ranked = rankedCandidates || [];
  const top = ranked[0] || null;
  const next = ranked[1] || null;
  const auto = Boolean(top?.exact_reference && top?.exact_amount && (!next || top.score > next.score));
  return {
    action: auto ? "auto_match" : "needs_matching",
    candidate: top,
    confidence_score: top?.score || 0,
    reason: auto ? "Unique exact payment reference and exact outstanding amount" : "No unique exact reference-and-amount match; user review required"
  };
}

export function remainingBalance(total, allocations) {
  const paid = (allocations || []).reduce((sum, value) => sum + Number(value || 0), 0);
  return Math.round((Number(total || 0) - paid + Number.EPSILON) * 100) / 100;
}
