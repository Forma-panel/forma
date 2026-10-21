import test from 'node:test';
import assert from 'node:assert/strict';
import {multiply,translate,scale,rotate,point,inverse,wrapText,chartDomain,sampleAnimation} from '../app/layout.js';
test('nested rotation hit mapping round trips',()=>{const m=multiply(translate(32,71),multiply(rotate(.82),scale(.6,1.2)));const p=point(m,43,21);const q=point(inverse(m),p.x,p.y);assert.ok(Math.abs(q.x-43)<1e-9&&Math.abs(q.y-21)<1e-9);});
test('graphemes wrap without splitting combining characters or losing source offsets',()=>{const text='中Cafe\u0301\n🙂文';const lines=wrapText(text,4,t=>[...t].length);assert.equal(lines[0].start,0);assert.equal(lines.at(-1).end,text.length);for(const l of lines)for(const p of l.parts)assert.equal(text.slice(p.start,p.end),p.text);assert.ok(lines.some(l=>l.parts.some(p=>p.text==='e\u0301')));});
test('negative chart range includes zero and null is not numeric zero',()=>{assert.deepEqual(chartDomain([-8,-2,null]),[-8,0]);assert.deepEqual(chartDomain([null,null]),[0,1]);assert.deepEqual(chartDomain([20,30],false),[20,30]);});
test('animation loops and once clamps without revision updates',()=>{const a={durationMs:1000,repeat:'loop',keyframes:[{timeMs:0,value:0},{timeMs:1000,value:10}]};assert.equal(sampleAnimation(a,1500),5);assert.equal(sampleAnimation({...a,repeat:'once'},1500),10);});
