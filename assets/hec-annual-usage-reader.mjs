// Pure CSV/monthly-record normaliser for Home Energy Check.
// No customer data, storage or network calls. All money values are NZD.
const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const clean = value => String(value ?? "").trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g,"");
const number = value => {
  const raw = clean(value).replace(/[$,\s]/g,"");
  if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
function monthId(value, date1904=false) {
  const s=clean(value);
  const iso=/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(s);
  if(iso && +iso[2]>=1 && +iso[2]<=12)return iso[1]+"-"+iso[2].padStart(2,"0");
  const named=/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s-]*(\d{2}|\d{4})$/i.exec(s);
  if(named){
    const year=named[2].length===2?2000+Number(named[2]):Number(named[2]);
    if(year<2000||year>2099)return null;
    return year+"-"+String(monthNames.indexOf(named[1].slice(0,3).toLowerCase())+1).padStart(2,"0");
  }
  // Excel date serials are only interpreted in an explicitly labelled month/date column.
  if(/^\d{5}(?:\.\d+)?$/.test(s)){
    const days=Number(s);
    if(days>20000&&days<80000){
      const date=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Math.floor(days)*86400000);
      const year=date.getUTCFullYear();
      if(year>=2000&&year<=2099)return year+"-"+String(date.getUTCMonth()+1).padStart(2,"0");
    }
  }
  return null;
}
export function parseCsv(text) {
  const rows=[]; let row=[],field="",quoted=false;
  const input=String(text).replace(/^\uFEFF/,"");
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(c==='"'){
      if(quoted && input[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    }else if(c===","&&!quoted){row.push(field);field="";}
    else if((c==="\n"||c==="\r")&&!quoted){
      if(c==="\r"&&input[i+1]==="\n")i++;
      row.push(field);if(row.some(v=>clean(v)))rows.push(row);
      row=[];field="";
    }else field+=c;
  }
  if(quoted)throw new Error("CSV has an unclosed quoted field");
  row.push(field);if(row.some(v=>clean(v)))rows.push(row);
  return rows;
}
export function reviewMonthlyRows(rows, options={}) {
  if(!Array.isArray(rows)||rows.length<2)return {status:"needs_review",months:[],warnings:["No monthly table found"]};
  const headers=rows[0].map(key);
  const find = patterns => headers.findIndex(h=>patterns.some(p=>p.test(h)));
  const monthCol=find([/^month$/, /^period$/, /^billingmonth$/, /^billingperiod$/, /^date$/, /^monthending$/, /^monthstart$/]);
  const kwhCol=find([/^kwh$/, /electricity.*kwh/, /energy.*kwh/, /^consumptionkwh$/, /^usagekwh$/]);
  const costCol=find([/^electricitycost/, /^electricitynzd$/, /^electricitycharges/, /^electricityamount$/, /^powercost/, /^powernzd$/, /^powercharges/, /^energycost/, /^energyamount$/]);
  const broadbandCol=find([/^broadband/, /^internet/]);
  const totalCol=find([/^total$/, /^totalcost$/, /^totalnzd$/, /^billtotal$/, /^combinedtotal$/]);
  const gstCol=find([/^gstbasis$/, /^gststatus$/, /^taxbasis$/]);
  const warnings=[];
  if(monthCol<0)warnings.push("Month/date column not recognised");
  if(kwhCol<0 && costCol<0)warnings.push("No explicitly labelled electricity kWh or electricity-cost column");
  if(costCol<0 && totalCol>=0)warnings.push("Combined bill total is not treated as electricity-only cost");
  const months=[],seen=new Set();
  if(monthCol>=0){
    for(const [index,row] of rows.slice(1).entries()){
      if(!row.some(v=>clean(v)))continue;
      const month=monthId(row[monthCol],Boolean(options.date1904));
      if(!month){warnings.push("Unrecognised month on data row "+(index+2));continue;}
      if(seen.has(month)){warnings.push("Duplicate month "+month);continue;}
      seen.add(month);
      const kwh=kwhCol<0?null:number(row[kwhCol]);
      const electricityNzd=costCol<0?null:number(row[costCol]);
      const broadbandNzd=broadbandCol<0?null:number(row[broadbandCol]);
      const combinedNzd=totalCol<0?null:number(row[totalCol]);
      const gstBasis=gstCol<0?null:clean(row[gstCol]).toLowerCase();
      if(kwhCol>=0&&kwh===null)warnings.push("Invalid kWh for "+month);
      if(costCol>=0&&electricityNzd===null)warnings.push("Invalid electricity cost for "+month);
      if(electricityNzd!==null && !["inclusive","incl","including","gstinclusive"].includes(key(gstBasis)))warnings.push("Electricity cost GST basis needs confirmation for "+month);
      months.push({month,kwh,electricityNzd,broadbandNzd,combinedNzd,gstBasis});
    }
  }
  months.sort((a,b)=>a.month.localeCompare(b.month));
  if(months.length!==12)warnings.push("Expected 12 unique months; found "+months.length);
  if(months.length===12){
    for(let i=1;i<months.length;i++){
      const [y,m]=months[i-1].month.split("-").map(Number);
      const next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
      if(months[i].month!==next){warnings.push("Months are not consecutive");break;}
    }
  }
  return {
    status:warnings.length?"needs_review":"ready_for_review",
    months,warnings,
    totals:{
      kwh:months.length===12&&months.every(m=>m.kwh!==null)?months.reduce((a,m)=>a+m.kwh,0):null,
      electricityNzd:months.length===12&&months.every(m=>m.electricityNzd!==null)?Number(months.reduce((a,m)=>a+m.electricityNzd,0).toFixed(2)):null
    },
    // Never infer kWh from dollar values or subtract broadband unless explicitly identified.
    verifiedForModel:false
  };
}


/**
 * A manually prepared 12-month spending summary has no kWh, no year and no
 * demonstrated electricity-only columns. Preserve the raw month/value pairs
 * without inventing units, dates, allocations or GST status.
 */
export function reviewMonthlyBillSummary(rows) {
  if (!Array.isArray(rows)) return null;
  const recognised=[];
  for (const row of rows) {
    const label=clean(row?.[0]);
    const m=/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i.exec(label);
    if (!m) continue;
    recognised.push({label, monthIndex:monthNames.indexOf(label.slice(0,3).toLowerCase()), combinedNzd:number(row?.[1])});
  }
  if(recognised.length!==12||new Set(recognised.map(r=>r.monthIndex)).size!==12)return null;
  const increasing=recognised.every((v,i)=>i===0||v.monthIndex===(recognised[i-1].monthIndex+1)%12);
  const decreasing=recognised.every((v,i)=>i===0||v.monthIndex===(recognised[i-1].monthIndex+11)%12);
  if(!increasing&&!decreasing)return null;
  const valid=recognised.every(r=>r.combinedNzd!==null);
  const sum=valid?Number(recognised.reduce((a,m)=>a+m.combinedNzd,0).toFixed(2)):null;
  const deductionRow=rows.find(r=>/^less\s+broadband\s+charges?/i.test(clean(r?.[0])));
  const statedAfterBroadbandNzd=deductionRow?number(deductionRow[1]):null;
  const allNotes=rows.flat().filter(v=>typeof v==='string').join(' ');
  const chargeMatch=/monthly\s+broadband\s+charge\s+(?:of\s+)?\$\s*([\d,]+(?:\.\d{1,2})?)/i.exec(allNotes);
  const broadbandMonthlyEstimateNzd=chargeMatch?number(chargeMatch[1]):null;
  const warnings=[
    'These are monthly dollar amounts, not kWh. No consumption figures have been extracted.',
    'Electricity-only charges cannot be established from these combined or unspecified bill amounts.',
    'The months have no years and may be statement months rather than electricity usage months.',
    'GST treatment of monthly amounts has not been established.'
  ];
  if(!valid)warnings.push('At least one monthly amount is missing or invalid.');
  if(broadbandMonthlyEstimateNzd!==null)warnings.push('Broadband is an approximate monthly figure; confirm it before any cost modelling.');
  if(statedAfterBroadbandNzd!==null)warnings.push('The workbook states an amount after broadband deduction. This is unverified, not an electricity-only total.');
  if(sum!==null && statedAfterBroadbandNzd!==null && broadbandMonthlyEstimateNzd!==null &&
      Math.abs(sum-statedAfterBroadbandNzd-12*broadbandMonthlyEstimateNzd)>0.03){
    warnings.push('The broadband estimate does not reconcile with the workbook deduction.');
  }
  if(/overseas|away\s+for|absen(?:t|ce)|unoccup/i.test(allNotes)){
    warnings.push('The notes indicate possible occupancy changes; spending may not represent typical seasonal electricity consumption.');
  }
  return {
    kind:'monthly_bill_summary',
    status:'needs_review',
    months:recognised.map(({label,combinedNzd})=>({label,combinedNzd})),
    totals:{combinedNzd:sum,reportedAfterBroadbandNzd:statedAfterBroadbandNzd},
    broadbandMonthlyEstimateNzd,
    warnings,
    verifiedForModel:false
  };
}
