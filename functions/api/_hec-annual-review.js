// Validate user-confirmed HEC monthly figures before retaining in answers_json.
// This does not read customer files, alter migrations or mark data model-ready.
const MAX=1000000;
const safeNumber=v=>(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=MAX)?v:null;
const money=v=>v===null?null:Math.round((v+Number.EPSILON)*100)/100;
const sumIfComplete=(rows,key)=>rows.every(r=>r[key]!==null)?rows.reduce((sum,row)=>sum+row[key],0):null;
const isObj=o=>o&&typeof o==='object'&&!Array.isArray(o);
const fileNameOk=n=>typeof n==='string'&&n.length>0&&n.length<=255&&/\.(csv|xlsx)$/i.test(n);
const yyyyMm=/^\d{4}-(0[1-9]|1[0-2])$/;
function nextMonth(ym){const [year,month]=ym.split('-').map(Number);return year+(month===12?1:0)+'-'+String(month===12?1:month+1).padStart(2,'0');}
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function validRows(raw,kind){
  if(!Array.isArray(raw)||raw.length!==12)return null;
  const output=[],ids=new Set();
  for(const row of raw){
    if(!isObj(row))return null;
    if(kind==='monthly_bill_summary'){
      const label=row.monthLabel;
      const id=typeof label==='string'?months.indexOf(label.slice(0,3).toLowerCase()):-1;
      if(id<0||!new RegExp('^'+['jan(?:uary)?','feb(?:ruary)?','mar(?:ch)?','apr(?:il)?','may','jun(?:e)?','jul(?:y)?','aug(?:ust)?','sep(?:tember)?','oct(?:ober)?','nov(?:ember)?','dec(?:ember)?'][id]+'$','i').test(label)||ids.has(id))return null;
      ids.add(id);
      const v=safeNumber(row.combinedBillNzd);if(v===null)return null;
      output.push({monthLabel:label,combinedBillNzd:v});
    }else if(kind==='monthly_usage'){
      if(typeof row.month!=='string'||!yyyyMm.test(row.month)||ids.has(row.month))return null;
      ids.add(row.month);
      const n=['kwh','electricityNzd','broadbandNzd'];
      for(const field of n)if(row[field]!==null&&safeNumber(row[field])===null)return null;
      if(row.kwh===null&&row.electricityNzd===null)return null;
      if(!['inclusive','exclusive','unknown'].includes(row.gstBasis))return null;
      output.push({month:row.month,kwh:row.kwh,electricityNzd:row.electricityNzd,broadbandNzd:row.broadbandNzd,gstBasis:row.gstBasis});
    }else return null;
  }
  if(kind==='monthly_usage'){
    const ordered=output.map(r=>r.month).sort();
    for(let i=1;i<ordered.length;i++)if(ordered[i]!==nextMonth(ordered[i-1]))return null;
    output.sort((a,b)=>a.month.localeCompare(b.month));
  }else{
    const indices=output.map(r=>months.indexOf(r.monthLabel.slice(0,3).toLowerCase()));
    const ascending=indices.every((v,i)=>!i||v===(indices[i-1]+1)%12);
    const descending=indices.every((v,i)=>!i||v===(indices[i-1]+11)%12);
    if(!ascending&&!descending)return null;
  }
  return output;
}
export function sanitiseAnnualUsageReview(raw,annualFiles=[],receivedAt=new Date().toISOString()){
  if(raw===undefined||raw===null)return null;
  if(!isObj(raw)||raw.version!==1||raw.status!=='user_confirmed'||raw.verifiedForModel!==false)return false;
  const kind=raw.kind;
  if(!['monthly_bill_summary','monthly_usage'].includes(kind))return false;
  const source=raw.sourceFile;
  if(!isObj(source)||!fileNameOk(source.name)||!Number.isInteger(source.size)||source.size<=0||source.size>12*1024*1024)return false;
  if(!annualFiles.some(f=>f.name===source.name&&f.size===source.size))return false;
  const rows=validRows(raw.months,kind);if(!rows)return false;
  if(kind==='monthly_bill_summary'){
    const est=raw.broadbandMonthlyEstimateNzd===null?null:safeNumber(raw.broadbandMonthlyEstimateNzd);
    const workbook=raw.workbookReportedAfterBroadbandNzd===null?null:safeNumber(raw.workbookReportedAfterBroadbandNzd);
    if(est===null&&raw.broadbandMonthlyEstimateNzd!==null)return false;
    if(workbook===null&&raw.workbookReportedAfterBroadbandNzd!==null)return false;
    return {
      version:1,status:'user_confirmed',kind,
      sourceFile:{name:source.name,size:source.size},confirmedAt:receivedAt,
      months:rows,
      totals:{combinedBillNzd:money(sumIfComplete(rows,'combinedBillNzd')),electricityNzd:null,kwh:null},
      broadbandMonthlyEstimateNzd:est,workbookReportedAfterBroadbandNzd:workbook,
      flags:{
        yearUnknown:true,electricityCostUnverified:true,
        broadbandEstimateUnverified:est!==null,
        seasonalOccupancyNote:raw.flags?.seasonalOccupancyNote===true
      },
      verifiedForModel:false
    };
  }
  return {
    version:1,status:'user_confirmed',kind,
    sourceFile:{name:source.name,size:source.size},confirmedAt:receivedAt,
    months:rows,
    totals:{combinedBillNzd:null,electricityNzd:money(sumIfComplete(rows,'electricityNzd')),kwh:sumIfComplete(rows,'kwh')},
    broadbandMonthlyEstimateNzd:null,workbookReportedAfterBroadbandNzd:null,
    flags:{
      yearUnknown:false,electricityCostUnverified:rows.some(r=>r.electricityNzd!==null&&r.gstBasis==='unknown'),
      broadbandEstimateUnverified:false,seasonalOccupancyNote:false
    },
    verifiedForModel:false
  };
}
