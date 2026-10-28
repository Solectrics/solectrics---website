// Limited XLSX reader for Home Energy Check. Runs in the browser; sends no data elsewhere.
// Rejects encrypted/oversized archives, external worksheets and formula-derived values.
const MAX_FILE=12*1024*1024, MAX_ENTRY=6*1024*1024, MAX_TOTAL=16*1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});
const fail=m=>{throw new Error(m);};
function range(n,p,k){if(!Number.isSafeInteger(p)||!Number.isSafeInteger(k)||p<0||k<0||p+k>n)fail('Invalid Excel archive');}
function readEntries(buffer){
  if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength||buffer.byteLength>MAX_FILE)fail('Excel file exceeds the 12 MB limit');
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)
    if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)fail('Not a valid .xlsx ZIP archive');
  if(view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)fail('Multi-disk ZIP is not supported');
  const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(!count||count>512||count===0xffff||length===0xffffffff||offset===0xffffffff)fail('Excel archive is too complex');
  range(bytes.length,offset,length);
  const entries=new Map();let pos=offset,total=0;
  for(let i=0;i<count;i++){
    range(bytes.length,pos,46);
    if(view.getUint32(pos,true)!==0x02014b50)fail('Invalid ZIP directory');
    const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true);
    const compressed=view.getUint32(pos+20,true),uncompressed=view.getUint32(pos+24,true);
    const n=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true);
    const localOffset=view.getUint32(pos+42,true);
    range(bytes.length,pos+46,n+extra+comment);
    const name=decoder.decode(bytes.subarray(pos+46,pos+46+n));
    if(flags&1||![0,8].includes(method))fail('Encrypted or unsupported Excel archive');
    if(uncompressed>MAX_ENTRY||compressed>MAX_FILE)fail('Excel worksheet exceeds the safe reading limit');
    if(name.startsWith('/')||name.includes('..')||name.includes('\\'))fail('Unsafe Excel archive entry');
    total+=uncompressed;if(total>MAX_TOTAL)fail('Excel archive expands beyond the safety limit');
    if(entries.has(name))fail('Duplicate Excel archive entry');
    entries.set(name,{method,compressed,uncompressed,localOffset});
    pos+=46+n+extra+comment;
  }
  return {entries,bytes,view};
}
async function fileText(zip,name){
  const e=zip.entries.get(name);if(!e)return null;
  const {bytes,view}=zip,p=e.localOffset;range(bytes.length,p,30);
  if(view.getUint32(p,true)!==0x04034b50)fail('Invalid Excel archive member');
  const start=p+30+view.getUint16(p+26,true)+view.getUint16(p+28,true);
  range(bytes.length,start,e.compressed);
  const raw=bytes.slice(start,start+e.compressed);let result;
  if(e.method===0)result=raw;
  else {
    if(typeof DecompressionStream!=='function')fail('This browser cannot read compressed Excel files; please export a CSV');
    try {
      const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader=stream.getReader(),parts=[];let length=0;
      while(true){
        const {value,done}=await reader.read();if(done)break;
        length+=value.byteLength;
        if(length>MAX_ENTRY){await reader.cancel();fail('Excel worksheet exceeds the safe reading size');}
        parts.push(value);
      }
      result=new Uint8Array(length);let i=0;
      for(const part of parts){result.set(part,i);i+=part.length;}
    }catch(error){if(/safe reading size/.test(String(error)))throw error;fail('Unable to decompress Excel worksheet');}
  }
  if(result.byteLength!==e.uncompressed)fail('Excel archive length mismatch');
  return decoder.decode(result);
}
function xml(text){
  if(!text||/<!DOCTYPE|<!ENTITY/i.test(text))fail('Unsupported Excel XML declarations');
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)fail('Malformed Excel XML');
  return doc;
}
const tags=(parent,name)=>Array.from(parent.getElementsByTagNameNS('*',name));
function cellValue(cell,strings){
  const type=cell.getAttribute('t');
  if(tags(cell,'f').length)return {value:null,formula:true}; // No formula execution or cached formula trust.
  if(type==='inlineStr')return {value:tags(cell,'t').map(t=>t.textContent).join(''),formula:false};
  const value=tags(cell,'v')[0]?.textContent??'';
  if(type==='s'){
    const index=Number(value);
    if(!Number.isInteger(index)||index<0||index>=strings.length)fail('Invalid Excel shared string index');
    return {value:strings[index],formula:false};
  }
  return {value,formula:false};
}
function readSheet(sheet,strings){
  const rows=[];let formulaCount=0,rowCount=0;
  for(const row of tags(sheet,'row')){
    if(++rowCount>1000)fail('Excel worksheet has over 1,000 rows; please export monthly totals to CSV');
    const data=[];
    for(const cell of tags(row,'c')){
      const col=/^[A-Z]+/i.exec(cell.getAttribute('r')||'')?.[0]?.toUpperCase();
      if(!col)continue;
      let index=0;for(const ch of col)index=index*26+ch.charCodeAt(0)-64;index--;
      if(index<0||index>=64)continue;
      const result=cellValue(cell,strings);
      if(result.formula)formulaCount++;
      data[index]=result.value;
    }
    if(data.some(v=>v!==undefined&&String(v).trim()))rows.push(Array.from({length:data.length},(_,i)=>data[i]??''));
  }
  return {rows,formulaCount};
}
function sheetPaths(workbook,rels){
  const map=new Map();
  for(const rel of tags(rels,'Relationship')){
    const id=rel.getAttribute('Id'),target=rel.getAttribute('Target'),type=rel.getAttribute('Type');
    if(id&&type?.endsWith('/worksheet')&&target&&rel.getAttribute('TargetMode')!=='External'){
      const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
      if(/^xl\/worksheets\/[a-zA-Z0-9_.-]+\.xml$/.test(path))map.set(id,path);
    }
  }
  return tags(workbook,'sheet').slice(0,12).map(sheet=>{
    const id=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id');
    return {name:sheet.getAttribute('name')||'Sheet',path:map.get(id)};
  }).filter(sheet=>sheet.path);
}
export async function readXlsxRows(buffer){
  const zip=readEntries(buffer);
  const [wb,rels,shared]=await Promise.all([
    fileText(zip,'xl/workbook.xml'),fileText(zip,'xl/_rels/workbook.xml.rels'),fileText(zip,'xl/sharedStrings.xml')
  ]);
  if(!wb||!rels)fail('Excel workbook structure not found');
  const workbook=xml(wb),relationships=xml(rels);
  const date1904=['1','true'].includes(tags(workbook,'workbookPr')[0]?.getAttribute('date1904'));
  const strings=shared?tags(xml(shared),'si').map(si=>tags(si,'t').map(t=>t.textContent).join('')):[];
  const sheets=[];
  for(const entry of sheetPaths(workbook,relationships)){
    const text=await fileText(zip,entry.path);if(!text)continue;
    sheets.push({name:entry.name,date1904,...readSheet(xml(text),strings)});
  }
  if(!sheets.length)fail('No supported Excel worksheets found');
  return sheets;
}
