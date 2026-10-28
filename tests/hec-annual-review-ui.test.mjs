import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseCsv,reviewMonthlyRows,reviewMonthlyBillSummary} from '../assets/hec-annual-usage-reader.mjs';

const html=await readFile(new URL('../home-energy-check.html',import.meta.url),'utf8');
const script=html.match(/<script type="module">\s*import \{parseCsv,reviewMonthlyRows\}[\s\S]*?<\/script>/)?.[0];
assert.ok(script,'Monthly review module must be present');
const code=script.replace(/^<script type="module">/,'').replace(/<\/script>$/,'').replace(/^import .*;\s*$/gm,'');

class Element{
  constructor(){this.children=[];this.listeners={};this.files=[];this.textContent='';this.className='';this.style={};}
  appendChild(c){this.children.push(c);return c;}
  replaceChildren(){this.children=[];this.textContent='';}
  addEventListener(type,callback){this.listeners[type]=callback;}
}
function setup(readXlsxRows=async()=>[]){
  const input=new Element(),status=new Element(),review=new Element();
  const elements={annualUsageFiles:input,annualUsageStatus:status,annualUsageReview:review};
  const document={
    getElementById:id=>elements[id]||null,
    createElement:()=>new Element()
  };
  vm.runInNewContext(code,{document,parseCsv,reviewMonthlyRows,reviewMonthlyBillSummary,readXlsxRows});
  return {input,status,review};
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
  assert.equal(table.children[1].children[2].textContent,'250');
  assert.equal(table.children[1].children[3].textContent,'60');
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
  assert.match(ui.status.textContent,/no kWh extracted/);
  const allText=JSON.stringify(ui.review.children);
  assert.match(allText,/broadband/i);
  assert.doesNotMatch(allText,/electricity-only annual cost/i);
});
