/* Reviewed handoff between existing saved records. No requests or new records. */
(function (root) {
  'use strict';
  const fieldMap = [
    ['visit_connection_type', 'design_connection_type', 'Connection type'],
    ['visit_main_supply', 'design_main_supply', 'Main supply'],
    ['visit_icp', 'design_icp', 'ICP'],
    ['visit_retailer', 'design_retailer', 'Retailer'],
    ['visit_network', 'design_network', 'Network'],
    ['visit_switchboard', 'design_switchboard', 'Switchboard'],
    ['visit_supply_notes', 'design_supply_notes', 'Supply notes']
  ];
  const roofMap = [
    ['visit_roof_length', 'roof_length', 'Roof length'],
    ['visit_roof_width', 'roof_width', 'Roof width'],
    ['visit_roof_pitch', 'roof_pitch', 'Roof pitch'],
    ['visit_roof_orientation', 'roof_orientation_design', 'Roof orientation'],
    ['visit_roof_material', 'roof_material', 'Roof material'],
    ['visit_roof_shading', 'roof_shading', 'Roof shading'],
    ['visit_roof_notes', 'roof_notes', 'Roof notes']
  ];
  const flags = ['salt_spray', 'high_wind', 'trees', 'chimneys', 'buildings', 'aerials', 'vents', 'satellite'];
  function text(value) { return value == null ? '' : String(value).trim(); }
  function differences(visit, assessment, design, roofIndex) {
    const rows = [];
    function add(source, target, label, value, current, boolean = false) {
      if (boolean ? typeof value !== 'boolean' : text(value) === '') return;
      if (boolean ? value === Boolean(current) : text(value) === text(current)) return;
      rows.push({source, target, label, value, current, boolean});
    }
    fieldMap.forEach(([from, to, label]) => add('Saved Site Visit', to, label, visit[from], design[to]));
    flags.forEach(flag => add('Saved Site Visit', 'design_' + flag, flag.replace(/_/g, ' '), visit['visit_' + flag], design['design_' + flag], true));
    const notes = [
      visit.visit_roof_access && 'Roof access: ' + visit.visit_roof_access,
      visit.visit_inverter_location && 'Possible inverter location: ' + visit.visit_inverter_location,
      visit.visit_battery_location && 'Possible battery location: ' + visit.visit_battery_location,
      visit.visit_cable_route && 'Likely cable route: ' + visit.visit_cable_route,
      visit.visit_access_notes && 'Access / safety: ' + visit.visit_access_notes,
      visit.visit_general_notes
    ].filter(Boolean).join('\n');
    add('Saved Site Visit', 'design_environment_notes', 'Location / access observations', notes, design.design_environment_notes);
    if (Number.isInteger(roofIndex) && design.roofs?.[roofIndex]) {
      roofMap.forEach(([from, to, label]) => add('Saved Site Visit', 'roof:' + roofIndex + ':' + to, label, visit[from], design.roofs[roofIndex][to]));
    }
    add('Saved Assessment', 'design_panel_wattage', 'Panel wattage', assessment.panel_wattage, design.design_panel_wattage);
    add('Saved Assessment', 'design_panel_count', 'Panel quantity', assessment.panel_count, design.design_panel_count);
    return rows;
  }
  function icpSuggestion(answers, design) {
    const values = [...new Set([answers.icp, answers.ICP, design.design_icp].map(text).filter(Boolean))];
    return {value: values.length === 1 ? values[0] : '', conflict: values.length > 1};
  }
  function mount({document: doc, getSources, getDesign, canReview, onApplied}) {
    const host = doc.getElementById('jobDataReview');
    if (!host) return {refresh() {}};
    let roofIndex = null, busy = false;
    const kept = new Set();
    const selection = new Set();
    const key = row => JSON.stringify([row.source, row.target, row.value, row.current]);
    function node(tag, value, parent) {
      const el = doc.createElement(tag); if (value != null) el.textContent = value; parent.append(el); return el;
    }
    function refresh() {
      if (busy) return;
      host.replaceChildren();
      node('h3', 'Review saved information for System Design', host);
      node('p', 'Saving Site Visit or Assessment does not change your design. Compare the saved sources and select only the values you want to use. Blank source fields never clear design values. Keep current design dismisses a comparison for this session; it returns if its values change or the page reloads.', host);
      if (!canReview()) {
        node('p', 'Saved sources could not all be loaded. Reload before reviewing or saving the design.', host); return;
      }
      const sources = getSources(), design = getDesign(), roofs = design.roofs || [];
      if (roofs.length === 1) roofIndex = 0;
      if (roofs.length > 1) {
        const label = node('label', 'Which design roof matches these Site Visit measurements?', host);
        const select = node('select', null, label);
        select.className = 'data-review-control';
        node('option', 'Choose roof before comparing measurements', select).value = '';
        roofs.forEach((roof, index) => { const option = node('option', 'Roof ' + (index + 1) + (roof.roof_name ? ' — ' + roof.roof_name : ''), select); option.value = String(index); });
        select.value = Number.isInteger(roofIndex) && roofIndex < roofs.length ? String(roofIndex) : '';
        if (select.value === '') roofIndex = null;
        select.addEventListener('change', () => { roofIndex = select.value === '' ? null : Number(select.value); refresh(); });
      }
      const rows = differences(sources.visit, sources.assessment, design, roofIndex).filter(row => !kept.has(key(row)));
      if (!rows.length) { node('p', roofs.length > 1 && roofIndex == null ? 'Choose a roof to review its measurements. No other differences need review.' : 'No saved-source differences need review.', host); return; }
      const selected = [];
      const show = (value, boolean) => boolean ? (value ? 'Yes' : 'No') : (text(value) || 'Not entered');
      rows.forEach(row => {
        const wrapper = node('div', null, host); wrapper.className = 'data-review-row';
        const label = node('label', null, wrapper), check = node('input', null, label); check.type = 'checkbox'; check.className = 'data-review-control';
        check.checked = selection.has(key(row));
        check.addEventListener('change', () => { if (check.checked) selection.add(key(row)); else selection.delete(key(row)); });
        node('strong', row.label, label);
        node('p', row.source + ': ' + show(row.value, row.boolean), wrapper);
        node('p', 'Current design: ' + show(row.current, row.boolean), wrapper);
        const keep = node('button', 'Keep current design', wrapper); keep.type = 'button'; keep.className = 'data-review-control';
        keep.addEventListener('click', () => { kept.add(key(row)); selection.delete(key(row)); refresh(); });
        selected.push({row, check});
      });
      const apply = node('button', 'USE SELECTED VALUES IN DESIGN', host); apply.type = 'button'; apply.className = 'data-review-control';
      const status = node('p', '', host); status.setAttribute('role', 'status');
      apply.addEventListener('click', () => {
        if (busy || !canReview()) return;
        const changes = selected.filter(item => item.check.checked);
        if (!changes.length) { status.textContent = 'Select the source values you want to use.'; return; }
        // Compare again: never apply a stale proposal to a changed design.
        const latest = differences(getSources().visit, getSources().assessment, getDesign(), roofIndex);
        if (changes.some(item => !latest.some(row => key(row) === key(item.row)))) {
          status.textContent = 'The source or design changed. Review the current values again.'; return;
        }
        busy = true;
        for (const {row} of changes) {
          const match = row.target.match(/^roof:(\d+):(.+)$/);
          const field = match ? doc.querySelectorAll('#designRoofs .design-roof')[Number(match[1])]?.querySelector('.' + match[2]) : doc.getElementById(row.target);
          if (field) { if (row.boolean) field.checked = row.value; else field.value = row.value; }
        }
        const reviewed = doc.getElementById('design_reviewed'); if (reviewed) reviewed.checked = false;
        // Existing derived-size formula and existing autosave, no new endpoint.
        const wattage = Number(doc.getElementById('design_panel_wattage')?.value) || 0;
        const count = Number(doc.getElementById('design_panel_count')?.value) || 0;
        const size = doc.getElementById('design_array_kw'); if (size) size.value = wattage > 0 && count > 0 ? ((wattage * count) / 1000).toFixed(3) : '';
        selection.clear(); onApplied(); busy = false; refresh();
      });
    }
    return {refresh};
  }
  root.JobDataReview = {differences, icpSuggestion, mount};
})(globalThis);
