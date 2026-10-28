import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/enquiry.js';
import {reviewMonthlyBillSummary} from '../assets/hec-annual-usage-reader.mjs';
import {makeConfirmedAnnualReview} from '../assets/hec-annual-review-data.mjs';

function fixture(){
  const pdfA=new File(['synthetic summer bill'],'summer.pdf',{type:'application/pdf'});
  const pdfB=new File(['synthetic winter bill'],'winter.pdf',{type:'application/pdf'});
  const spreadsheet=new File(['synthetic annual data'],'annual.xlsx',{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const months=['Oct','Sep','Aug','Jul','Jun','May','Apr','Mar','Feb','Jan','Dec','Nov'];
  const parsed=reviewMonthlyBillSummary([
    ['Synthetic monthly bills'],
    ...months.map((label,index)=>[label,150+index]),
    ['Notes','Monthly broadband charge of $65']
  ]);
  assert.ok(parsed);
  const confirmed=makeConfirmedAnnualReview(parsed,
    parsed.months.map(month=>({combinedBillNzd:month.combinedNzd})),spreadsheet);
  return {pdfA,pdfB,spreadsheet,confirmed};
}
function mockEnvironment(confirmed){
  const db={queries:[],savedAnswers:null};
  db.prepare=sql=>{
    const stmt={
      parameters:[],
      bind(...parameters){this.parameters=parameters;return this;},
      async all(){return{results:[
        {name:'job_type'},{name:'document_role'},{name:'energy_data_detail'}
      ]};},
      async run(){
        db.queries.push({sql,params:this.parameters});
        if(/INSERT INTO enquiries/i.test(sql)){
          db.savedAnswers=JSON.parse(this.parameters[6]);
          return{meta:{last_row_id:101}};
        }
        if(/INSERT INTO jobs/i.test(sql))return{meta:{last_row_id:202}};
        return{meta:{changes:1}};
      }
    };
    return stmt;
  };
  const bucket={
    uploaded:[],
    async put(key,buffer,options){this.uploaded.push({key,originalName:options.customMetadata.originalName});},
    async delete(key){}
  };
  const {pdfA,pdfB,spreadsheet}=fixture();
  const answers={name:'Synthetic Household',email:'household@example.invalid',customerCopyOptIn:false};
  if(confirmed!==undefined)answers.annualUsageReview=confirmed;
  const form=new FormData();
  form.append('answers',JSON.stringify(answers));
  form.append('summer_bill',pdfA,pdfA.name);
  form.append('winter_bill',pdfB,pdfB.name);
  form.append('annual_usage_files',spreadsheet,spreadsheet.name);
  const request=new Request('https://test.invalid/api/enquiry',{method:'POST',body:form});
  return{db,bucket,context:{env:{DB:db,JOB_FILES:bucket},request}};
}
test('two PDFs plus confirmed annual spreadsheet create linked job/files and preserve units',async()=>{
  const {confirmed}=fixture();
  const state=mockEnvironment(confirmed);
  const response=await onRequestPost(state.context);
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.annualReviewSaved,true);
  assert.deepEqual(state.bucket.uploaded.map(file=>file.originalName),
    ['summer.pdf','winter.pdf','annual.xlsx']);
  const stored=state.db.queries.filter(item=>/INSERT INTO job_files/i.test(item.sql));
  assert.equal(stored.length,3);
  assert.deepEqual(stored.map(item=>item.params[7]),['power_bill','power_bill','annual_usage']);
  assert.equal(state.db.savedAnswers.annualUsageReview.months.length,12);
  assert.equal(state.db.savedAnswers.annualUsageReview.verifiedForModel,false);
  assert.equal(state.db.savedAnswers.annualUsageReview.totals.kwh,null);
  assert.equal(state.db.savedAnswers.annualUsageReview.totals.electricityNzd,null);
});
test('same three attachments still submit when customer skips monthly confirmation',async()=>{
  const state=mockEnvironment(undefined);
  const response=await onRequestPost(state.context);
  assert.equal(response.status,200);
  assert.equal(state.bucket.uploaded.length,3);
  assert.equal(state.db.savedAnswers.annualUsageReview,undefined);
});
test('invalid monthly confirmation cannot create an enquiry or upload data',async()=>{
  const {confirmed}=fixture();
  const invalid={...confirmed,sourceFile:{...confirmed.sourceFile,size:9999}};
  const state=mockEnvironment(invalid);
  const response=await onRequestPost(state.context);
  assert.equal(response.status,400);
  assert.equal(state.bucket.uploaded.length,0);
  assert.equal(state.db.queries.length,0);
});
