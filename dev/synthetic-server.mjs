import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {syntheticDb,seedJobs} from '../tests/helpers/synthetic-db.mjs';
import {syntheticAccess} from '../tests/helpers/synthetic-access.mjs';
import {onRequest as rootMiddleware} from '../functions/_middleware.js';
import {onRequest as apiMiddleware} from '../functions/api/_middleware.js';
import {ACCEPTANCE_HOST} from '../functions/api/_usability-staging.js';
const staging=process.argv.includes('--staging'),access=staging?await syntheticAccess():null;
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const {db,sql}=syntheticDb();seedJobs(sql);
sql.prepare('INSERT INTO system_designs(job_id,data_json) VALUES(?,?)').run(9101,JSON.stringify({design_reviewed:true,design_retailer:'Synthetic previously reviewed decision'}));
const objects=new Map();
const bucket={async put(key,body){const b=body instanceof ArrayBuffer?Buffer.from(body):Buffer.from(await new Response(body).arrayBuffer());objects.set(key,b);},async get(key){const b=objects.get(key);return b?{body:b,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),writeHttpMetadata(h){h.set('content-type','application/pdf');}}:null;},async head(key){return objects.has(key)?{}:null;}};
for(const [id,role,name]of [['synthetic-layout','roof_layout','synthetic-layout.pdf'],['synthetic-sld','sld','synthetic-sld.pdf'],['synthetic-bill','power_bill','synthetic-bill.pdf']]){const key='jobs/9101/'+name;objects.set(key,Buffer.from('%PDF-1.4\nSynthetic document only'));sql.prepare('INSERT INTO job_files(id,job_id,storage_key,original_name,content_type,size_bytes,category,document_role) VALUES(?,?,?,?,?,?,?,?)').run(id,9101,key,name,'application/pdf',34,'drawing',role);}
sql.prepare('INSERT INTO customer_quote_versions(id,job_id,version_number,status,snapshot_json,source_hash) VALUES(?,?,?,?,?,?)').run('synthetic-issued',9101,1,'issued','{"customer":{"name":"Synthetic Alpha"},"options":[],"issued":"immutable"}','synthetic');
const env={DB:db,JOB_FILES:bucket,JOBHUB_USABILITY_LOCAL_ONLY:'true'};
if(staging)Object.assign(env,access.env,{JOBHUB_USABILITY_LOCAL_ONLY:'false'});
globalThis.fetch=staging?access.jwksFetch:async()=>{throw Error('External provider access disabled for synthetic local testing');};
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,staging?'https://'+ACCEPTANCE_HOST:'http://localhost:8765');
 if(staging&&url.pathname==='/__synthetic_token'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:await access.token()}));return;}
 if(url.pathname==='/__synthetic_state'){const answers=JSON.parse(sql.prepare('SELECT answers_json FROM enquiries WHERE id=9101').get().answers_json);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({answers,jobs:sql.prepare('SELECT COUNT(*) n FROM jobs').get().n,enquiries:sql.prepare('SELECT COUNT(*) n FROM enquiries').get().n,files:sql.prepare('SELECT id,document_role,original_name FROM job_files').all(),tasks:sql.prepare('SELECT * FROM job_tasks').all(),quotes:sql.prepare('SELECT id,snapshot_json,status FROM customer_quote_versions').all()}));return;}
 if(url.pathname.startsWith('/api/')){
 const name=url.pathname.slice(5);if(!/^[a-z-]+$/.test(name))throw Error('Invalid route');
 const mod=await import(pathToFileURL(root+'/functions/api/'+name+'.js'));
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
 const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body,duplex:'half'})});
 const fn=mod['onRequest'+req.method[0]+req.method.slice(1).toLowerCase()];if(!fn){res.writeHead(405);res.end();return;}
 const context={request,env,data:{}};context.next=()=>apiMiddleware({...context,next:()=>fn(context)});const response=await rootMiddleware(context);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/mini-fergus.html';if(!path.extname(pathname))pathname+='.html';
 const target=path.resolve(root,'.'+pathname);if(!target.startsWith(root+'/')||pathname.startsWith('/snapshots')||pathname.includes('/.git'))throw Error('Invalid path');
 const body=await readFile(target),type=({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.pdf':'application/pdf'})[path.extname(target)]||'application/octet-stream';const response=await rootMiddleware({request:new Request(url,{headers:req.headers}),env,data:{},next:async()=>new Response(body,{headers:{'Content-Type':type}})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error(req.url,e.message);res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Synthetic server: '+e.message}));}
});
server.listen(8765,'127.0.0.1',()=>console.log('Synthetic-only local server http://localhost:8765 (no real records, keys, emails or provider requests)'));
