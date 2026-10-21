import { ParticleRenderer } from './particle-renderer.js';
import { FLOW_DURATION } from './material-state.js';
import { validateScene } from './scene-validation.js';
import { identity, multiply, translate, scale, rotate, point, inverse, wrapText, chartDomain, sampleAnimation } from './layout.js';

const PALETTE = {primary:'#29382f',accent:'#6267dc',muted:'#d7deea',positive:'#43846b',negative:'#be6070'};
const FONT = '"Forma Sans", "PingFang SC", "Microsoft YaHei", sans-serif';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const clone=v=>JSON.parse(JSON.stringify(v));
const format=v=>v===null?'缺失':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(v);
const isVideo=m=>typeof HTMLVideoElement!=='undefined'&&m instanceof HTMLVideoElement;
function rounded(ctx,x,y,w,h,r=10){ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(r,h/2,w/2));}
function text(ctx,value,x,y,size=14,color='#36453d',weight=400,align='left'){
  ctx.font=weight+' '+size+'px '+FONT;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(String(value),x,y);ctx.textAlign='left';
}
function fitRect(sw,sh,w,h,fit='contain'){
  const k=fit==='cover'?Math.max(w/sw,h/sh):Math.min(w/sw,h/sh);
  return {x:(w-sw*k)/2,y:(h-sh*k)/2,w:sw*k,h:sh*k};
}
const hitContains=(p,r)=>p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.w&&p.y<=r.y+r.h;

export class ParticleCompiler {
  constructor(canvas, options={}) {
    this.canvas=canvas;this.options=options;this.renderer=new ParticleRenderer(canvas);
    this.media=new Map();this.mediaListeners=new Map();this.scene=null;this.records=[];this.byId=new Map();this.fields=[];this.hits=[];
    this.width=1;this.height=1;this.ratio=1;this.scroll=0;this.contentHeight=0;
    this.style='clear';this.reducedMotion=false;this.disturbance=false;this.renderingEnabled=true;
    this.pointer={x:-1000,y:-1000,active:false};this.selected=null;this.drag=null;this.hover=null;
    this.tablePages=new Map();this.tables=new Set();this.overrides=new Map();this.animationTime=0;this.speed=1;this.paused=false;
    this.animationFrame=0;this.lastFrame=0;this.lastPaint=0;this.lastStat=0;this.frameTimes=[];this.revealStart=0;this.revealDuration=0;this.overlayDirty=true;
    this.status='';this.destroyed=false;this.contextLost=false;this.measure=document.createElement('canvas').getContext('2d');
    canvas.tabIndex=0;canvas.setAttribute('aria-label','粒子回答画板，方向键滚动，拖动文字可选择，按 Escape 清除选择');
    canvas.style.touchAction='none';
    this.events=new AbortController();const opt={signal:this.events.signal};
    canvas.addEventListener('wheel',e=>{if(this.contentHeight>this.height){e.preventDefault();this.setScroll(this.scroll+e.deltaY);}},{...opt,passive:false});
    canvas.addEventListener('pointerdown',e=>this.pointerDown(e),opt);
    canvas.addEventListener('pointermove',e=>this.pointerMove(e),opt);
    canvas.addEventListener('pointerup',e=>this.pointerUp(e),opt);
    canvas.addEventListener('pointercancel',()=>{this.drag=null;this.pointer.active=false;this.pointer.time=performance.now()/1000;this.wake();},opt);
    canvas.addEventListener('pointerleave',()=>{if(!this.drag){this.pointer.active=false;this.pointer.time=performance.now()/1000;this.hover=null;this.overlayDirty=true;this.wake();}},opt);
    canvas.addEventListener('keydown',e=>this.keyDown(e),opt);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;cancelAnimationFrame(this.animationFrame);this.animationFrame=0;this.options.onError?.('粒子画板正在恢复，内容已保留。');},opt);
    canvas.addEventListener('webglcontextrestored',()=>{try{this.renderer=new ParticleRenderer(canvas);this.contextLost=false;this.fields=[];this.overlay=null;this.build();}catch(error){this.options.onError?.(error.message);}},opt);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement||canvas);
    this.resize();
    document.fonts?.ready.then(()=>{if(!this.destroyed&&this.scene)this.rebuild();});
    this.fontListener=()=>{if(!this.destroyed&&this.scene)this.rebuild();};
    document.fonts?.addEventListener('loadingdone',this.fontListener);
  }
  resize() {
    const rect=this.canvas.getBoundingClientRect();
    const width=Math.max(240,Math.round(rect.width||this.canvas.parentElement?.clientWidth||800));
    const height=Math.max(240,Math.round(rect.height||this.canvas.parentElement?.clientHeight||600));
    const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(2300000/(width*height)));
    if(width===this.width&&height===this.height&&Math.abs(ratio-this.ratio)<.01)return;
    this.width=width;this.height=height;this.ratio=ratio;
    this.canvas.width=Math.ceil(width*ratio);this.canvas.height=Math.ceil(height*ratio);
    if(this.scene)this.rebuild();else this.wake();
  }
  setScene(scene,{animate=true}={}) {
    const next=validateScene(scene);
    const plan=this.prepareLayout(next,new Set());
    for(const [id,m] of this.media)if(isVideo(m)&&!next.nodes.some(n=>n.assetId===id))m.pause();
    this.scene=next;this.scroll=0;this.selected=null;this.drag=null;this.hover=null;
    this.animationTime=0;this.paused=false;this.status='';this.tables.clear();this.tablePages.clear();this.overrides.clear();
    this.revealStart=performance.now();this.revealDuration=animate&&!this.reducedMotion&&next.summary!=='welcome'?FLOW_DURATION:0;
    this.options.onSelect?.(null);this.build(plan);
  }
  getText() {
    if(!this.scene)return '';
    return this.scene.nodes.map(n=>{
      if(n.kind==='text')return n.text;
      if(n.kind==='chart'){const d=this.scene.datasets.find(d=>d.id===n.datasetId);return n.label+'（'+n.unit+'）\n'+d.rows.map(r=>String(r.values[n.xField])+'：'+format(r.values[n.yField])).join('\n');}
      if(n.kind==='image')return n.alt;
      if(n.kind==='video')return n.label;
      return '';
    }).filter(Boolean).join('\n\n');
  }
  setStyle(style){this.style=style==='grain'?'grain':'clear';this.overrides.clear();this.wake();}
  setReducedMotion(value){this.reducedMotion=!!value;if(value)this.revealDuration=0;this.wake();}
  setDisturbance(value){this.disturbance=!!value;this.pointer.active=false;this.pointer.time=performance.now()/1000;this.wake();}
  setRenderingEnabled(value){this.renderingEnabled=!!value;this.wake();}
  setStatus(value){this.status=String(value||'');this.overlayDirty=true;this.wake();}
  clear(){this.scene=null;this.disposeFields();this.records=[];this.byId.clear();this.hits=[];this.selected=null;this.scroll=0;this.options.onSelect?.(null);this.syncSemantics();this.wake();}
  pause(){if(this.pauseSnapshot)return;this.pauseSnapshot={paused:this.paused,playing:[]};this.paused=true;for(const m of this.media.values())if(isVideo(m)&&!m.paused){this.pauseSnapshot.playing.push(m);m.pause();}this.invalidateControls();this.wake();}
  resume(){const saved=this.pauseSnapshot;if(!saved)return;this.pauseSnapshot=null;this.paused=saved.paused;for(const m of saved.playing)if([...this.media].some(([id,value])=>value===m&&this.scene?.nodes.some(n=>n.assetId===id)))m.play().catch(()=>{});this.invalidateControls();this.wake();}
  registerMedia(id,media){
    if(!media){this.unregisterMedia(id);return;}
    if(this.media.get(id)===media)return;
    this.unregisterMedia(id);this.media.set(id,media);
    const handler=e=>{for(const f of this.fields)if(f.mediaId===id)f.dirty=true;if(['play','pause','ended','loadeddata','error'].includes(e.type))this.semanticDirty=true;this.wake();};
    const names=isVideo(media)?['loadeddata','seeked','timeupdate','play','pause','ended','error']:['load','error'];
    for(const name of names)media.addEventListener(name,handler);
    this.mediaListeners.set(id,()=>{for(const name of names)media.removeEventListener(name,handler);});
    if(this.scene?.nodes.some(n=>n.assetId===id))this.build();
  }
  unregisterMedia(id){
    this.mediaListeners.get(id)?.();this.mediaListeners.delete(id);
    const media=this.media.get(id);if(isVideo(media))media.pause();this.media.delete(id);
    for(const f of this.fields)if(f.mediaId===id)f.dirty=true;
    this.wake();
  }
  setScroll(value){this.scroll=clamp(value,0,Math.max(0,this.contentHeight-this.height+28));this.overlayDirty=true;this.wake();}
  disposeFields(){for(const f of this.fields)this.renderer.deleteField(f.handle);this.fields=[];if(this.overlay){this.renderer.deleteField(this.overlay.handle);this.overlay=null;}}
  prepareLayout(scene,tables=this.tables){
    const plan=Object.assign(Object.create(ParticleCompiler.prototype),{scene,tables,width:this.width,height:this.height,measure:this.measure,media:this.media,records:[],byId:new Map(),children:new Map(),animationControl:null});
    const margin=plan.width<600?24:Math.max(40,(plan.width-840)/2);
    const width=plan.width-margin*2;let y=46;
    for(const n of scene.nodes){const p=n.parentId??'_root';if(!plan.children.has(p))plan.children.set(p,[]);plan.children.get(p).push(n);}
    if(scene.summary==='welcome'){
      const titles=scene.nodes.filter(n=>n.kind==='text');y=plan.height*.76;
      for(const n of titles){const r=plan.layoutNode(n,null,margin,y,width);r.centered=true;y+=r.h+14;}
      plan.contentHeight=plan.height;
    }else{
      for(const n of plan.children.get('_root')||[]){const r=plan.layoutNode(n,null,margin,y,width);y+=r.h+20;}
      if(scene.animations.length){
        const r={node:{id:'_animation',kind:'controls'},parent:null,x:margin,y:y+4,w:width,h:48,world:identity(),children:[],opacity:1};
        plan.records.push(r);plan.animationControl=r;y+=76;
      }
      plan.contentHeight=y+28;
    }
    let pixels=this.canvas.width*this.canvas.height;
    for(const r of plan.records){
      if(r.node.kind==='group')continue;
      const heights=r.node.kind==='text'?Array.from({length:Math.ceil(r.lines.length/8)},(_,i)=>Math.min(8,r.lines.length-i*8)*r.lineHeight+4):[r.h];
      for(const height of heights){
        const w=Math.ceil(r.w*this.ratio),h=Math.ceil(height*this.ratio);
        if(w>this.renderer.textureMax||h>this.renderer.textureMax)throw new Error('场景尺寸超出当前设备上限，请缩小图形或媒体尺寸。');
        pixels+=w*h;
        if(pixels>24000000)throw new Error('场景超出本机粒子资源预算，请减少内容或图形尺寸。');
      }
    }
    return {records:plan.records,byId:plan.byId,children:plan.children,animationControl:plan.animationControl,contentHeight:plan.contentHeight};
  }
  build(plan){
    if(this.destroyed||this.contextLost)return;
    if(!this.scene){this.disposeFields();this.records=[];this.byId=new Map();this.hits=[];this.wake();return;}
    const next=plan||this.prepareLayout(this.scene);
    this.disposeFields();this.hits=[];Object.assign(this,next);
    this.updateWorld();
    for(const r of this.records)this.createNodeFields(r);
    this.scroll=clamp(this.scroll,0,Math.max(0,this.contentHeight-this.height+28));
    this.overlayDirty=true;this.syncSemantics();this.wake();
  }
  rebuild(){try{this.build();}catch(error){this.options.onError?.(error.message);}}
  layoutNode(node,parent,x,y,availableWidth){
    const layout=node.layout;
    const w=layout.mode==='absolute'?layout.width:typeof layout.width==='number'?Math.min(availableWidth,layout.width):availableWidth;
    const r={node,parent,x,y,w:Math.max(1,w),h:0,children:[],world:identity(),opacity:1};
    this.records.push(r);this.byId.set(node.id,r);
    if(node.kind==='group'){
      if(node.direction==='free'){
        r.h=layout.mode==='absolute'?layout.height:typeof layout.height==='number'?layout.height:r.w*node.viewBox.height/node.viewBox.width;
        for(const child of this.children.get(node.id)||[]){const c=this.layoutNode(child,r,child.layout.x,child.layout.y,child.layout.width);r.children.push(c);}
      }else{
        let cy=0;for(const child of this.children.get(node.id)||[]){const c=this.layoutNode(child,r,0,cy,r.w);r.children.push(c);cy+=c.h+(node.gap??16);}
        r.h=Math.max(1,cy-(r.children.length?(node.gap??16):0));
      }
    }else if(node.kind==='text'){
      r.fontSize=node.role==='title'?(this.width<620?27:34):node.role==='caption'?13:node.role==='code'?14:16;
      r.weight=node.role==='title'?650:node.role==='caption'?400:430;r.lineHeight=Math.round(r.fontSize*(node.role==='title'?1.48:1.82));
      if(this.scene.summary==='welcome'){r.fontSize=node.role==='title'?(this.width<620?26:36):14;r.lineHeight=Math.round(r.fontSize*1.6);}
      this.measure.font=r.weight+' '+r.fontSize+'px '+FONT;
      r.lines=wrapText(node.text,Math.min(r.w,node.role==='body'?740:r.w),t=>this.measure.measureText(t).width);
      r.h=r.lines.length*r.lineHeight+4;
    }else if(node.kind==='chart'){
      r.h=Math.max(330,typeof layout.height==='number'?layout.height:350)+(this.tables.has(node.id)?350:0);
    }else if(node.kind==='image'||node.kind==='video'){
      const m=this.media.get(node.assetId);const aspect=m?(m.videoWidth||m.naturalWidth||16)/(m.videoHeight||m.naturalHeight||9):16/9;
      r.h=(typeof layout.height==='number'?layout.height:Math.min(420,r.w/aspect))+(node.kind==='video'?66:34);
    }else r.h=layout.mode==='absolute'?layout.height:typeof layout.height==='number'?layout.height:64;
    return r;
  }
  updateWorld(){
    for(const r of this.records){
      let parent=identity();
      if(r.parent){parent=r.parent.world;if(r.parent.node.kind==='group'&&r.parent.node.direction==='free'){
        const box=r.parent.node.viewBox,k=Math.min(r.parent.w/box.width,r.parent.h/box.height);
        parent=multiply(parent,multiply(translate((r.parent.w-box.width*k)/2,(r.parent.h-box.height*k)/2),scale(k,k)));
      }}
      let local=translate(r.x,r.y);let alpha=1;
      const animations=this.scene?.animations.filter(a=>a.target===r.node.id)||[];
      let dx=0,dy=0,angle=0;
      for(const a of animations){const v=sampleAnimation(a,this.animationTime);if(a.property==='rotate')angle=v*Math.PI/180;if(a.property==='translateX')dx=v;if(a.property==='translateY')dy=v;if(a.property==='opacity')alpha=v;}
      if(dx||dy)local=multiply(local,translate(dx,dy));
      if(angle)local=multiply(local,multiply(translate(r.w/2,r.h/2),multiply(rotate(angle),translate(-r.w/2,-r.h/2))));
      r.world=multiply(parent,local);r.opacity=alpha*(r.parent?.opacity??1);
    }
  }
  field(r,name,x,y,w,h,paint,extra={}){
    const source=document.createElement('canvas');source.width=Math.max(1,Math.ceil(w*this.ratio));source.height=Math.max(1,Math.ceil(h*this.ratio));
    const ctx=source.getContext('2d',{willReadFrequently:true});
    const f={id:r.node.id+':'+name,record:r,x,y,w,h,source,ctx,paint,dirty:true,ratio:this.ratio,...extra};
    this.fields.push(f);this.paintField(f);f.handle=this.renderer.createField(source);f.dirty=false;return f;
  }
  paintField(f){
    this.hits=this.hits.filter(h=>h.field!==f);
    const c=f.ctx;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,f.source.width,f.source.height);c.setTransform(f.ratio,0,0,f.ratio,0,0);
    f.paint(c,f);
    if(f.handle)this.renderer.updateField(f.handle,f.source);
    f.dirty=false;
  }
  addHit(field,rect,label,fn,extra={}){this.hits.push({field,record:field.record,rect:{x:rect.x+field.x,y:rect.y+field.y,w:rect.w,h:rect.h},label,fn,...extra});}
  button(ctx,field,label,x,y,w,fn,active=false,key=label){
    rounded(ctx,x,y,w,34,9);ctx.fillStyle=active?'#5c64d5':'#f0f2f2';ctx.fill();
    text(ctx,label,x+w/2,y+22,12,active?'#fff':'#53605b',500,'center');
    this.addHit(field,{x,y,w,h:34},label,fn,{kind:'button',key});
  }
  createNodeFields(r){
    const n=r.node;
    if(n.kind==='text'){
      for(let start=0;start<r.lines.length;start+=8){
        const lines=r.lines.slice(start,start+8),chunkY=start*r.lineHeight;
        this.field(r,'text'+start,0,chunkY,r.w,lines.length*r.lineHeight+4,(ctx,f)=>{
          lines.forEach((line,i)=>{
            const x=r.centered?(r.w-line.width)/2:0;
            text(ctx,line.parts.map(g=>g.text).join(''),x,i*r.lineHeight+r.fontSize+1,r.fontSize,n.role==='caption'?'#768078':'#28392f',r.weight);
            line.drawX=x;
          });
          this.addHit(f,{x:0,y:0,w:r.w,h:lines.length*r.lineHeight},n.text,()=>this.selectNode(r),{kind:'text',key:n.id+':'+start});
        });
      }
    }else if(n.kind==='shape'){
      this.field(r,'shape',0,0,r.w,r.h,ctx=>{
        const color=PALETTE[n.material]||PALETTE.accent;ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1.2;
        if(n.shape==='circle'){
          ctx.beginPath();ctx.ellipse(r.w/2,r.h/2,Math.max(0,r.w/2-1),Math.max(0,r.h/2-1),0,0,Math.PI*2);
          if(n.material==='muted')ctx.stroke();else{
            const gradient=ctx.createRadialGradient(r.w*.3,r.h*.25,0,r.w*.5,r.h*.5,r.w*.7);
            gradient.addColorStop(0,n.material==='primary'?'#7dacbd':'#beb3f4');gradient.addColorStop(1,n.material==='primary'?'#486e91':color);ctx.fillStyle=gradient;ctx.fill();
          }
        }else if(n.shape==='line'){ctx.beginPath();ctx.moveTo(1,1);ctx.lineTo(r.w-1,r.h-1);ctx.lineWidth=2;ctx.stroke();}
        else{rounded(ctx,0,0,r.w,r.h,Math.min(12,r.w*.12));ctx.fill();}
      });
    }else if(n.kind==='chart'){
      this.field(r,'chart',0,0,r.w,r.h,(ctx,f)=>this.paintChart(ctx,f));
    }else if(n.kind==='image'||n.kind==='video'){
      this.field(r,'media',0,0,r.w,r.h,(ctx,f)=>this.paintMedia(ctx,f),{mediaId:n.assetId});
    }else if(n.kind==='controls'){
      this.field(r,'controls',0,0,r.w,r.h,(ctx,f)=>{
        const bw=Math.min(92,(r.w-20)/3);
        this.button(ctx,f,this.paused?'播放动画':'暂停动画',0,0,bw,()=>{this.paused=!this.paused;this.invalidateControls();this.wake();},!this.paused,'animation-play');
        this.button(ctx,f,this.speed+'× 速度',bw+10,0,bw,()=>{this.speed=this.speed===1?2:this.speed===2?.5:1;this.invalidateControls();this.wake();},false,'animation-speed');
        this.button(ctx,f,'重新开始',(bw+10)*2,0,bw,()=>{this.animationTime=0;this.wake();},false,'animation-reset');
      },{reveal:false});
    }
  }
  paintChart(ctx,f){
    const r=f.record,n=r.node,d=this.scene.datasets.find(d=>d.id===n.datasetId),rows=d.rows;
    const expanded=this.tables.has(n.id),chartH=expanded?r.h-350:r.h;
    text(ctx,n.label,0,20,16,'#304138',600);text(ctx,n.unit||'数值',0,45,12,'#7c857e');
    const plot={x:42,y:66,w:r.w-58,h:chartH-132};
    const values=rows.map(row=>row.values[n.yField]);
    const [min,max]=chartDomain(values,n.chartType==='bar'||n.zeroBaseline===true);
    const py=v=>plot.y+plot.h-(v-min)/(max-min)*plot.h;
    for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,y=py(value);ctx.beginPath();ctx.moveTo(plot.x,y);ctx.lineTo(plot.x+plot.w,y);ctx.strokeStyle='#e7ebe7';ctx.lineWidth=1;ctx.stroke();text(ctx,format(value),plot.x-10,y+4,10,'#8a948e',400,'right');}
    const step=plot.w/Math.max(1,rows.length),px=i=>plot.x+step*(i+.5);
    const base=py(clamp(0,min,max));
    if(n.chartType==='line'){
      let drawing=false;ctx.beginPath();ctx.lineWidth=2.5;ctx.strokeStyle='#6973dc';
      rows.forEach((row,i)=>{const v=row.values[n.yField];if(v===null){drawing=false;return;}if(!drawing){ctx.moveTo(px(i),py(v));drawing=true;}else ctx.lineTo(px(i),py(v));});ctx.stroke();
    }
    rows.forEach((row,i)=>{
      const v=row.values[n.yField],x=px(i);
      if(v!==null){
        const y=py(v);
        if(n.chartType==='bar'){
          const bw=Math.max(1,Math.min(52,step*.52)),h=Math.max(1,Math.abs(base-y));
          const gradient=ctx.createLinearGradient(0,Math.min(y,base),0,Math.max(y,base));gradient.addColorStop(0,'#6974dd');gradient.addColorStop(1,'#adb6ef');
          ctx.fillStyle=gradient;rounded(ctx,x-bw/2,Math.min(y,base),bw,h,5);ctx.fill();
        }else{ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fillStyle='#6973dc';ctx.fill();}
        this.addHit(f,{x:x-Math.max(10,step*.3),y:plot.y,w:Math.max(20,step*.6),h:plot.h},String(row.values[n.xField])+' · '+format(v)+' '+n.unit,()=>this.selectNode(r,String(row.values[n.xField])+'：'+format(v)+' '+n.unit),{kind:'data',rowKey:row.key,key:row.key});
      }
      if(rows.length<=12||i%Math.ceil(rows.length/12)===0)text(ctx,String(row.values[n.xField]),x,plot.y+plot.h+22,10,'#758178',400,'center');
    });
    const by=chartH-36;
    const bw=Math.min(82,(r.w-16)/3);
    this.button(ctx,f,'柱状图',0,by,bw,()=>this.changeChart(n.id,'bar'),n.chartType==='bar','chart-bar');
    this.button(ctx,f,'折线图',bw+8,by,bw,()=>this.changeChart(n.id,'line'),n.chartType==='line','chart-line');
    this.button(ctx,f,expanded?'收起数据':'查看数据',(bw+8)*2,by,bw,()=>{if(expanded)this.tables.delete(n.id);else this.tables.add(n.id);this.build();},expanded,'chart-data');
    if(expanded){
      const page=this.tablePages.get(n.id)||0,start=page*8,tableY=chartH+24;
      text(ctx,'原始数据',0,tableY,14,'#37453d',600);
      text(ctx,n.unit?('单位：'+n.unit):'保留原始数值',r.w,tableY,11,'#889189',400,'right');
      rows.slice(start,start+8).forEach((row,i)=>{
        const y=tableY+18+i*31;
        if(i%2===0){ctx.fillStyle='#f4f6f3';ctx.fillRect(0,y,r.w,30);}
        text(ctx,String(row.values[n.xField]),14,y+21,12);
        text(ctx,format(row.values[n.yField]),r.w-14,y+21,12,'#6671c9',500,'right');
      });
      const foot=tableY+279;
      const tw=Math.min(84,(r.w-20)/3);
      this.button(ctx,f,'复制数据',0,foot,tw,()=>this.options.onAction?.({type:'copy',text:n.label+'\n'+rows.map(row=>String(row.values[n.xField])+'\t'+(row.values[n.yField]??'缺失')).join('\n')}),false,'copy-data');
      if(rows.length>8){
        this.button(ctx,f,'上一页',tw+10,foot,tw,()=>{this.tablePages.set(n.id,Math.max(0,page-1));this.build();},false,'previous-data');
        this.button(ctx,f,'下一页',(tw+10)*2,foot,tw,()=>{this.tablePages.set(n.id,Math.min(Math.ceil(rows.length/8)-1,page+1));this.build();},false,'next-data');
      }
    }
  }
  changeChart(id,chartType){
    const scene=clone(this.scene);scene.nodes.find(n=>n.id===id).chartType=chartType;
    if(chartType==='bar')scene.nodes.find(n=>n.id===id).zeroBaseline=true;
    const scroll=this.scroll,tables=new Set(this.tables),pages=new Map(this.tablePages);
    this.scene=validateScene(scene);this.selected=null;this.overrides.clear();this.revealDuration=0;
    this.tables=tables;this.tablePages=pages;this.build();this.setScroll(scroll);
    this.options.onSelect?.(null);this.options.onAction?.({type:'scene-change',scene});
  }
  paintMedia(ctx,f){
    const r=f.record,n=r.node,m=this.media.get(n.assetId),isVid=n.kind==='video',pictureH=r.h-(isVid?66:34);
    rounded(ctx,0,0,r.w,pictureH,14);ctx.fillStyle='#f0f2ef';ctx.fill();ctx.save();ctx.clip();
    const sw=m&&(m.videoWidth||m.naturalWidth),sh=m&&(m.videoHeight||m.naturalHeight);
    if(sw&&sh){
      const fit=fitRect(sw,sh,r.w,pictureH,n.fit);
      try{ctx.drawImage(m,fit.x,fit.y,fit.w,fit.h);}catch{ text(ctx,'等待媒体帧',r.w/2,pictureH/2,14,'#89938c',400,'center');}
    }else{text(ctx,m?.error?'此媒体格式暂不可解码':'请重新导入这份本地媒体',r.w/2,pictureH/2,14,'#7f8982',400,'center');}
    ctx.restore();
    if(isVid){
      const y=pictureH+16;
      this.button(ctx,f,m&&!m.paused?'暂停':'播放',0,y,66,()=>{
        if(!m){this.options.onError?.('请先重新导入这份本地视频。');return;}
        if(m.paused)m.play().then(()=>this.wake()).catch(()=>this.options.onError?.('视频未能播放，请确认格式受当前浏览器支持。'));else m.pause();
        this.invalidateControls();this.wake();
      },!!m&&!m.paused,'media-play');
      const x=84,w=Math.max(30,r.w-170),duration=Number.isFinite(m?.duration)?m.duration:0,current=m?.currentTime||0;
      ctx.fillStyle='#dde3dc';rounded(ctx,x,y+14,w,5,3);ctx.fill();
      if(duration){ctx.fillStyle='#7883da';rounded(ctx,x,y+14,Math.max(2,w*current/duration),5,3);ctx.fill();}
      text(ctx,Math.floor(current)+' / '+Math.floor(duration)+' 秒',r.w,y+23,11,'#7d887f',400,'right');
      this.addHit(f,{x,y:y-4,w,h:40},'调整视频播放位置',p=>{if(m&&duration){m.currentTime=clamp((p.x-x)/w,0,1)*duration;f.dirty=true;this.wake();}},{kind:'seek',key:'media-seek'});
    }else text(ctx,n.alt,0,r.h-9,11,'#8a938d');
    f.lastMediaTime=m?.currentTime;
  }
  invalidateControls(){for(const f of this.fields)if(f.record.node.kind==='controls'||f.mediaId)f.dirty=true;this.semanticDirty=true;}
  fieldMatrix(f){return multiply(f.record.world,translate(f.x,f.y));}
  visible(f){
    const m=this.fieldMatrix(f),corners=[point(m,0,0),point(m,f.w,0),point(m,0,f.h),point(m,f.w,f.h)];
    return Math.max(...corners.map(p=>p.y))>=this.scroll-60&&Math.min(...corners.map(p=>p.y))<=this.scroll+this.height+60;
  }
  wake(){if(this.destroyed||this.contextLost||this.animationFrame)return;this.animationFrame=requestAnimationFrame(t=>this.frame(t));}
  frame(now){
    this.animationFrame=0;if(this.destroyed||this.contextLost)return;
    try{
      const delta=this.lastFrame?Math.min(64,now-this.lastFrame):16;this.lastFrame=now;
      const animated=!!this.scene?.animations.length&&!this.paused&&!this.reducedMotion&&(!this.revealDuration||now-this.revealStart>=this.revealDuration);
      if(animated)this.animationTime+=delta*this.speed;
      this.updateWorld();
      let playing=false;
      for(const f of this.fields)if(f.mediaId){const m=this.media.get(f.mediaId);if(isVideo(m)&&!m.paused&&!m.ended){playing=true;if(m.currentTime!==f.lastMediaTime)f.dirty=true;}}
      const reveal=this.revealDuration?clamp((now-this.revealStart)/this.revealDuration,0,1):1;
      let active=animated||playing||reveal<1||(this.scene?.summary==='welcome'&&!this.reducedMotion);
      if(!playing||animated||now-this.lastPaint>=30||reveal<1){
        for(const f of this.fields)if(f.dirty)this.paintField(f);
        if(this.overlayDirty)this.paintOverlay();
        const fields=this.fields.map(f=>({id:f.id,visible:this.visible(f),handle:f.handle,ratio:f.ratio,transform:this.fieldMatrix(f),opacity:f.record.opacity,reveal:f.reveal,override:this.overrides.get(f.id)}));
        if(this.overlay)fields.push({id:'_overlay',handle:this.overlay.handle,ratio:this.ratio,transform:translate(0,this.scroll),opacity:1,reveal:false});
        const stats=this.renderer.render(fields,{width:this.width,height:this.height,dpr:this.ratio,pitch:this.style==='grain'?3:1,time:now/1000,motionEpoch:this.revealStart/1000,progress:reveal,motionTime:this.revealDuration?Math.max(0,(now-this.revealStart)/1000):FLOW_DURATION/1000,scroll:this.scroll,reducedMotion:this.reducedMotion,disturbance:this.disturbance,pointer:this.pointer,idle:this.scene?.summary==='welcome',enabled:this.renderingEnabled});
        active=active||this.renderer.needsFrame;
        this.lastPaint=now;this.frameTimes.push(now);this.frameTimes=this.frameTimes.filter(t=>t>now-1000);
        if(now-this.lastStat>500||!this.lastStat||!active){this.options.onStats?.({...stats,fps:active?this.frameTimes.length:null,active,backend:'WebGL2',width:this.canvas.width,height:this.canvas.height});this.lastStat=now;}
      }
      if(this.semanticDirty){this.syncSemantics();this.semanticDirty=false;}
      if(active||this.renderer.needsFrame)this.wake();
    }catch(error){this.options.onError?.(error.message||'粒子显示发生错误。');}
  }
  paintOverlay(){
    this.overlayHits=[];
    if(!this.selected&&this.hover?.kind!=='data'&&!this.status&&this.contentHeight<=this.height){
      if(this.overlay){this.renderer.deleteField(this.overlay.handle);this.overlay=null;}
      this.overlayDirty=false;return;
    }
    if(!this.overlay){
      const source=document.createElement('canvas');source.width=this.canvas.width;source.height=this.canvas.height;
      this.overlay={source,ctx:source.getContext('2d'),handle:null};
    }
    const {source,ctx}=this.overlay;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,source.width,source.height);ctx.setTransform(this.ratio,0,0,this.ratio,0,0);
    const sel=this.selected,r=sel&&this.byId.get(sel.nodeId);
    if(r){
      if(r.node.kind==='text'&&sel.start!==undefined&&sel.end!==undefined&&sel.start!==sel.end){
        const a=Math.min(sel.start,sel.end),b=Math.max(sel.start,sel.end);ctx.fillStyle='rgba(105,137,221,.20)';
        for(const [i,line] of r.lines.entries()){
          const parts=line.parts.filter(p=>p.end>a&&p.start<b);if(!parts.length)continue;
          const start=point(r.world,(line.drawX||0)+parts[0].x,i*r.lineHeight),end=point(r.world,(line.drawX||0)+parts.at(-1).x+parts.at(-1).width,(i+1)*r.lineHeight);
          ctx.fillRect(start.x,start.y-this.scroll,end.x-start.x,end.y-start.y);
        }
      }else{
        const p=point(r.world,0,0);ctx.strokeStyle='rgba(104,125,205,.65)';ctx.lineWidth=1;rounded(ctx,p.x-5,p.y-this.scroll-5,r.w+10,r.h+10,9);ctx.stroke();
      }
      const bx=this.width-178,by=this.height-51;
      rounded(ctx,bx-5,by-5,166,42,12);ctx.fillStyle='#fff';ctx.shadowColor='rgba(42,56,47,.08)';ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
      [['引用追问','ask'],['复制','copy']].forEach(([label,type],i)=>{const x=bx+i*79;rounded(ctx,x,by,74,32,8);ctx.fillStyle=i?'#f0f3ef':'#e9ecfb';ctx.fill();text(ctx,label,x+37,by+21,11,i?'#66736a':'#6774c8',500,'center');this.overlayHits.push({rect:{x,y:by,w:74,h:32},label,fn:()=>this.options.onAction?.({type,text:type==='copy'?this.selectionText():'解释一下这里：'+this.selectionText().slice(0,240)}),kind:'button'});});
    }
    if(this.hover?.kind==='data'){
      const label=this.hover.label,tw=Math.min(this.width-24,this.measure.measureText(label).width+28);
      const x=clamp(this.pointer.x+14,12,this.width-tw-12),y=clamp(this.pointer.y-40,12,this.height-40);
      rounded(ctx,x,y,tw,30,8);ctx.fillStyle='#34443b';ctx.fill();text(ctx,label,x+14,y+20,11,'#fff');
    }
    if(this.status){text(ctx,this.status,this.width/2,26,11,'#8b948e',400,'center');}
    if(this.contentHeight>this.height){
      const size=Math.max(30,this.height*this.height/this.contentHeight),y=this.scroll/Math.max(1,this.contentHeight-this.height+28)*(this.height-size-16)+8;
      ctx.fillStyle='rgba(157,168,158,.45)';rounded(ctx,this.width-6,y,3,size,2);ctx.fill();
    }
    if(this.overlay.handle)this.renderer.updateField(this.overlay.handle,source);else this.overlay.handle=this.renderer.createField(source);
    this.overlayDirty=false;
  }
  eventPoint(e){const rect=this.canvas.getBoundingClientRect();return {x:(e.clientX-rect.left)*this.width/rect.width,y:(e.clientY-rect.top)*this.height/rect.height};}
  hitAt(p){
    for(const h of [...(this.overlayHits||[])].reverse())if(hitContains(p,h.rect))return {...h,local:p};
    for(const h of [...this.hits].reverse()){
      const inv=inverse(h.record.world);if(!inv)continue;
      const local=point(inv,p.x,p.y+this.scroll);if(hitContains(local,h.rect))return {...h,local};
    }
    for(const r of [...this.records].reverse()){
      if(['group','controls'].includes(r.node.kind))continue;
      const inv=inverse(r.world);if(!inv)continue;const local=point(inv,p.x,p.y+this.scroll);
      if(hitContains(local,{x:0,y:0,w:r.w,h:r.h}))return {record:r,kind:'node',local,fn:()=>this.selectNode(r)};
    }
    return null;
  }
  textOffset(r,p){
    const inv=inverse(r.world),local=point(inv,p.x,p.y+this.scroll);const line=r.lines[clamp(Math.floor(local.y/r.lineHeight),0,r.lines.length-1)];
    const x=local.x-(line.drawX||0);
    for(const part of line.parts)if(x<part.x+part.width/2)return part.start;
    return line.end;
  }
  pointerDown(e){
    const p=this.eventPoint(e);this.lastPointerMove=performance.now();this.pointer={...p,active:this.disturbance,time:this.lastPointerMove/1000};
    this.canvas.focus({preventScroll:true});this.canvas.setPointerCapture(e.pointerId);
    if(this.revealDuration&&performance.now()-this.revealStart<this.revealDuration)return;
    const hit=this.hitAt(p);
    this.drag={start:p,last:p,hit,pointerType:e.pointerType,scroll:this.scroll,moved:false};
    if(!this.disturbance&&hit?.kind==='text'&&e.pointerType!=='touch'){
      const offset=this.textOffset(hit.record,p);this.selected={nodeId:hit.record.node.id,start:offset,end:offset};this.drag.selecting=true;this.emitSelection();
    }
    this.overlayDirty=true;this.wake();
  }
  pointerMove(e){
    const p=this.eventPoint(e);this.lastPointerMove=performance.now();this.pointer={...p,active:this.disturbance,time:this.lastPointerMove/1000};
    if(this.drag){
      const distance=Math.hypot(p.x-this.drag.start.x,p.y-this.drag.start.y);if(distance>4)this.drag.moved=true;
      if(this.drag.pointerType==='touch'&&distance>8){this.setScroll(this.drag.scroll+this.drag.start.y-p.y);this.drag.scrolling=true;}
      else if(this.drag.selecting){const r=this.byId.get(this.selected.nodeId);this.selected.end=this.textOffset(r,p);this.emitSelection();}
      else if(this.drag.hit?.kind==='seek'){const hit=this.drag.hit,local=point(inverse(hit.record.world),p.x,p.y+this.scroll);hit.fn(local);}
    }else this.hover=this.hitAt(p);
    this.canvas.style.cursor=this.disturbance?'crosshair':this.hover?.kind==='text'?'text':this.hover?'pointer':'default';
    this.overlayDirty=true;this.wake();
  }
  pointerUp(e){
    const p=this.eventPoint(e),drag=this.drag;this.drag=null;
    if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
    if(!this.disturbance&&drag&&!drag.scrolling&&!drag.moved){
      if(drag.hit?.kind==='text'){this.selectNode(drag.hit.record);}
      else if(drag.hit)drag.hit.fn?.(drag.hit.local);
      else {this.selected=null;this.options.onSelect?.(null);}
    }else if(drag?.selecting)this.emitSelection();
    this.pointer.active=false;this.pointer.time=performance.now()/1000;this.overlayDirty=true;this.wake();
  }
  selectionText(){
    const s=this.selected,r=s&&this.byId.get(s.nodeId);if(!r)return '';
    if(s.text)return s.text;
    if(r.node.kind==='text'){if(s.start!==undefined&&s.end!==undefined&&s.start!==s.end)return r.node.text.slice(Math.min(s.start,s.end),Math.max(s.start,s.end));return r.node.text;}
    return r.node.label||r.node.alt||r.node.id;
  }
  selectNode(r,value){
    this.selected={nodeId:r.node.id,text:value||undefined};this.emitSelection();this.overlayDirty=true;this.wake();
  }
  emitSelection(){this.options.onSelect?.(this.selected?{nodeId:this.selected.nodeId,text:this.selectionText(),label:this.selectionText()}:null);this.overlayDirty=true;}
  keyDown(e){
    const command=e.metaKey||e.ctrlKey;
    if(command&&e.key.toLowerCase()==='c'){e.preventDefault();this.options.onAction?.({type:'copy',text:this.selectionText()||this.getText()});}
    else if(command&&e.key.toLowerCase()==='a'){e.preventDefault();const r=this.byId.get(this.selected?.nodeId)||this.records.find(r=>r.node.kind==='text'&&r.node.role==='body');if(r)this.selectNode(r);}
    else if(e.key==='Escape'){this.selected=null;this.emitSelection();this.overlayDirty=true;this.wake();}
    else if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key)){e.preventDefault();const delta=e.key==='ArrowDown'?48:e.key==='ArrowUp'?-48:e.key==='PageDown'?this.height*.8:e.key==='PageUp'?-this.height*.8:e.key==='Home'?-1e8:1e8;this.setScroll(this.scroll+delta);}
    else if(e.key==='Enter'&&this.selected){e.preventDefault();this.options.onAction?.({type:'ask',text:'解释一下这里：'+this.selectionText().slice(0,240)});}
  }
  syncSemantics(){
    const root=this.options.semanticRoot;if(!root)return;
    const focused=document.activeElement?.dataset?.formaAction;
    const fragment=document.createDocumentFragment();
    for(const r of this.records){
      const n=r.node;if(n.kind==='group')continue;
      if(n.kind==='text'){const el=document.createElement(n.role==='title'?'h2':'p');el.textContent=n.text;fragment.append(el);}
      else if(n.kind==='chart'){const el=document.createElement('p');const d=this.scene.datasets.find(d=>d.id===n.datasetId);el.textContent=n.label+'，'+d.rows.map(row=>row.values[n.xField]+': '+format(row.values[n.yField])+n.unit).join('；');fragment.append(el);}
      else if(n.kind==='image'||n.kind==='video'){const el=document.createElement('p');el.textContent=n.label||n.alt;fragment.append(el);}
    }
    this.hits.filter(h=>h.kind==='button'||h.kind==='seek').forEach((hit,index)=>{
      const key=hit.record.node.id+':'+(hit.key||index),el=document.createElement('button');
      el.type='button';el.textContent=hit.label;el.dataset.formaAction=key;
      el.addEventListener('click',()=>{hit.fn?.({x:hit.rect.x+hit.rect.w/2,y:hit.rect.y});this.wake();});
      el.addEventListener('focus',()=>{const p=point(hit.record.world,hit.rect.x,hit.rect.y);if(p.y<this.scroll||p.y>this.scroll+this.height-60)this.setScroll(p.y-this.height/2);this.selectNode(hit.record);});
      fragment.append(el);
    });
    root.replaceChildren(fragment);
    if(focused)for(const el of root.querySelectorAll('button'))if(el.dataset.formaAction===focused){el.focus({preventScroll:true});break;}
  }
  inspectParticle(x,y){
    const pitch=this.style==='grain'?3:1;
    for(const f of [...this.fields].reverse()){
      const matrix=this.fieldMatrix(f),inv=inverse(matrix);if(!inv)continue;
      const p=point(inv,x,y+this.scroll);if(p.x<0||p.y<0||p.x>=f.w||p.y>=f.h)continue;
      const cx=Math.floor(p.x*f.ratio/pitch),cy=Math.floor(p.y*f.ratio/pitch),cols=Math.ceil(f.source.width/pitch);
      const sx=Math.min(f.source.width-1,Math.floor((cx+.5)*pitch)),sy=Math.min(f.source.height-1,Math.floor((cy+.5)*pitch));
      const color=[...f.ctx.getImageData(sx,sy,1,1).data];if(color[3]<2)continue;
      const position=point(matrix,(sx+.5)/f.ratio,(sy+.5)/f.ratio);
      return {id:f.id+'#'+(cy*cols+cx),fieldId:f.id,index:cy*cols+cx,nodeId:f.record.node.id,color,x:position.x,y:position.y-this.scroll};
    }
    return null;
  }
  overrideParticle(id,{offset=[0,0],color}={}){
    const at=id.lastIndexOf('#'),fieldId=id.slice(0,at),index=Number(id.slice(at+1));
    if(!this.fields.some(f=>f.id===fieldId)||!Number.isInteger(index))throw new Error('粒子标识已过期。');
    this.overrides.set(fieldId,{index,offset,color});this.wake();
  }
  restoreParticles(){this.overrides.clear();this.wake();}
  getDebugPixels(){return this.renderer.getDebugPixels();}
  destroy(){
    this.destroyed=true;cancelAnimationFrame(this.animationFrame);this.events.abort();this.observer.disconnect();document.fonts?.removeEventListener('loadingdone',this.fontListener);
    for(const id of [...this.media.keys()])this.unregisterMedia(id);
    this.disposeFields();this.renderer.destroy();this.options.semanticRoot?.replaceChildren();
  }
}
