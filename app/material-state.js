// Persistent material parcels. Display cells own a parcel; density and final
// coverage are two measurements of that same state, never extra reservoirs.
export const FLOW_DURATION = 2600;
const TAU=Math.PI*2,STEP=1/120;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const angle=(x,y)=>((Math.atan2(y,x)+TAU)%TAU);
function spatialOrder(x,y){
  x=Math.round(clamp(x)*1023);y=Math.round(clamp(y)*1023);let order=0;
  for(let s=512;s>0;s>>=1){const rx=(x&s)?1:0,ry=(y&s)?1:0;order+=s*s*((3*rx)^ry);
    if(!ry){if(rx){x=1023-x;y=1023-y;}[x,y]=[y,x];}
  }
  return order;
}

export class MaterialState {
  constructor(count,width,height){
    this.count=count;this.width=width;this.height=height;
    this.radius=Math.min(112,width*.22,height*.28);
    this.position=new Float32Array(count*2);
    this.velocity=new Float32Array(count*2);
    this.home=new Float32Array(count*2);
    this.target=new Float32Array(count*2);
    this.guide=new Float32Array(count*2);
    this.initial=new Float32Array(count*2);
    this.initialVelocity=new Float32Array(count*2);
    this.pigment=new Float32Array(count*4);
    this.origin=new Float32Array(count*4);
    this.currentPigment=new Float32Array(count*4);
    this.tileIds=new Int32Array(count);
    this.packed=new Float32Array(count*4);
    this.release=new Float32Array(count);
    this.initialDistance=new Float32Array(count);
    this.landing=new Float32Array(count);
    this.tint=new Float32Array(count);
    this.attached=new Uint8Array(count);
    this.bins=new Int32Array(count);
    this.mode='idle';this.tick=0;this.settled=0;
    for(let i=0;i<count;i++){
      const a=i*2.399963229728653;
      // Projection of a volume: more material in the middle, less at the rim.
      const r=this.radius*Math.sqrt(1-Math.pow(1-(i+.5)/count,2/3));
      this.home[i*2]=Math.cos(a)*r;this.home[i*2+1]=Math.sin(a)*r;
      this.pigment[i*4+3]=6000/count;
      this.currentPigment[i*4+3]=6000/count;
    }
    this.idle(0);
  }
  idle(time){
    this.mode='idle';this.tick=0;this.settled=0;
    const cx=this.width/2,cy=this.height/2;
    for(let i=0;i<this.count;i++){
      const hx=this.home[i*2],hy=this.home[i*2+1],a=Math.atan2(hy,hx);
      const shape=1+.06*Math.sin(a*3+time*.67)+.028*Math.cos(a*5-time*.41);
      this.position[i*2]=cx+hx*shape*(1+.035*Math.sin(time*.57));
      this.position[i*2+1]=cy+hy*shape*(1-.035*Math.sin(time*.57));
      this.velocity[i*2]=this.velocity[i*2+1]=0;
      this.landing[i]=this.tint[i]=this.attached[i]=0;
      this.pigment[i*4]=this.pigment[i*4+1]=this.pigment[i*4+2]=0;
      this.origin[i*4]=this.origin[i*4+1]=this.origin[i*4+2]=0;
    }
    this.pack();
  }
  assign(tiles){
    if(!tiles.length)throw new Error('没有可分配的显示格点');
    if(tiles.length>this.count)throw new Error('目标分块超过材料预算');
    const cx=this.width/2,cy=this.height/2;
    const sourceIds=Array.from({length:this.count},(_,i)=>i);
    const sourceBox=[Infinity,Infinity,-Infinity,-Infinity],targetBox=[Infinity,Infinity,-Infinity,-Infinity];
    const extend=(box,x,y)=>{box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],y);};
    for(const id of sourceIds)extend(sourceBox,this.position[id*2],this.position[id*2+1]);
    for(const tile of tiles)extend(targetBox,tile.x,tile.y);
    const key=(box,x,y)=>spatialOrder((x-box[0])/Math.max(1,box[2]-box[0]),(y-box[1])/Math.max(1,box[3]-box[1]));
    const sourceKeys=sourceIds.map(id=>key(sourceBox,this.position[id*2],this.position[id*2+1]));
    sourceIds.sort((a,b)=>sourceKeys[a]-sourceKeys[b]);
    // Spatial ordering keeps nearby material assigned to nearby content across
    // arbitrary content types, without radial sectors or image-specific paths.
    const sorted=tiles.map((tile,index)=>({...tile,index,key:key(targetBox,tile.x,tile.y)})).sort((a,b)=>a.key-b.key);
    const owners=new Int32Array(tiles.length);owners.fill(-1);
    for(let k=0;k<this.count;k++){
      const id=sourceIds[k],tile=sorted[Math.min(sorted.length-1,Math.floor(k*sorted.length/this.count))];
      if(owners[tile.index]<0)owners[tile.index]=id;
      const sx=this.position[id*2],sy=this.position[id*2+1],a=angle(sx-cx,sy-cy);
      this.tileIds[id]=tile.index;
      for(let c=0;c<3;c++)this.origin[id*4+c]=this.currentPigment[id*4+c];
      this.target[id*2]=tile.x;this.target[id*2+1]=tile.y;
      this.updateGuide(id);
      this.pigment[id*4]=tile.color[0];this.pigment[id*4+1]=tile.color[1];this.pigment[id*4+2]=tile.color[2];
      const depth=clamp(1-Math.hypot(sx-cx,sy-cy)**2/this.radius**2);
      this.release[id]=.025+.57*depth+.075*(.5+.5*Math.sin(a*3+.7));
      this.initialDistance[id]=Math.max(12,Math.hypot(tile.x-sx,tile.y-sy));
    }
    this.initial.set(this.position);this.initialVelocity.set(this.velocity);
    this.landing.fill(0);this.tint.fill(0);this.attached.fill(0);
    this.mode='flow';this.tick=0;this.settled=0;this.pack();
    return owners;
  }
  rewind(){
    this.position.set(this.initial);this.velocity.set(this.initialVelocity);
    this.landing.fill(0);this.tint.fill(0);this.attached.fill(0);this.tick=0;this.settled=0;
  }
  resize(width,height){
    const sx=width/this.width,sy=height/this.height;
    for(const data of [this.position,this.initial,this.target,this.velocity,this.initialVelocity])for(let i=0;i<this.count;i++){data[i*2]*=sx;data[i*2+1]*=sy;}
    const radius=Math.min(112,width*.22,height*.28),scale=radius/this.radius;
    for(let i=0;i<this.home.length;i++)this.home[i]*=scale;
    this.radius=radius;this.width=width;this.height=height;this.pack();
    for(let i=0;i<this.count;i++)this.updateGuide(i);
  }
  updateGuide(i){
    const cx=this.width/2,cy=this.height/2,a=angle(this.target[i*2]-cx,this.target[i*2+1]-cy);
    const direction=a+.24*Math.sin(a*3+.7)+.13*Math.sin(a*5-1.1);
    this.guide[i*2]=cx+Math.cos(direction)*this.radius*.92;this.guide[i*2+1]=cy+Math.sin(direction)*this.radius*.92;
  }
  updateTargets(tiles){
    for(let i=0;i<this.count;i++){
      const tile=tiles[this.tileIds[i]],j=i*2;if(!tile)continue;
      if(this.target[j]!==Math.fround(tile.x)||this.target[j+1]!==Math.fround(tile.y)){
        this.target[j]=tile.x;this.target[j+1]=tile.y;this.updateGuide(i);
      }
      for(let c=0;c<3;c++)this.pigment[i*4+c]=tile.color[c];
      if(this.attached[i]){this.position[j]=tile.x;this.position[j+1]=tile.y;}
    }
  }
  settle(){
    this.position.set(this.target);this.velocity.fill(0);this.landing.fill(1);this.tint.fill(1);this.attached.fill(1);this.settled=this.count;this.pack();
  }
  advance(seconds){
    if(this.mode!=='flow')return;
    const targetTick=Math.max(0,Math.round(seconds/STEP));
    if(targetTick<this.tick)this.rewind();
    while(this.tick<targetTick&&this.settled<this.count){this.step(++this.tick*STEP);}
    this.tick=targetTick;this.pack();
  }
  step(time){
    const cell=32,columns=Math.ceil(this.width/cell)+12,rows=Math.ceil(this.height/cell)+12;
    if(!this.grid||this.grid.length!==columns*rows*3)this.grid=new Float32Array(columns*rows*3);
    else this.grid.fill(0);
    const grid=this.grid;
    for(let i=0;i<this.count;i++){
      if(this.attached[i])continue;
      const bx=clamp(Math.floor(this.position[i*2]/cell)+6,0,columns-1),by=clamp(Math.floor(this.position[i*2+1]/cell)+6,0,rows-1),b=(by*columns+bx)*3;
      this.bins[i]=b;grid[b]+=this.velocity[i*2];grid[b+1]+=this.velocity[i*2+1];grid[b+2]++;
    }
    for(let i=0;i<this.count;i++){
      if(this.attached[i])continue;
      const age=time-this.release[i];
      if(age<0)continue;
      const j=i*2,tx=this.target[j],ty=this.target[j+1];
      const exitX=this.guide[j],exitY=this.guide[j+1];
      const opening=smooth((age-.06)/.40);
      const gx=exitX+(tx-exitX)*opening,gy=exitY+(ty-exitY)*opening;
      let x=this.position[j],y=this.position[j+1],vx=this.velocity[j],vy=this.velocity[j+1];
      const b=this.bins[i],weight=grid[b+2],viscosity=2.0*(1-opening);
      const omega=19;
      vx+=((gx-x)*omega*omega-2*omega*vx+viscosity*(grid[b]/Math.max(1,weight)-vx))*STEP;
      vy+=((gy-y)*omega*omega-2*omega*vy+viscosity*(grid[b+1]/Math.max(1,weight)-vy))*STEP;
      x+=vx*STEP;y+=vy*STEP;
      const distance=Math.hypot(tx-x,ty-y),speed=Math.hypot(vx,vy);
      // Resolve detailed display cells only within attachment distance. Before
      // that, the same material is reconstructed as a continuous liquid surface.
      const destinationBlend=smooth(1-distance/3)*smooth((age-.25)/.30);
      this.landing[i]=Math.max(this.landing[i],destinationBlend);
      const dye=smooth((age-.09)/.78)*smooth(1-distance/(this.initialDistance[i]+this.radius));
      this.tint[i]=Math.max(this.tint[i],dye);
      if(opening===1&&distance<.10&&speed<1.5){
        x=tx;y=ty;vx=vy=0;this.landing[i]=this.tint[i]=1;this.attached[i]=1;this.settled++;
      }
      this.position[j]=x;this.position[j+1]=y;this.velocity[j]=vx;this.velocity[j+1]=vy;
    }
  }
  pack(){
    for(let i=0;i<this.count;i++){
      this.packed[i*4]=this.position[i*2];this.packed[i*4+1]=this.position[i*2+1];
      this.packed[i*4+2]=this.landing[i];this.packed[i*4+3]=this.tint[i];
      for(let c=0;c<3;c++)this.currentPigment[i*4+c]=this.origin[i*4+c]+(this.pigment[i*4+c]-this.origin[i*4+c])*this.tint[i];
    }
  }
  inspect(){
    let waiting=0,moving=0,attached=0,movingCentre=0,centre=0;
    const now=this.tick*STEP;
    for(let i=0;i<this.count;i++){
      if(this.attached[i])attached++;else if(this.mode==='idle'||now<this.release[i])waiting++;else moving++;
      if(Math.hypot(this.position[i*2]-this.width/2,this.position[i*2+1]-this.height/2)<this.radius*.5){
        centre++;if(Math.hypot(this.velocity[i*2],this.velocity[i*2+1])>2)movingCentre++;
      }
    }
    return {count:this.count,waiting,moving,attached,centre,movingCentre,complete:attached===this.count};
  }
}
