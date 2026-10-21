import { ParticleRenderer } from '../particle-renderer.js';
import { ParticleCompiler } from '../compiler.js';
import { getDemo, makeTextScene } from '../scenes.js';
import { point } from '../layout.js';

const $ = (id) => document.getElementById(id);
const results = [];
let running = false;
let renderer = null;
let compiler = null;
let video = null;
let compilerErrors = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  assert(actual === expected, `${message}；实际 ${actual}，预期 ${expected}`);
}

function near(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}；实际 ${actual}，预期 ${expected} ± ${tolerance}`);
}

function throws(action, match, message) {
  let caught;
  try { action(); } catch (error) { caught = error; }
  assert(caught && (!match || match.test(caught.message)), `${message}；${caught?.message || '没有抛出错误'}`);
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
async function settle() { await frame(); await frame(); }

function source(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'));
  return canvas;
}

function sample(snapshot, x, y) {
  const index = (Math.floor(y) * snapshot.width + Math.floor(x)) * 4;
  return [...snapshot.pixels.subarray(index, index + 4)];
}

function occupied(snapshot, rect = { x: 0, y: 0, w: snapshot.width, h: snapshot.height }) {
  let count = 0;
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(snapshot.width, Math.ceil(rect.x + rect.w)), y1 = Math.min(snapshot.height, Math.ceil(rect.y + rect.h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (snapshot.pixels[(y * snapshot.width + x) * 4 + 3] > 0) count++;
  return count;
}

function centroid(snapshot) {
  let mass=0,x=0,y=0;
  for(let row=0;row<snapshot.height;row++)for(let col=0;col<snapshot.width;col++){
    const alpha=snapshot.pixels[(row*snapshot.width+col)*4+3];
    mass+=alpha;x+=(col+.5)*alpha;y+=(row+.5)*alpha;
  }
  assert(mass>0,'轨迹采样必须有实际 GPU 粒子');
  return {x:x/mass,y:y/mass};
}

function difference(a, b, rect) {
  equal(a.width, b.width, '比较图像的宽度一致');
  equal(a.height, b.height, '比较图像的高度一致');
  let count = 0;
  const area = rect || { x: 0, y: 0, w: a.width, h: a.height };
  for (let y = Math.max(0, Math.floor(area.y)); y < Math.min(a.height, Math.ceil(area.y + area.h)); y++) {
    for (let x = Math.max(0, Math.floor(area.x)); x < Math.min(a.width, Math.ceil(area.x + area.w)); x++) {
      const offset = (y * a.width + x) * 4;
      if ([0, 1, 2, 3].some((channel) => Math.abs(a.pixels[offset + channel] - b.pixels[offset + channel]) > 3)) count++;
    }
  }
  return count;
}

function glHealthy(value) {
  equal(value.gl.getError(), value.gl.NO_ERROR, 'WebGL 未报告错误');
}

const defaults = { width: 240, height: 180, dpr: 1, pitch: 1, time: 0, progress: 1, scroll: 0, reducedMotion: false, disturbance: false, idle: false, enabled: true };
function render(fields, extra = {}) {
  const stats = renderer.render(fields, { ...defaults, ...extra });
  glHealthy(renderer);
  return { stats, image: renderer.getDebugPixels() };
}

function flushCompiler() {
  if (compiler.animationFrame) cancelAnimationFrame(compiler.animationFrame);
  compiler.animationFrame = 0;
  compiler.frame(performance.now());
  assert(compilerErrors.length === 0, `编译器报错：${compilerErrors.join('；')}`);
  glHealthy(compiler.renderer);
  return compiler.getDebugPixels();
}

function clean() {
  try { compiler?.destroy(); } catch { /* a previous test can already have destroyed it */ }
  compiler = null;
  try { renderer?.destroy(); } catch { /* still clean up the remaining resources */ }
  renderer = null;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video = null;
  }
}

async function check(name, action) {
  const item = document.createElement('li');
  item.dataset.status = 'running';
  const title = document.createElement('strong');
  title.textContent = `RUN · ${name}`;
  const detail = document.createElement('small');
  detail.textContent = '正在运行真实断言…';
  item.append(title, detail);
  $('results').append(item);
  await frame();
  const started = performance.now();
  try {
    const evidence = await action();
    const elapsed = Math.round(performance.now() - started);
    item.dataset.status = 'pass';
    title.textContent = `PASS · ${name}`;
    detail.textContent = `${evidence || '全部断言通过'}（${elapsed} ms）`;
    results.push({ name, status: 'pass', evidence, elapsed });
  } catch (error) {
    const elapsed = Math.round(performance.now() - started);
    item.dataset.status = 'fail';
    title.textContent = `FAIL · ${name}`;
    detail.textContent = error.message;
    results.push({ name, status: 'fail', error: error.message, stack: error.stack, elapsed });
  }
  const passed = results.filter((result) => result.status === 'pass').length;
  $('summary').textContent = `${passed} / ${results.length} 项通过 · 运行中`;
}

async function eventReady(target, event, begin, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, success); target.removeEventListener('error', failure); };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error(`媒体 ${event} 失败：${target.error?.message || target.error?.code || '未知解码错误'}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`等待 ${event} 超时（${timeoutMs} ms）`)); }, timeoutMs);
    target.addEventListener(event, success, { once: true });
    target.addEventListener('error', failure, { once: true });
    begin();
  });
}

async function seek(time) {
  if (Math.abs(video.currentTime - time) < 0.002 && video.readyState >= 2) return;
  await eventReady(video, 'seeked', () => { video.currentTime = time; });
  await settle();
  assert(video.readyState >= 2, 'seek 后必须有可解码的视频帧');
}

export async function runVerification() {
  if (running) return;
  running = true;
  clean();
  results.length = 0;
  compilerErrors = [];
  $('run').disabled = true;
  $('results').replaceChildren();
  $('details').textContent = '';
  $('summary').textContent = '正在启动 WebGL 2…';
  $('summary').dataset.status = 'running';
  $('compiler-host').className = 'wide';
  try {
    await document.fonts.ready;
    await check('真实 WebGL 2 初始化与着色器链接', () => {
      renderer = new ParticleRenderer($('renderer-canvas'));
      const gl = renderer.gl;
      assert(gl instanceof WebGL2RenderingContext, '必须使用实际 WebGL2RenderingContext');
      assert(gl.getProgramParameter(renderer.fieldProgram.value, gl.LINK_STATUS), '格点粒子程序链接失败');
      assert(gl.getProgramParameter(renderer.materialProgram.value, gl.LINK_STATUS), '液态粒子程序链接失败');
      glHealthy(renderer);
      const small=render([], {width:240,height:180,dpr:1,idle:true}).stats.particles;
      const large=render([], {width:960,height:540,dpr:2,idle:true}).stats.particles;
      assert(large>small&&large<=2500000,'液态粒子数量随有效屏幕像素变化，并受预算约束');
      $('environment').textContent = `${gl.getParameter(gl.VERSION)} · ${gl.getParameter(gl.SHADING_LANGUAGE_VERSION)} · DPR ${window.devicePixelRatio} · ${navigator.userAgent}`;
      assert(gl.getProgramParameter(renderer.materialProgram.value,gl.LINK_STATUS)&&gl.getProgramParameter(renderer.surfaceProgram.value,gl.LINK_STATUS),'密度与液面程序必须链接');
      return `三个 GPU 程序链接；液体使用 ${renderer.floatDensity?'RGBA16F':'RGBA8'} 密度场；粒子提交随像素预算由 ${small} 增至 ${large}。`;
    });


    await check('黑色液面连续，展开途中逐渐染成目标颜色',()=>{
      const idle=render([],{idle:true,width:400,height:320}).image;
      let opaque=0,dark=0;
      for(let y=110;y<185;y++)for(let x=165;x<235;x++){
        const p=sample(idle,x,y);if(p[3]>245)opaque++;if(p[0]<90&&p[1]<90&&p[2]<90)dark++;
      }
      assert(opaque>5000&&dark>4800,`中心必须是连续不透明黑液面，实际 ${opaque} 不透明 / ${dark} 黑色格点`);
      equal(occupied(idle,{x:0,y:0,w:70,h:70}),0,'液团以外留白');
      const handle=renderer.createField(source(64,64,ctx=>{ctx.fillStyle='#6267dc';ctx.fillRect(0,0,64,64);}));
      const field={id:'gradient',handle,ratio:1,transform:[1,0,0,1,152,94]};
      const means=[];
      try{
        for(const progress of [.30,.48,.65]){
          const image=render([field],{progress,motionEpoch:4}).image;
          let mass=0,r=0,g=0,b=0;
          for(let i=0;i<image.pixels.length;i+=4)if(image.pixels[i+3]>220){mass++;r+=image.pixels[i];g+=image.pixels[i+1];b+=image.pixels[i+2];}
          assert(mass>100,'渐变采样中必须有实际液面');means.push([r/mass,g/mass,b/mass]);
        }
        assert(means[1][2]>means[0][2]+10&&means[2][2]>means[1][2]+10,`途中蓝色应渐增，实际 ${means.map(m=>m[2].toFixed(1))}`);
        assert(means[2][2]>means[2][0]*1.5,'落板之前已经呈现目标紫色');
        return `中心 ${opaque} 个采样格点连续覆盖；30% / 48% / 65% 的蓝色均值 ${means.map(m=>m[2].toFixed(1)).join(' / ')}，目标颜色在附着前渐变。`;
      }finally{renderer.deleteField(handle);}
    });

    await check('单粒子可寻址：移动后原位置清空，目标位置改色', () => {
      assert(renderer, '初始化失败，无法运行此项');
      const handle = renderer.createField(source(4, 4, (ctx) => { ctx.fillStyle = '#ff0000'; ctx.fillRect(1, 1, 1, 1); }));
      const field = { id: 'single', handle, ratio: 1, transform: [1, 0, 0, 1, 20, 30] };
      try {
        const initial = render([field]);
        equal(occupied(initial.image), 1, '只绘制一个非透明粒子');
        equal(sample(initial.image, 21, 31).join(','), '255,0,0,255', '原位置是红色粒子');
        const shifted = render([{ ...field, override: { index: 5, offset: [20, 10], color: [0, 1, 0, 1] } }]);
        equal(sample(shifted.image, 21, 31)[3], 0, '移动后原位置必须透明');
        equal(sample(shifted.image, 41, 41).join(','), '0,255,0,255', '目标位置是绿色粒子');
        equal(occupied(shifted.image), 1, '移动不会复制粒子');
        equal(shifted.stats.drawCalls, 1, '一个字段只提交一次粒子绘制');
        return '读取 (21,31) 与 (41,41)：红色原点消失，绿色目标出现，总可见像素仍为 1。';
      } finally { renderer.deleteField(handle); }
    });

    await check('字段前后层与半透明颜色合成正确', () => {
      const make = (color) => renderer.createField(source(2, 2, (ctx) => { ctx.fillStyle = color; ctx.fillRect(0, 0, 2, 2); }));
      const back = make('#ff0000'), front = make('#0000ff');
      const a = { id: 'back', handle: back, ratio: 1, transform: [1, 0, 0, 1, 40, 50] };
      const b = { id: 'front', handle: front, ratio: 1, transform: [1, 0, 0, 1, 40, 50] };
      try {
        equal(sample(render([a, b]).image, 40, 50).join(','), '0,0,255,255', '前层蓝色遮住后层红色');
        equal(sample(render([b, a]).image, 40, 50).join(','), '255,0,0,255', '交换字段顺序应交换前后层');
        const mixed = sample(render([a, { ...b, opacity: 0.5 }]).image, 40, 50);
        near(mixed[0], 128, 1, '半透明蓝色保留后层红色');
        near(mixed[2], 128, 1, '半透明蓝色贡献正确');
        equal(mixed[3], 255, '不透明底层使总覆盖率保持 1');
        const moved = sample(render([a, { ...b, override: { index: 0, offset: [10, 0] } }]).image, 40, 50);
        equal(moved.join(','), '255,0,0,255', '前层粒子移动后正确显示仍存在的后层');
        return '读回证实字段顺序、50% 预乘 alpha 合成和移动后的下层恢复。';
      } finally { renderer.deleteField(back); renderer.deleteField(front); }
    });

    await check('同一份材料离开中心、到达目标，终点前后没有切换', () => {
      const make=()=>renderer.createField(source(28,28,ctx=>{ctx.fillStyle='#6267dc';ctx.fillRect(0,0,28,28);}));
      const left=make(),right=make();
      const fields=[{id:'left',handle:left,ratio:1,transform:[1,0,0,1,12,12]},{id:'right',handle:right,ratio:1,transform:[1,0,0,1,195,140]}];
      const centre={x:108,y:78,w:24,h:24};
      try{
        render([],{idle:true});
        const first=render(fields,{progress:0,motionEpoch:70}).image;
        const pool=renderer.material,positions=pool.position,count=pool.count;
        assert(occupied(first,centre)>400,'起点中心必须由材料组成');
        equal(occupied(first,{x:12,y:12,w:28,h:28}),0,'材料到来前目标必须为空');
        const evidence=[];
        for(const progress of [.15,.32,.5,.8,.99]){
          render(fields,{progress,motionEpoch:70});const m=renderer.inspectMaterial();
          equal(renderer.material,pool,'过程不替换材料池');equal(pool.position,positions,'位置存储持续复用');
          equal(m.waiting+m.moving+m.attached,count,'材料身份没有复制或丢失');
          if(progress>=.32)equal(m.waiting,0,'所有材料已经离开待出发状态');evidence.push(m);
        }
        const beforeEnd=renderer.getDebugPixels();equal(occupied(beforeEnd,centre),0,'计时结束之前中心已随材料离开而清空');
        const final=render(fields,{progress:1,motionEpoch:70}).image;
        equal(difference(beforeEnd,final),0,'99% 与终点逐像素相同，不依靠末帧换图');
        equal(occupied(final),1568,'只剩两块内容的真实像素');
        equal(renderer.inspectMaterial().attached,count,'材料全部附着');
        return `${count} 份材料保留身份；待出发数量 ${evidence.map(m=>m.waiting).join(' → ')}；终点前中心已空，99% 与 100% 无像素跳变。`;
      }finally{renderer.deleteField(left);renderer.deleteField(right);}
    });

    await check('材料贡献归零时液面也归零，没有独立黑团或连接形状',()=>{
      const handle=renderer.createField(source(24,24,ctx=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,24,24);}));
      const fields=[{id:'material-only',handle,ratio:1,transform:[1,0,0,1,195,140]}];
      try{
        render([],{idle:true});render(fields,{progress:0,motionEpoch:71});
        renderer.material.position.fill(-10000);renderer.material.pack();
        equal(occupied(render(fields,{progress:0,motionEpoch:71}).image),0,'移走全部材料后不能有任何背景液团或附加液桥');
        renderer.material.rewind();
        assert(occupied(render(fields,{progress:.2,motionEpoch:71}).image)>50,'恢复同一份材料后液面恢复');
        return '故障注入：同一批材料全部移出视口，GPU RGBA 全空；恢复后正常成像。';
      }finally{renderer.deleteField(handle);}
    });

    await check('驻留后的最终画面仍读取材料状态，没有终点绕过路径',()=>{
      const handle=renderer.createField(source(12,12,ctx=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,12,12);}));
      const fields=[{id:'retained',handle,ratio:1,transform:[1,0,0,1,40,50]}];
      const upload=renderer.uploadMaterial;
      try{
        const original=render(fields,{progress:1,motionEpoch:72}).image;
        equal(occupied(original),144,'驻留后完整成像');
        // Inject at the GPU upload boundary, after integration. This detects a
        // final-frame shader that silently bypasses the persistent state.
        renderer.uploadMaterial=function(){for(let i=0;i<this.material.count;i++)this.material.packed[i*4]+=20;upload.call(this);};
        const shifted=render(fields,{progress:1,motionEpoch:72}).image;
        equal(occupied(shifted,{x:40,y:50,w:12,h:12}),0,'驻留后的原位置随材料状态移动而消失');
        equal(occupied(shifted,{x:60,y:50,w:12,h:12}),144,'驻留后的目标位置随材料状态移动');
        return '100% 后仅改材料状态，144 个显示像素整体移动 20 px；源图与布局均未修改。';
      }finally{renderer.uploadMaterial=upload;renderer.deleteField(handle);}
    });

    await check('未附着的邻居不能拉走已到达材料的显示贡献',()=>{
      const handle=renderer.createField(source(24,24,ctx=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,24,24);}));
      const fields=[{id:'local-coverage',handle,ratio:1,transform:[1,0,0,1,40,50]}];
      const upload=renderer.uploadMaterial;
      try{
        render([],{idle:true});render(fields,{progress:0,motionEpoch:74});
        const owner=renderer.ownerFields.get(handle).owners[0]-1;
        renderer.uploadMaterial=function(){
          for(let i=0;i<this.material.count;i++){
            this.material.packed[i*4]=this.material.target[i*2]+(i===owner?0:80);
            this.material.packed[i*4+1]=this.material.target[i*2+1];
            this.material.packed[i*4+2]=i===owner?1:0;this.material.packed[i*4+3]=1;
            this.material.currentPigment[i*4+3]=0;
          }upload.call(this);
        };
        const image=render(fields,{progress:0,motionEpoch:74}).image;
        const all=occupied(image),local=occupied(image,{x:40,y:50,w:24,h:24});
        assert(all>0,'已到达材料必须成像');equal(local,all,'未附着邻居不应在远处或中间位置复制显示贡献');
        return '仅一份材料允许精细成像，其余材料远离目标；全部输出仍在真实目标范围内。';
      }finally{renderer.uploadMaterial=upload;renderer.deleteField(handle);}
    });

    await check('内容更新、目标运动、滚动与缩放沿用材料归属',()=>{
      const bitmap=source(24,24,ctx=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,8,8);});
      const handle=renderer.createField(bitmap),field={id:'live',handle,ratio:1,transform:[1,0,0,1,40,50]};
      try{
        render([field],{motionEpoch:73});const pool=renderer.material,owner=renderer.ownerFields.get(handle).texture;
        const ids=pool.tileIds.slice();
        const ctx=bitmap.getContext('2d');ctx.clearRect(0,0,24,24);ctx.fillStyle='#0000ff';ctx.fillRect(16,16,8,8);renderer.updateField(handle,bitmap);
        const changed=render([field],{motionEpoch:73}).image;
        equal(occupied(changed,{x:40,y:50,w:8,h:8}),0,'旧帧原位置清空');
        equal(sample(changed,58,68).join(','),'0,0,255,255','新帧在原来透明的区域直接成像');
        field.transform=[1,0,0,1,60,70];
        const moved=render([field],{motionEpoch:73,scroll:10}).image;
        equal(sample(moved,78,78).join(','),'0,0,255,255','运动目标与滚动合成正确');
        render([field],{motionEpoch:73,width:320,height:240});
        equal(renderer.material,pool,'缩放不替换材料身份');equal(renderer.ownerFields.get(handle).texture,owner,'运动/帧更新/滚动不重新分配归属');
        equal([...pool.tileIds].join(','),[...ids].join(','),'材料仍归属于原内容块');
        return '同一内容更新透明区域、移动、滚动、改变视口后，材料池与归属纹理均保持原对象。';
      }finally{renderer.deleteField(handle);}
    });

    await check('扰动惯性在不同刷新率一致，并完整归位', () => {
      const handle=renderer.createField(source(1,1,ctx=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,1,1);}));
      const field={id:'pointer-motion',handle,ratio:1,transform:[8,0,0,8,116,86]};
      try{
        const images=[];
        for(const hz of [30,60,120]){
          renderer.pointerMotion.reset();
          const pointer={x:92,y:80,active:true,time:0};
          render([field],{time:0,disturbance:true,pointer});
          for(let i=1;i<=hz/5;i++)render([field],{time:i/hz,disturbance:true,pointer});
          images.push(renderer.getDebugPixels());
        }
        equal(difference(images[0],images[1]),0,'30 与 60 Hz 的同时间画面一致');
        equal(difference(images[0],images[2]),0,'30 与 120 Hz 的同时间画面一致');
        render([field],{time:5,disturbance:true,pointer:{x:92,y:80,active:true,time:0}});
        const holding=renderer.getDebugPixels();
        const released={x:92,y:80,active:false,time:5};
        const release=render([field],{time:5,disturbance:false,pointer:released}).image;
        equal(difference(holding,release),0,'松开第一帧位置连续');
        assert(renderer.needsFrame,'松开后仍请求惯性收尾帧');
        const settled=render([field],{time:6,disturbance:false,pointer:released}).image;
        assert(!renderer.needsFrame,'收稳后停止请求帧');
        renderer.pointerMotion.reset();
        equal(difference(settled,render([field],{time:7}).image),0,'最终精确回到未扰动像素');
        return '30 / 60 / 120 Hz 同时刻像素一致；长时间停留后松开连续，关闭扰动也完整归位。';
      }finally{renderer.deleteField(handle);renderer.pointerMotion.reset();}
    });

    await check('编译器所有显示内容可统一停用并清空', async () => {
      compiler = new ParticleCompiler($('compiler-canvas'), { onError: (message) => compilerErrors.push(message) });
      compiler.setReducedMotion(true);
      await settle();
      const counts = [];
      for (const kind of ['welcome', 'text', 'chart', 'orbit', 'video']) {
        compiler.setScene(getDemo(kind), { animate: false });
        compiler.setStatus('QA 粒子状态标签');
        compiler.setRenderingEnabled(true);
        const before = flushCompiler();
        const count = occupied(before);
        assert(count > 50, `${kind} 必须先有真实 GPU 显示内容`);
        compiler.setRenderingEnabled(false);
        const cleared = flushCompiler();
        equal(cleared.pixels.some((value) => value !== 0), false, `${kind} 停用后所有 RGBA 值必须归零`);
        compiler.setRenderingEnabled(true);
        assert(occupied(flushCompiler()) > 50, `${kind} 可恢复显示`);
        counts.push(`${kind}:${count}`);
      }
      compiler.setStatus('');
      return `文字、图表、轨道、媒体占位与黑色液团均通过，状态标签也一并清空。初始可见像素：${counts.join(' / ')}`;
    });

    await check('编译器持续刷新扰动直到归位，并停止静态刷新', () => {
      compiler.setReducedMotion(false);compiler.setScene(getDemo('text'),{animate:false});compiler.setDisturbance(true);
      const now=performance.now(),base=now/1000;
      const at=time=>{cancelAnimationFrame(compiler.animationFrame);compiler.animationFrame=0;compiler.frame(time);};
      compiler.pointer={x:120,y:100,active:true,time:base};
      at(now);at(now+3000);
      assert(!compiler.renderer.needsFrame,'停留稳定后不需要额外帧');
      compiler.lastPointerMove=now;
      compiler.pointer={x:120,y:100,active:false,time:base+3};
      at(now+3000);
      assert(compiler.renderer.needsFrame&&compiler.animationFrame!==0,'离开时间与最后移动相隔3秒，也必须持续刷新');
      at(now+4000);
      assert(!compiler.renderer.needsFrame&&compiler.animationFrame===0,'归位后恢复静态停帧');
      compiler.setDisturbance(false);compiler.setReducedMotion(true);flushCompiler();
      return '长停留离开仍安排 RAF，归位后 RAF 归零；不再依赖最后移动后的固定550ms窗口。';
    });

    await check('非法场景事务不能破坏现有文本和 GPU 画面', () => {
      compiler.setScene(getDemo('text'), { animate: false });
      const before = flushCompiler();
      const previousScene = JSON.stringify(compiler.scene), previousText = compiler.getText();
      const invalid = getDemo('chart');
      invalid.nodes.find((node) => node.kind === 'chart').datasetId = 'doesNotExist';
      throws(() => compiler.setScene(invalid), /数据集不存在/, '错误引用必须被拒绝');
      const excessive=getDemo('orbit');
      const huge=excessive.nodes.find(node=>node.id==='earth');
      huge.layout.width=8192;huge.layout.height=8192;
      throws(()=>compiler.setScene(excessive), /上限|预算/, '超额资源必须在分配大画布前拒绝');
      equal(JSON.stringify(compiler.scene), previousScene, '提交失败后场景保持不变');
      equal(compiler.getText(), previousText, '提交失败后语义文本保持不变');
      equal(difference(before, flushCompiler()), 0, '提交失败后 GPU 画面保持不变');
      return '无效数据引用与超额资源被拒绝；场景 JSON、真实文本与逐像素画面均保持原值。';
    });

    await check('中文长文窄屏再宽屏：排版完整、末尾可见', async () => {
      const body = Array.from({ length: 24 }, (_, index) => `第${index + 1}段：粒子附着在相应的位置，附着的瞬间便成为文字。中文、标点和数字 123 都应完整保留。`).join('\n') + '\n验收终点：全文到这里完整结束。';
      const expected = body.replace(/\n/g, '');
      compiler.setScene(makeTextScene(body, '中文重排验收'), { animate: false });
      const evidence = [];
      for (const mode of ['narrow', 'wide']) {
        $('compiler-host').className = mode;
        await settle();
        compiler.resize();
        flushCompiler();
        const record = compiler.byId.get('body');
        equal(record.lines.flatMap((line) => line.parts.map((part) => part.text)).join(''), expected, `${mode} 不丢字符、不复制字符`);
        assert(record.lines.every((line) => line.width <= record.w + 0.5), `${mode} 所有文字行应在可用宽度内`);
        equal(record.lines.at(-1).end, body.length, `${mode} 末尾索引必须覆盖全文`);
        assert(compiler.getText().includes(body), `${mode} 复制文本保留原始全文`);
        compiler.setScroll(1e9);
        const image = flushCompiler();
        const lastField = compiler.fields.filter((field) => field.record.node.id === 'body').at(-1);
        const corner = point(compiler.fieldMatrix(lastField), 0, 0);
        const region = { x: corner.x * compiler.ratio, y: (corner.y - compiler.scroll) * compiler.ratio, w: lastField.w * compiler.ratio, h: lastField.h * compiler.ratio };
        const finalInk = occupied(image, region);
        assert(finalInk > 20, `${mode} 末尾文本字段必须真实显示在 GPU 视口`);
        evidence.push({ mode, width: compiler.width, lines: record.lines.length, finalInk });
      }
      equal(evidence[0].width, 320, '窄屏实际宽度');
      equal(evidence[1].width, 800, '宽屏实际宽度');
      assert(evidence[0].lines > evidence[1].lines, '扩大面板应减少换行数量');
      return `${body.length} 字符完整保留；320 px 为 ${evidence[0].lines} 行，800 px 为 ${evidence[1].lines} 行；两次末尾像素均可见。`;
    });

    await check('真实视频解码、seek 与粒子纹理更新，无可见 video 层', async () => {
      video = document.createElement('video');
      video.preload = 'auto'; video.muted = true; video.playsInline = true;
      await eventReady(video, 'loadeddata', () => { video.src = new URL('../assets/sample.webm', import.meta.url).href; video.load(); });
      assert(video.videoWidth > 0 && video.videoHeight > 0, '样例视频必须已解码出真实尺寸');
      assert(Number.isFinite(video.duration) && video.duration > 0.5, '样例视频需要可 seek 的有效时长');
      compiler.registerMedia('sampleVideo', video);
      compiler.setScene(getDemo('video'), { animate: false });
      const firstTime = Math.min(0.15, video.duration * 0.1);
      const secondTime = Math.min(video.duration - 0.1, video.duration * 0.7);
      await seek(firstTime);
      const first = flushCompiler();
      const mediaField = compiler.fields.find((field) => field.mediaId === 'sampleVideo');
      const corner = point(compiler.fieldMatrix(mediaField), 0, 0);
      const cssRegion = { x: corner.x + 30, y: corner.y + 20 - compiler.scroll, w: mediaField.w - 60, h: Math.min(mediaField.h - 106, compiler.height - (corner.y + 20 - compiler.scroll) - 8) };
      assert(cssRegion.h > 30, 'GPU 比较区必须包含视频图像，不能只包含播放控件');
      const region = Object.fromEntries(Object.entries(cssRegion).map(([key, value]) => [key, value * compiler.ratio]));
      await seek(secondTime);
      const second = flushCompiler();
      const changed = difference(first, second, region);
      assert(changed > 200, `seek 后视频图像区必须真实变化；实际 ${changed} 像素`);
      near(mediaField.lastMediaTime, video.currentTime, 0.02, '上传颜色场的帧时间应跟随 seek');
      equal(video.isConnected, false, '解码 video 不连接显示 DOM');
      equal(document.querySelectorAll('video').length, 0, '页面不存在可见或隐藏的 video 叠层');
      compiler.setRenderingEnabled(false);
      equal(occupied(flushCompiler()), 0, '视频也随粒子绘制停用一起消失');
      compiler.setRenderingEnabled(true);
      flushCompiler();
      return `${video.videoWidth}×${video.videoHeight} 视频从 ${firstTime.toFixed(2)} s seek 到 ${secondTime.toFixed(2)} s，图像区 ${changed} 像素发生变化；页面 video 元素为 0。`;
    });

    await check('destroy 释放 GPU 字段、媒体监听与动画生命周期', async () => {
      assert(compiler && renderer, '必须先创建编译器与渲染器');
      const textureHandles = [...compiler.renderer.fields].map((handle) => handle.texture);
      textureHandles.push(compiler.renderer.densityTexture,compiler.renderer.pigmentTexture,...compiler.renderer.materialTextures,...[...compiler.renderer.ownerFields.values()].map(o=>o.texture));
      const gl = compiler.renderer.gl;
      const oldRenderer = compiler.renderer;
      let callbacksAfterDestroy = 0;
      const originalFrame = compiler.frame.bind(compiler);
      compiler.frame = (time) => { callbacksAfterDestroy++; return originalFrame(time); };
      compiler.wake();
      compiler.destroy();
      equal(oldRenderer.destroyed, true, '编译器销毁其渲染器');
      equal(oldRenderer.fields.size, 0, '编译器颜色场集合清空');
      equal(compiler.media.size, 0, '媒体注册表清空');
      equal(compiler.mediaListeners.size, 0, '媒体事件监听解除');
      for (const texture of textureHandles) equal(gl.isTexture(texture), false, 'GPU 纹理对象已删除');
      await settle();
      equal(callbacksAfterDestroy, 0, 'destroy 后无后续动画帧执行');
      if (video) equal(video.paused, true, '销毁后视频暂停');
      throws(() => oldRenderer.getDebugPixels(), /已释放/, '销毁后的渲染器不能继续读回');
      const directProgram = renderer.fieldProgram.value;
      renderer.destroy();
      equal(renderer.gl.isProgram(directProgram), false, '直接渲染器程序已删除');
      for(const name of ['materialProgram','surfaceProgram'])equal(renderer.gl.isProgram(renderer[name].value),false,'液面程序已删除');
      equal(renderer.gl.isFramebuffer(renderer.densityFramebuffer),false,'液面帧缓冲已删除');
      throws(() => renderer.render([], defaults), /已释放/, '销毁后的渲染器不能继续绘制');
      return `${textureHandles.length} 个编译器纹理已删除；媒体和 RAF 停止；已销毁对象明确拒绝后续调用。`;
    });
  } catch (error) {
    results.push({ name: '验收执行器', status: 'fail', error: error.message, stack: error.stack });
  } finally {
    clean();
    const passed = results.filter((result) => result.status === 'pass').length;
    const failed = results.length - passed;
    $('summary').textContent = `${passed} / ${results.length} 项通过${failed ? ` · ${failed} 项失败` : ' · 全部通过'}`;
    $('summary').dataset.status = failed ? 'fail' : 'pass';
    $('details').textContent = JSON.stringify({ completedAt: new Date().toISOString(), passed, failed, results }, null, 2);
    window.formaQA = { passed, failed, results: structuredClone(results) };
    $('run').disabled = false;
    running = false;
  }
}

$('run').addEventListener('click', runVerification);
runVerification();
