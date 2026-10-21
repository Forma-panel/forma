// v7 着色器，逐字搬运自 reference/v7.html。外观红线：这里的改动必须带开关，关掉时与 v7 逐像素一致。

export const FS_TRI = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.-1.,0.,1.); }`;

export const SPLAT_VS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uContent, uContentB;   // 当前画面 / 要变成的画面
uniform vec4 uCard;              // 画面在屏幕上的 x, y, 宽, 高（宽 = 0 表示没有画面）
uniform vec3 uBlob, uPool;       // 液团 / 剩余液团：中心 xy，半径
uniform vec2 uMouse, uMVel, uRes;
uniform float uN, uT, uMode, uTime, uDpr, uHwBlob, uHwCard, uCell, uDown, uFrom;
out vec3 vCol; out float vSig; out float vSize; out float vHw;

uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hu(uint v){ return float(pcg(v)) * (1. / 4294967296.); }
float hg(ivec2 p){ return hu(pcg(uint(p.x + 8192)) + uint(p.y + 8192)); }
float vn(vec2 x){
  vec2 i = floor(x), f = fract(x), u = f*f*(3.-2.*f); ivec2 I = ivec2(i);
  return mix(mix(hg(I), hg(I+ivec2(1,0)), u.x), mix(hg(I+ivec2(0,1)), hg(I+ivec2(1,1)), u.x), u.y);
}
float easeIO(float s){ return s<.5 ? 4.*s*s*s : 1.-pow(-2.*s+2.,3.)*.5; }
vec2 bez(vec2 a, vec2 b, vec2 c, float t){ return mix(mix(a,b,t), mix(b,c,t), t); }

// 正方形 (u,v) + 深度 w -> 单位球内一点。投影到屏幕上的厚度正好是球的厚度，所以看起来是立体的。
vec3 ballPoint(vec2 uv, float w){
  vec2 a = uv * 2. - 1.;
  float r, phi;
  if (abs(a.x) < 1e-6 && abs(a.y) < 1e-6) return vec3(0., 0., 1. - 2.*w);
  if (abs(a.x) > abs(a.y)) { r = a.x; phi = .7853982 * (a.y / a.x); }
  else { r = a.y; phi = 1.5707963 - .7853982 * (a.x / a.y); }
  float rr = sqrt(max(1. - pow(max(1. - r*r, 0.), 2./3.), 0.));
  vec2 xy = sign(r) * rr * vec2(cos(phi), sin(phi));
  float zm = sqrt(max(1. - rr*rr, 0.));
  return vec3(xy, zm * (1. - 2.*w));
}

// 液团的自然形变：起伏的瓣、缓慢翻转、挤压回弹、靠近鼠标的一侧被吸出来（像铁磁流体）
vec2 blobPos(vec3 b, vec3 B, float t, float seed){
  // 只在屏幕平面内做低频、处处光滑的流动形变（不把深度搅进来），液面才会像真的液体一样顺滑
  vec2 xy = b.xy;
  xy += .05 * vec2(sin(xy.y*2.2 + t*1.05 + seed), sin(xy.x*2.0 - t*.85 + 1.7 + seed));
  xy += .03 * vec2(sin((xy.x + xy.y)*2.9 + t*1.6), cos((xy.x - xy.y)*3.1 - t*1.3 + seed));
  b.xy = xy;
  float spin = .15 * sin(t*.31 + seed);
  b.xy = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * b.xy;
  float sq = .035*sin(t*1.6 + seed);
  b.x *= 1. + sq; b.y *= 1. - sq;
  vec2 p = B.xy + b.xy * B.z;
  vec2 tm = uMouse - B.xy; float dm = length(tm);
  vec2 dirm = tm / max(dm, 1.);
  float rl = length(b.xy);
  float facing = max(dot(b.xy / max(rl, 1e-4), dirm), 0.);
  float near = exp(-max(dm - B.z, 0.) / (B.z * .6)) * smoothstep(0., B.z * .5, dm) * (1. - uDown);
  p += dirm * B.z * .3 * pow(facing, 6.) * rl * rl * near;
  return p;
}

void main(){
  uint id = uint(gl_VertexID);
  float hA = hu(id*3u + 1u), hB = hu(id*3u + 2u), hC = hu(id*3u + 7u);
  float cw = uCard.z, ch = uCard.w;
  bool hasCard = cw > 0.;
  float Mc = hasCard ? cw * ch : 0.;
  float frac = Mc / uN;
  float fid = float(gl_VertexID);

  bool isCard = false;
  int ix = 0, iy = 0;
  vec3 home3, bhome3, tcol = vec3(.015, .016, .02);
  vec2 tgt, btgt, poolUV, poolBUV;
  float delay, dur, bend;

  if (fid < Mc) {
    int x = gl_VertexID % int(cw), y = gl_VertexID / int(cw);
    ix = x; iy = y;
    vec4 c = texelFetch(uContent, ivec2(x, y), 0);
    vec2 pc = vec2(x, y), sz = vec2(cw, ch);
    vec2 uv = (pc + .5) / sz;
    home3 = ballPoint(uv, frac * hA);
    float cell = uCell;
    vec2 nq = pc / (50. * uDpr);
    float by = floor((pc.y + (vn(nq + 40.) - .5) * cell * .9) / cell);
    float shift = mod(by, 2.) * .5 * cell;
    float bx = floor((pc.x + shift + (vn(nq + vec2(20., 0.)) - .5) * cell * .9) / cell);
    vec2 bc = clamp(vec2((bx + .5) * cell - shift, (by + .5) * cell), vec2(0.), sz - 1.);
    bhome3 = ballPoint(bc / sz, frac * .5);
    ivec2 bi = ivec2(bx, by);
    delay = .03 + .34 * (.55 * bc.y / ch + .45 * hg(bi + 11)) + .16 * hB;
    dur = .72 + .2 * hg(bi + 37);
    bend = (vn(vec2(bi) * .35 + 5.3) - .5) * 1.4;
    poolUV = uv; poolBUV = bc / sz;
    if (c.a > .5) {
      isCard = true; tcol = c.rgb;
      tgt = uCard.xy + pc + .5;
      btgt = uCard.xy + bc;
    }
  } else {
    float j = fid - Mc, P = uN - Mc;
    float cols = ceil(sqrt(P)), rows = ceil(P / cols);
    vec2 uv = vec2(mod(j, cols) + .5 + (hC - .5) * .3, floor(j / cols) + .5) / vec2(cols, rows);
    home3 = ballPoint(uv, frac + (1. - frac) * hA);
    vec2 bq = (floor(uv * vec2(10., 3.)) + .5) / vec2(10., 3.);
    bhome3 = ballPoint(bq, frac + (1. - frac) * .5);
    ivec2 bi = ivec2(floor(uv * vec2(10., 3.)));
    delay = .06 + .28 * bq.y + .1 * hg(bi + 3) + .12 * hB;
    dur = .75 + .2 * hg(bi + 9);
    bend = (hg(bi + 21) - .5) * 1.2;
    poolUV = uv; poolBUV = bq;
  }
  if (!isCard) {                                   // 剩下的液体去另一个小液团
    tgt = blobPos(ballPoint(poolUV, hA), uPool, uTime, 2.);
    btgt = blobPos(ballPoint(poolBUV, .5), uPool, uTime, 2.);
  }

  vec2 h = blobPos(home3, uBlob, uTime, 0.);
  vec2 hb = blobPos(bhome3, uBlob, uTime, 0.);

  float s = 0.;
  if (uMode > 2.5) s = 1.;
  else if (uMode > .5) s = clamp((uT - delay) / dur, 0., 1.);
  else if (uMode < -.5) { float d = (.55 - delay) * .7; s = min(clamp((uFrom - delay) / dur, 0., 1.), 1. - clamp((uT - d) / dur, 0., 1.)); }
  float e = easeIO(s);
  float bump = 4. * s * (1. - s);

  vec2 dv = btgt - hb; float L = length(dv) + 1e-3; vec2 dir = dv / L; vec2 perp = vec2(-dir.y, dir.x);
  vec2 c1 = mix(hb, btgt, .5) + perp * bend * L * .6 + vec2(0., -.2 * L);
  vec2 center = bez(hb, c1, btgt, e);
  vec2 q = center / uDpr * .006;
  center += vec2(sin(q.y*3.1 + uTime*1.3), cos(q.x*2.7 - uTime*1.1)) * 24. * uDpr * bump;
  vec2 off = mix(h - hb, tgt - btgt, e) * (1. - .7 * smoothstep(0., .7, bump));
  if (hC < .12) off += (vec2(hA, hB) - .5) * 26. * uDpr * bump;      // 细碎飞沫
  vec2 p = center + off;

  float settle = 0.;
  if (uMode > 2.5) settle = 1.;
  else if (uMode > .5) {
    float a = uT - delay - dur;
    if (a > 0.) { p += dir * sin(a*16.) * exp(-a*7.) * 2.5 * uDpr; settle = smoothstep(.45, .7, a); }
  }
  vec2 hd = vec2(0.);
  if (isCard && uMode > .5 && uMode < 2.5 && s >= 1.) {           // 鼠标掠过：液面被拨动，停下后弹回
    vec2 dm = p - uMouse; float r2 = dot(dm, dm); float rad = 46. * uDpr;
    float hov = exp(-r2 / (2.*rad*rad)) * (1. - uDown);
    hd = (uMVel * .5 + dm * inversesqrt(r2 + 1.) * length(uMVel) * .25) * hov;
    p += hd;
  }

  vec3 ink = vec3(.015, .016, .02);
  vec3 col = mix(ink, tcol, smoothstep(.3, .8, s));
  vec3 iri = .5 + .5 * cos(6.2832 * (s*.7 + hA*.15 + vec3(0., .33, .67)));
  col = mix(col, iri * .3, .15 * bump * (isCard ? 1. : .5));
  float hw = mix(uHwBlob, isCard ? uHwCard : uHwBlob, e);

  float restSig = isCard ? mix(.95, .6, s) : .95;
  float sig = mix(restSig, 1.15, bump);
  bool exact = isCard && settle >= 1. && dot(hd, hd) < .0025;  // 落定：一滴液体正好占一个屏幕像素
  vec2 snap = tgt;

  if (isCard && uMode > 2.5) {            // 页面之间直接变换：一道黑色液浪在卡片上翻滚扫过，经过的地方液体换成新画面
    vec3 cB = texelFetch(uContentB, ivec2(ix, iy), 0).rgb;
    vec2 A = tgt;
    vec2 rel = (A - uCard.xy) / vec2(cw, ch);
    vec2 wd = normalize(vec2(.6, .4));
    float front = dot(rel, vec2(.6, .4)) + .06 * sin(rel.y * 9. + uTime) + .04 * sin(rel.x * 13. - uTime * 1.3);
    float dl = .02 + .7 * front;
    float du = .35;
    float sm = clamp((uT - dl) / du, 0., 1.), bm = 4. * sm * (1. - sm);
    vec2 sp = A / uDpr;
    vec2 swirl = vec2(sin(sp.y * .021 + uTime * 2.1) + .5 * sin(sp.x * .013 - uTime * 1.4),
                      cos(sp.x * .019 - uTime * 1.7) + .5 * cos(sp.y * .015 + uTime * 1.2));
    p = A + (wd * 16. + swirl * 9. + vec2(0., -6.)) * uDpr * bm * bm;          // 平滑的整体流动，液面不会碎成方块
    float am = uT - dl - du;
    if (am > 0.) p += wd * sin(am * 16.) * exp(-am * 7.) * 1.5 * uDpr;
    col = mix(mix(tcol, ink, .95 * smoothstep(.04, .2, sm)), cB, smoothstep(.62, .85, sm));
    hw = uHwCard + 40. * bm * bm * bm;  // 浪尖是一道又厚又亮的黑色液脊
    sig = mix(.6, 1.2, bm);
    exact = am > .35;
  }
  vCol = col;
  vHw = hw;
  if (exact) p = snap;
  vSig = sig; vSize = exact ? 1. : ceil(sig * 6.);
  gl_PointSize = vSize;
  vec2 ndc = p / uRes * 2. - 1.;
  gl_Position = vec4(ndc.x, -ndc.y, 0., 1.);
}`;

// 新增：尺寸不同的画面之间直接变换用的液滴着色器。单独编译成另一个程序，
// 这样 v7 原路径的编译结果完全不受影响（同一个程序里加分支会让编译器改变浮点运算顺序）。
export const SPLAT_VS_UNION = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uContent, uContentB;   // 当前画面 / 要变成的画面
uniform vec4 uCard;              // 画面在屏幕上的 x, y, 宽, 高（宽 = 0 表示没有画面）
uniform vec3 uBlob, uPool;       // 液团 / 剩余液团：中心 xy，半径
uniform vec2 uMouse, uMVel, uRes;
uniform float uN, uT, uMode, uTime, uDpr, uHwBlob, uHwCard, uCell, uDown, uFrom;
out vec3 vCol; out float vSig; out float vSize; out float vHw;
// 新增（带开关）：尺寸不同的画面之间直接变换。uUnion = 0 时完全走 v7 原路径。
uniform float uUnion;
uniform vec4 uOffs;    // 旧画面 / 新画面在并集矩形里的偏移：A.xy, B.zw（设备像素）
uniform vec4 uSizes;   // 旧画面 / 新画面的宽高：A.xy, B.zw

uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hu(uint v){ return float(pcg(v)) * (1. / 4294967296.); }
float hg(ivec2 p){ return hu(pcg(uint(p.x + 8192)) + uint(p.y + 8192)); }
float vn(vec2 x){
  vec2 i = floor(x), f = fract(x), u = f*f*(3.-2.*f); ivec2 I = ivec2(i);
  return mix(mix(hg(I), hg(I+ivec2(1,0)), u.x), mix(hg(I+ivec2(0,1)), hg(I+ivec2(1,1)), u.x), u.y);
}
float easeIO(float s){ return s<.5 ? 4.*s*s*s : 1.-pow(-2.*s+2.,3.)*.5; }
vec2 bez(vec2 a, vec2 b, vec2 c, float t){ return mix(mix(a,b,t), mix(b,c,t), t); }

// 正方形 (u,v) + 深度 w -> 单位球内一点。投影到屏幕上的厚度正好是球的厚度，所以看起来是立体的。
vec3 ballPoint(vec2 uv, float w){
  vec2 a = uv * 2. - 1.;
  float r, phi;
  if (abs(a.x) < 1e-6 && abs(a.y) < 1e-6) return vec3(0., 0., 1. - 2.*w);
  if (abs(a.x) > abs(a.y)) { r = a.x; phi = .7853982 * (a.y / a.x); }
  else { r = a.y; phi = 1.5707963 - .7853982 * (a.x / a.y); }
  float rr = sqrt(max(1. - pow(max(1. - r*r, 0.), 2./3.), 0.));
  vec2 xy = sign(r) * rr * vec2(cos(phi), sin(phi));
  float zm = sqrt(max(1. - rr*rr, 0.));
  return vec3(xy, zm * (1. - 2.*w));
}

// 液团的自然形变：起伏的瓣、缓慢翻转、挤压回弹、靠近鼠标的一侧被吸出来（像铁磁流体）
vec2 blobPos(vec3 b, vec3 B, float t, float seed){
  // 只在屏幕平面内做低频、处处光滑的流动形变（不把深度搅进来），液面才会像真的液体一样顺滑
  vec2 xy = b.xy;
  xy += .05 * vec2(sin(xy.y*2.2 + t*1.05 + seed), sin(xy.x*2.0 - t*.85 + 1.7 + seed));
  xy += .03 * vec2(sin((xy.x + xy.y)*2.9 + t*1.6), cos((xy.x - xy.y)*3.1 - t*1.3 + seed));
  b.xy = xy;
  float spin = .15 * sin(t*.31 + seed);
  b.xy = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * b.xy;
  float sq = .035*sin(t*1.6 + seed);
  b.x *= 1. + sq; b.y *= 1. - sq;
  vec2 p = B.xy + b.xy * B.z;
  vec2 tm = uMouse - B.xy; float dm = length(tm);
  vec2 dirm = tm / max(dm, 1.);
  float rl = length(b.xy);
  float facing = max(dot(b.xy / max(rl, 1e-4), dirm), 0.);
  float near = exp(-max(dm - B.z, 0.) / (B.z * .6)) * smoothstep(0., B.z * .5, dm) * (1. - uDown);
  p += dirm * B.z * .3 * pow(facing, 6.) * rl * rl * near;
  return p;
}

// 并集变换：uCard 是新旧两张卡的外包矩形。两边都有的像素走 v7 液浪；
// 只有旧画面有的，液浪经过时流回剩余小液团；只有新画面有的，从小液团流出，在液浪到达时落位。
void unionMain(float hA, float hB, float hC){
  float cw = uCard.z, ch = uCard.w, Mc = cw * ch, fid = float(gl_VertexID);
  vec3 ink = vec3(.015, .016, .02);
  vec4 cA = vec4(0.), cB = vec4(0.);
  vec2 pc = vec2(0.), poolUV;
  if (fid < Mc) {
    pc = vec2(gl_VertexID % int(cw), gl_VertexID / int(cw));
    ivec2 ia = ivec2(pc - uOffs.xy), ib = ivec2(pc - uOffs.zw);
    if (all(greaterThanEqual(ia, ivec2(0))) && all(lessThan(ia, ivec2(uSizes.xy)))) cA = texelFetch(uContent, ia, 0);
    if (all(greaterThanEqual(ib, ivec2(0))) && all(lessThan(ib, ivec2(uSizes.zw)))) cB = texelFetch(uContentB, ib, 0);
    poolUV = (pc + .5) / vec2(cw, ch);
  } else {
    float j = fid - Mc, P = uN - Mc;
    float cols = ceil(sqrt(P)), rows = ceil(P / cols);
    poolUV = vec2(mod(j, cols) + .5 + (hC - .5) * .3, floor(j / cols) + .5) / vec2(cols, rows);
  }
  vec2 poolP = blobPos(ballPoint(poolUV, hA), uPool, uTime, 2.);
  bool a = cA.a > .5, b = cB.a > .5;
  vec2 p = poolP; vec3 col = ink; float hw = uHwBlob, sig = .95; bool exact = false;
  if (a || b) {
    vec2 A = uCard.xy + pc + .5;
    vec2 rel = pc / vec2(cw, ch);
    vec2 wd = normalize(vec2(.6, .4));
    float front = dot(rel, vec2(.6, .4)) + .06 * sin(rel.y * 9. + uTime) + .04 * sin(rel.x * 13. - uTime * 1.3);
    float dl = .02 + .7 * front, du = .35;
    float sm = clamp((uT - dl) / du, 0., 1.), bm = 4. * sm * (1. - sm);
    vec2 sp = A / uDpr;
    vec2 swirl = vec2(sin(sp.y * .021 + uTime * 2.1) + .5 * sin(sp.x * .013 - uTime * 1.4),
                      cos(sp.x * .019 - uTime * 1.7) + .5 * cos(sp.y * .015 + uTime * 1.2));
    vec2 flow = (wd * 16. + swirl * 9. + vec2(0., -6.)) * uDpr;
    if (a && b) {                                  // 两边都有：v7 液浪原样
      p = A + flow * bm * bm;
      float am = uT - dl - du;
      if (am > 0.) p += wd * sin(am * 16.) * exp(-am * 7.) * 1.5 * uDpr;
      col = mix(mix(cA.rgb, ink, .95 * smoothstep(.04, .2, sm)), cB.rgb, smoothstep(.62, .85, sm));
      hw = uHwCard + 40. * bm * bm * bm;
      sig = mix(.6, 1.2, bm);
      exact = am > .35;
    } else {
      // 新旧卡片的重叠区域。多出 / 缺少的那一圈液体沿卡片边缘伸缩，像液面被拉长或收拢；
      // 体积差由剩余小液团的缩放来补（小液团的大小在 CPU 上随进度插值）。
      vec2 oMin = max(uOffs.xy, uOffs.zw), oMax = min(uOffs.xy + uSizes.xy, uOffs.zw + uSizes.zw);
      bool hasO = all(greaterThan(oMax, oMin + 1.));
      vec2 edge = uCard.xy + clamp(pc, oMin, oMax - 1.) + .5;
      vec2 wob = vec2(sin(sp.y * .02 + uTime * 1.3), cos(sp.x * .02 - uTime * 1.1)) * 7. * uDpr;
      if (a) {                                     // 只有旧画面有：液浪经过时收回到重叠区的边缘，汇入液面
        float s2 = clamp((uT - dl) / .6, 0., 1.), e2 = easeIO(s2), b2 = 4. * s2 * (1. - s2);
        vec2 to = hasO ? edge : poolP;
        p = mix(A, to, e2) + flow * .5 * b2 + wob * b2;
        col = mix(cA.rgb, ink, smoothstep(0., .25, s2));
        hw = mix(uHwCard + 30. * b2 * b2, hasO ? 0. : uHwBlob, smoothstep(.55, 1., e2));
        sig = mix(.6, 1.2, b2);
      } else {                                     // 只有新画面有：从重叠区边缘被液浪带出来，铺到新位置
        float st = dl - .2;
        float s2 = clamp((uT - st) / .6, 0., 1.), e2 = easeIO(s2), b2 = 4. * s2 * (1. - s2);
        vec2 from = hasO ? edge : poolP;
        p = mix(from, A, e2) + flow * .5 * b2 + wob * b2;
        float am = uT - st - .6;
        if (am > 0.) p += wd * sin(am * 16.) * exp(-am * 7.) * 1.5 * uDpr;
        col = mix(ink, cB.rgb, smoothstep(.7, .92, s2));
        hw = mix(hasO ? 0. : uHwBlob, uHwCard + 30. * b2 * b2, smoothstep(0., .35, e2));
        sig = mix(.6, 1.2, b2);
        exact = am > .2;
      }
    }
  }
  vCol = col; vHw = hw; vSig = sig;
  if (exact) p = (a || b) ? uCard.xy + pc + .5 : p;
  vSize = exact ? 1. : ceil(sig * 6.);
  gl_PointSize = vSize;
  vec2 ndc = p / uRes * 2. - 1.;
  gl_Position = vec4(ndc.x, -ndc.y, 0., 1.);
}

void main(){
  uint id = uint(gl_VertexID);
  float hA = hu(id*3u + 1u), hB = hu(id*3u + 2u), hC = hu(id*3u + 7u);
  if (uUnion > .5 && uMode > 2.5) { unionMain(hA, hB, hC); return; }
  float cw = uCard.z, ch = uCard.w;
  bool hasCard = cw > 0.;
  float Mc = hasCard ? cw * ch : 0.;
  float frac = Mc / uN;
  float fid = float(gl_VertexID);

  bool isCard = false;
  int ix = 0, iy = 0;
  vec3 home3, bhome3, tcol = vec3(.015, .016, .02);
  vec2 tgt, btgt, poolUV, poolBUV;
  float delay, dur, bend;

  if (fid < Mc) {
    int x = gl_VertexID % int(cw), y = gl_VertexID / int(cw);
    ix = x; iy = y;
    vec4 c = texelFetch(uContent, ivec2(x, y), 0);
    vec2 pc = vec2(x, y), sz = vec2(cw, ch);
    vec2 uv = (pc + .5) / sz;
    home3 = ballPoint(uv, frac * hA);
    float cell = uCell;
    vec2 nq = pc / (50. * uDpr);
    float by = floor((pc.y + (vn(nq + 40.) - .5) * cell * .9) / cell);
    float shift = mod(by, 2.) * .5 * cell;
    float bx = floor((pc.x + shift + (vn(nq + vec2(20., 0.)) - .5) * cell * .9) / cell);
    vec2 bc = clamp(vec2((bx + .5) * cell - shift, (by + .5) * cell), vec2(0.), sz - 1.);
    bhome3 = ballPoint(bc / sz, frac * .5);
    ivec2 bi = ivec2(bx, by);
    delay = .03 + .34 * (.55 * bc.y / ch + .45 * hg(bi + 11)) + .16 * hB;
    dur = .72 + .2 * hg(bi + 37);
    bend = (vn(vec2(bi) * .35 + 5.3) - .5) * 1.4;
    poolUV = uv; poolBUV = bc / sz;
    if (c.a > .5) {
      isCard = true; tcol = c.rgb;
      tgt = uCard.xy + pc + .5;
      btgt = uCard.xy + bc;
    }
  } else {
    float j = fid - Mc, P = uN - Mc;
    float cols = ceil(sqrt(P)), rows = ceil(P / cols);
    vec2 uv = vec2(mod(j, cols) + .5 + (hC - .5) * .3, floor(j / cols) + .5) / vec2(cols, rows);
    home3 = ballPoint(uv, frac + (1. - frac) * hA);
    vec2 bq = (floor(uv * vec2(10., 3.)) + .5) / vec2(10., 3.);
    bhome3 = ballPoint(bq, frac + (1. - frac) * .5);
    ivec2 bi = ivec2(floor(uv * vec2(10., 3.)));
    delay = .06 + .28 * bq.y + .1 * hg(bi + 3) + .12 * hB;
    dur = .75 + .2 * hg(bi + 9);
    bend = (hg(bi + 21) - .5) * 1.2;
    poolUV = uv; poolBUV = bq;
  }
  if (!isCard) {                                   // 剩下的液体去另一个小液团
    tgt = blobPos(ballPoint(poolUV, hA), uPool, uTime, 2.);
    btgt = blobPos(ballPoint(poolBUV, .5), uPool, uTime, 2.);
  }

  vec2 h = blobPos(home3, uBlob, uTime, 0.);
  vec2 hb = blobPos(bhome3, uBlob, uTime, 0.);

  float s = 0.;
  if (uMode > 2.5) s = 1.;
  else if (uMode > .5) s = clamp((uT - delay) / dur, 0., 1.);
  else if (uMode < -.5) { float d = (.55 - delay) * .7; s = min(clamp((uFrom - delay) / dur, 0., 1.), 1. - clamp((uT - d) / dur, 0., 1.)); }
  float e = easeIO(s);
  float bump = 4. * s * (1. - s);

  vec2 dv = btgt - hb; float L = length(dv) + 1e-3; vec2 dir = dv / L; vec2 perp = vec2(-dir.y, dir.x);
  vec2 c1 = mix(hb, btgt, .5) + perp * bend * L * .6 + vec2(0., -.2 * L);
  vec2 center = bez(hb, c1, btgt, e);
  vec2 q = center / uDpr * .006;
  center += vec2(sin(q.y*3.1 + uTime*1.3), cos(q.x*2.7 - uTime*1.1)) * 24. * uDpr * bump;
  vec2 off = mix(h - hb, tgt - btgt, e) * (1. - .7 * smoothstep(0., .7, bump));
  if (hC < .12) off += (vec2(hA, hB) - .5) * 26. * uDpr * bump;      // 细碎飞沫
  vec2 p = center + off;

  float settle = 0.;
  if (uMode > 2.5) settle = 1.;
  else if (uMode > .5) {
    float a = uT - delay - dur;
    if (a > 0.) { p += dir * sin(a*16.) * exp(-a*7.) * 2.5 * uDpr; settle = smoothstep(.45, .7, a); }
  }
  vec2 hd = vec2(0.);
  if (isCard && uMode > .5 && uMode < 2.5 && s >= 1.) {           // 鼠标掠过：液面被拨动，停下后弹回
    vec2 dm = p - uMouse; float r2 = dot(dm, dm); float rad = 46. * uDpr;
    float hov = exp(-r2 / (2.*rad*rad)) * (1. - uDown);
    hd = (uMVel * .5 + dm * inversesqrt(r2 + 1.) * length(uMVel) * .25) * hov;
    p += hd;
  }

  vec3 ink = vec3(.015, .016, .02);
  vec3 col = mix(ink, tcol, smoothstep(.3, .8, s));
  vec3 iri = .5 + .5 * cos(6.2832 * (s*.7 + hA*.15 + vec3(0., .33, .67)));
  col = mix(col, iri * .3, .15 * bump * (isCard ? 1. : .5));
  float hw = mix(uHwBlob, isCard ? uHwCard : uHwBlob, e);

  float restSig = isCard ? mix(.95, .6, s) : .95;
  float sig = mix(restSig, 1.15, bump);
  bool exact = isCard && settle >= 1. && dot(hd, hd) < .0025;  // 落定：一滴液体正好占一个屏幕像素
  vec2 snap = tgt;

  if (isCard && uMode > 2.5) {            // 页面之间直接变换：一道黑色液浪在卡片上翻滚扫过，经过的地方液体换成新画面
    vec3 cB = texelFetch(uContentB, ivec2(ix, iy), 0).rgb;
    vec2 A = tgt;
    vec2 rel = (A - uCard.xy) / vec2(cw, ch);
    vec2 wd = normalize(vec2(.6, .4));
    float front = dot(rel, vec2(.6, .4)) + .06 * sin(rel.y * 9. + uTime) + .04 * sin(rel.x * 13. - uTime * 1.3);
    float dl = .02 + .7 * front;
    float du = .35;
    float sm = clamp((uT - dl) / du, 0., 1.), bm = 4. * sm * (1. - sm);
    vec2 sp = A / uDpr;
    vec2 swirl = vec2(sin(sp.y * .021 + uTime * 2.1) + .5 * sin(sp.x * .013 - uTime * 1.4),
                      cos(sp.x * .019 - uTime * 1.7) + .5 * cos(sp.y * .015 + uTime * 1.2));
    p = A + (wd * 16. + swirl * 9. + vec2(0., -6.)) * uDpr * bm * bm;          // 平滑的整体流动，液面不会碎成方块
    float am = uT - dl - du;
    if (am > 0.) p += wd * sin(am * 16.) * exp(-am * 7.) * 1.5 * uDpr;
    col = mix(mix(tcol, ink, .95 * smoothstep(.04, .2, sm)), cB, smoothstep(.62, .85, sm));
    hw = uHwCard + 40. * bm * bm * bm;  // 浪尖是一道又厚又亮的黑色液脊
    sig = mix(.6, 1.2, bm);
    exact = am > .35;
  }
  vCol = col;
  vHw = hw;
  if (exact) p = snap;
  vSig = sig; vSize = exact ? 1. : ceil(sig * 6.);
  gl_PointSize = vSize;
  vec2 ndc = p / uRes * 2. - 1.;
  gl_Position = vec4(ndc.x, -ndc.y, 0., 1.);
}`;

export const SPLAT_FS = `#version 300 es
precision highp float;
in vec3 vCol; in float vSig; in float vSize; in float vHw;
out vec4 o;
void main(){
  if (vSize < 1.5) { o = vec4(vCol * vHw, vHw); return; }
  vec2 d = (gl_PointCoord - .5) * vSize;
  float w = exp(-dot(d,d) / (2.*vSig*vSig)) / (6.2832*vSig*vSig) * vHw;
  o = vec4(vCol * w, w);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir; uniform vec4 uMask;
in vec2 vUv; out vec4 o;
void main(){
  float w[5] = float[](.227027, .1945946, .1216216, .054054, .016216);
  float s = dot(texture(uTex, vUv), uMask) * w[0];
  for (int i = 1; i < 5; i++) {
    s += dot(texture(uTex, vUv + uDir*float(i)), uMask) * w[i];
    s += dot(texture(uTex, vUv - uDir*float(i)), uMask) * w[i];
  }
  o = vec4(s);
}`;

export const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uD, uH, uHL;
uniform vec2 uRes;
uniform float uTime, uSweep, uMove, uDpr, uHwCard;
in vec2 vUv; out vec4 o;

vec3 env(vec3 r){                       // 白色摄影棚：亮墙、深色地面、清晰的地平线和几块边缘锐利的灯箱
  float y = r.y;
  vec3 wall = mix(vec3(.62,.64,.68), vec3(.97,.975,.985), smoothstep(0., .7, y));
  vec3 flo = mix(vec3(.04,.045,.055), vec3(.16,.17,.19), smoothstep(-.9, -.05, y));
  vec3 c = mix(flo, wall, smoothstep(-.03, .03, y));
  vec2 a = r.xy - vec2(-.42, .5);
  c += vec3(6.) * smoothstep(.02, 0., max(abs(a.x) - .17, abs(a.y) - .08));
  c += vec3(3.6, 3.8, 4.2) * smoothstep(.015, 0., abs(r.x - .64) - .03) * smoothstep(.03, 0., abs(y - .15) - .45);
  c += vec3(2.2, 2., 1.8) * smoothstep(.015, 0., length(r.xy - vec2(.38, -.42)) - .05);
  return c;
}

void main(){
  vec2 px = 1. / uRes;
  vec3 bg = mix(vec3(.935,.94,.95), vec3(.985,.988,.992), vUv.y);
  float s1 = textureLod(uH, vUv + vec2(0., 6. * uDpr * px.y), 0.).r;
  float s2 = textureLod(uH, vUv + vec2(0., 22. * uDpr * px.y), 0.).r;
  bg *= 1. - .08 * smoothstep(0., uHwCard, s1) - .16 * smoothstep(4., 80., s2);
  if (textureLod(uH, vUv, 0.).r < 1e-3) { o = vec4(bg, 1.); return; }   // 纯背景，不用算液体
  vec2 fp = vUv * uRes;
  vec2 uv = vUv;

  vec4 D = texture(uD, uv);
  float a = D.a;
  vec3 base = D.rgb / max(a, 1e-4);
  float Hc = texture(uH, uv).r;
  vec2 e = px * 2. * uDpr;
  vec2 gS = vec2(texture(uH, uv + vec2(e.x,0.)).r - texture(uH, uv - vec2(e.x,0.)).r,
                 texture(uH, uv + vec2(0.,e.y)).r - texture(uH, uv - vec2(0.,e.y)).r) / (4. * uDpr);
  vec2 eL = px * 6. * uDpr;              // 厚液体内部用更大范围的液面，消除颗粒，表面像镜子一样顺
  vec2 gL = vec2(texture(uHL, uv + vec2(eL.x,0.)).r - texture(uHL, uv - vec2(eL.x,0.)).r,
                 texture(uHL, uv + vec2(0.,eL.y)).r - texture(uHL, uv - vec2(0.,eL.y)).r) / (12. * uDpr);
  vec2 g = mix(gS, gL, smoothstep(25., 70., Hc / uDpr));
  vec2 ga = vec2(texture(uD, uv + vec2(px.x,0.)).a - texture(uD, uv - vec2(px.x,0.)).a,
                 texture(uD, uv + vec2(0.,px.y)).a - texture(uD, uv - vec2(0.,px.y)).a) * .5;
  g += clamp(ga * .25, -.6, .6) * (1. - smoothstep(2., 10., Hc));

  float th = smoothstep(5., 30., Hc);    // 厚液体（液团、液流）
  vec2 sp = fp / uDpr;
  vec2 amb = cos(dot(sp, vec2(.013,.008)) + uTime*.9) * vec2(.013,.008)
           + cos(dot(sp, vec2(-.009,.016)) + uTime*.7) * vec2(-.009,.016)
           + cos(dot(sp, vec2(.024,-.019)) - uTime*1.2) * vec2(.024,-.019) * .7;
  g += amb * (5. * th + 2.5 * uMove);

  vec3 n = normalize(vec3(-g, 1.));
  vec3 r = reflect(vec3(0.,0.,-1.), n);
  r.xy += (vUv - .5) * vec2(.35, .3);
  r = normalize(r);
  float F0 = .07 * th;
  float F = F0 + (1. - F0) * pow(1. - clamp(n.z, 0., 1.), 5.);
  vec3 L = normalize(vec3(-.4, .6, 1.));
  float diff = mix(1., .82 + .18 * max(dot(n, L), 0.), th);
  vec3 liq = base * diff * (1. - F) + env(r) * F * mix(vec3(1.), vec3(.93,.96,1.), th);
  liq += pow(max(dot(r, normalize(vec3(-.35,.5,1.))), 0.), 600.) * (.2 + 2.5 * th);
  liq += smoothstep(.05, 0., abs(vUv.x + vUv.y*.35 - uSweep)) * vec3(.08) * (1. - th);

  float m = smoothstep(.35 * uHwCard, .8 * uHwCard, a);
  o = vec4(min(mix(bg, liq, m), vec3(1.)), 1.);
}`;
