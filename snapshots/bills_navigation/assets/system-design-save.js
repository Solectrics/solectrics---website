/* One serial save path shared by manual save and the existing autosave. */
(function(root){
  'use strict';
  function create({read,write,state,saved}) {
    let version=0, savedVersion=-1, inFlight=null;
    function initialise(hasSavedRecord){savedVersion=hasSavedRecord?version:-1;state(hasSavedRecord?'saved':'dirty');}
    function dirty(){version++;state(inFlight?'saving':'dirty');}
    function save(){
      if(inFlight)return inFlight;
      state('saving');
      const run=Promise.resolve().then(async()=>{
        do {
          const savingVersion=version;
          const payload=read();
          try {
            await write(payload);
            savedVersion=savingVersion;
            saved();
          } catch(error) {
            state('failed',error);
            return false; // No automatic retry of a failed request.
          }
        } while(savedVersion!==version); // Edits during a save are sent serially.
        state('saved');return true;
      });
      inFlight=run.finally(()=>{inFlight=null;});return inFlight;
    }
    return {initialise,dirty,save};
  }
  root.SystemDesignSave={create};
})(globalThis);
