// Bank connectors translate provider-specific statements into this common shape.
// The reconciliation engine does not know which bank or transport supplied a row.
function valueAt(row, key) {
  return key ? row[key] : undefined;
}

function validDate(value, format = "dmy") {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parts = text.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (parts) {
    let year, month, day;
    if (format === "ymd" || parts[1].length === 4) [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else if (format === "mdy") [month, day, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else [day, month, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(value) {
  let text = String(value ?? "").trim();
  const negative = /^\(.*\)$/.test(text);
  text = text.replace(/[,$\s]/g, "").replace(/[()]/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : NaN;
}

export function normalizeBankFeedRows(rows, mapping = {}) {
  if (!Array.isArray(rows)) throw new Error("Bank feed rows must be an array");
  return rows.map((row, index) => {
    const transactionDate = validDate(valueAt(row, mapping.date || "date"), mapping.date_format || "dmy");
    if (!transactionDate) throw new Error(`Bank row ${index + 1} has an invalid transaction date`);
    const debitValue = mapping.debit ? parseAmount(valueAt(row, mapping.debit)) : NaN;
    const creditValue = mapping.credit ? parseAmount(valueAt(row, mapping.credit)) : NaN;
    let amountRaw = mapping.amount ? parseAmount(valueAt(row, mapping.amount)) : parseAmount(valueAt(row, "amount"));
    if (!Number.isFinite(amountRaw) && (Number.isFinite(debitValue) || Number.isFinite(creditValue))) {
      const debit = Number.isFinite(debitValue) ? debitValue : 0;
      const credit = Number.isFinite(creditValue) ? creditValue : 0;
      if (debit > 0 && credit > 0) throw new Error(`Bank row ${index + 1} has both debit and credit amounts`);
      amountRaw = credit > 0 ? credit : -debit;
    }
    if (!Number.isFinite(amountRaw) || amountRaw === 0) throw new Error(`Bank row ${index + 1} has an invalid amount`);
    const directionValue = String(valueAt(row, mapping.direction || "direction") ?? "").trim().toLowerCase();
    let direction;
    if (directionValue === "inflow" || directionValue === "credit" || directionValue === "in") direction = "inflow";
    else if (directionValue === "outflow" || directionValue === "debit" || directionValue === "out") direction = "outflow";
    else direction = amountRaw < 0 ? "outflow" : "inflow";
    const amount = Math.round(Math.abs(amountRaw) * 100) / 100;
    const text = key => String(valueAt(row, mapping[key] || key) ?? "").trim().slice(0, key === "description" ? 1000 : 240);
    return {
      external_transaction_id: text("id") || null,
      transaction_date: transactionDate,
      direction,
      amount,
      currency: text("currency") || "NZD",
      counterparty: text("counterparty") || null,
      reference: text("reference") || null,
      description: text("description"),
      transaction_code: text("transaction_code") || null,
      raw: row
    };
  });
}

export function parseCsvRows(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (cell !== "" || row.length) { row.push(cell); if (row.some(value => value !== "")) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim());
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])));
}

export function buildImportFingerprint(normalizedRows) {
  const canonical = [...normalizedRows].map(row => ({
    id: row.external_transaction_id || "", date: row.transaction_date, direction: row.direction,
    amount: row.amount, currency: row.currency, counterparty: row.counterparty || "",
    reference: row.reference || "", description: row.description || ""
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(canonical);
}
