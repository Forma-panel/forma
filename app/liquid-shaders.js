// Both density and display coverage read the persistent material state.
// There is deliberately no independently drawn reservoir or ligament geometry.
export const MATERIAL_VERTEX = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform sampler2D uPigment;
uniform int uStateColumns;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uPointMax;
uniform float uKernel;
out vec4 vColor;
out float vRoundness;
void main(){
  ivec2 cell=ivec2(gl_VertexID%uStateColumns,gl_VertexID/uStateColumns);
  vec4 state=texelFetch(uState,cell,0),pigment=texelFetch(uPigment,cell,0);
  vec2 point=state.xy;
  float cover=state.z;
  gl_Position=vec4(point.x/uViewport.x*2.0-1.0,1.0-point.y/uViewport.y*2.0,0.0,1.0);
  gl_PointSize=clamp(mix(uKernel,5.0,cover)*uDpr,1.0,uPointMax);
  vColor=vec4(pigment.rgb,1.0);
  vRoundness=0.075*pigment.a*(1.0-cover);
  if(cover>=1.0)gl_Position=vec4(3.0,3.0,0.0,1.0);
}`;

export const DENSITY_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
in float vRoundness;
layout(location=0) out vec4 density;
layout(location=1) out vec4 pigment;
void main(){
  float r=length(gl_PointCoord*2.0-1.0);
  float kernel=pow(max(0.0,1.0-r*r),3.0);
  float weight=vRoundness*kernel;
  density=vec4(weight,0.0,0.0,1.0);
  pigment=vec4(vColor.rgb*weight,weight);
}`;

export const SURFACE_VERTEX = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uDensity;
uniform sampler2D uPigment;
uniform vec2 uViewport;
uniform vec2 uDensitySize;
uniform float uDpr;
uniform int uColumns;
uniform float uPitch;
out vec4 vColor;
out float vRoundness;
float heightAt(vec2 uv){
  return 1.0-exp(-texture(uDensity,uv).r*1.3);
}
float filteredHeight(vec2 uv){
  vec2 d=2.5/uDensitySize;
  return heightAt(uv)*0.4+(heightAt(uv+vec2(d.x,0.0))+heightAt(uv-vec2(d.x,0.0))+heightAt(uv+vec2(0.0,d.y))+heightAt(uv-vec2(0.0,d.y)))*0.15;
}
void main(){
  vec2 point=(vec2(gl_VertexID%uColumns,gl_VertexID/uColumns)+0.5)*uPitch;
  vec2 uv=vec2(point.x/uViewport.x,1.0-point.y/uViewport.y);
  float h=filteredHeight(uv);
  gl_Position=vec4(uv*2.0-1.0,0.0,1.0);
  gl_PointSize=ceil(uPitch*uDpr)+0.01;
  vRoundness=0.0;
  if(h<0.085){gl_Position=vec4(3.0,3.0,0.0,1.0);vColor=vec4(0.0);return;}
  vec2 d=3.5/uDensitySize;
  float dx=filteredHeight(uv+vec2(d.x,0.0))-filteredHeight(uv-vec2(d.x,0.0));
  float dy=filteredHeight(uv+vec2(0.0,d.y))-filteredHeight(uv-vec2(0.0,d.y));
  vec3 n=normalize(vec3(-dx*6.0,-dy*6.0,1.0));
  vec3 light=normalize(vec3(-0.65,0.8,0.7));
  float diffuse=max(dot(n,light),0.0);
  float spec=pow(max(dot(n,normalize(light+vec3(0.0,0.0,1.0))),0.0),42.0);
  float rim=pow(1.0-n.z,2.0);
  float softbox=pow(max(dot(n,normalize(vec3(-0.34,0.43,0.82))),0.0),24.0);
  vec3 ink=vec3(0.014,0.017,0.022)+diffuse*0.016;
  ink+=vec3(0.90,0.92,0.95)*spec*0.48+softbox*0.16+rim*0.09;
  vec4 pigment=texture(uPigment,uv);
  vec3 tint=clamp(pigment.rgb/max(pigment.a,0.00001),0.0,1.0);
  float colored=clamp(max(tint.r,max(tint.g,tint.b))*2.0,0.0,1.0);
  vec3 color=ink*(1.0-colored)+tint+vec3(spec*0.18+softbox*0.035)*colored;
  vColor=vec4(color,smoothstep(0.085,0.12,h));
}`;
