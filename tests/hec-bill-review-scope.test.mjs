import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../home-energy-check.html', import.meta.url), 'utf8');
const between = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));

function reviewRuntime(success = true) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      files: [{ size: 100, name: 'synthetic.pdf' }],
      textContent: '', innerHTML: '', className: '',
      classList: { add() {}, remove() {} }
    });
    return elements.get(id);
  };
  let requests = 0;
  const bill = {
    retailer: 'Contact', total_bill_nzd: 397.36,
    electricity_charges_nzd: 337.36, non_electricity_charges_nzd: 60,
    total_import_kwh: 877, charged_import_kwh: 781, free_import_kwh: 96,
    electricity_cost_separation_status: 'separated',
    import_rate_cents: 31.8, import_rate_gst_basis: 'exclusive',
    daily_fixed_charge_cents: 150, daily_fixed_charge_gst_basis: 'exclusive',
    free_import_schedule: 'Saturday and Sunday 9am–5pm'
  };
  const context = vm.createContext({
    document: { getElementById: element },
    answers: { bills: { summer: null, winter: null } },
    FormData: class { append() {} },
    fetch: async () => {
      requests++;
      return { ok: success, json: async () => success ? bill : { error: 'Provider unavailable' } };
    },
    renderBillFields() {}, saveBillEditsNoLoop() {}, escapeHtml: String
  });
  context.window = context;
  // Preserve the final report's private scope: only explicit window exports escape it.
  vm.runInContext('(function(){' + between('function num(value)', 'function money(value)') +
    between('function billNumber(', 'function average(') + '})();', context);
  vm.runInContext(between('async function readBill(season)', 'function renderBillFields(') +
    between('function validNumber(v)', 'function updateBillInsights()') +
    between('function updateBillInsights()', 'function escapeHtml(s)'), context);
  return { context, element, bill, requests: () => requests };
}

test('successful bill extraction finishes review across the real script scopes', async () => {
  const r = reviewRuntime();
  await vm.runInContext("readBill('winter')", r.context);
  assert.match(r.element('winterStatus').textContent, /Bill read ✓/);
  assert.doesNotMatch(r.element('winterStatus').textContent, /couldn.t read/);
  assert.equal(r.requests(), 1);
  assert.equal(r.context.answers.bills.winter, r.bill);
  assert.match(r.element('insights').innerHTML, /Your fixed electricity charge is about \$630 a year including GST, before any electricity is used\./);
  assert.match(r.element('insights').innerHTML, /781 kWh charged and 96 kWh free/);
});

test('shared numeric helper retains electricity-only totals and GST conversion', () => {
  const r = reviewRuntime();
  assert.equal(vm.runInContext('electricityBillTotal(answers.bills.winter = ' + JSON.stringify(r.bill) + ')', r.context), 337.36);
  assert.ok(Math.abs(vm.runInContext("rateInclGstNzd(answers.bills.winter,'import_rate_cents','import_rate_gst_basis')", r.context) - .3657) < 1e-10);
  assert.equal(r.context.billNumber({ value: '$1,234.50' }, ['value']), 1234.5);
  assert.equal(r.context.billNumber({ value: null }, ['value']), null);
  assert.equal(r.context.billNumber({ value: 0 }, ['value']), 0);
});

test('actual extraction rejection still reports failure without saving bill answers', async () => {
  const r = reviewRuntime(false);
  await vm.runInContext("readBill('winter')", r.context);
  assert.match(r.element('winterStatus').textContent, /Provider unavailable/);
  assert.equal(r.context.answers.bills.winter, null);
  assert.equal(r.requests(), 1);
});
