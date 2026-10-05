export function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

export function validateJournalLines(lines, tolerance = 0.005) {
  if (!Array.isArray(lines) || lines.length < 2) return { ok: false, error: "A journal needs at least two lines" };
  let debits = 0;
  let credits = 0;
  for (const [index, line] of lines.entries()) {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (!line.account_id) return { ok: false, error: `Line ${index + 1} needs an account` };
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0)) {
      return { ok: false, error: `Line ${index + 1} must have one non-negative debit or credit` };
    }
    if (debit === 0 && credit === 0) return { ok: false, error: `Line ${index + 1} cannot be zero` };
    debits += debit;
    credits += credit;
  }
  if (money(debits - credits) !== 0 || Math.abs(debits - credits) > tolerance) {
    return { ok: false, error: "Journal debits and credits must balance" };
  }
  return { ok: true, debits: money(debits), credits: money(credits) };
}

export function calculateTrialBalance(accounts, lines) {
  const totals = new Map();
  for (const line of lines || []) {
    const item = totals.get(line.account_id) || { debit: 0, credit: 0 };
    item.debit += Number(line.debit) || 0;
    item.credit += Number(line.credit) || 0;
    totals.set(line.account_id, item);
  }
  const rows = (accounts || []).map(account => {
    const total = totals.get(account.id) || { debit: 0, credit: 0 };
    return { ...account, debit: money(total.debit), credit: money(total.credit), balance: money(total.debit - total.credit) };
  });
  return {
    rows,
    total_debits: money(rows.reduce((sum, row) => sum + row.debit, 0)),
    total_credits: money(rows.reduce((sum, row) => sum + row.credit, 0))
  };
}

export function calculateProfitAndLoss(accounts, lines) {
  const sums = new Map();
  for (const line of lines || []) {
    const account = (accounts || []).find(item => item.id === line.account_id);
    if (!account || !["income", "expense"].includes(account.account_type)) continue;
    const signed = Number(line.credit || 0) - Number(line.debit || 0);
    sums.set(account.id, (sums.get(account.id) || 0) + signed);
  }
  const rows = (accounts || []).filter(account => ["income", "expense"].includes(account.account_type)).map(account => {
    const signed = sums.get(account.id) || 0;
    return { ...account, amount: money(account.account_type === "income" ? signed : -signed) };
  });
  const income = money(rows.filter(row => row.account_type === "income").reduce((sum, row) => sum + row.amount, 0));
  const expenses = money(rows.filter(row => row.account_type === "expense").reduce((sum, row) => sum + row.amount, 0));
  return { rows, income, expenses, profit: money(income - expenses) };
}

export function calculateBalanceSheet(accounts, lines, profitAndLoss) {
  const balances = new Map();
  for (const line of lines || []) {
    balances.set(line.account_id, (balances.get(line.account_id) || 0) + (Number(line.debit || 0) - Number(line.credit || 0)));
  }
  const rows = (accounts || []).filter(account => ["asset", "liability", "equity"].includes(account.account_type)).map(account => {
    const raw = balances.get(account.id) || 0;
    const amount = account.account_type === "asset" ? raw : -raw;
    return { ...account, amount: money(amount) };
  });
  const assets = money(rows.filter(row => row.account_type === "asset").reduce((sum, row) => sum + row.amount, 0));
  const liabilities = money(rows.filter(row => row.account_type === "liability").reduce((sum, row) => sum + row.amount, 0));
  const equity = money(rows.filter(row => row.account_type === "equity").reduce((sum, row) => sum + row.amount, 0));
  const current_period_profit = money(profitAndLoss?.profit || 0);
  return { rows, assets, liabilities, equity, current_period_profit, liabilities_and_equity: money(liabilities + equity + current_period_profit) };
}

export function calculateTaxReserve(input) {
  const gst = money((input.output_gst || 0) - (input.allowable_input_gst || 0) - (input.gst_paid || 0) + (input.gst_adjustments || 0));
  const taxableProfit = Math.max(0, Number(input.accounting_profit || 0) + Number(input.taxable_profit_adjustments || 0));
  const incomeTaxProvision = money(taxableProfit * Math.max(0, Number(input.company_tax_rate || 0)) + Number(input.income_tax_adjustments || 0));
  const incomeTax = money(incomeTaxProvision - (input.income_tax_paid || 0));
  const paye = money((input.paye_liability || 0) - (input.paye_paid || 0));
  const otherPayroll = money((input.other_payroll_liability || 0) - (input.other_payroll_paid || 0));
  const currentReserve = money(input.current_reserve_balance || 0);
  const estimatedTaxLiabilities = money(Math.max(0, gst) + Math.max(0, incomeTax) + Math.max(0, paye) + Math.max(0, otherPayroll));
  return {
    gst_liability: gst,
    company_income_tax_provision: incomeTaxProvision,
    company_income_tax_outstanding: incomeTax,
    paye_outstanding: paye,
    other_payroll_outstanding: otherPayroll,
    tax_already_paid: money((input.gst_paid || 0) + (input.income_tax_paid || 0) + (input.paye_paid || 0) + (input.other_payroll_paid || 0)),
    current_reserve_balance: currentReserve,
    total_tax_cash_to_reserve: estimatedTaxLiabilities,
    suggested_transfer: money(Math.max(0, estimatedTaxLiabilities - currentReserve)),
    cash_available_after_reserves: money((input.cash_received || 0) - estimatedTaxLiabilities)
  };
}

export function toMappedCsv(rows, fields, mapping = {}) {
  const columns = fields.map(field => ({ key: field, label: mapping[field] || field }));
  const cell = value => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.map(column => cell(column.label)).join(","), ...(rows || []).map(row => columns.map(column => cell(row[column.key])).join(","))].join("\r\n");
}
