import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialState,FLOW_DURATION} from '../app/material-state.js';
const targets=Array.from({length:320},(_,i)=>({x:40+(i%20)*25,y:30+Math.floor(i/20)*18,color:[.3,.6,.9]}));
function state(){const s=new MaterialState(4096,640,480);s.idle(4);s.assign(targets);return s;}
test('all destination tiles receive an existing material identity, with unchanged launch positions',()=>{
 const s=new MaterialState(4096,640,480);s.idle(4);const before=s.position.slice(),ids=s.assign(targets);
 assert.deepEqual(s.position,before);assert.equal(new Set(ids).size,targets.length);assert(ids.every(id=>id>=0&&id<s.count));
});
test('same material is waiting, moving or attached; reserve drains by actual departures',()=>{
 const s=state();for(const t of [0,.2,.5,.8,1.2,2.6]){s.advance(t);const d=s.inspect();assert.equal(d.waiting+d.moving+d.attached,4096);if(t>=.8)assert.equal(d.waiting,0);}
 assert.equal(s.inspect().attached,4096);assert.deepEqual(s.position,s.target);
});
test('all material leaves an empty centre rather than retaining a background blob',()=>{
 const s=new MaterialState(4096,640,480);s.assign([{x:50,y:50,color:[1,0,0]},{x:590,y:430,color:[0,1,0]}]);s.advance(FLOW_DURATION/1000);
 assert.equal(s.inspect().centre,0);assert.equal(s.inspect().attached,4096);
});
test('fixed-step state is identical at 30, 60 and 120 Hz; backwards seeking replays the same states',()=>{
 const images=[];for(const hz of [30,60,120]){const s=state();for(let i=0;i<=hz;i++)s.advance(i/hz);images.push(s.packed.slice());}
 assert.deepEqual(images[0],images[1]);assert.deepEqual(images[0],images[2]);const s=state();s.advance(1);const first=s.packed.slice();s.advance(2);s.advance(1);assert.deepEqual(s.packed,first);
});
test('a retained parcel changes its colour while in flight and lands without residual velocity',()=>{
 const s=state();s.advance(.7);assert(s.tint.some((v,i)=>v>0&&v<1&&!s.attached[i]));s.advance(FLOW_DURATION/1000);assert(s.velocity.every(v=>v===0));assert(s.tint.every(v=>v===1));
});
test('a new answer starts from the current positions, velocities and pigment, without recreating the liquid',()=>{
 const s=state();s.advance(.65);const position=s.position.slice(),velocity=s.velocity.slice(),color=s.currentPigment.slice();
 s.assign([{x:60,y:380,color:[1,.2,.1]},{x:580,y:60,color:[.1,.9,.2]}]);
 assert.deepEqual(s.position,position);assert.deepEqual(s.velocity,velocity);
 for(let i=0;i<s.count;i++)for(let c=0;c<3;c++)assert.equal(s.currentPigment[i*4+c],color[i*4+c]);
 s.advance(FLOW_DURATION/1000);assert(s.inspect().complete);
});
test('attached identities follow target changes and retain their storage during a viewport resize',()=>{
 const s=state();s.settle();const ids=s.tileIds.slice(),positions=s.position;
 const moved=targets.map(t=>({...t,x:t.x+25,y:t.y-10}));s.updateTargets(moved);s.pack();
 assert.deepEqual(s.position,s.target);assert.deepEqual(s.tileIds,ids);
 s.resize(800,600);assert.equal(s.position,positions);assert.deepEqual(s.tileIds,ids);assert.equal(s.inspect().count,4096);
});
