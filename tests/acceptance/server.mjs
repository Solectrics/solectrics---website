// Loopback-only, in-memory synthetic acceptance. No inherited credentials or real outbound calls.
import http from 'node:http';import {readFile}from 'node:fs/promises';import path from 'node:path';import {fileURLToPath}from 'node:url';
import {syntheticDb}from '../helpers/synthetic-db.mjs';
import {onRequestPost as enquiry}from '../../functions/api/enquiry.js';
import {onRequestPost as bill}from '../../functions/api/read-bill.js';
import {onRequestPost as email,onRequestGet as emailConfig}from '../../functions/api/hec-email-results.js';
import {onRequestGet as file}from '../../functions/api/job-file.js';
import guard from '../../services/hec-email-guard/worker.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
let db,sql,objects,counts,mode,emails,putCount;function reset(){({db,sql}=syntheticDb());objects=new Map();counts=new Map();mode='success';emails=0;putCount=0;}reset();
const limiter=limit=>({async limit({key}){const k=limit+':'+key+':'+Math.floor(Date.now()/60000);const n=(counts.get(k)||0)+1;counts.set(k,n);return {success:n<=limit};}});
const limits={GLOBAL_LIMIT:limiter(50),IP_LIMIT:limiter(5),RECIPIENT_LIMIT:limiter(1)};
const fixture=(season)=>({billing_days:season==='summer'?31:30,total_import_kwh:season==='summer'?430:1040,electricity_total_incl_gst_nzd:season==='summer'?197.86:413.89,broadband_total_incl_gst_nzd:90,total_bill_nzd:season==='summer'?287.86:503.89,needs_review_fields:['import_rate_cents','daily_fixed_charge_cents']});
globalThis.fetch=async(url,opts)=>{
 const body=JSON.parse(opts.body);
 if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:body.response.startsWith('synthetic-token:'),hostname:body.response.split(':').slice(1).join(':'),action:'hec-email'});
 if(url==='https://api.resend.com/emails'){if(mode==='email-failure')return new Response('Synthetic rejection',{status:503});if(!body.to.every(x=>x.endsWith('@example.invalid')))throw Error('Synthetic recipients only');emails++;return Response.json({id:'synthetic-delivery'});}
 if(url==='https://api.openai.com/v1/responses'){if(mode==='read-failure')return new Response('{}',{status:503});const part=body.input[0].content.find(x=>x.type==='input_file');return Response.json({output_text:JSON.stringify(fixture(part?.filename.includes('winter')?'winter':'summer'))});}
 throw Error('Outbound request disabled');
};
function environment(){return {DB:db,OPENAI_API_KEY:'synthetic',RESEND_API_KEY:'synthetic',HEC_TURNSTILE_SECRET:'synthetic',HEC_TURNSTILE_SITE_KEY:'synthetic',HEC_EMAIL_GUARD:{fetch:async(url,opts)=>guard.fetch(new Request(url,opts),limits)},JOB_FILES:{async put(k,b){objects.set(k,Buffer.from(b));if(++putCount===2&&mode==='upload-failure')throw Error('Synthetic storage failure');},async delete(k){objects.delete(k);},async get(k){return objects.has(k)?{body:objects.get(k),writeHttpMetadata(){}}:null;}}};}
const routes={'/api/enquiry':enquiry,'/api/read-bill':bill,'/api/hec-email-results':email,'/api/job-file':file};
http.createServer(async(req,res)=>{try{
 const host=req.headers.host||'localhost:8766';const local=new URL('http://'+host);if(!['localhost','127.0.0.1'].includes(local.hostname)&&!local.hostname.endsWith('.app.github.dev')){res.writeHead(403).end();return;}
 const url=new URL(req.url,local);const headers=new Headers(req.headers);headers.set('CF-Connecting-IP','192.0.2.1');
 if(url.pathname==='/__reset'&&req.method==='POST'){sql.close();reset();res.end('reset');return;}
 if(url.pathname==='/__mode'&&req.method==='POST'){mode=url.searchParams.get('value');putCount=0;res.end('ok');return;}
 if(url.pathname==='/__state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enquiries:sql.prepare('SELECT count(*) n FROM enquiries').get().n,jobs:sql.prepare('SELECT count(*) n FROM jobs').get().n,files:sql.prepare('SELECT count(*) n FROM job_files').get().n,objects:objects.size,emails,nextActions:sql.prepare('SELECT next_action FROM jobs ORDER BY id').all()}));return;}
 if(url.pathname==='/__turnstile.js'){res.setHeader('Content-Type','text/javascript');res.end("window.turnstile={render:(el,opts)=>{el.textContent='Synthetic verification (no external service)';setTimeout(()=>opts.callback('synthetic-token:'+location.hostname),20);return 'mock';},remove:()=>{}};");return;}
 if(routes[url.pathname]){
  const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>26000000){res.writeHead(413).end();return;}chunks.push(c);}
  const origin=headers.get('origin');if(origin&&new URL(origin).host===host)url.protocol=new URL(origin).protocol;
  const request=new Request(url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
  const handler=url.pathname==='/api/hec-email-results'&&req.method==='GET'?emailConfig:routes[url.pathname];
  const response=await handler({request,env:environment()});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 if(!/^\/(home-energy-check\.html|assets\/[\w.-]+|[\w-]+\.png)$/.test(url.pathname)){res.writeHead(404).end();return;}
 let body=await readFile(path.join(root,url.pathname));if(url.pathname.endsWith('.html'))body=Buffer.from(body.toString().replace('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit','/__turnstile.js'));
 res.setHeader('Content-Type',url.pathname.endsWith('.html')?'text/html':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'image/png');res.end(body);
}catch{res.writeHead(500).end('Synthetic acceptance error');}}).listen(8766,'127.0.0.1',()=>console.log('Synthetic HEC acceptance: http://localhost:8766/home-energy-check.html (no external services)'));
