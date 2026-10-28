import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve(process.cwd());
const pdfStub=Buffer.from('%PDF-1.4\n% Synthetic PDF only - no customer information\n%%EOF\n');
const months=['Oct','Sep','Aug','Jul','Jun','May','Apr','Mar','Feb','Jan','Dec','Nov'];
const xmlEsc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const inlineCell=(r,col,value)=>'<c r="'+col+r+'" t="inlineStr"><is><t>'+xmlEsc(value)+'</t></is></c>';
const moneyCell=(r,col,value)=>'<c r="'+col+r+'"><v>'+value+'</v></c>';

async function syntheticXlsx() {
  const dir=await mkdtemp(join(tmpdir(),'hec-e2e-'));
  await mkdir(join(dir,'xl','worksheets'),{recursive:true});
  await mkdir(join(dir,'xl','_rels'),{recursive:true});
  const top='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const rows=[
    '<row r="1">'+inlineCell(1,'A','12 months combined electricity and broadband bills')+'</row>',
    ...months.map((m,i)=>{
      const row=i+2;
      return '<row r="'+row+'">'+inlineCell(row,'A',m)+moneyCell(row,'B',200+i)+'</row>';
    }),
    '<row r="14">'+inlineCell(14,'A','Less Broadband Charges')+moneyCell(14,'B',1386)+'</row>',
    '<row r="15">'+inlineCell(15,'A','Notes')+inlineCell(15,'B','Monthly broadband charge of $90 and household overseas for four months')+'</row>',
    '<row r="16"><c r="B16"><f>SUM(B2:B13)</f><v>2466</v></c></row>'
  ];
  const sheet=top+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.join('')+'</sheetData></worksheet>';
  const wb=top+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Annual spending" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rel=top+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const types=top+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';
  await writeFile(join(dir,'xl','worksheets','sheet1.xml'),sheet);
  await writeFile(join(dir,'xl','workbook.xml'),wb);
  await writeFile(join(dir,'xl','_rels','workbook.xml.rels'),rel);
  await writeFile(join(dir,'[Content_Types].xml'),types);
  const file=join(dir,'synthetic.xlsx');
  const zipped=spawnSync('zip',['-q','-r',file,'[Content_Types].xml','xl'],{cwd:dir,encoding:'utf8'});
  if(zipped.status!==0)throw new Error('Could not create synthetic ZIP fixture: '+zipped.stderr);
  return {dir,bytes:await readFile(file)};
}

const mimetypes={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const captured=[];
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/api/read-bill'&&req.method==='POST'){
      const body=[];
      for await (const chunk of req)body.push(chunk);
      const raw=Buffer.concat(body).toString('latin1');
      const isWinter=raw.includes('winter');
      const response={
        retailer:'Synthetic Energy',billing_days:30,
        total_import_kwh:isWinter?680:520,average_daily_kwh:isWinter?22.67:17.33,
        total_bill_nzd:isWinter?360:280,electricity_charges_nzd:isWinter?280:200,
        non_electricity_charges_nzd:80,electricity_cost_separation_status:'separated',
        import_rate_cents:30,import_rate_gst_basis:'inclusive',
        daily_fixed_charge_cents:150,daily_fixed_charge_gst_basis:'inclusive',
        charged_import_kwh:isWinter?640:480,free_import_kwh:40,
        free_import_schedule:'Free weekend electricity',
        needs_review_fields:[]
      };
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(response));return;
    }
    if(url.pathname==='/api/enquiry'&&req.method==='POST'){
      const chunks=[];for await (const chunk of req)chunks.push(chunk);
      const body=Buffer.concat(chunks);
      captured.push({body,contentType:req.headers['content-type']});
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true,enquiryRef:999001,jobId:999002,annualReviewSaved:true}));return;
    }
    const path=resolve(root,'.'+url.pathname);
    if(!path.startsWith(root+sep)&&path!==root){res.writeHead(403);res.end();return;}
    const data=await readFile(path);
    res.writeHead(200,{'Content-Type':mimetypes[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  }catch(err){res.writeHead(404);res.end('Not found');}
});
async function listen(server) {await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;}
const steps=[];
function check(name,condition){assert.ok(condition,'Browser check failed: '+name);steps.push(name);console.log('PASS '+name);}

let browser,fixture;
try{
  fixture=await syntheticXlsx();
  const port=await listen(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1200,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+port+'/home-energy-check.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.hecAnnualUsageReview?.getConfirmedSubmission==='function');
  check('Full real HEC page loads and review bridge is available',true);
  const pdfA={name:'summer.pdf',mimeType:'application/pdf',buffer:pdfStub};
  const pdfB={name:'winter.pdf',mimeType:'application/pdf',buffer:pdfStub};
  const xlsx={name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fixture.bytes};
  await page.locator('#summerBill').setInputFiles(pdfA);
  await page.locator('#winterBill').setInputFiles(pdfB);
  await page.evaluate(async()=>{await readBill('summer');await readBill('winter');});
  const pdfRead=await page.evaluate(()=>({
    summer:document.getElementById('summerStatus').textContent,
    winter:document.getElementById('winterStatus').textContent
  }));
  check('Two independent PDF uploads read and review successfully',pdfRead.summer.includes('Bill read')&&pdfRead.winter.includes('Bill read'));
  await page.locator('#annualUsageFiles').setInputFiles(xlsx);
  await page.waitForFunction(()=>document.getElementById('annualUsageStatus').textContent.includes('12 monthly bill amounts recognised'));
  check('Compressed XLSX parser displays 12 yearless combined bill rows',await page.locator('#annualUsageReview input[type=number]').count()===12);
  check('Formulas are disclosed, rather than silently trusted', (await page.locator('#annualUsageReview').innerText()).includes('formulas'));
  await page.evaluate(()=>{
    document.getElementById('annualUsageChecked').checked=true;
    Array.from(document.querySelectorAll('#annualUsageReview button')).find(b=>b.textContent.includes('CONFIRM CHECKED MONTHLY FIGURES')).click();
  });
  let payload=await page.evaluate(()=>window.hecAnnualUsageReview.getConfirmedSubmission());
  check('Explicit confirmation retains combined dollars but no kWh',payload?.totals?.combinedBillNzd===2466&&payload?.totals.kwh===null&&payload.verifiedForModel===false);
  await page.evaluate(()=>{
    const input=document.querySelector('#annualUsageReview input[type=number]');
    input.value='250';input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  check('Editing monthly figure invalidates old confirmation',await page.evaluate(()=>window.hecAnnualUsageReview.getConfirmedSubmission()===null));
  await page.evaluate(()=>{
    document.getElementById('annualUsageChecked').checked=true;
    Array.from(document.querySelectorAll('#annualUsageReview button')).find(b=>b.textContent.includes('CONFIRM CHECKED MONTHLY FIGURES')).click();
  });
  payload=await page.evaluate(()=>window.hecAnnualUsageReview.getConfirmedSubmission());
  check('Updated confirmation recalculates annual combined total',payload?.totals?.combinedBillNzd===2516);
  await page.locator('#annualUsageFiles').setInputFiles([pdfA,pdfB,xlsx]);
  await page.waitForFunction(()=>document.getElementById('annualUsageStatus').textContent.includes('12 monthly bill amounts recognised'));
  check('Two PDFs alongside one XLSX do not block the monthly preview',await page.locator('#annualUsageReview input[type=number]').count()===12);
  await page.evaluate(()=>{window.__previousAnnualApproval=document.getElementById('annualUsageChecked');});
  await page.locator('#annualUsageFiles').setInputFiles(xlsx);
  // The *old* checkbox may exist while the new spreadsheet is still loading.
  // Confirm only against the freshly rendered checkbox, not a stale one.
  await page.waitForFunction(()=>{
    const current=document.getElementById('annualUsageChecked');
    return current&&current!==window.__previousAnnualApproval;
  });
  await page.waitForFunction(()=>document.getElementById('annualUsageStatus').textContent.includes('12 monthly bill amounts recognised'));
  await page.evaluate(()=>{
    document.getElementById('annualUsageChecked').checked=true;
    Array.from(document.querySelectorAll('#annualUsageReview button')).find(b=>b.textContent.includes('CONFIRM CHECKED MONTHLY FIGURES')).click();
  });
  const response=await page.evaluate(async()=>{
    answers.name='Synthetic Browser Household';answers.email='synthetic@example.invalid';
    document.getElementById('customerCopyConsent').checked=false;
    return await submitHomeEnergyCheck();
  });
  check('Actual HEC form submits to local mock endpoint',response?.ok===true&&captured.length===1);
  const submitted=captured[0].body.toString('latin1');
  check('FormData includes both PDF bill files and original XLSX',submitted.includes('name="summer_bill"')&&submitted.includes('name="winter_bill"')&&submitted.includes('name="annual_usage_files"'));
  check('FormData persists checked monthly figures without modelling status',submitted.includes('annualUsageReview')&&submitted.includes('user_confirmed')&&submitted.includes('verifiedForModel'));
  check('Browser reports no uncaught page exceptions',errors.length===0);
  const mobile=await browser.newContext({viewport:{width:390,height:844}});
  const phone=await mobile.newPage();
  const mobileErrors=[];phone.on('pageerror',e=>mobileErrors.push(e.message));
  await phone.goto('http://127.0.0.1:'+port+'/home-energy-check.html',{waitUntil:'domcontentloaded'});
  await phone.locator('#annualUsageFiles').setInputFiles(xlsx);
  await phone.waitForFunction(()=>document.getElementById('annualUsageStatus').textContent.includes('12 monthly bill amounts recognised'));
  const metrics=await phone.evaluate(()=>({
    tableRows:document.querySelectorAll('#annualUsageReview table tr').length,
    scrollWidth:document.documentElement.scrollWidth,
    viewport:document.documentElement.clientWidth
  }));
  check('Mobile review renders all twelve months',metrics.tableRows===13&&mobileErrors.length===0);
  // The monthly table has its own horizontal scroller; avoid a page-wide overflow.
  check('Mobile page does not overflow horizontally',metrics.scrollWidth<=metrics.viewport+3);
  await mobile.close();await context.close();
  console.log('PASS '+steps.length+' integrated browser checks; no live network/service use');
}catch(error){
  console.error('INTEGRATED BROWSER TEST FAILURE:',error?.stack||String(error));
  process.exitCode=1;
}finally{
  await browser?.close();
  if(server.listening)await new Promise(r=>server.close(r));
  if(fixture?.dir)await rm(fixture.dir,{recursive:true,force:true});
}