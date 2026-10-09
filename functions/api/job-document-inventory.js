// Staging-only, SELECT + R2 HEAD inventory. No schema initialisation or writes.
const HOST = 'fletcher-package-mobile-fix.solectrics-jobhub-staging.pages.dev';
export async function onRequestGet({request, env}) {
  const url = new URL(request.url);
  if (env.JOBHUB_STAGING_ONLY !== 'true' || env.ALLOW_PAGES_DEV_HOST !== 'true' || url.hostname !== HOST) return new Response('Not found', {status:404});
  const ids = [...new Set((url.searchParams.get('job_ids') || url.searchParams.get('job_id') || '').split(',').map(Number))];
  if (!ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return Response.json({ok:false,error:'Supply 1–50 valid job IDs'}, {status:400});
  if (!env.DB || !env.JOB_FILES) return Response.json({ok:false,error:'Staging document bindings unavailable'}, {status:503});
  try {
    const placeholders=ids.map(()=>'?').join(',');
    const jobs=await env.DB.prepare(`SELECT id, job_type, job_status FROM jobs WHERE id IN (${placeholders})`).bind(...ids).all();
    const rows=await env.DB.prepare(`SELECT id, job_id, storage_key, original_name, content_type, size_bytes, category, caption, document_role, energy_data_detail, uploaded_at FROM job_files WHERE job_id IN (${placeholders}) ORDER BY uploaded_at DESC, id DESC`).bind(...ids).all();
    let checked=0;
    const files=(rows.results || []).map(file => ({...file, accessibility:"unknown"}));
    // Bound request fan-out; unchecked files stay unverified, never "Received".
    for(let start=0;start<Math.min(files.length,200);start+=4) {
      await Promise.all(files.slice(start,start+4).map(async file=>{
        if(checked++>=200)return;
        try {const object=await env.JOB_FILES.head(file.storage_key);file.accessibility=object?'accessible':'unavailable';}
        catch {file.accessibility='unknown';}
      }));
    }
    return Response.json({ok:true,jobs:(jobs.results||[]).map(job=>({...job,files:files.filter(file=>Number(file.job_id)===Number(job.id)).map(({storage_key,...file})=>({...file,accessibility:file.accessibility||'unknown'}))}))}, {headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({ok:false,error:'Document inventory could not be verified. No document status can be assumed.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
