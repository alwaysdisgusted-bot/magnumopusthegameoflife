const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const clock=vm.compileFunction(fs.readFileSync('public/learning-clock.js','utf8')+'\nreturn module.exports;',['module'])({exports:{}});
test('active time accumulates to ten minutes over interrupted sessions without counting gaps',()=>{
  let value={total:0,at:1000};
  for(let i=1;i<=60;i++)value=clock.advance(value,{now:1000+i*5000,lastInteraction:1000+i*5000,visible:true,focused:true});
  assert.equal(value.total,300000);
  value=clock.advance(value,{now:999999,lastInteraction:999999,visible:true,focused:true});assert.equal(value.total,300000);
  for(let i=1;i<=60;i++)value=clock.advance(value,{now:999999+i*5000,lastInteraction:999999+i*5000,visible:true,focused:true});
  assert.equal(value.total,600000);
});
test('hidden, unfocused, idle and suspended tabs never earn catch-up time',()=>{
  const base={total:4000,at:100000};
  for(const input of [{now:105000,lastInteraction:100000,visible:false,focused:true},{now:105000,lastInteraction:100000,visible:true,focused:false},{now:105000,lastInteraction:1,visible:true,focused:true},{now:200000,lastInteraction:200000,visible:true,focused:true}])assert.equal(clock.advance(base,input).total,4000);
  assert.equal(clock.advance(base,{now:105000,lastInteraction:42000,visible:true,focused:true}).total,6000,'only two seconds before the idle boundary count');
});
test('first tick, invalid clock data and backward wall-clock movement do not generate time',()=>{
  assert.equal(clock.advance(null,{now:5000,lastInteraction:5000,visible:true,focused:true}).total,0);
  assert.equal(clock.advance({total:1000,at:5000},{now:1000,lastInteraction:1000,visible:true,focused:true}).total,1000);
  assert.equal(clock.advance({total:-999,at:5000},{now:10000,lastInteraction:10000,visible:true,focused:true}).total,5000);
});
