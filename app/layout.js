export const identity = () => [1, 0, 0, 1, 0, 0];
export function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export const translate = (x,y) => [1,0,0,1,x,y];
export const scale = (x,y=x) => [x,0,0,y,0,0];
export const rotate = a => [Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0];
export const point = (m,x,y) => ({x:m[0]*x+m[2]*y+m[4], y:m[1]*x+m[3]*y+m[5]});
export function inverse(m) {
  const d=m[0]*m[3]-m[1]*m[2];
  if(Math.abs(d)<1e-9) return null;
  return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];
}
export function graphemes(text) {
  if(typeof Intl.Segmenter==='function') return [...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text)].map(s=>({text:s.segment,start:s.index,end:s.index+s.segment.length}));
  let offset=0; return Array.from(text,s=>{const p={text:s,start:offset,end:offset+s.length};offset+=s.length;return p;});
}
export function wrapText(text,width,measure) {
  const lines=[];let parts=[],w=0,start=0;
  const push=(end)=>{lines.push({parts,width:w,start,end});parts=[];w=0;};
  for(const g of graphemes(text)) {
    if(g.text==='\n'||g.text==='\r\n'){push(g.start);start=g.end;continue;}
    const next=measure(parts.map(p=>p.text).join('')+g.text);
    if(parts.length&&next>width){push(g.start);start=g.start;}
    const current=measure(parts.map(p=>p.text).join(''));
    const full=measure(parts.map(p=>p.text).join('')+g.text);
    parts.push({...g,x:current,width:full-current});w=full;
  }
  push(text.length);return lines;
}
export function chartDomain(values,includeZero=true) {
  const finite=values.filter(v=>typeof v==='number'&&Number.isFinite(v));
  let min=finite.length?Math.min(...finite):0,max=finite.length?Math.max(...finite):1;
  if(includeZero){min=Math.min(0,min);max=Math.max(0,max);}
  if(min===max){const pad=Math.max(1,Math.abs(min)*.1);min-=pad;max+=pad;}
  return [min,max];
}
export function sampleAnimation(animation,timeMs) {
  const t=animation.repeat==='loop'?timeMs%animation.durationMs:Math.min(timeMs,animation.durationMs);
  const frames=animation.keyframes;
  for(let i=1;i<frames.length;i++){if(t<=frames[i].timeMs){const a=frames[i-1],b=frames[i];return a.value+(b.value-a.value)*(t-a.timeMs)/(b.timeMs-a.timeMs);}}
  return frames.at(-1).value;
}
