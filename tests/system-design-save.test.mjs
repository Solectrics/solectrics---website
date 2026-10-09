import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../assets/system-design-save.js',import.meta.url),'utf8');const context=vm.createContext({});vm.runInContext(code,context);const {create}=context.SystemDesignSave;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
test('manual save and autosave share one in-flight request and success state',async()=>{
 let writes=0;const states=[],request=deferred();const controller=create({read:()=>({count:20}),write:async()=>{writes++;await request.promise;},state:s=>states.push(s),saved(){}});
 controller.initialise(true);controller.dirty();const manual=controller.save(),auto=controller.save();assert.equal(manual,auto);await Promise.resolve();assert.equal(writes,1);assert.equal(states.at(-1),'saving');request.resolve();assert.equal(await manual,true);assert.equal(states.at(-1),'saved');
});
test('edits during a save are sent serially and never reported saved before the newest edit',async()=>{
 let value=20,active=0,max=0;const first=deferred(),second=deferred(),written=[],states=[];
 const controller=create({read:()=>({value}),write:async data=>{active++;max=Math.max(max,active);written.push(data.value);await (written.length===1?first:second).promise;active--;},state:s=>states.push(s),saved(){}});
 const save=controller.save();await Promise.resolve();value=21;controller.dirty();first.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(written.length,2);assert.equal(states.at(-1),'saving');second.resolve();assert.equal(await save,true);assert.deepEqual(written,[20,21]);assert.equal(max,1);assert.equal(states.at(-1),'saved');
});
test('failed save keeps entered data, has explicit failure state and waits for a deliberate retry',async()=>{
 let calls=0;const data={notes:'Keep this entered design'},states=[];const controller=create({read:()=>({...data}),write:async payload=>{calls++;assert.equal(payload.notes,data.notes);if(calls===1)throw Error('network');},state:s=>states.push(s),saved(){}});
 controller.dirty();assert.equal(await controller.save(),false);assert.equal(states.at(-1),'failed');await Promise.resolve();assert.equal(calls,1);assert.equal(data.notes,'Keep this entered design');assert.equal(await controller.save(),true);assert.equal(calls,2);assert.equal(states.at(-1),'saved');
});
