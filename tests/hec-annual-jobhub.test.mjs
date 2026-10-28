import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../mini-fergus-job.html',import.meta.url),'utf8');
const a=html.indexOf('function renderConfirmedAnnualUsage()');
const b=html.indexOf('function renderEnergyData(files)',a);
assert.ok(a>=0&&b>a,'Expected isolated read-only Job Hub review rendering function');
const source=html.slice(a,b);
class Element{
  constructor(){this.children=[];this.textContent='';this.style={};this.className='';}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(){this.children=[];}
}
const find=(root,predicate)=>{
  if(predicate(root))return root;
  for(const child of root.children){const result=find(child,predicate);if(result)return result;}
  return null;
};
function render(review){
  const panel=new Element();
  const document={getElementById:id=>id==='annualUsageConfirmedJobhub'?panel:null,createElement:()=>new Element()};
  const context={document,currentAnswers:{annualUsageReview:review}};
  vm.runInNewContext(source+'\nrenderConfirmedAnnualUsage();',context);
  return panel;
}
test('Job Hub shows a customer file as unconfirmed until checked figures are submitted',()=>{
  const panel=render(null);
  assert.match(panel.textContent,/No customer-confirmed monthly figures/);
});
test('Job Hub labels combined bill amounts without claiming kWh or electricity-only cost',()=>{
  const review={
    status:'user_confirmed',kind:'monthly_bill_summary',sourceFile:{name:'synthetic.xlsx'},
    months:['Oct','Sep','Aug','Jul','Jun','May','Apr','Mar','Feb','Jan','Dec','Nov'].map((monthLabel,i)=>({monthLabel,combinedBillNzd:200+i})),
    totals:{combinedBillNzd:2466,kwh:null,electricityNzd:null},
    broadbandMonthlyEstimateNzd:90,workbookReportedAfterBroadbandNzd:1386
  };
  const panel=render(review);
  const heading=find(panel,e=>/Submitter-reviewed monthly figures/.test(e.textContent));
  const table=find(panel,e=>e.children.length===13);
  assert.ok(heading);
  assert.ok(table,'12 months plus header');
  assert.match(JSON.stringify(panel),/may include broadband/);
  assert.match(JSON.stringify(panel),/NOT electricity-only/);
});
test('Job Hub never treats unconfirmed monthly data as approved',()=>{
  const panel=render({status:'needs_review',months:Array(12).fill({combinedBillNzd:100})});
  assert.match(panel.textContent,/No customer-confirmed monthly figures/);
});
