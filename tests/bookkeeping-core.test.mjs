import test from "node:test";
import assert from "node:assert/strict";
import { calculateBalanceSheet, calculateProfitAndLoss, calculateTaxReserve, calculateTrialBalance, toMappedCsv, validateJournalLines } from "../functions/api/bookkeeping-core.js";

test("journal validation enforces balanced, single-sided lines", () => {
  assert.deepEqual(validateJournalLines([
    { account_id: "cash", debit: 115 },
    { account_id: "income", credit: 100 },
    { account_id: "gst", credit: 15 }
  ]), { ok: true, debits: 115, credits: 115 });
  assert.equal(validateJournalLines([{ account_id: "cash", debit: 2 }]).ok, false);
  assert.equal(validateJournalLines([{ account_id: "cash", debit: 2, credit: 2 }, { account_id: "x", credit: 2 }]).ok, false);
});

test("trial balance, profit and loss and balance sheet reconcile from posted ledger lines", () => {
  const accounts = [
    { id: "cash", code: "100", name: "Cash", account_type: "asset" },
    { id: "gst", code: "220", name: "GST payable", account_type: "liability" },
    { id: "income", code: "400", name: "Sales", account_type: "income" },
    { id: "cost", code: "500", name: "Materials", account_type: "expense" }
  ];
  const lines = [
    { account_id: "cash", debit: 115, credit: 0 },
    { account_id: "income", debit: 0, credit: 100 },
    { account_id: "gst", debit: 0, credit: 15 },
    { account_id: "cost", debit: 20, credit: 0 },
    { account_id: "cash", debit: 0, credit: 20 }
  ];
  const trial = calculateTrialBalance(accounts, lines);
  assert.equal(trial.total_debits, trial.total_credits);
  const pnl = calculateProfitAndLoss(accounts, lines);
  assert.equal(pnl.income, 100);
  assert.equal(pnl.expenses, 20);
  assert.equal(pnl.profit, 80);
  const balance = calculateBalanceSheet(accounts, lines, pnl);
  assert.equal(balance.assets, 95);
  assert.equal(balance.liabilities_and_equity, 95);
});

test("tax reserve keeps GST, company tax, PAYE and reserve cash distinct", () => {
  const result = calculateTaxReserve({
    output_gst: 150, allowable_input_gst: 30, gst_paid: 20,
    accounting_profit: 1000, company_tax_rate: 0.28, income_tax_adjustments: 20,
    income_tax_paid: 40, paye_liability: 75, paye_paid: 25,
    current_reserve_balance: 80, cash_received: 600
  });
  assert.equal(result.gst_liability, 100);
  assert.equal(result.company_income_tax_provision, 300);
  assert.equal(result.company_income_tax_outstanding, 260);
  assert.equal(result.paye_outstanding, 50);
  assert.equal(result.tax_already_paid, 85);
  assert.equal(result.total_tax_cash_to_reserve, 410);
  assert.equal(result.suggested_transfer, 330);
  assert.equal(result.cash_available_after_reserves, 190);
});

test("CSV field labels can be remapped and values are escaped", () => {
  assert.equal(toMappedCsv([{ ref: 'A,"B"', debit: 4 }], ["ref", "debit"], { ref: "Reference" }), 'Reference,debit\r\n"A,""B""",4');
});
