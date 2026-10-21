// Optional asset-authoring tool. Running the app itself does not require FFmpeg.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const width=640,height=360,fps=24,frames=144;
const output=fileURLToPath(new URL('../app/assets/sample.webm',import.meta.url));
const ffmpeg=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-an','-c:v','libvpx-vp9','-b:v','450k',output],{stdio:['pipe','inherit','inherit']});
ffmpeg.on('error',error=>{console.error(error.message);process.exitCode=1;});
const completion=once(ffmpeg,'exit');
for(let frame=0;frame<frames;frame++){
  const pixels=Buffer.allocUnsafe(width*height*3),time=frame/frames*Math.PI*2;
  for(let x=0;x<width;x++){
    const u=x/width,phase=u*6.8+time;
    const center=.51+.115*Math.sin(phase)+.03*Math.sin(u*13-time);
    const span=.16+.038*Math.cos(u*5-time);
    for(let y=0;y<height;y++){
      const v=y/height,dy=(v-center)/span;
      const edge=Math.exp(-Math.pow(dy,4)*1.25)*Math.pow(Math.sin(Math.PI*u),.55);
      const folds=.5+.5*Math.sin(dy*12+u*17-time*2+Math.sin(phase)*2);
      const light=.3+.7*folds;
      const warm=.5+.5*Math.sin(u*4-time);
      const ink=[100+85*warm,104+32*warm,191-51*warm];
      const base=[245,246,240],index=(y*width+x)*3;
      for(let channel=0;channel<3;channel++)pixels[index+channel]=Math.round(base[channel]*(1-edge*.9)+ink[channel]*edge*.9*light+244*edge*.9*(1-light));
    }
  }
  if(!ffmpeg.stdin.write(pixels))await once(ffmpeg.stdin,'drain');
}
ffmpeg.stdin.end();
const [code]=await completion;
if(code!==0)process.exitCode=code||1;
else console.log('Created six-second procedural silk study: '+output);
