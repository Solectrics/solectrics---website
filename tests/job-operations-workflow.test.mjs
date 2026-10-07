import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAftercareTasks,
  installationReadiness,
  recordDepositReceived
} from "../functions/api/job-operations-core.js";

function fakeDb() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              statements.push({ sql, values });
              return { success: true };
            }
          };
        }
      };
    }
  };
}

test("deposit receipt creates idempotent equipment order and supplier payment tasks due immediately", async () => {
  const db = fakeDb();
  await recordDepositReceived(db, 17, 5000, "2026-10-07");
  const taskInserts = db.statements.filter(row => row.sql.includes("INSERT OR IGNORE INTO job_tasks"));
  assert.equal(taskInserts.length, 2);
  assert.deepEqual(taskInserts.map(row => row.values[1]), ["order-equipment", "pay-equipment"]);
  assert.deepEqual(taskInserts.map(row => row.values[5]), ["2026-10-07", "2026-10-07"]);
  assert.ok(taskInserts.every(row => row.values[11] === 1), "both purchasing actions require evidence");
  assert.ok(db.statements.some(row => row.sql.includes("deposit_status = 'received'") && row.values[0] === 5000));
});

test("handover creates two linked aftercare checks at 14 and 30 days", async () => {
  const db = fakeDb();
  await generateAftercareTasks(db, 17, "2026-10-01");
  const rows = db.statements.filter(row => row.sql.includes("INSERT OR IGNORE INTO job_tasks"));
  assert.deepEqual(rows.map(row => [row.values[1], row.values[5], row.values[13], row.values[14]]), [
    ["aftercare-2-week", "2026-10-15", "handover", 14],
    ["aftercare-1-month", "2026-10-31", "handover", 30]
  ]);
});

test("install readiness distinguishes blockers and passes only when required dependencies are confirmed", () => {
  const readyJob = {
    install_date: "2026-11-10",
    finance_approval_required: 1,
    finance_status: "approved",
    deposit_required: 1,
    deposit_status: "received",
    equipment_order_reference: "ORD-42",
    equipment_invoice_reference: "INV-42",
    equipment_amount_paid: 2200,
    equipment_paid_at: "2026-10-20",
    materials_status: "received",
    final_site_verified_at: "2026-10-25",
    final_design_confirmed_at: "2026-10-26",
    vector_dg_status: "approved",
    retailer_export_status: "sent_to_retailer",
    scaffolding_required: "yes",
    scaffold_booked_at: "2026-11-05",
    installation_team_confirmed_at: "2026-10-30"
  };
  assert.deepEqual(installationReadiness(readyJob), { ready: true, blockers: [] });
  const notReady = installationReadiness({ ...readyJob, finance_status: "awaiting_documents", scaffold_booked_at: null });
  assert.equal(notReady.ready, false);
  assert.ok(notReady.blockers.includes("Required finance approval is not confirmed"));
  assert.ok(notReady.blockers.includes("Required scaffolding is not booked"));
});
