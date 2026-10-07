export async function syncJobNextAction(db, jobId) {
  await db.prepare(`
    UPDATE jobs SET
      next_action = (SELECT title FROM job_tasks WHERE job_id = ? AND status = 'open'
        ORDER BY is_blocker DESC, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id LIMIT 1),
      next_action_date = (SELECT due_date FROM job_tasks WHERE job_id = ? AND status = 'open'
        ORDER BY is_blocker DESC, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id LIMIT 1),
      assigned_to = (SELECT assigned_to FROM job_tasks WHERE job_id = ? AND status = 'open'
        ORDER BY is_blocker DESC, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id LIMIT 1)
    WHERE id = ?
  `).bind(jobId, jobId, jobId, jobId).run();
}

export async function insertTask(db, task) {
  await db.prepare(`
    INSERT OR IGNORE INTO job_tasks
      (job_id, task_key, title, stage, category, due_date, assigned_to, status,
       is_blocker, blocker_reason, priority, event_kind, requires_evidence,
       source, date_anchor, anchor_offset_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    task.job_id, task.task_key ?? null, task.title, task.stage || "Operations",
    task.category || "task", task.due_date || null, task.assigned_to || "Unassigned",
    task.is_blocker ? 1 : 0, task.blocker_reason || null, task.priority || "normal",
    task.event_kind || "task", task.requires_evidence ? 1 : 0, task.source || "manual",
    task.date_anchor || null, task.anchor_offset_days ?? null
  ).run();
  await syncJobNextAction(db, task.job_id);
}

export async function seedAcceptedQuoteTasks(db, jobId) {
  const job = await db.prepare("SELECT job_type FROM jobs WHERE id = ?").bind(jobId).first();
  if (!job || job.job_type !== "solar") return;
  const tasks = [
    ["customer-decisions", "Confirm final system and smart-energy decisions", "Customer decisions", "Jane"],
    ["final-site-verification", "Complete final site verification and confirm design", "Design", "Tom"],
    ["vector-application", "Submit or progress Vector / DG application", "Vector / DG", "Jane"],
    ["retailer-contact", "Contact retailer about pre-install meter and export requirements", "Retailer", "Jane"],
    ["finance-check", "Confirm finance requirement and approval status", "Finance", "Jane"],
    ["deposit-check", "Issue and track required deposit / materials invoice", "Deposit", "Jane"]
  ];
  for (const [key, title, stage, assigned_to] of tasks) {
    await insertTask(db, { job_id: jobId, task_key: key, title, stage, category: "workflow", assigned_to, source: "quote_accepted" });
  }
}

function offsetDate(date, days) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + Number(days || 0));
  return result.toISOString().slice(0, 10);
}

export async function generateAftercareTasks(db, jobId, handoverDate) {
  await insertTask(db, { job_id: jobId, task_key: "aftercare-2-week", title: "Two-week customer check-in", stage: "Aftercare", category: "aftercare", due_date: offsetDate(handoverDate, 14), assigned_to: "Jane", date_anchor: "handover", anchor_offset_days: 14, source: "handover" });
  await insertTask(db, { job_id: jobId, task_key: "aftercare-1-month", title: "One-month performance and customer review", stage: "Aftercare", category: "aftercare", due_date: offsetDate(handoverDate, 30), assigned_to: "Jane", date_anchor: "handover", anchor_offset_days: 30, source: "handover" });
}

export async function recordDepositReceived(db, jobId, amount, receivedDate) {
  await db.prepare("UPDATE jobs SET deposit_status = 'received', deposit_received = ?, deposit_received_at = ? WHERE id = ?").bind(amount, receivedDate, jobId).run();
  await insertTask(db, { job_id: jobId, task_key: "order-equipment", title: "Order equipment and record the supplier reference", stage: "Equipment", category: "supplier", due_date: receivedDate, assigned_to: "Tom", priority: "high", requires_evidence: true, source: "deposit_received" });
  await insertTask(db, { job_id: jobId, task_key: "pay-equipment", title: "Pay the equipment supplier and record the invoice amount", stage: "Equipment", category: "supplier", due_date: receivedDate, assigned_to: "Jane", priority: "high", requires_evidence: true, source: "deposit_received" });
}

export async function recordVectorDocumentReceived(db, jobId) {
  await db.prepare("UPDATE jobs SET vector_dg_status = 'approved', retailer_export_status = 'vector_document_received' WHERE id = ?").bind(jobId).run();
  await insertTask(db, { job_id: jobId, task_key: "send-vector-docs-to-retailer", title: "Send Vector documentation to retailer now", stage: "Retailer", category: "external", due_date: new Date().toISOString().slice(0, 10), assigned_to: "Jane", priority: "high", source: "vector_document_received" });
}

export function installationReadiness(job) {
  const blockers = [];
  if (!job.install_date) blockers.push("Installation date not set");
  if (Number(job.finance_approval_required) === 1 && job.finance_status !== "approved") blockers.push("Required finance approval is not confirmed");
  if (Number(job.deposit_required || 0) > 0 && job.deposit_status !== "received") blockers.push("Required deposit has not been received");
  if (!job.equipment_order_reference) blockers.push("Equipment order reference is missing");
  if (!job.equipment_invoice_reference) blockers.push("Supplier invoice reference is missing");
  if (!(Number(job.equipment_amount_paid) > 0) || !job.equipment_paid_at) blockers.push("Equipment has not been recorded as paid");
  if (job.materials_status !== "received") blockers.push("Equipment delivery is not confirmed as received");
  if (!job.final_site_verified_at) blockers.push("Final site verification is not recorded");
  if (!job.final_design_confirmed_at) blockers.push("Final design is not confirmed");
  if (!["approved", "not_required"].includes(job.vector_dg_status)) blockers.push("Vector / DG approval is not complete");
  if (!["contacted", "awaiting_vector", "vector_document_received", "sent_to_retailer", "processing", "complete", "not_required"].includes(job.retailer_export_status)) blockers.push("Retailer export/meter process has not started");
  if (job.scaffolding_required === "to_be_confirmed") blockers.push("Scaffolding requirement has not been decided");
  if (job.scaffolding_required === "yes" && !job.scaffold_booked_at) blockers.push("Required scaffolding is not booked");
  if (!job.installation_team_confirmed_at) blockers.push("Installation team/date is not confirmed");
  return { ready: blockers.length === 0, blockers };
}
