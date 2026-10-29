// Service binding only: deploy without public routes or workers.dev.
export default {async fetch(request,env){
 try{
  if(request.method!=='POST')return new Response(null,{status:405});
  const {ip,recipient}=await request.json();
  if(![ip,recipient].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))return new Response(null,{status:400});
  for(const [name,key] of [['GLOBAL_LIMIT','hec-email'],['IP_LIMIT',ip],['RECIPIENT_LIMIT',recipient]]){
   if(!env[name]?.limit)return new Response(null,{status:503});
   if((await env[name].limit({key})).success!==true)return new Response(null,{status:429});
  }
  return new Response(null,{status:204});
 }catch{return new Response(null,{status:503});}
}};
