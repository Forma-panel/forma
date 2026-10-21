import {FLOW_DURATION} from '../material-state.js';
import {ParticleCompiler} from '../compiler.js';
import {getDemo} from '../scenes.js';
import {point} from '../layout.js';
const $=id=>document.getElementById(id);
const canvas=$('canvas');
const compiler=new ParticleCompiler(canvas,{onError:message=>{$('status').textContent=message;}});
let raf=0,current='welcome',progress=0,recording=false,url=null;
let localImage=null,imageUrl=null;
const duration=FLOW_DURATION;
function selectedScene(name){
  if(name!=='image')return getDemo(name);
  if(!localImage)throw new Error('请先选择一张本地图片');
  return {protocol:'panel-scene/0.3',summary:'local-image-study',nodes:[
    {id:'answer',parentId:null,kind:'group',direction:'column',layout:{mode:'flow'}},
    {id:'image',parentId:'answer',kind:'image',assetId:'study-image',alt:localImage.name,fit:'contain',layout:{mode:'flow',height:Math.max(120,compiler.height-130)}},
  ],datasets:[],animations:[],actions:[]};
}
function stop(){cancelAnimationFrame(raf);raf=0;cancelAnimationFrame(compiler.animationFrame);compiler.animationFrame=0;}
function draw(value){
  stop();progress=value;
  const name=value<0?'welcome':$('scene').value;
  if(name!==current||!compiler.scene){compiler.setScene(selectedScene(name),{animate:false});current=name;}
  cancelAnimationFrame(compiler.animationFrame);compiler.animationFrame=0;
  compiler.revealStart=10000;compiler.revealDuration=value<0?0:duration;
  compiler.frame(value<0?9000:10000+value*duration);
  cancelAnimationFrame(compiler.animationFrame);compiler.animationFrame=0;
  $('progress').value=Math.max(0,value)*100;
  $('position').textContent=value<0?'中心液体':Math.round(value*100)+'%';
  const material=compiler.renderer.inspectMaterial();
  if(material)$('material-stats').textContent=`材料 ${material.count} · 待出发 ${material.waiting} · 流动 ${material.moving} · 附着 ${material.attached}`;
}
function play(){
  if(recording)return;
  stop();const start=performance.now(),samples=[];
  const tick=now=>{
    const t=now-start;draw(t<500?-1:Math.min(1,(t-500)/duration));
    if(t>=550&&t<=500+duration)samples.push(now);
    if(t<500+duration)raf=requestAnimationFrame(tick);
    else if(samples.length>1){
      const gaps=samples.slice(1).map((v,i)=>v-samples[i]).sort((a,b)=>a-b);
      const fps=(samples.length-1)*1000/(samples.at(-1)-samples[0]);
      $('status').textContent=`本次原速展开：${fps.toFixed(1)} FPS；95% 帧间隔 ≤ ${gaps[Math.floor(gaps.length*.95)].toFixed(1)} ms。实际测量，不含录屏开销。`;
    }
  };
  raf=requestAnimationFrame(tick);
}
$('play').addEventListener('click',play);
$('idle').addEventListener('click',()=>draw(-1));
$('progress').addEventListener('input',e=>draw(Number(e.target.value)/100));
$('scene').addEventListener('change',()=>draw(progress));
$('choose-image').addEventListener('click',()=>{if(!recording)$('image-file').click();});
$('image-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';
  if(!file||recording)return;
  if(!file.type.startsWith('image/')||file.size>150*1024*1024){$('status').textContent='请选择小于 150 MB 的本地图片。';return;}
  const nextUrl=URL.createObjectURL(file),element=new Image();element.src=nextUrl;
  try{
    await element.decode();stop();
    const previousUrl=imageUrl;imageUrl=nextUrl;localImage={element,name:file.name};
    compiler.registerMedia('study-image',element);
    if(previousUrl)URL.revokeObjectURL(previousUrl);
    $('image-option').disabled=false;$('scene').value='image';current='';
    $('verify-image').hidden=false;$('image-result').textContent='';
    draw(-1);
    $('status').textContent=`已读取 ${file.name} · ${element.naturalWidth} × ${element.naturalHeight}；点击重播展开。文件只在本机读取。`;
  }catch(error){URL.revokeObjectURL(nextUrl);$('status').textContent=`图片读取失败：${error.message}`;}
});
$('verify-image').addEventListener('click',()=>{
  if(recording||!localImage)return;
  $('scene').value='image';draw(1);
  const field=compiler.fields.find(f=>f.mediaId==='study-image');
  const source=field.ctx.getImageData(0,0,field.source.width,field.source.height);
  const output=compiler.getDebugPixels(),matrix=compiler.fieldMatrix(field);
  let checked=0,maxError=0,totalError=0;
  // Compare interior sampling cells with the actual uploaded colour field,
  // accounting for the same transforms and premultiplied alpha as the GPU.
  for(let y=8;y<source.height-8;y+=11)for(let x=8;x<source.width-8;x+=13){
    const world=point(matrix,(x+.5)/field.ratio,(y+.5)/field.ratio);
    const px=Math.floor(world.x*compiler.ratio),py=Math.floor((world.y-compiler.scroll)*compiler.ratio);
    if(px<0||py<0||px>=output.width||py>=output.height)continue;
    const s=(y*source.width+x)*4,d=(py*output.width+px)*4;
    for(let c=0;c<4;c++){
      const expected=c===3?source.data[s+3]:Math.round(source.data[s+c]*source.data[s+3]/255);
      const error=Math.abs(output.pixels[d+c]-expected);maxError=Math.max(maxError,error);totalError+=error;
    }
    checked++;
  }
  const result={file:localImage.name,sourceSize:[localImage.element.naturalWidth,localImage.element.naturalHeight],canvasSize:[output.width,output.height],checkedPixels:checked,maxChannelError:maxError,meanChannelError:totalError/(checked*4),pass:checked>100&&maxError<=2,displayPath:'WebGL2 gl.POINTS',visibleImageElements:document.querySelectorAll('img,video').length};
  $('image-result').textContent=JSON.stringify(result,null,2);
  $('status').textContent=`${result.pass?'通过':'未通过'}：检查 ${checked} 个格点，最大色差 ${maxError}/255（相对于编译器缩放后的颜色场）。`;
});
$('record').addEventListener('click',async()=>{
  if(recording)return;
  recording=true;stop();$('record').disabled=true;
  const output=document.createElement('canvas');output.width=Math.min(960,canvas.width);output.height=Math.round(canvas.height*output.width/canvas.width);
  const ctx=output.getContext('2d'),stream=output.captureStream(60),chunks=[];
  const type=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  let recorder;
  try{
    recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:7000000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{
      if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob(chunks,{type}));
      $('download').href=url;$('download').hidden=false;
      $('status').textContent='录制完成：真实 WebGL 画布，原速，未添加过渡素材。';
      stream.getTracks().forEach(t=>t.stop());recording=false;$('record').disabled=false;
    };
    const start=performance.now();recorder.start();
    const tick=now=>{
      const t=now-start;draw(t<1100?-1:Math.min(1,(t-1100)/duration));
      ctx.fillStyle='#fffefa';ctx.fillRect(0,0,output.width,output.height);ctx.drawImage(canvas,0,0,output.width,output.height);
      if(t<1100+duration+1350)raf=requestAnimationFrame(tick);else recorder.stop();
    };raf=requestAnimationFrame(tick);
    $('status').textContent='正在录制真实画布…';
  }catch(error){stream.getTracks().forEach(t=>t.stop());recording=false;$('record').disabled=false;$('status').textContent=error.message;}
});
await document.fonts.ready;draw(-1);
window.addEventListener('pagehide',()=>{stop();compiler.destroy();if(url)URL.revokeObjectURL(url);if(imageUrl)URL.revokeObjectURL(imageUrl);});
