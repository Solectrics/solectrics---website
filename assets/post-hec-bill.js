(function(root) {
  'use strict';
  const fields = [
    ['retailer','Retailer'],['plan_name','Exact plan name (leave unknown if unconfirmed)'],['icp','ICP'],
    ['billing_period_start','Period start','date'],['billing_period_end','Period end','date'],['billing_days','Billing days','number'],
    ['total_import_kwh','All imported electricity (kWh)','number'],['average_daily_kwh','Average daily use (calculated from kWh/days)','number'],
    ['charged_import_kwh','Charged imported electricity (kWh)','number'],['free_import_kwh','Free imported electricity (kWh)','number'],
    ['total_export_kwh','Exported electricity (kWh; unknown is not zero)','number'],
    ['total_bill_nzd','Whole invoice incl GST ($)','number'],['electricity_charges_nzd','Electricity only incl GST ($)','number'],
    ['non_electricity_charges_nzd','Other services incl GST ($)','number'],['gst_nzd','Whole invoice GST ($)','number'],['electricity_gst_nzd','Electricity-only GST ($)','number'],
    ['electricity_cost_separation_status','Cost separation','select',['','electricity_only','separated','needs_review']],
    ['daily_fixed_charge_cents','Printed fixed charge (c/day)','number'],['daily_fixed_charge_gst_basis','Printed fixed charge GST basis','select',['','exclusive','inclusive']],
    ['import_rate_cents','Printed import rate (c/kWh)','number'],['import_rate_gst_basis','Printed import-rate GST basis','select',['','exclusive','inclusive']],
    ['peak_rate_cents','Peak (c/kWh)','number'],['offpeak_rate_cents','Off-peak (c/kWh)','number'],['controlled_rate_cents','Controlled load (c/kWh)','number'],
    ['ev_night_rate_cents','EV night (c/kWh)','number'],['export_rate_cents','Export credit (c/kWh)','number'],['peak_export_rate_cents','Peak export credit (c/kWh)','number'],
    ['tariff_description','Confirmed tariff description'],['free_import_schedule','Free electricity schedule'],['fixed_term','Fixed term'],['exit_cost_nzd','Exit cost ($)','number'],
    ['other_tariff_information','Tariff / ripple-control information'],['notes','Bill-reading notes']
  ];
  const display = value => value == null || value === '' ? 'Unknown / not supplied' : String(value);
  async function request(jobId,fileId,action,values={}) {
    const response = await fetch('/api/job-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:Number(jobId),file_id:fileId,action,...values})});
    if (response.redirected || !String(response.headers.get('content-type')).includes('application/json')) throw new Error('Sign-in or connection needs checking. Your attachment is retained.');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function mount({document:doc,jobId,onSaved}) {
    let busy=false, activeFile, bundle;
    const dialog=doc.createElement('dialog'); dialog.className='bill-review-dialog';
    const form=doc.createElement('div'); dialog.append(form); doc.body.append(dialog);
    const node=(tag,text,parent=form)=>{const el=doc.createElement(tag);if(text!=null)el.textContent=text;parent.append(el);return el;};
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    async function open(fileId,name) {
      if(busy)return;
      if(activeFile?.id===fileId && bundle?.draft && form.dataset.saved!=='true') {if(!dialog.open)dialog.showModal();return;}
      delete form.dataset.saved;
      busy=true;activeFile={id:fileId,name}; form.replaceChildren();
      node('h2','Read bill and update energy information');
      const status=node('p','Loading saved review…');status.setAttribute('role','status');
      if(!dialog.open)dialog.showModal();
      try {
        bundle=await request(jobId,fileId,'load_energy_bill_review');
        if(!bundle.draft) {status.textContent='Reading the attached bill…';bundle=await request(jobId,fileId,'read_energy_bill');}
        draw();
      } catch(e) {
        status.textContent=e.message;
        const retry=node('button','Retry reading this bill');retry.type='button';retry.onclick=()=>open(fileId,name);
        const close=node('button','Close');close.type='button';close.onclick=()=>dialog.close();
      } finally{busy=false;}
    }
    function draw() {
      form.replaceChildren();node('h2','Review '+activeFile.name);
      node('p','The attached original and extraction are retained. Review differences before replacing a summer or winter bill. Blank values remain unknown.');
      if(bundle.draft.extracted.needs_review_fields?.length)node('p','Reader uncertainty — check: '+bundle.draft.extracted.needs_review_fields.join(', '));
      const slotLabel=node('label','Evidence slot to update');const slot=node('select',null,slotLabel);
      for(const value of ['summer','winter']){const option=node('option',value[0].toUpperCase()+value.slice(1)+' bill',slot);option.value=value;}
      slot.value=bundle.bills?.summer && !bundle.bills?.winter?'winter':'summer';
      const list=node('div');list.className='bill-review-fields';const controls=new Map();
      fields.forEach(([key,label,type='text',options])=>{
        const row=node('div',null,list);row.className='bill-review-field';
        const wrap=node('label',label,row), input=node(type==='select'?'select':'input',null,wrap);
        if(type==='select')options.forEach(value=>{const option=node('option',value || 'Unknown',input);option.value=value;});
        else{input.type=type;if(type==='number'){input.min='0';input.step='any';input.inputMode='decimal';}input.maxLength=500;}
        input.value=bundle.draft.extracted[key] ?? '';input.dataset.billKey=key;
        if(key==='average_daily_kwh')input.readOnly=true;
        const previous=node('small','',row);const change=node('strong','',row);
        controls.set(key,{input,previous,change});
      });
      const refresh=()=>{
        const total=Number(controls.get('total_import_kwh').input.value),days=Number(controls.get('billing_days').input.value);
        if(controls.get('total_import_kwh').input.value!=='' && days>0)controls.get('average_daily_kwh').input.value=Number((total/days).toFixed(4));
        const existing=bundle.bills?.[slot.value] || {};
        for(const [key,{input,previous,change}] of controls) {
          const sharedValue=key==='icp'?bundle.shared.icp:key==='retailer'?bundle.shared.retailer:key==='plan_name'?bundle.shared.plan_name:null;
          previous.textContent='Saved bill: '+display(existing[key])+(sharedValue?' · Current shared: '+sharedValue:'');
          change.textContent=display(existing[key])!==display(input.value) || (sharedValue && sharedValue!==input.value)?'Review difference':'';
        }
      };
      slot.onchange=()=>{approve.checked=false;refresh();save.disabled=true;};
      const warning=node('p','Broadband is excluded from electricity costs. Free kWh are consumption, not paid import. Monthly bills do not establish solar overlap with free/TOU periods; savings remain subject to review.');warning.className='bill-review-warning';
      const approvalLabel=node('label',null);const approve=node('input',null,approvalLabel);approve.type='checkbox';
      node('span',' I have checked these values and approve updating this evidence slot and shared electricity information.',approvalLabel);
      const footer=node('div');footer.className='bill-review-actions';
      const save=node('button','Approve and save energy information',footer);save.type='button';save.disabled=true;
      const close=node('button','Close — keep review for later',footer);close.type='button';close.onclick=()=>{if(!busy)dialog.close();};
      const status=node('p','',footer);status.setAttribute('role','status');
      approve.onchange=()=>save.disabled=!approve.checked || busy;
      list.addEventListener('input',()=>{approve.checked=false;save.disabled=true;refresh();});
      save.onclick=async()=>{
        if(busy || !approve.checked)return;busy=true;
        const editable=[...form.querySelectorAll('input,select,button')];editable.forEach(el=>el.disabled=true);status.textContent='Saving reviewed values…';
        const bill={};for(const [key,{input}] of controls)bill[key]=input.value===''?null:input.type==='number'?Number(input.value):input.value;
        try {
          await request(jobId,activeFile.id,'save_energy_bill',{bill,slot:slot.value,revision:bundle.revision,approved:true});
          status.textContent='Saved successfully. The original bill remains attached. Energy calculations need review; existing proposals are unchanged.';
          form.dataset.saved='true';
          save.textContent='Saved';close.textContent='Close';
          try{await onSaved();}catch{status.textContent+=' Reload the job to see updated shared information.';}
          close.disabled=false;
        } catch(e) {status.textContent='Save failed — '+e.message;editable.forEach(el=>el.disabled=false);save.disabled=!approve.checked;}
        finally{busy=false;}
      };
      refresh();
    }
    doc.addEventListener('click',e=>{const button=e.target.closest('[data-read-energy-bill]');if(button)open(button.dataset.readEnergyBill,button.dataset.billName || 'Electricity bill');});
    return {open};
  }
  root.PostHecBill={mount,fields,display};
})(typeof window!=='undefined'?window:globalThis);
