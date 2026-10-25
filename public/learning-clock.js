(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MOLearningClock=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function advance(clock,input){
    const total=Number.isSafeInteger(clock?.total)&&clock.total>=0?clock.total:0;
    const previous=Number.isSafeInteger(clock?.at)?clock.at:input.now;
    const gap=input.now-previous;
    // A suspended tab / restarted browser never earns a catch-up burst.
    const eligible=input.visible&&input.focused&&gap>0&&gap<=15000;
    const activeEnd=Math.min(input.now,input.lastInteraction+60000);
    const delta=eligible?Math.min(5000,Math.max(0,activeEnd-previous)):0;
    return {total:Math.min(Number.MAX_SAFE_INTEGER,total+delta),at:input.now};
  }
  return Object.freeze({advance});
});
