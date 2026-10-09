(function(root){
  const roleNames={power_bill:'Customer power bill',roof_layout:'OpenSolar roof / panel layout',sld:'Single-line diagram (SLD)',fletcher_assessment:'Completed Fletcher PDF'};
  function inferredRole(file){
    if(file.document_role && file.document_role!=='general')return {role:file.document_role,inferred:false};
    const text=`${file.original_name||''} ${file.caption||''}`.toLowerCase();
    if(/\bsld\b|single[- ]line/.test(text))return {role:'sld',inferred:true};
    if(/roof.*(layout|plan)|panel.*layout/.test(text))return {role:'roof_layout',inferred:true};
    if(/(power|electricity).*bill|bill.*(power|electricity)/.test(text))return {role:'power_bill',inferred:true};
    return {role:'general',inferred:false};
  }
  function packageStatus(files,required){
    return Object.entries(roleNames).map(([role,label])=>{
      const matches=files.filter(f=>inferredRole(f).role===role);
      const latest=matches[0]; // Inventory is newest first, as the Fletcher selector is.
      const must=required && ['power_bill','roof_layout','fletcher_assessment'].includes(role);
      const status=latest?(latest.accessibility==='accessible'&&!inferredRole(latest).inferred?'received':'review'):(must?'missing':'optional');
      return {role,label,status,file:latest,reason:latest?inferredRole(latest).inferred?'Document use inferred from name; check classification':latest.accessibility!=='accessible'?'Stored file could not be verified':'Accessible attachment confirmed':must?'Required for the Fletcher package':'Optional / no current requirement confirmed'};
    });
  }
  function group(file){
    const r=inferredRole(file).role;
    if(['power_bill','annual_usage','additional_power_bill'].includes(r))return 'Energy & HEC';
    if(['sld','roof_layout'].includes(r)||file.category==='drawing')return 'Design & OpenSolar';
    if(['supplier_quote','supplier_invoice','fletcher_assessment'].includes(r)||file.category==='supplier')return 'Supplier Quotes';
    if(r==='certificate'||['certificate','testing'].includes(file.category))return 'Compliance';
    if(['completed','wiring','fixings','labels'].includes(file.category))return 'Installation';
    if(['site_photo','roof','switchboard','meter','cable_route','equipment'].includes(file.category))return 'Site Visit';
    return 'Other / Unclassified';
  }
  const api={inferredRole,packageStatus,group};root.JobDocumentLibrary=api;
})(globalThis);
