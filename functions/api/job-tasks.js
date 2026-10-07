import { insertTask, seedAcceptedQuoteTasks, generateAftercareTasks, generatePostInstallTasks, recordDepositReceived, recordVectorDocumentReceived, installationReadiness } from "./job-operations-core.js";

const ASSIGNEES = new Set(["Jane", "Tom", "Ben", "External", "Unassigned"]);
const TASK_STATUSES = new Set(["open", "completed", "cancelled"]);
const WORKFLOW_FIELDS = {
  finance_type: ["unknown", "customer_funded", "green_loan", "other_finance", "westpac", "asb", "anz", "bnz", "kiwibank"],
  finance_provider: "text",
  finance_status: ["not_applicable", "not_required", "customer_investigating", "application_submitted", "approved", "declined", "awaiting_documents"],
  finance_approval_required: "boolean",
  deposit_status: ["not_requested", "awaiting", "received", "not_required"],
  deposit_required: "number",
  deposit_received: "number",
  materials_received_at: "date",
  materials_status: ["not_ordered", "ordered", "paid", "in_transit", "received", "part_received", "issue"],
  equipment_order_reference: "text",
  equipment_supplier: "text",
  equipment_invoice_reference: "text",
  equipment_amount_paid: "number",
  equipment_paid_at: "date",
  equipment_expected_delivery_date: "date",
  final_site_verified_at: "date",
  final_design_confirmed_at: "date",
  installation_team_confirmed_at: "date",
  scaffolding_required: ["yes", "no", "to_be_confirmed"],
  scaffold_provider: "text",
  scaffold_quote_cost: "number",
  scaffold_arranged_by: "text",
  scaffold_booked_at: "date",
  scaffold_erection_date: "date",
  scaffold_removal_date: "date",
  site_access_notes: "text",
  vector_dg_status: ["not_started", "submitted", "information_required", "approved", "not_required"],
  retailer_export_status: ["not_contacted", "contacted", "awaiting_vector", "vector_document_received", "sent_to_retailer", "processing", "complete", "not_required"],
  retailer_requirements: "text",
  retailer: "text",
  retailer_plan: "text",
  icp: "text",
  meter_status: "text",
  export_confirmed: "boolean",
  supervision_status: "text",
  supervisor_approval_status: "text",
  inspection_status: "text",
  coc_status: "text",
  final_payment_status: ["not_due", "issued", "outstanding", "paid"],
  install_status: ["not_scheduled", "scheduled", "in_progress", "completed"],
  handover_completed_at: "date"
};

function jsonError(error, status = 500) {
  return Response.json({ ok: false, error }, { status });
}
function clean(value, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function isoDate(value) {
  const valueText = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : null;
}
function dateOffset(date, days) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + Number(days || 0));
  return result.toISOString().slice(0, 10);
}
async function jobExists(db, jobId) {
  return db.prepare("SELECT id, job_type, install_date, install_status FROM jobs WHERE id = ?").bind(jobId).first();
}
async function settings(db) {
  const { results = [] } = await db.prepare("SELECT setting_key, days_before_install FROM job_workflow_settings").all();
  return Object.fromEntries(results.map(row => [row.setting_key, Number(row.days_before_install)]));
}
async function seedScheduledTasks(db, jobId, installDate) {
  const cfg = await settings(db);
  const tasks = [
    { task_key: "vector-before-install", title: "Check Vector / DG application status", stage: "Vector / DG", category: "external", due_date: dateOffset(installDate, -cfg.vector_check), assigned_to: "Jane", date_anchor: "installation", anchor_offset_days: -cfg.vector_check },
    { task_key: "retailer-before-install", title: "Contact retailer about meter, export and tariff requirements", stage: "Retailer", category: "external", due_date: dateOffset(installDate, -cfg.retailer_contact), assigned_to: "Jane", date_anchor: "installation", anchor_offset_days: -cfg.retailer_contact },
    { task_key: "scaffold-before-install", title: "Confirm scaffolding and site access are arranged", stage: "Access", category: "site", due_date: dateOffset(installDate, -cfg.scaffold_check), assigned_to: "Jane", date_anchor: "installation", anchor_offset_days: -cfg.scaffold_check },
    { task_key: "equipment-before-install", title: "Confirm equipment is paid for and delivery is available", stage: "Equipment", category: "supplier", due_date: dateOffset(installDate, -cfg.equipment_delivery), assigned_to: "Tom", date_anchor: "installation", anchor_offset_days: -cfg.equipment_delivery },
    { task_key: "final-readiness", title: "Complete final Ready to Install check", stage: "Readiness", category: "readiness", due_date: dateOffset(installDate, -cfg.final_readiness), assigned_to: "Jane", date_anchor: "installation", anchor_offset_days: -cfg.final_readiness },
    { task_key: "solar-installation", title: "Solar installation", stage: "Installation", category: "installation", due_date: installDate, assigned_to: "Tom", priority: "high", event_kind: "milestone", date_anchor: "installation", anchor_offset_days: 0 },
    { task_key: "customer-handover", title: "Complete customer handover", stage: "Handover", category: "customer", due_date: installDate, assigned_to: "Jane", event_kind: "milestone", date_anchor: "installation", anchor_offset_days: 0 }
  ];
  for (const task of tasks) await insertTask(db, { ...task, job_id: jobId });
}
async function tasksForJob(db, jobId) {
  const { results = [] } = await db.prepare("SELECT id, title, due_date, anchor_offset_days FROM job_tasks WHERE job_id = ? AND status = 'open' AND date_anchor = 'installation'").bind(jobId).all();
  return results;
}
function parseTaskIds(value) {
  return Array.isArray(value) ? value.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return jsonError("D1 database binding DB is not available");
    const url = new URL(context.request.url);
    const jobId = Number(url.searchParams.get("job_id") || 0);
    const includeCompleted = url.searchParams.get("include_completed") === "1";
    let taskSql = `
      SELECT t.*, j.install_date, j.job_type, j.job_status, j.next_action,
        j.finance_type, j.finance_status, j.finance_approval_required, j.deposit_status,
        j.deposit_required, j.deposit_received, j.deposit_received_at, j.materials_status, j.materials_received_at,
        j.equipment_supplier, j.equipment_order_reference, j.equipment_amount_paid,
        j.equipment_paid_at, j.equipment_expected_delivery_date, j.vector_dg_status,
        j.retailer_export_status, j.retailer, j.retailer_plan, j.scaffolding_required,
        j.scaffold_provider, j.scaffold_booked_at, j.final_site_verified_at,
        j.final_design_confirmed_at, j.installation_team_confirmed_at, j.install_status,
        j.supervision_status, j.inspection_status, j.coc_status, j.final_payment_status,
        j.handover_completed_at, j.job_closed_at, e.customer_name, e.address, e.email
      FROM job_tasks t JOIN jobs j ON j.id = t.job_id
      JOIN enquiries e ON e.id = j.enquiry_id
    `;
    const conditions = ["t.status != 'cancelled'"];
    const params = [];
    if (jobId) { conditions.push("t.job_id = ?"); params.push(jobId); }
    if (!includeCompleted) conditions.push("t.status != 'completed'");
    if (conditions.length) taskSql += " WHERE " + conditions.join(" AND ");
    taskSql += " ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.is_blocker DESC, t.id";
    const taskResult = await db.prepare(taskSql).bind(...params).all();

    const jobsResult = await db.prepare(`
      SELECT j.id AS job_id, j.job_type, j.job_status, j.install_date,
        j.system_size_kw, j.inverter, j.battery, j.finance_type, j.finance_status,
        j.finance_approval_required, j.deposit_status, j.deposit_required, j.deposit_received,
        j.materials_status, j.materials_received_at, j.equipment_supplier, j.equipment_order_reference, j.equipment_amount_paid,
        j.equipment_paid_at, j.equipment_expected_delivery_date, j.vector_dg_status,
        j.retailer_export_status, j.retailer, j.retailer_plan, j.scaffolding_required,
        j.scaffold_provider, j.scaffold_booked_at, j.final_site_verified_at, j.final_design_confirmed_at,
        j.installation_team_confirmed_at, j.install_status, j.supervision_status, j.supervisor_approval_status,
        j.inspection_status, j.coc_status, j.final_payment_status, j.handover_completed_at, j.job_closed_at,
        e.customer_name, e.address
      FROM jobs j JOIN enquiries e ON e.id = j.enquiry_id
      ORDER BY j.install_date, j.id DESC
    `).all();
    const settingsResult = await db.prepare("SELECT setting_key, days_before_install FROM job_workflow_settings").all();
    const scopeResult = await db.prepare(`
      SELECT s.*, e.customer_name FROM job_scope_items s
      JOIN jobs j ON j.id = s.job_id JOIN enquiries e ON e.id = j.enquiry_id
      ${jobId ? "WHERE s.job_id = ?" : ""}
      ORDER BY s.job_id, s.id
    `).bind(...(jobId ? [jobId] : [])).all();

    return Response.json({
      ok: true,
      tasks: taskResult.results || [],
      jobs: (jobsResult.results || []).filter(job => !jobId || Number(job.job_id) === jobId),
      scope_items: scopeResult.results || [],
      settings: Object.fromEntries((settingsResult.results || []).map(row => [row.setting_key, Number(row.days_before_install)]))
    });
  } catch (error) {
    console.error("Operations tasks GET error:", error);
    return jsonError(error.message || "Unable to load operations tasks");
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return jsonError("D1 database binding DB is not available");
    const body = await context.request.json();
    const action = clean(body.action, 50);

    if (action === "update_settings") {
      const allowed = ["vector_check", "retailer_contact", "scaffold_check", "equipment_delivery", "final_readiness"];
      const entries = Object.entries(body.settings || {}).filter(([key, value]) => allowed.includes(key) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 180);
      for (const [key, value] of entries) {
        await db.prepare("UPDATE job_workflow_settings SET days_before_install = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?").bind(Number(value), key).run();
      }
      return Response.json({ ok: true, settings: await settings(db) });
    }

    const jobId = Number(body.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) return jsonError("A valid job_id is required", 400);
    const job = await jobExists(db, jobId);
    if (!job) return jsonError("Job not found", 404);

    if (action === "set_install_date") {
      const installDate = isoDate(body.install_date);
      if (!installDate) return jsonError("A valid installation date is required", 400);
      const openAnchored = await tasksForJob(db, jobId);
      const changed = Boolean(job.install_date && job.install_date !== installDate);
      if (changed && openAnchored.length && body.confirm_reschedule !== true) {
        const cfg = await settings(db);
        return Response.json({
          ok: false, needs_confirmation: true,
          tasks: openAnchored.map(task => ({
            id: task.id, title: task.title, due_date: task.due_date,
            proposed_date: task.anchor_offset_days == null ? null : dateOffset(installDate, task.anchor_offset_days)
          })),
          settings: cfg
        }, { status: 409 });
      }
      await db.prepare("UPDATE jobs SET install_date = ?, install_status = 'scheduled', job_status = 'scheduled' WHERE id = ?").bind(installDate, jobId).run();
      if (changed && body.confirm_reschedule === true) {
        const moveIds = new Set(parseTaskIds(body.move_task_ids));
        for (const task of openAnchored) {
          if (moveIds.has(Number(task.id)) && task.anchor_offset_days != null) {
            await db.prepare("UPDATE job_tasks SET due_date = ?, date_review_required = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND job_id = ? AND status = 'open'").bind(dateOffset(installDate, task.anchor_offset_days), task.id, jobId).run();
          } else {
            await db.prepare("UPDATE job_tasks SET date_review_required = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND job_id = ? AND status = 'open'").bind(task.id, jobId).run();
          }
        }
      } else {
        await seedScheduledTasks(db, jobId, installDate);
      }
      return Response.json({ ok: true, install_date: installDate, reschedule_review_required: changed ? openAnchored.length - parseTaskIds(body.move_task_ids).length : 0 });
    }

    if (action === "create_task") {
      const title = clean(body.title, 240);
      if (!title) return jsonError("Task title is required", 400);
      await insertTask(db, {
        job_id: jobId, title, stage: clean(body.stage || "Operations", 80),
        category: clean(body.category || "task", 60), due_date: isoDate(body.due_date),
        assigned_to: ASSIGNEES.has(body.assigned_to) ? body.assigned_to : "Unassigned",
        is_blocker: body.is_blocker === true,
        blocker_reason: clean(body.blocker_reason, 500),
        priority: ["low", "normal", "high"].includes(body.priority) ? body.priority : "normal",
        event_kind: body.event_kind === "milestone" ? "milestone" : "task",
        requires_evidence: body.requires_evidence === true,
        source: "manual"
      });
      return Response.json({ ok: true });
    }

    if (action === "update_task") {
      const taskId = Number(body.task_id);
      if (!Number.isInteger(taskId) || taskId <= 0) return jsonError("A valid task_id is required", 400);
      const task = await db.prepare("SELECT * FROM job_tasks WHERE id = ? AND job_id = ?").bind(taskId, jobId).first();
      if (!task) return jsonError("Task not found", 404);
      const nextStatus = TASK_STATUSES.has(body.status) ? body.status : task.status;
      if (nextStatus === "completed" && task.task_key?.startsWith("final-invoice-payment-")) {
        const payment=await db.prepare("SELECT final_payment_status FROM jobs WHERE id=?").bind(jobId).first();
        if(payment?.final_payment_status!=="paid") return Response.json({ok:false,error:"Record the customer invoice as paid in the invoice section before completing this follow-up."},{status:409});
      }
      if (nextStatus === "completed" && task.task_key === "solar-installation") {
        const fullJob=await db.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first();
        const readiness=installationReadiness(fullJob||{});
        if(!readiness.ready) return Response.json({ok:false,error:"Installation readiness gate is not satisfied.",blockers:readiness.blockers},{status:409});
      }
      const actor = clean(body.actor, 120) || null;
      const evidenceNote = body.evidence_note === undefined ? task.evidence_note : clean(body.evidence_note, 2000);
      if (nextStatus === "completed" && task.requires_evidence && !evidenceNote) {
        return jsonError("Add the required evidence or document reference before completing this task.", 400);
      }
      const dueDate = body.due_date === undefined ? task.due_date : isoDate(body.due_date);
      const assigned = body.assigned_to === undefined ? task.assigned_to : (ASSIGNEES.has(body.assigned_to) ? body.assigned_to : "Unassigned");
      const isBlocker = body.is_blocker === undefined ? task.is_blocker : (body.is_blocker ? 1 : 0);
      const reason = body.blocker_reason === undefined ? task.blocker_reason : clean(body.blocker_reason, 500);
      const title = body.title === undefined ? task.title : clean(body.title, 240);
      const completionDate = nextStatus === "completed" ? new Date().toISOString() : null;
      const resolveDateReview = body.due_date === undefined ? 0 : 1;
      await db.prepare(`
        UPDATE job_tasks SET title = ?, due_date = ?, assigned_to = ?, status = ?,
          is_blocker = ?, blocker_reason = ?, evidence_note = ?,
          completed_at = ?, completed_by = ?, updated_at = CURRENT_TIMESTAMP,
          date_review_required = CASE WHEN ? = 1 OR ? IS NOT NULL THEN 0 ELSE date_review_required END
        WHERE id = ? AND job_id = ?
      `).bind(title, dueDate, assigned, nextStatus, isBlocker, reason, evidenceNote,
        completionDate, nextStatus === "completed" ? actor : null, resolveDateReview, completionDate, taskId, jobId).run();

      if (nextStatus === "completed" && task.task_key === "order-equipment") {
        const orderDate = new Date().toISOString().slice(0, 10);
        await db.prepare("UPDATE jobs SET materials_status = 'ordered', materials_ordered_at = ? WHERE id = ?").bind(orderDate, jobId).run();
      }
      if (nextStatus === "completed" && task.task_key === "solar-installation") {
        const completedDate=new Date().toISOString().slice(0,10);
        await db.prepare("UPDATE jobs SET install_status='completed', install_completed_at=COALESCE(install_completed_at, ?) WHERE id=?").bind(completedDate,jobId).run();
        await generatePostInstallTasks(db,jobId,completedDate);
      }
      if (nextStatus === "completed" && task.task_key === "send-vector-docs-to-retailer") {
        await db.prepare("UPDATE jobs SET retailer_export_status = 'sent_to_retailer', retailer_contacted_at = COALESCE(retailer_contacted_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(jobId).run();
      }
      if (nextStatus === "completed" && task.task_key === "pay-equipment") {
        const paidDate = new Date().toISOString().slice(0, 10);
        await db.prepare("UPDATE jobs SET materials_status = 'paid', equipment_paid_at = ? WHERE id = ?").bind(paidDate, jobId).run();
      }
      if (nextStatus === "completed" && task.task_key === "customer-handover") {
        const today = new Date().toISOString().slice(0, 10);
        await db.prepare("UPDATE jobs SET handover_completed_at = ? WHERE id = ?").bind(today, jobId).run();
        await generateAftercareTasks(db, jobId, today);
      }
      await db.prepare("UPDATE jobs SET next_action = (SELECT title FROM job_tasks WHERE job_id = ? AND status = 'open' ORDER BY is_blocker DESC, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id LIMIT 1), next_action_date = (SELECT due_date FROM job_tasks WHERE job_id = ? AND status = 'open' ORDER BY is_blocker DESC, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id LIMIT 1), assigned_to = (SELECT assigned_to FROM job_tasks WHERE job_id = ? AND status = 'open' ORDER BY is_blocker DESC, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id LIMIT 1) WHERE id = ?").bind(jobId,jobId,jobId,jobId).run();
      return Response.json({ ok: true });
    }

    if (action === "record_deposit") {
      const receivedDate = isoDate(body.received_date) || new Date().toISOString().slice(0, 10);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return jsonError("Enter the deposit received amount.", 400);
      await recordDepositReceived(db, jobId, amount, receivedDate);
      return Response.json({ ok: true, next_action_created: "order-and-pay-equipment" });
    }

    if (action === "vector_document_received") {
      await recordVectorDocumentReceived(db, jobId);
      return Response.json({ ok: true, next_action_created: "send-vector-docs-to-retailer" });
    }

    if (action === "add_scope_item") {
      const title = clean(body.title, 180);
      const key = clean(body.item_key, 80) || `scope-${crypto.randomUUID()}`;
      const category = clean(body.category || "other", 50);
      const decision = ["pending", "accepted", "deferred", "declined"].includes(body.decision) ? body.decision : "pending";
      if (!title) return jsonError("Scope item title is required", 400);
      await db.prepare(`
        INSERT OR IGNORE INTO job_scope_items (job_id,item_key,title,category,decision,details,costing_note)
        VALUES (?,?,?,?,?,?,?)
      `).bind(jobId,key,title,category,decision,clean(body.details,2000),clean(body.costing_note,1000)).run();
      const item=await db.prepare("SELECT id FROM job_scope_items WHERE job_id=? AND item_key=?").bind(jobId,key).first();
      if (decision === "accepted" && item) {
        await insertTask(db,{job_id:jobId,task_key:`scope-${item.id}`,title:`Include ${title} in design, costing and installation plan`,stage:"Customer decisions",category:"design",assigned_to:"Tom",source:"accepted_scope_item"});
      }
      return Response.json({ok:true,item_id:item?.id});
    }

    if (action === "update_scope_item") {
      const itemId=Number(body.item_id);
      if(!Number.isInteger(itemId)||itemId<=0) return jsonError("A valid item_id is required",400);
      const decision=["pending","accepted","deferred","declined"].includes(body.decision)?body.decision:null;
      const item=await db.prepare("SELECT * FROM job_scope_items WHERE id=? AND job_id=?").bind(itemId,jobId).first();
      if(!item)return jsonError("Scope item not found",404);
      await db.prepare("UPDATE job_scope_items SET decision=?,details=?,costing_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND job_id=?").bind(decision||item.decision,clean(body.details===undefined?item.details:body.details,2000),clean(body.costing_note===undefined?item.costing_note:body.costing_note,1000),itemId,jobId).run();
      if(decision==="accepted") await insertTask(db,{job_id:jobId,task_key:`scope-${item.id}`,title:`Include ${item.title} in design, costing and installation plan`,stage:"Customer decisions",category:"design",assigned_to:"Tom",source:"accepted_scope_item"});
      return Response.json({ok:true});
    }

    if (action === "update_job_stage") {
      const updates = [];
      const values = [];
      const currentJob = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first();
      const candidate = { ...currentJob };
      for (const [field, type] of Object.entries(WORKFLOW_FIELDS)) {
        if (body[field] === undefined) continue;
        let value = body[field];
        if (type === "boolean") value = value ? 1 : 0;
        else if (type === "number") { value = value === "" || value === null ? null : Number(value); if (value !== null && !Number.isFinite(value)) continue; }
        else if (type === "date") value = isoDate(value);
        else if (Array.isArray(type)) { if (!type.includes(value)) continue; }
        else value = clean(value, 1200) || null;
        updates.push(field + " = ?");
        values.push(value);
        candidate[field] = value;
      }
      if (!updates.length) return jsonError("No supported workflow fields were provided.", 400);
      if (["in_progress", "completed"].includes(candidate.install_status)) {
        const readiness = installationReadiness(candidate);
        if (!readiness.ready) return Response.json({ ok: false, error: "Installation readiness gate is not satisfied.", blockers: readiness.blockers }, { status: 409 });
      }
      values.push(jobId);
      await db.prepare(`UPDATE jobs SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
      return Response.json({ok:true});
    }

    if (action === "handover_complete") {
      const date = isoDate(body.completed_date) || new Date().toISOString().slice(0,10);
      await db.prepare("UPDATE jobs SET handover_completed_at = ? WHERE id = ?").bind(date,jobId).run();
      await db.prepare("UPDATE job_tasks SET status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND task_key='customer-handover' AND status='open'").bind(jobId).run();
      await generateAftercareTasks(db,jobId,date);
      return Response.json({ok:true});
    }
    if (action === "aftercare_issue") {
      const title=clean(body.title,200);
      if(!title)return jsonError("Describe the aftercare issue",400);
      const created=await insertTask(db,{job_id:jobId,title,stage:"Aftercare",category:"maintenance",due_date:isoDate(body.due_date)||new Date().toISOString().slice(0,10),assigned_to:ASSIGNEES.has(body.assigned_to)?body.assigned_to:"Jane",priority:"high",is_blocker:false,requires_evidence:Boolean(body.requires_evidence),source:"aftercare_issue"});
      return Response.json({ok:true});
    }

    if (action === "close_job") {
      const row=await db.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first();
      const taskRows=await db.prepare("SELECT COUNT(*) AS n FROM job_tasks WHERE job_id=? AND status='open' AND is_blocker=1").bind(jobId).first();
      const blockers=Number(taskRows?.n||0);
      const requiredTaskRows=await db.prepare("SELECT task_key FROM job_tasks WHERE job_id=? AND task_key IN ('post-install-compliance','post-install-commissioning','final-invoice-reconciliation') AND status!='completed'").bind(jobId).all();
      const requiredTasks=(requiredTaskRows.results||[]).map(task=>task.task_key);
      const failures=[];
      if(blockers) failures.push(`${blockers} open blocker task(s)`);
      if(requiredTasks.includes("post-install-compliance")) failures.push("compliance task is not complete with evidence");
      if(requiredTasks.includes("post-install-commissioning")) failures.push("commissioning task is not complete with evidence");
      if(requiredTasks.includes("final-invoice-reconciliation")) failures.push("final cost reconciliation task is not complete");
      if(row.final_payment_status!=="paid") failures.push("final invoice is not paid in full");
      if(!row.handover_completed_at) failures.push("customer handover is not complete");
      if(row.install_status!=="completed") failures.push("installation is not marked complete");
      if(!["issued","not_required","complete"].includes(row.coc_status)) failures.push("CoC is not issued or marked not required");
      if(!["approved","not_required","complete"].includes(row.supervisor_approval_status)) failures.push("supervisor verification is not complete");
      if(!["complete","not_required","approved"].includes(row.inspection_status)) failures.push("required inspection is not complete");
      if(failures.length)return Response.json({ok:false,error:"Job cannot be closed yet.",blockers:failures},{status:409});
      await db.prepare("UPDATE jobs SET job_closed_at = ?, job_status = 'completed' WHERE id = ?").bind(new Date().toISOString(),jobId).run();
      return Response.json({ok:true});
    }

    return jsonError("Unknown operations action", 400);
  } catch (error) {
    console.error("Operations tasks POST error:", error);
    return jsonError(error.message || "Unable to save operations task");
  }
}
