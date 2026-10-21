// Every submitted vertex is an independently addressable grid particle.
// Textures are sampled only for colour/coverage: there is no textured quad path.
import { PointerMotion } from './motion.js';
import { MATERIAL_VERTEX, DENSITY_FRAGMENT, SURFACE_VERTEX } from './liquid-shaders.js';
import { MaterialState, FLOW_DURATION } from './material-state.js';
import { MaterialPlan } from './material-plan.js';

const FIELD_VERTEX = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uField;
uniform sampler2D uOwners;
uniform sampler2D uState;
uniform sampler2D uTargets;
uniform sampler2D uOrigin;
uniform int uStateColumns;
uniform int uTileSize;
uniform bool uBound;
uniform bool uCoherent;
uniform ivec2 uSourceSize;
uniform int uColumns;
uniform float uPitch;
uniform float uRatio;
uniform mat3 uTransform;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uScroll;
uniform float uOpacity;
uniform float uPointMax;
uniform bool uGrain;
uniform bool uDisturbance;
uniform vec3 uPointer;
uniform int uOverrideIndex;
uniform vec2 uOverrideOffset;
uniform vec4 uOverrideColor;
uniform bool uOverrideHasColor;
out vec4 vColor;
out float vRoundness;
void main(){
  int index=gl_VertexID;
  ivec2 cell=ivec2(index%uColumns,index/uColumns);
  vec2 source=min((vec2(cell)+0.5)*uPitch,vec2(uSourceSize)-0.5);
  vec4 color=texelFetch(uField,ivec2(source),0);
  bool overridden=index==uOverrideIndex;
  if(overridden&&uOverrideHasColor)color=uOverrideColor;
  color.a*=uOpacity;
  vec2 point=(uTransform*vec3(source/uRatio,1.0)).xy;
  point.y-=uScroll;
  if(uBound&&color.a>0.0){
    // Smooth reconstruction of neighbouring material displacements keeps the
    // material continuous across compile tiles. All samples retain their IDs.
    vec2 grid=source/float(uTileSize)-0.5,fraction=fract(grid);
    ivec2 base=ivec2(floor(grid)),size=textureSize(uOwners,0);
    if(uCoherent){base=ivec2(source)/uTileSize;fraction=vec2(0.0);}
    vec2 displacement=vec2(0.0);vec3 origin=vec3(0.0);
    float weightSum=0.0,cover=0.0,tint=0.0;
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
      if(uCoherent&&(x>0||y>0))continue;
      ivec2 tile=clamp(base+ivec2(x,y),ivec2(0),size-1);
      int owner=int(texelFetch(uOwners,tile,0).r)-1;if(owner<0)continue;
      float weight=(x==0?1.0-fraction.x:fraction.x)*(y==0?1.0-fraction.y:fraction.y);
      ivec2 address=ivec2(owner%uStateColumns,owner/uStateColumns);
      vec4 material=texelFetch(uState,address,0);
      float contribution=weight*material.z;
      displacement+=(material.xy-texelFetch(uTargets,address,0).rg)*contribution;
      origin+=texelFetch(uOrigin,address,0).rgb*contribution;
      cover+=contribution;tint+=material.w*contribution;weightSum+=weight;
    }
    if(cover>0.00001){
      // Unattached neighbours have no fine-coverage contribution and therefore
      // cannot drag an arrived cell back into space between unrelated parcels.
      point+=displacement/cover;
      color.rgb=mix(origin/cover,color.rgb,tint/cover);
      color.a*=cover/weightSum;
    }else color.a=0.0;
  }
  if(overridden)point+=uOverrideOffset;
  if(uDisturbance&&uPointer.z>0.0){
    vec2 delta=point-uPointer.xy;
    point+=delta*(1.0-smoothstep(0.0,70.0,length(delta)))*1.2*uPointer.z;
  }
  float worldScale=max(length(uTransform[0].xy),length(uTransform[1].xy));
  gl_PointSize=clamp(uPitch*worldScale*uDpr/uRatio,1.0,uPointMax);
  gl_Position=vec4(point.x/uViewport.x*2.0-1.0,1.0-point.y/uViewport.y*2.0,0.0,1.0);
  vColor=color;vRoundness=uGrain?1.0:0.0;
  if(color.a<0.001)gl_Position=vec4(3.0,3.0,0.0,1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
in float vRoundness;
out vec4 outputColor;
void main() {
  float alpha = vColor.a;
  if (vRoundness > 0.5) {
    float radius = length(gl_PointCoord * 2.0 - 1.0);
    alpha *= 1.0 - smoothstep(0.68, 1.0, radius);
  }
  if (alpha < 0.001) discard;
  outputColor = vec4(vColor.rgb * alpha, alpha);
}`;

function shader(gl, type, source) {
  const value = gl.createShader(type);
  if (!value) throw new Error('无法分配粒子着色器');
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(value) || '驱动未提供诊断';
    gl.deleteShader(value);
    throw new Error(`粒子着色器编译失败：${log}`);
  }
  return value;
}

function program(gl, vertexSource, names, fragmentSource = FRAGMENT) {
  const shaders = [];
  let value;
  try {
    shaders.push(shader(gl, gl.VERTEX_SHADER, vertexSource));
    shaders.push(shader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    value = gl.createProgram();
    if (!value) throw new Error('无法分配粒子绘制程序');
    for (const compiled of shaders) gl.attachShader(value, compiled);
    gl.linkProgram(value);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(`粒子程序连接失败：${gl.getProgramInfoLog(value) || '驱动未提供诊断'}`);
    return { value, uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(value, name)])) };
  } catch (error) {
    if (value) gl.deleteProgram(value);
    throw error;
  } finally {
    for (const compiled of shaders) gl.deleteShader(compiled);
  }
}

const commonUniforms = ['uViewport', 'uDpr', 'uTime', 'uPointMax', 'uPointer', 'uDisturbance'];
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class ParticleRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('当前浏览器无法创建 WebGL 2 粒子画板，请开启硬件加速或更换支持 WebGL 2 的浏览器。');
    const gl = this.gl;
    this.fields = new Set();
    this.destroyed = false;
    this.pointerMotion = new PointerMotion();
    this.needsFrame = false;
    this.ownerFields=new Map();
    this.materialTextures=[];
    this.materialEpoch=null;
    this.pointMax = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    this.textureMax = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.floatDensity=!!gl.getExtension('EXT_color_buffer_float');
    try {
      this.fieldProgram = program(gl, FIELD_VERTEX, [...commonUniforms, 'uField', 'uOwners', 'uState', 'uTargets', 'uOrigin', 'uStateColumns', 'uTileSize', 'uBound', 'uCoherent', 'uSourceSize', 'uColumns', 'uPitch', 'uRatio', 'uTransform', 'uScroll', 'uOpacity', 'uGrain', 'uOverrideIndex', 'uOverrideOffset', 'uOverrideColor', 'uOverrideHasColor']);
      this.materialProgram=program(gl,MATERIAL_VERTEX,['uState','uPigment','uStateColumns','uViewport','uDpr','uPointMax','uKernel'],DENSITY_FRAGMENT);
      this.surfaceProgram=program(gl,SURFACE_VERTEX,['uViewport','uDensitySize','uDpr','uColumns','uPitch','uDensity','uPigment']);
      this.densityTexture=gl.createTexture();
      this.pigmentTexture=gl.createTexture();
      this.densityFramebuffer=gl.createFramebuffer();
      if(!this.densityTexture||!this.pigmentTexture||!this.densityFramebuffer)throw new Error('无法分配液面密度场');
      for(const texture of [this.densityTexture,this.pigmentTexture]){
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      }
      this.densityWidth=0;this.densityHeight=0;
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`粒子画板初始化失败（WebGL ${error}）`);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  assertAvailable() {
    if (this.destroyed) throw new Error('粒子画板已释放');
    if (this.gl.isContextLost()) throw new Error('GPU 上下文已丢失，请重新创建粒子画板');
  }

  assertSource(source) {
    if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1) throw new Error('颜色场必须是非空画布');
    if (source.width > this.textureMax || source.height > this.textureMax) throw new Error(`颜色场超出 GPU 纹理尺寸上限 ${this.textureMax}`);
  }

  createField(sourceCanvas) {
    this.assertAvailable();
    this.assertSource(sourceCanvas);
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('无法分配粒子颜色场');
    const handle = { texture, width: 0, height: 0, source:sourceCanvas };
    this.fields.add(handle);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    try { this.updateField(handle, sourceCanvas); }
    catch (error) { this.deleteField(handle); throw error; }
    return handle;
  }

  updateField(handle, sourceCanvas) {
    this.assertAvailable();
    if (!this.fields.has(handle)) throw new Error('颜色场不属于当前粒子画板或已释放');
    this.assertSource(sourceCanvas);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, handle.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (handle.width === sourceCanvas.width && handle.height === sourceCanvas.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`粒子颜色场上传失败（WebGL ${error}）`);
    handle.source=sourceCanvas;
    handle.revision=(handle.revision||0)+1;
    handle.width = sourceCanvas.width;
    handle.height = sourceCanvas.height;
  }

  deleteField(handle) {
    if (!handle || !this.fields.has(handle)) return;
    const owner=this.ownerFields.get(handle);if(owner){this.gl.deleteTexture(owner.texture);this.ownerFields.delete(handle);}
    this.gl.deleteTexture(handle.texture);
    this.fields.delete(handle);
    handle.texture = null;
  }

  bindTexture(unit,texture,uniform){
    const gl=this.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(uniform,unit);
  }

  dataTexture(width,height,data,red=false){
    const gl=this.gl,texture=gl.createTexture();
    if(!texture)throw new Error('无法分配材料状态纹理');
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,red?gl.R32F:gl.RGBA32F,width,height,0,red?gl.RED:gl.RGBA,gl.FLOAT,data);
    return texture;
  }

  prepareMaterial(fields,options){
    const {width,height,dpr,progress}=options,gl=this.gl;
    if(!this.material){
      const count=Math.ceil(clamp(width*height*dpr*dpr/140,4096,12288)/256)*256;
      this.material=new MaterialState(count,width,height);
      this.targetData=new Float32Array(count*4);
      this.stateTexture=this.dataTexture(256,count/256,this.material.packed);
      this.materialTexture=this.dataTexture(256,count/256,this.material.currentPigment);
      this.originTexture=this.dataTexture(256,count/256,this.material.origin);
      this.targetTexture=this.dataTexture(256,count/256,this.targetData);
      this.materialTextures.push(this.stateTexture,this.materialTexture,this.originTexture,this.targetTexture);
    }else if(this.material.width!==width||this.material.height!==height){
      // Keep IDs and material amounts through a viewport change. Pixel sampling
      // can change independently; it must not replace the live material pool.
      this.material.resize(width,height);
    }
    if(options.idle){
      this.material.idle(options.reducedMotion?0:finite(options.time,0));this.materialEpoch=null;this.materialKernel=22;return;
    }
    const moving=fields.filter(f=>f.reveal!==false);
    const epoch=finite(options.motionEpoch,0),elapsed=finite(options.motionTime,progress*FLOW_DURATION/1000);
    const newEpoch=this.materialEpoch!==epoch;
    if(newEpoch||!this.materialPlan?.matches(moving)){
      const plan=new MaterialPlan(moving,this.material.count);plan.update(moving,finite(options.scroll,0));
      for(const owner of this.ownerFields.values())gl.deleteTexture(owner.texture);this.ownerFields.clear();
      this.materialPlan=plan;this.materialOffset=newEpoch?0:elapsed;
      if(plan.tiles.length){
        const owners=this.material.assign(plan.tiles);
        for(const [handle,part] of plan.fields){
          const values=Float32Array.from(part.ids,id=>id<0?0:owners[id]+1);
          this.ownerFields.set(handle,{texture:this.dataTexture(part.columns,part.rows,values,true),tileSize:part.tileSize,owners:values});
        }
        // Non-animated commits still allocate and bind the same material.
        if(progress>=1)this.material.settle();
      }
      this.materialEpoch=epoch;
      this.materialKernel=clamp(Math.sqrt(width*height/this.material.count)*4,22,38);
    }
    if(this.materialPlan.tiles.length){
      this.materialPlan.update(moving,finite(options.scroll,0));
      this.materialPlan.refreshColors();
      this.material.updateTargets(this.materialPlan.tiles);
      if(options.reducedMotion)this.material.settle();
      else this.material.advance(Math.max(0,elapsed-this.materialOffset));
      for(let i=0;i<this.material.count;i++){this.targetData[i*4]=this.material.target[i*2];this.targetData[i*4+1]=this.material.target[i*2+1];}
    }
  }

  uploadMaterial(){
    const gl=this.gl,rows=this.material.count/256;
    gl.activeTexture(gl.TEXTURE0);
    for(const [texture,data] of [[this.stateTexture,this.material.packed],[this.materialTexture,this.material.currentPigment],[this.originTexture,this.material.origin],[this.targetTexture,this.targetData]]){
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,rows,gl.RGBA,gl.FLOAT,data);
    }
  }

  inspectMaterial(){return this.material?.inspect()||null;}

  render(fields, options = {}) {
    this.assertAvailable();
    const gl = this.gl;
    const width = Math.max(1, finite(options.width, this.canvas.clientWidth || this.canvas.width));
    const height = Math.max(1, finite(options.height, this.canvas.clientHeight || this.canvas.height));
    const dpr = clamp(finite(options.dpr, 1), 0.25, 4);
    const physicalWidth = Math.max(1, Math.round(width * dpr));
    const physicalHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== physicalWidth) this.canvas.width = physicalWidth;
    if (this.canvas.height !== physicalHeight) this.canvas.height = physicalHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, physicalWidth, physicalHeight);
    gl.bindVertexArray(this.vao);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (options.enabled === false) { this.pointerMotion.reset(); this.needsFrame=false; return { particles: 0, drawCalls: 0 }; }

    const rawTime = finite(options.time, 0);
    const pointer=this.pointerMotion.update(rawTime,options.pointer,options.disturbance,options.reducedMotion);
    this.needsFrame=pointer.needsFrame;
    const animatedTime = options.reducedMotion ? 0 : rawTime;
    const disturbance = pointer.strength > 0 && !options.reducedMotion;
    const common = (compiled) => {
      gl.useProgram(compiled.value);
      const u = compiled.uniforms;
      gl.uniform2f(u.uViewport, width, height);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform1f(u.uTime, animatedTime);
      gl.uniform1f(u.uPointMax, this.pointMax);
      gl.uniform3f(u.uPointer, pointer.x, pointer.y, pointer.strength);
      gl.uniform1i(u.uDisturbance, disturbance ? 1 : 0);
      return u;
    };
    let particles = 0;
    let drawCalls = 0;

    const progress=options.reducedMotion?1:clamp(finite(options.progress,1),0,1);
    this.prepareMaterial(fields,{...options,width,height,dpr,progress});
    this.uploadMaterial();
    const fluid=!!options.idle||!!this.materialPlan?.tiles.length&&this.material.settled<this.material.count;
    this.needsFrame=this.needsFrame||fluid&&!options.idle;
    const densityDpr=Math.min(dpr,0.6);
    const densityWidth=Math.max(1,Math.round(width*densityDpr)),densityHeight=Math.max(1,Math.round(height*densityDpr));
    if(fluid){
      gl.activeTexture(gl.TEXTURE0);
      if(this.densityWidth!==densityWidth||this.densityHeight!==densityHeight){
        for(const texture of [this.densityTexture,this.pigmentTexture]){
          gl.bindTexture(gl.TEXTURE_2D,texture);
          gl.texImage2D(gl.TEXTURE_2D,0,this.floatDensity?gl.RGBA16F:gl.RGBA8,densityWidth,densityHeight,0,gl.RGBA,this.floatDensity?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
        }
        this.densityWidth=densityWidth;this.densityHeight=densityHeight;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.densityFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.densityTexture,0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,this.pigmentTexture,0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('液面密度场不可用');
      gl.viewport(0,0,densityWidth,densityHeight);gl.clear(gl.COLOR_BUFFER_BIT);gl.blendFunc(gl.ONE,gl.ONE);
      const m=common(this.materialProgram);
      this.bindTexture(0,this.stateTexture,m.uState);this.bindTexture(1,this.materialTexture,m.uPigment);
      gl.uniform1i(m.uStateColumns,256);gl.uniform1f(m.uDpr,densityDpr);gl.uniform1f(m.uKernel,this.materialKernel||22);
      gl.drawArrays(gl.POINTS,0,this.material.count);particles+=this.material.count;drawCalls++;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,physicalWidth,physicalHeight);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      const u=common(this.surfaceProgram);
      const pitch=Math.ceil(Math.max(1,Math.sqrt(physicalWidth*physicalHeight/1250000)))/dpr;
      const columns=Math.ceil(width/pitch),count=columns*Math.ceil(height/pitch);
      this.bindTexture(0,this.densityTexture,u.uDensity);this.bindTexture(1,this.pigmentTexture,u.uPigment);
      gl.uniform2f(u.uDensitySize,densityWidth,densityHeight);gl.uniform1f(u.uPitch,pitch);gl.uniform1i(u.uColumns,columns);
      gl.drawArrays(gl.POINTS,0,count);particles+=count;drawCalls++;
    }
    const grain=options.pitch===3,u=common(this.fieldProgram),pitch=grain?3:fluid?Math.max(1,Math.round(dpr)):1;
    gl.uniform1f(u.uPitch,pitch);gl.uniform1f(u.uScroll,finite(options.scroll,0));gl.uniform1i(u.uGrain,grain?1:0);
    gl.uniform1i(u.uCoherent,this.material.settled===this.material.count?1:0);
    gl.uniform1i(u.uStateColumns,256);
    for(const field of fields){
      if(field.visible===false&&!fluid)continue;
      const handle=field.handle;
      if(!this.fields.has(handle)||!handle.texture)throw new Error(`粒子字段 ${field.id||''} 已失效`);
      const matrix=field.transform||[1,0,0,1,0,0];
      if(matrix.length!==6||!matrix.every(Number.isFinite))throw new Error('粒子字段变换必须是 6 个有限数值');
      const [a,b,c,d,e,f]=matrix,columns=Math.ceil(handle.width/pitch),count=columns*Math.ceil(handle.height/pitch);
      this.bindTexture(0,handle.texture,u.uField);
      const owner=this.ownerFields.get(handle),bound=!options.idle&&field.reveal!==false;
      gl.uniform1i(u.uBound,bound?1:0);
      // Content remains bound after settling; there is no end-of-animation bypass.
      this.bindTexture(1,owner?.texture||handle.texture,u.uOwners);
      this.bindTexture(2,this.stateTexture||handle.texture,u.uState);
      this.bindTexture(3,this.targetTexture||handle.texture,u.uTargets);
      this.bindTexture(4,this.originTexture||handle.texture,u.uOrigin);
      gl.uniform1i(u.uTileSize,owner?.tileSize||1);
      gl.uniform2i(u.uSourceSize,handle.width,handle.height);gl.uniform1i(u.uColumns,columns);
      gl.uniform1f(u.uRatio,Math.max(.001,finite(field.ratio,1)));
      gl.uniformMatrix3fv(u.uTransform,false,new Float32Array([a,b,0,c,d,0,e,f,1]));gl.uniform1f(u.uOpacity,clamp(finite(field.opacity,1),0,1));
      const override=field.override,valid=override&&Number.isInteger(override.index)&&override.index>=0&&override.index<count;
      gl.uniform1i(u.uOverrideIndex,valid?override.index:-1);gl.uniform2f(u.uOverrideOffset,valid?finite(override.offset?.[0],0):0,valid?finite(override.offset?.[1],0):0);
      const color=valid&&Array.isArray(override.color)&&override.color.length===4&&override.color.every(Number.isFinite)?override.color:null;
      gl.uniform1i(u.uOverrideHasColor,color?1:0);gl.uniform4f(u.uOverrideColor,...(color?color.map(v=>clamp(v,0,1)):[0,0,0,0]));
      gl.drawArrays(gl.POINTS,0,count);particles+=count;drawCalls++;
    }
    return { particles, drawCalls };
  }

  /** RGBA premultiplied pixels in top-left row order, intended for QA only. */
  getDebugPixels() {
    this.assertAvailable();
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const pixels = new Uint8Array(raw.length);
    const stride = width * 4;
    for (let y = 0; y < height; y++) pixels.set(raw.subarray((height - y - 1) * stride, (height - y) * stride), y * stride);
    return { width, height, pixels };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const gl = this.gl;
    if (!gl) return;
    // Unbind first: deleting a program while it is current only marks it for
    // later deletion, which otherwise retains shader resources after teardown.
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.useProgram(null);
    gl.bindVertexArray(null);
    for(let unit=0;unit<5;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,null);}
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,null);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, null);
    for (const field of this.fields || []) gl.deleteTexture(field.texture);
    this.fields?.clear();
    for(const owner of this.ownerFields?.values()||[])gl.deleteTexture(owner.texture);
    this.ownerFields?.clear();
    for(const texture of this.materialTextures||[])gl.deleteTexture(texture);
    this.materialTextures=[];
    if (this.fieldProgram) gl.deleteProgram(this.fieldProgram.value);
    if (this.materialProgram) gl.deleteProgram(this.materialProgram.value);
    if(this.surfaceProgram)gl.deleteProgram(this.surfaceProgram.value);
    if(this.pigmentTexture)gl.deleteTexture(this.pigmentTexture);
    if(this.densityTexture)gl.deleteTexture(this.densityTexture);
    if(this.densityFramebuffer)gl.deleteFramebuffer(this.densityFramebuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
