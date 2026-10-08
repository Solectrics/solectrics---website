import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const job = await readFile(new URL('../mini-fergus-job.html', import.meta.url), 'utf8');
const form = await readFile(new URL('../mini-fergus-fletcher-form.html', import.meta.url), 'utf8');
const email = await readFile(new URL('../functions/api/fletcher-email.js', import.meta.url), 'utf8');
const notesSource = form.slice(form.indexOf('function buildNotes('), form.indexOf('function updateMissing('));
const context = vm.createContext({ firstValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim()) || '' });
vm.runInContext(notesSource, context);

test('reviewed supplier notes include exact equipment and exclude private design/costing fields', () => {
  const text = context.buildNotes({ design_reviewed: true, design_panel_count: '14', design_panel_model: 'Suntech exact test model', design_panel_wattage: '445', design_inverter_model: 'Test inverter', design_battery_model: 'Test battery', design_battery_kwh: '10', design_supplier_notes: 'Black roof clamps and freight', design_environment_notes: 'PRIVATE ENVIRONMENT', design_electrical_notes: 'PRIVATE ELECTRICAL', markup: 'PRIVATE MARKUP', profit: 'PRIVATE PROFIT', customer_price: 'PRIVATE PRICE' }, {}, 'TEST ICP');
  for (const expected of ['14 panels', 'Suntech exact test model', '445 W', 'Test inverter', 'Test battery', 'Black roof clamps', 'TEST ICP']) assert.ok(text.includes(expected));
  assert.ok(!text.includes('PRIVATE'));
});

test('unreviewed equipment remains preliminary and battery is optional', () => {
  assert.equal(context.buildNotes({ design_panel_model: 'UNCONFIRMED', design_supplier_notes: 'UNCONFIRMED' }, {}, 'ICP'), 'ICP: ICP');
  const text = context.buildNotes({ design_reviewed: true, design_panel_model: 'Suntech', design_panel_count: '10' }, {}, '');
  assert.ok(!text.includes('Battery:'));
});

test('layout shortcut uses existing same-job upload role and respects the Site Visit prerequisite', () => {
  const start = job.indexOf('  if (event.target.id === "uploadOpenSolarLayout")');
  const end = job.indexOf('  if (event.target.id === "generateSupplierRequest")', start);
  const source = job.slice(start, end);
  let picked = 0;
  const fields = { jobFileCategory: {}, jobFileRole: {}, jobFilesSection: { scrollIntoView() {} }, jobFileInput: { click() { picked++; } } };
  const run = vm.runInNewContext(`(function(complete) { const siteVisitPrerequisiteComplete=complete; ${source} })`, { document: { getElementById: id => fields[id] }, event: { target: { id: 'uploadOpenSolarLayout' } } });
  run(false); assert.equal(picked, 0);
  run(true); assert.equal(picked, 1); assert.equal(fields.jobFileCategory.value, 'drawing'); assert.equal(fields.jobFileRole.value, 'roof_layout');
  assert.match(job, /form.append\("job_id", jobId\)/);
  assert.match(job, /"design_supplier_notes"/);
});

test('package continues using reviewed Jane route and classified layout without costing queries', () => {
  assert.match(email, /const RECIPIENT = "jane@solectrics.co.nz"/);
  assert.match(email, /PACKAGE_ROLES = \[REQUIRED_ROLE, "sld", "roof_layout", "power_bill"\]/);
  assert.doesNotMatch(email, /FROM costing_|FROM customer_quote|FROM job_supplier_pricing/);
  assert.doesNotMatch(form, /items.push\(design.design_(environment|electrical)_notes\)/);
  assert.match(form, /Boolean\(roles.has\("sld"\) \|\| roles.has\("roof_layout"\)\)/);
});
