// Confirmed spreadsheet review payload: explicit units, bounded values and no automatic modelling.
const validMoney=n=>Number.isFinite(n)&&n>=0&&n<=1000000;
const validKwh=n=>Number.isFinite(n)&&n>=0&&n<=1000000;
function numeric(value,kind){
  if(value===null||value===undefined||value==='')return null;
  const n=typeof value==='number'?value:Number(String(value).replace(/[$,\s]/g,''));
  if(!(kind==='kwh'?validKwh(n):validMoney(n)))throw new Error('Enter a valid non-negative '+(kind==='kwh'?'kWh':'dollar')+' amount.');
  return Math.round(n*10000)/10000;
}
function twoDecimals(n){return n===null?null:Math.round((n+Number.EPSILON)*100)/100;}
function sumIfComplete(rows,key){return rows.every(r=>r[key]!==null)?rows.reduce((sum,r)=>sum+r[key],0):null;}
function serialisedMonths(original,changes,kind){
  if(!Array.isArray(original?.months)||original.months.length!==12||!Array.isArray(changes)||changes.length!==12)throw new Error('Exactly twelve monthly rows are required.');
  if(kind==='monthly_bill_summary'){
    const labels=new Set();
    return changes.map((change,i)=>{
      const label=String(original.months[i].label||'').trim();
      const index=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(label.slice(0,3).toLowerCase());
      if(index<0||labels.has(index))throw new Error('Month labels need review.');
      labels.add(index);
      const combinedBillNzd=numeric(change.combinedBillNzd,'money');
      if(combinedBillNzd===null)throw new Error('Enter a bill amount for each month, including zero when appropriate.');
      return {monthLabel:label,combinedBillNzd};
    });
  }
  if(kind==='monthly_usage'){
    const seen=new Set();
    return changes.map((change,i)=>{
      const month=original.months[i].month;
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||seen.has(month))throw new Error('Month dates need review.');
      seen.add(month);
      const kwh=numeric(change.kwh,'kwh');
      const electricityNzd=numeric(change.electricityNzd,'money');
      const broadbandNzd=numeric(change.broadbandNzd,'money');
      const gstBasis=['inclusive','exclusive'].includes(change.gstBasis)?change.gstBasis:'unknown';
      if(kwh===null&&electricityNzd===null)throw new Error('Each month needs either explicitly labelled kWh or electricity-only cost.');
      return {month,kwh,electricityNzd,broadbandNzd,gstBasis};
    });
  }
  throw new Error('Unsupported monthly review format.');
}
export function makeConfirmedAnnualReview(original,changes,source,reviewedAt=new Date().toISOString()){
  if(!source||!/^.+\.(csv|xlsx)$/i.test(source.name||'')||!Number.isInteger(source.size)||source.size<=0||source.size>12*1024*1024)throw new Error('The source file is missing or unsupported.');
  const kind=original?.kind==='monthly_bill_summary'?'monthly_bill_summary':'monthly_usage';
  const months=serialisedMonths(original,changes,kind);
  const totals=kind==='monthly_bill_summary'
    ? {combinedBillNzd:twoDecimals(sumIfComplete(months,'combinedBillNzd')),electricityNzd:null,kwh:null}
    : {combinedBillNzd:null,electricityNzd:twoDecimals(sumIfComplete(months,'electricityNzd')),kwh:sumIfComplete(months,'kwh')};
  const rawEstimate=kind==='monthly_bill_summary'?original.broadbandMonthlyEstimateNzd:null;
  const broadbandMonthlyEstimateNzd=rawEstimate===null||rawEstimate===undefined?null:numeric(rawEstimate,'money');
  const workbookAfterBroadbandNzd=kind==='monthly_bill_summary'&&original.totals?.reportedAfterBroadbandNzd!==null
    ? numeric(original.totals.reportedAfterBroadbandNzd,'money'):null;
  return {
    version:1,
    status:'user_confirmed',
    kind,
    sourceFile:{name:source.name,size:source.size},
    confirmedAt:reviewedAt,
    months,
    totals,
    broadbandMonthlyEstimateNzd,
    workbookReportedAfterBroadbandNzd:workbookAfterBroadbandNzd,
    flags:{
      yearUnknown:kind==='monthly_bill_summary',
      electricityCostUnverified:kind==='monthly_bill_summary',
      broadbandEstimateUnverified:broadbandMonthlyEstimateNzd!==null,
      seasonalOccupancyNote:Boolean(original.warnings?.some(w=>/occupancy changes/.test(w)))
    },
    // Customer checked transcription, not verified source/energy audit.
    verifiedForModel:false
  };
}
