function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function parse(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return Response.json({ ok:false, error:"D1 database binding DB is not available" }, {status:500});
  try {
    const jobId = Number(new URL(context.request.url).searchParams.get("job_id"));
    if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ok:false,error:"job_id is required"},{status:400});
    const job = await db.prepare(`SELECT j.id, j.job_status, j.next_action, j.job_type, j.quote_amount,
      j.supplier_reference, e.customer_name, e.address, e.email
      FROM jobs j JOIN enquiries e ON e.id=j.enquiry_id WHERE j.id=?`).bind(jobId).first();
    if (!job) return Response.json({ok:false,error:"Job not found"},{status:404});

    const quote = await db.prepare(`SELECT id, version_number, status, snapshot_json, created_at
      FROM customer_quote_versions WHERE job_id=? ORDER BY version_number DESC LIMIT 1`).bind(jobId).first();
    const invoice = await db.prepare(`SELECT id, version_number, status, snapshot_json, created_at, issued_at, paid_at
      FROM customer_invoice_versions WHERE job_id=? ORDER BY version_number DESC LIMIT 1`).bind(jobId).first();
    const materials = await db.prepare(`SELECT COALESCE(SUM(quantity*unit_cost_ex_gst),0) total,
      COALESCE(SUM(CASE WHEN billable_to_customer=1 THEN quantity*unit_cost_ex_gst ELSE 0 END),0) billable
      FROM job_materials WHERE job_id=?`).bind(jobId).first();
    const costing = await db.prepare(`SELECT category,
      COALESCE(SUM(quantity*unit_cost),0) cost,
      COALESCE(SUM(quantity*customer_unit_price),0) charge
      FROM costing_lines WHERE job_id=? GROUP BY category`).bind(jobId).all();
    const work = await db.prepare(`SELECT COALESCE(SUM(hours),0) hours, COALESCE(SUM(days),0) days
      FROM job_work_logs WHERE job_id=?`).bind(jobId).first();

    let book=null, transactions=[], payments=[];
    try {
      book = await db.prepare(`SELECT b.id,b.name,b.legal_name,b.currency,b.gst_registered,b.gst_basis,b.business_id
        FROM bookkeeping_job_books jb JOIN bookkeeping_books b ON b.id=jb.book_id
        WHERE jb.job_id=? LIMIT 1`).bind(jobId).first();
      if (book) {
        const tx=await db.prepare(`SELECT id,kind,transaction_date,reference_number,contact_name,description,status,
          reconciliation_status,ex_gst_amount,gst_amount,total_incl_gst,source_type,source_id
          FROM bookkeeping_transactions WHERE book_id=? AND job_id=? ORDER BY transaction_date,created_at`)
          .bind(book.id,jobId).all();
        transactions=tx.results||[];
        const p=await db.prepare(`SELECT p.id,p.amount,p.allocated_at,t.reference_number,t.transaction_date
          FROM bookkeeping_payment_allocations p
          JOIN bookkeeping_transactions t ON t.id=p.payment_transaction_id
          WHERE p.book_id=? AND (t.job_id=? OR p.invoice_transaction_id IN
            (SELECT id FROM bookkeeping_transactions WHERE book_id=? AND job_id=?)) ORDER BY p.allocated_at`)
          .bind(book.id,jobId,book.id,jobId).all();
        payments=p.results||[];
      }
    } catch (error) {
      if (!/no such table|no such column/i.test(String(error?.message||error))) throw error;
    }

    const quoteSnap=parse(quote?.snapshot_json);
    const invoiceSnap=parse(invoice?.snapshot_json);
    const costRows=costing.results||[];
    const quotedDirectCost=money(costRows.reduce((s,r)=>s+Number(r.cost||0),0));
    const actualMaterials=money(materials?.total||0);
    const accountingExpenses=money(transactions.filter(t=>["supplier_bill","expense"].includes(t.kind))
      .reduce((s,t)=>s+Math.abs(Number(t.ex_gst_amount||0)),0));
    const revenueEx=money(transactions.filter(t=>t.kind==="sales_invoice")
      .reduce((s,t)=>s+Number(t.ex_gst_amount||0),0));
    const operationalInvoiceEx=money(invoiceSnap?.totals?.subtotal_ex_gst||0);
    const recognizedRevenue=revenueEx || operationalInvoiceEx;
    const knownDirectCost=Math.max(actualMaterials, accountingExpenses, quotedDirectCost);
    const profit=money(recognizedRevenue-knownDirectCost);

    return Response.json({ok:true,job,
      quote:quote?{id:quote.id,version:quote.version_number,status:quote.status,total_incl_gst:money(quoteSnap?.totals?.total_incl_gst||0)}:null,
      materials:{actual_ex_gst:actualMaterials,billable_ex_gst:money(materials?.billable||0)},
      labour:{work_log_hours:Number(work?.hours||0),work_log_days:Number(work?.days||0),
        costing:costRows.filter(r=>r.category==="labour"||r.category==="subcontractor")},
      customer_invoice:invoice?{id:invoice.id,version:invoice.version_number,status:invoice.status,
        invoice_number:invoiceSnap?.invoice_number||"",subtotal_ex_gst:operationalInvoiceEx,
        gst:money(invoiceSnap?.totals?.gst||0),total_incl_gst:money(invoiceSnap?.totals?.total_incl_gst||0)}:null,
      accounting:{book,transactions,payments},
      profitability:{revenue_ex_gst:recognizedRevenue,known_direct_cost_ex_gst:knownDirectCost,
        indicative_profit_ex_gst:profit,method:"Demo indicator only: uses the best available operational/accounting values and is not a year-end accounting profit."}
    });
  } catch(error) {
    console.error("Accountant demo GET error:",error);
    return Response.json({ok:false,error:"Unable to build accountant demo view"},{status:500});
  }
}
