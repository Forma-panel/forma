import test from 'node:test';
import assert from 'node:assert/strict';
import { damp, PointerMotion } from '../app/motion.js';

const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('critical damping matches closed-form step and does not overshoot',()=>{
  const state=damp(0,0,1,.1,24);
  near(state.value,1-(1+2.4)*Math.exp(-2.4));
  near(state.velocity,24*24*.1*Math.exp(-2.4));
  for(const dt of [0,.01,.1,.5,10]){
    const value=damp(0,0,1,dt).value;
    assert.ok(value>=0&&value<=1);
  }
});

test('motion agrees at 30, 60, 120 and 240 Hz and repeated timestamps are inert',()=>{
  const samples=[];
  for(const hz of [30,60,120,240]){
    const motion=new PointerMotion();
    const input={x:120,y:80,active:true,time:0};
    motion.update(0,input,true);
    for(let i=1;i<=hz/5;i++)motion.update(i/hz,input,true);
    samples.push(motion.strength);
    const before=JSON.stringify(motion);
    motion.update(.2,input,true);
    assert.equal(JSON.stringify(motion),before);
  }
  for(const value of samples)near(value,samples[0]);
});

test('new input after long idle starts from rest and at the contact position',()=>{
  const motion=new PointerMotion();
  motion.update(0,null,false);
  motion.update(100,{x:340,y:240,active:true,time:100},true);
  assert.equal(motion.strength,0);
  assert.equal(motion.x,340);assert.equal(motion.y,240);
  assert.equal(motion.needsFrame,true);
  motion.update(100.1,{x:340,y:240,active:true,time:100},true);
  assert.ok(motion.strength>0&&motion.strength<1);
});

test('pointer position eases through an input change rather than jumping',()=>{
  const motion=new PointerMotion();
  motion.update(0,{x:10,y:20,active:true,time:0},true);
  motion.update(1,{x:10,y:20,active:true,time:0},true);
  motion.update(40,{x:210,y:120,active:true,time:40},true);
  assert.equal(motion.x,10);assert.equal(motion.y,20);
  motion.update(40.04,{x:210,y:120,active:true,time:40},true);
  assert.ok(motion.x>10&&motion.x<210);
  assert.ok(motion.y>20&&motion.y<120);
});

test('release after a long hold and disabling disturbance settle fully',()=>{
  for(const disable of [false,true]){
    const motion=new PointerMotion();
    motion.update(0,{x:120,y:80,active:true,time:0},true);
    motion.update(5,{x:120,y:80,active:true,time:0},true);
    assert.equal(motion.strength,1);assert.equal(motion.needsFrame,false);
    const input={x:120,y:80,active:disable,time:5};
    motion.update(5,input,!disable);
    assert.equal(motion.strength,1);assert.equal(motion.needsFrame,true);
    motion.update(5.1,input,!disable);
    assert.ok(motion.strength>0&&motion.strength<1);
    motion.update(6,input,!disable);
    assert.equal(motion.strength,0);assert.equal(motion.needsFrame,false);
  }
});

test('reduced motion removes displacement immediately with no residual frames',()=>{
  const motion=new PointerMotion();
  const input={x:120,y:80,active:true,time:0};
  motion.update(0,input,true);motion.update(.2,input,true);
  assert.ok(motion.strength>0);
  motion.update(.2,input,true,true);
  assert.equal(motion.strength,0);assert.equal(motion.needsFrame,false);
});
