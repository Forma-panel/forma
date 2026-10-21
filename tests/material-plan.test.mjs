import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialPlan} from '../app/material-plan.js';
function field(id,width,height,paint){
 const data=new Uint8ClampedArray(width*height*4);paint(data);
 const image={data,width,height};
 const handle={width,height,revision:1,source:{getContext:()=>({getImageData:()=>image})}};
 return {id,handle,ratio:1,transform:[1,0,0,1,10,20]};
}
test('thin content compiles within budget and every future sample retains an owner',()=>{
 const f=field('text',64,64,data=>{for(let y=0;y<64;y++){data[(y*64+1)*4]=200;data[(y*64+1)*4+3]=255;}});
 const plan=new MaterialPlan([f],128),part=plan.fields.get(f.handle);
 assert(plan.tiles.length<=128);assert(plan.tiles.length>0);
 assert(part.ids.every(id=>id>=0&&id<plan.tiles.length));
 assert(plan.tiles.every(t=>t.color[0]===200/255));
});
test('layout transforms and camera scroll move targets without changing ownership',()=>{
 const f=field('shape',24,24,data=>data.fill(255)),plan=new MaterialPlan([f],128);
 const ids=plan.fields.get(f.handle).ids,first=plan.tiles[0],x=first.x,y=first.y;
 f.transform=[1,0,0,1,40,60];plan.update([f],15);
 assert.equal(plan.fields.get(f.handle).ids,ids);assert.equal(first.x,x+30);assert.equal(first.y,y+25);
});
test('new media frame updates pigment without replacing target assignments',()=>{
 const f=field('video',24,24,data=>{for(let i=0;i<data.length;i+=4){data[i]=255;data[i+3]=255;}}),plan=new MaterialPlan([f],128);
 const ids=plan.fields.get(f.handle).ids;
 const {data}=f.handle.source.getContext('2d').getImageData();
 for(let i=0;i<data.length;i+=4){data[i]=0;data[i+2]=255;}
 f.handle.revision++;plan.refreshColors();
 assert.equal(plan.fields.get(f.handle).ids,ids);assert(plan.tiles.every(t=>t.color.join(',')==='0,0,1'));
});
