import { sendHomeEnergyCheckCopy } from "./_hec-customer-copy.js";

// Email-only: never writes to D1/R2 and does not create a Solectrics enquiry.
// Rate limiting / abuse controls must be configured and verified before production release.
export async function onRequestPost({request,env}) {
  try {
    const length=Number(request.headers.get("content-length")||0);
    if(length>16000) return Response.json({ok:false,error:"Request too large"},{status:413});
    const raw=await request.text();
    if(raw.length>16000) return Response.json({ok:false,error:"Request too large"},{status:413});
    const payload=JSON.parse(raw);
    const answers=payload?.answers;
    if(!answers || typeof answers!=="object" || Array.isArray(answers))
      return Response.json({ok:false,error:"Invalid results"},{status:400});
    const recipient=String(answers.email||"").trim();
    if(recipient.length>254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(recipient))
      return Response.json({ok:false,error:"A valid email address is required"},{status:400});
    // Customer email only: do not accept copied internal metadata or file contents.
    const safe={...answers, customerCopyOptIn:false};
    delete safe.internalNotes;
    delete safe.supplierPricing;
    delete safe.costing;
    delete safe.energyDataUploads;
    await sendHomeEnergyCheckCopy(env,safe,recipient);
    return Response.json({ok:true});
  }catch(error){
    console.error("HEC email-only delivery failed:",error);
    return Response.json({ok:false,error:"Could not send results"},{status:502});
  }
}
