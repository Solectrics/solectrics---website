// Shared job/task records only. This module never sends email or calls third parties.
import { syncJobNextAction } from './job-operations-core.js';

export const HANDOVER_ITEMS = ['documents', 'operation', 'monitoring', 'support'];
export const AFTERCARE_KEYS = ['aftercare-2-week', 'aftercare-1-month'];

export async function handoverSchemaReady(db) {
  const jobs = (await db.prepare('PRAGMA table_info(jobs)').all()).results || [];
  const tasks = (await db.prepare('PRAGMA table_info(job_tasks)').all()).results || [];
  return ['handover_checklist_json','handover_notes'].every(name=>jobs.some(c=>c.name===name)) &&
    ['contact_date','contact_notes','outstanding_issues'].every(name=>tasks.some(c=>c.name===name));
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function nzToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function aftercareDates(date) {
  if (!validDate(date)) throw new Error('A valid actual handover date is required.');
  const source = new Date(`${date}T12:00:00Z`);
  const fortnight = new Date(source);
  fortnight.setUTCDate(fortnight.getUTCDate() + 14);
  const month = new Date(source);
  month.setUTCDate(1);
  month.setUTCMonth(month.getUTCMonth() + 1);
  const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  month.setUTCDate(Math.min(source.getUTCDate(), last));
  return [fortnight.toISOString().slice(0, 10), month.toISOString().slice(0, 10)];
}

export function handoverInput(body) {
  const checklist = Object.fromEntries(HANDOVER_ITEMS.map(key => [key, body.checklist?.[key] === true]));
  const date = validDate(body.completed_date);
  if (!date || date > nzToday()) throw new Error('Enter the actual handover date, not a future date.');
  if (!HANDOVER_ITEMS.every(key => checklist[key])) throw new Error('Complete the handover checklist before recording handover.');
  return { date, checklist, notes: String(body.notes ?? '').trim().slice(0, 4000) };
}

export async function saveHandover(db, jobId, body) {
  const input = handoverInput(body);
  const current = await db.prepare('SELECT job_type, handover_completed_at FROM jobs WHERE id = ?').bind(jobId).first();
  if (!current || current.job_type !== 'solar') throw new Error('Handover is available for solar jobs only.');
  const changed = current.handover_completed_at && current.handover_completed_at !== input.date;
  if (changed && body.confirm_date_change !== true) throw new Error('Confirm the date correction: open follow-up dates will move; completed records will stay unchanged.');
  const dates = aftercareDates(input.date);
  const actor = String(body.actor || 'Job Hub user').slice(0, 120);
  const statements = [
    db.prepare('UPDATE jobs SET handover_completed_at = ?, handover_checklist_json = ?, handover_notes = ? WHERE id = ?').bind(input.date, JSON.stringify(input.checklist), input.notes, jobId),
    db.prepare("UPDATE job_tasks SET status='completed', completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP), completed_by=COALESCE(completed_by,?), updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND task_key='customer-handover' AND status='open'").bind(actor, jobId)
  ];
  for (let i = 0; i < AFTERCARE_KEYS.length; i++) {
    const key = AFTERCARE_KEYS[i];
    const title = i === 0 ? 'Two-week customer check-in' : 'One-month performance and customer review';
    statements.push(db.prepare(`INSERT OR IGNORE INTO job_tasks
      (job_id,task_key,title,stage,category,due_date,assigned_to,status,event_kind,source,date_anchor,anchor_offset_days)
      VALUES (?,?,?,'Aftercare','aftercare',?,'Jane','open','milestone','handover','handover',?)`).bind(jobId,key,title,dates[i],i === 0 ? 14 : null));
    // Same-date saves must preserve manual scheduling and all completed history.
    if (changed) statements.push(db.prepare("UPDATE job_tasks SET due_date=?, anchor_offset_days=?, date_review_required=0, updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND task_key=? AND status='open'").bind(dates[i],i === 0 ? 14 : null,jobId,key));
    // Correct only untouched legacy 30-day dates; preserve manually moved dates.
    if (!changed && i === 1) statements.push(db.prepare("UPDATE job_tasks SET due_date=?, anchor_offset_days=NULL, updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND task_key=? AND status='open' AND date_anchor='handover' AND anchor_offset_days=30 AND due_date=date(?, '+30 days')").bind(dates[i],jobId,key,input.date));
  }
  await db.batch(statements);
  await syncJobNextAction(db, jobId);
  return { handover_date: input.date, followup_dates: dates };
}
