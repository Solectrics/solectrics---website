export function normalizeInvoiceIdentity(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function supplierInvoiceDuplicate(existing, invoice) {
  const sameBook = existing.book_id == null || invoice.book_id == null || existing.book_id === invoice.book_id;
  if (!sameBook) return false;
  const hashMatch = Boolean(invoice.content_sha256 && existing.content_sha256 === invoice.content_sha256);
  const supplierKey = value => normalizeInvoiceIdentity(value).replace(/LIMITED$/, "LTD");
  const invoiceMatch = Boolean(
    supplierKey(existing.supplier_name) &&
    normalizeInvoiceIdentity(existing.supplier_invoice_number) &&
    supplierKey(existing.supplier_name) === supplierKey(invoice.supplier_name) &&
    normalizeInvoiceIdentity(existing.supplier_invoice_number) === normalizeInvoiceIdentity(invoice.supplier_invoice_number)
  );
  return hashMatch || invoiceMatch;
}

export function rankSupplierJobSuggestions(jobs, purchaseOrderReference) {
  const reference = normalizeInvoiceIdentity(purchaseOrderReference);
  if (!reference) return [];
  return (jobs || []).map(job => {
    const customer = normalizeInvoiceIdentity(job.customer_name);
    const enquiry = normalizeInvoiceIdentity(job.enquiry_ref);
    const supplierReference = normalizeInvoiceIdentity(job.supplier_reference);
    const exactJob = Boolean(supplierReference && reference === supplierReference) || reference === String(job.job_id) || reference === `JOB${job.job_id}` || (enquiry && reference === enquiry);
    const customerHit = Boolean(customer && (customer.includes(reference) || reference.includes(customer)));
    const score = exactJob ? 100 : customerHit ? (customer === reference ? 85 : 65) : 0;
    return {
      job_id: job.job_id,
      job_status: job.job_status,
      customer_name: job.customer_name,
      address: job.address,
      score,
      reason: supplierReference && reference === supplierReference ? "Exact supplier reference" : exactJob ? "Exact job/enquiry reference" : customerHit ? "Purchase order reference resembles customer name" : ""
    };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || b.job_id - a.job_id).slice(0, 5);
}

export function supplierInvoiceAmountsReconcile(subtotalExGst, gst, totalInclGst, allowableInputGst = gst) {
  const values = [subtotalExGst, gst, totalInclGst, allowableInputGst].map(Number);
  if (!values.every(Number.isFinite) || values.some(value => value < 0)) return false;
  const [subtotal, tax, total, allowable] = values;
  return Math.abs(subtotal + tax - total) < 0.005 && allowable <= tax + 0.005;
}
