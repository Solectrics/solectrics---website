import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseCsv,reviewMonthlyRows,reviewMonthlyBillSummary} from '../assets/hec-annual-usage-reader.mjs';
import {makeConfirmedAnnualReview} from '../assets/hec-annual-review-data.mjs';

const html=await readFile(new URL('../home-energy-check.html',import.meta.url),'utf8');
const script=html.match(/<script type="module">\s*import \{parseCsv,reviewMonthlyRows,reviewMonthlyBillSummary\}[\s\S]*?<\/script>/)?.[0];
assert.ok(script,'Monthly review module must be present');
const code=script.replace(/^<script type="module">/,'').replace(/<\/script>$/,'').replace(/^import .*;\s*$/gm,'');

class Element{
  constructor(){this.children=[];this.listeners={};this.files=[];this.textContent='';this.className='';this.style={};this.value='';this.checked=false;}
  appendChild(c){this.children.push(c);return c;}
  replaceChildren(){this.children=[];this.textContent='';}
  addEventListener(type,callback){this.listeners[type]=callback;}
  setAttribute(name,value){this[name]=value;}
}
function setup(readXlsxRows=async()=>[]){
  const input=new Element(),status=new Element(),review=new Element();
  const elements={annualUsageFiles:input,annualUsageStatus:status,annualUsageReview:review};
  const document={
    getElementById:id=>elements[id]||null,
    createElement:()=>new Element()
  };
  const window={};
  vm.runInNewContext(code,{document,window,parseCsv,reviewMonthlyRows,reviewMonthlyBillSummary,readXlsxRows,makeConfirmedAnnualReview});
  return {input,status,review,window};
}
const rows=[['Month','Electricity Cost','Broadband','GST Basis'],
  ...Array.from({length:12},(_,i)=>[`2025-${String(i+1).padStart(2,'0')}`,'250','60','inclusive'])
];
test('CSV selection creates a 12-month review table without modifying the solar model',async()=>{
  const ui=setup();
  ui.input.files=[{name:'synthetic.csv',size:200,text:async()=>rows.map(r=>r.join(',')).join('\n')}];
  await ui.input.listeners.change();
  assert.match(ui.status.textContent,/Monthly figures extracted/);
  const table=ui.review.children.flatMap(e=>e.children).find(e=>e.children.length===13);
  assert.ok(table,'expected header and twelve monthly rows');
  assert.equal(table.children[1].children[2].children[0].value,'250');
  assert.equal(table.children[1].children[3].children[0].value,'60');
});
test('XLSX selection displays the returned monthly worksheet',async()=>{
  const ui=setup(async()=>[{name:'Synthetic usage',rows,date1904:false,formulaCount:0}]);
  ui.input.files=[{name:'synthetic.xlsx',size:200,arrayBuffer:async()=>new ArrayBuffer(20)}];
  await ui.input.listeners.change();
  assert.match(ui.status.textContent,/Monthly figures extracted/);
  assert.match(ui.review.children[0].textContent,/Synthetic usage/);
});
test('switching to unsupported .xls clears previous extraction confirmation',async()=>{
  const ui=setup();
  ui.input.files=[{name:'synthetic.csv',size:200,text:async()=>rows.map(r=>r.join(',')).join('\n')}];
  await ui.input.listeners.change();
  ui.input.files=[{name:'older.xls',size:200}];
  await ui.input.listeners.change();
  assert.doesNotMatch(ui.status.textContent,/figures extracted/i);
  assert.match(ui.status.textContent,/not been extracted/);
});
test('XLSX sheet without electricity figures is not labelled extracted',async()=>{
  const missing=[['Month','Broadband'],...rows.slice(1).map(r=>[r[0],'60'])];
  const ui=setup(async()=>[{name:'Other services',rows:missing,date1904:false,formulaCount:0}]);
  ui.input.files=[{name:'synthetic.xlsx',size:200,arrayBuffer:async()=>new ArrayBuffer(20)}];
  await ui.input.listeners.change();
  assert.match(ui.status.textContent,/no recognisable monthly table/);
});

test('unlabelled 12-month summary displays combined spending, without claiming kWh or electricity-only spending',async()=>{
  const labels=['Oct','Sep','Aug','Jul','Jun','May','Apr','Mar','Feb','Jan','Dec','Nov'];
  const workbookRows=[['12 Months Power - Retailer'],...labels.map((label,i)=>[label,String(200+i)]),
    ['Total',''],['Less Broadband Charges','1500'],['Notes','Monthly broadband charge of $90 incl GST']];
  const ui=setup(async()=>[{name:'Summary',rows:workbookRows,date1904:false,formulaCount:1}]);
  ui.input.files=[{name:'annual.xlsx',size:300,arrayBuffer:async()=>new ArrayBuffer(16)}];
  await ui.input.listeners.change();
  assert.match(ui.status.textContent,/12 monthly bill amounts recognised/);
  assert.match(JSON.stringify(ui.review.children),/No kWh data supplied/);
  const allText=JSON.stringify(ui.review.children);
  assert.match(allText,/broadband/i);
  assert.doesNotMatch(allText,/electricity-only annual cost/i);
});

function findNode(root,predicate){
  if(predicate(root))return root;
  for(const child of root.children||[]){const found=findNode(child,predicate);if(found)return found;}
  return null;
}
async function confirm(ui){
  const checkbox=findNode(ui.review,x=>x.id==='annualUsageChecked');
  const button=findNode(ui.review,x=>x.textContent==='CONFIRM CHECKED MONTHLY FIGURES');
  assert.ok(checkbox&&button);
  checkbox.checked=true;
  await button.listeners.click();
}
test('confirmed monthly summary is exposed only after explicit review',async()=>{
  const labels=['Oct','Sep','Aug','Jul','Jun','May','Apr','Mar','Feb','Jan','Dec','Nov'];
  const workbookRows=[['Header'],...labels.map((month,i)=>[month,String(200+i)]),
    ['Notes','Monthly broadband charge of $90']];
  const ui=setup(async()=>[{name:'Summary',rows:workbookRows,date1904:false,formulaCount:0}]);
  ui.input.files=[{name:'annual.xlsx',size:300,arrayBuffer:async()=>new ArrayBuffer(16)}];
  await ui.input.listeners.change();
  assert.equal(ui.window.hecAnnualUsageReview.getConfirmedSubmission(),null);
  await confirm(ui);
  const payload=ui.window.hecAnnualUsageReview.getConfirmedSubmission();
  assert.equal(payload.status,'user_confirmed');
  assert.equal(payload.totals.combinedBillNzd,2466);
  assert.equal(payload.totals.kwh,null);
  assert.equal(payload.verifiedForModel,false);
});
test('editing a confirmed monthly value immediately clears confirmation',async()=>{
  const ui=setup();
  ui.input.files=[{name:'synthetic.csv',size:200,text:async()=>rows.map(r=>r.join(',')).join('\n')}];
  await ui.input.listeners.change();
  await confirm(ui);
  assert.ok(ui.window.hecAnnualUsageReview.getConfirmedSubmission());
  const firstNumber=findNode(ui.review,e=>e.type==='number');
  firstNumber.value='300';
  firstNumber.listeners.input();
  assert.equal(ui.window.hecAnnualUsageReview.getConfirmedSubmission(),null);
  await confirm(ui);
  const stored=ui.window.hecAnnualUsageReview.getConfirmedSubmission();
  assert.equal(stored.months[0].kwh,300);
});
test('changing to a different file clears previously confirmed figures',async()=>{
  const ui=setup();
  ui.input.files=[{name:'synthetic.csv',size:200,text:async()=>rows.map(r=>r.join(',')).join('\n')}];
  await ui.input.listeners.change();
  await confirm(ui);
  assert.ok(ui.window.hecAnnualUsageReview.getConfirmedSubmission());
  ui.input.files=[{name:'other.xls',size:30}];
  await ui.input.listeners.change();
  assert.equal(ui.window.hecAnnualUsageReview.getConfirmedSubmission(),null);
});

test('a PDF and the annual XLSX together still display the editable monthly review',async()=>{
  const ui=setup(async()=>[{name:'Synthetic usage',rows,date1904:false,formulaCount:0}]);
  const pdf={name:'winter.pdf',size:100};
  const xlsx={name:'annual.xlsx',size:300,arrayBuffer:async()=>new ArrayBuffer(12)};
  ui.input.files=[pdf,xlsx];
  await ui.input.listeners.change();
  assert.match(ui.status.textContent,/Monthly figures extracted/);
  await confirm(ui);
  const confirmed=ui.window.hecAnnualUsageReview.getConfirmedSubmission();
  assert.equal(confirmed.sourceFile.name,'annual.xlsx');
  assert.equal(confirmed.months.length,12);
});
test('two PDFs and a monthly XLSX can be attached and reviewed together',async()=>{
  const labels=['Oct','Sep','Aug','Jul','Jun','May','Apr','Mar','Feb','Jan','Dec','Nov'];
  const values=[['Header'],...labels.map((m,i)=>[m,String(i+100)])];
  const ui=setup(async()=>[{name:'Combined bills',rows:values,date1904:false,formulaCount:1}]);
  const pdf1={name:'march.pdf',size:110},pdf2={name:'september.pdf',size:120};
  const annual={name:'annual.xlsx',size:200,arrayBuffer:async()=>new ArrayBuffer(12)};
  ui.input.files=[pdf1,pdf2,annual];
  await ui.input.listeners.change();
  assert.match(ui.status.textContent,/12 monthly bill amounts recognised/);
  await confirm(ui);
  assert.equal(ui.window.hecAnnualUsageReview.getConfirmedSubmission().sourceFile.name,'annual.xlsx');
});
test('two CSV/XLSX files leave both attached but do not present an ambiguous extraction',async()=>{
  const ui=setup();
  ui.input.files=[
    {name:'a.csv',size:200,text:async()=>rows.map(r=>r.join(',')).join('\n')},
    {name:'b.xlsx',size:220,arrayBuffer:async()=>new ArrayBuffer(12)}
  ];
  await ui.input.listeners.change();
  assert.match(ui.status.textContent,/has not been extracted/);
  assert.equal(ui.window.hecAnnualUsageReview.getConfirmedSubmission(),null);
});
