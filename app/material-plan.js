// Content-neutral binding between raster coverage and persistent material IDs.
// Raster sources are compile inputs, never independently displayed answer layers.
export class MaterialPlan {
  constructor(fields, capacity) {
    const pixels=fields.reduce((n,f)=>n+f.handle.width*f.handle.height,0);
    let tileSize=Math.max(4,Math.ceil(Math.sqrt(pixels/(capacity*.60))));
    const sources=fields.map(field=>({field,image:field.handle.source.getContext('2d').getImageData(0,0,field.handle.width,field.handle.height)}));
    do {
      this.tiles=[];this.fields=new Map();
      for(const {field,image} of sources){
        const columns=Math.ceil(image.width/tileSize),rows=Math.ceil(image.height/tileSize),acc=new Float64Array(columns*rows*6);
        for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
          const p=(y*image.width+x)*4,alpha=image.data[p+3]/255;if(alpha<.001)continue;
          const cell=(Math.floor(y/tileSize)*columns+Math.floor(x/tileSize))*6;
          acc[cell]+=alpha;acc[cell+1]+=(x+.5)*alpha;acc[cell+2]+=(y+.5)*alpha;
          acc[cell+3]+=image.data[p]*alpha;acc[cell+4]+=image.data[p+1]*alpha;acc[cell+5]+=image.data[p+2]*alpha;
        }
        const ids=new Int32Array(columns*rows);ids.fill(-1);
        for(let cell=0;cell<ids.length;cell++){
          const j=cell*6,weight=acc[j];if(!weight)continue;
          ids[cell]=this.tiles.length;
          this.tiles.push({handle:field.handle,cx:(cell%columns+.5)*tileSize,cy:(Math.floor(cell/columns)+.5)*tileSize,lx:acc[j+1]/weight/(field.ratio||1),ly:acc[j+2]/weight/(field.ratio||1),x:0,y:0,color:[acc[j+3]/weight/255,acc[j+4]/weight/255,acc[j+5]/weight/255]});
        }
        // Transparent cells retain a nearby owner too: a later decoded frame
        // or control label may paint here without inventing fresh material.
        const queue=new Int32Array(ids.length);let head=0,tail=0;
        for(let i=0;i<ids.length;i++)if(ids[i]>=0)queue[tail++]=i;
        if(!tail){ids[0]=this.tiles.length;queue[tail++]=0;this.tiles.push({handle:field.handle,cx:image.width/2,cy:image.height/2,lx:image.width/2/(field.ratio||1),ly:image.height/2/(field.ratio||1),x:0,y:0,color:[0,0,0]});}
        while(head<tail){const i=queue[head++],x=i%columns;
          for(const next of [x>0?i-1:-1,x<columns-1?i+1:-1,i-columns,i+columns])if(next>=0&&next<ids.length&&ids[next]<0){ids[next]=ids[i];queue[tail++]=next;}
        }
        this.fields.set(field.handle,{columns,rows,ids,tileSize,revision:field.handle.revision});
      }
      if(this.tiles.length>capacity)tileSize=Math.ceil(tileSize*1.25);
    }while(this.tiles.length>capacity);
    this.update(fields,0);
  }
  matches(fields){return fields.length===this.fields.size&&fields.every(f=>this.fields.has(f.handle));}
  update(fields,scroll){
    const transforms=new Map(fields.map(f=>[f.handle,f.transform||[1,0,0,1,0,0]]));
    for(const tile of this.tiles){
      const m=transforms.get(tile.handle);if(!m)continue;
      tile.x=m[0]*tile.lx+m[2]*tile.ly+m[4];tile.y=m[1]*tile.lx+m[3]*tile.ly+m[5]-scroll;
    }
  }
  refreshColors(){
    const changed=new Map();
    for(const [handle,part] of this.fields)if(handle.revision!==part.revision){
      changed.set(handle,handle.source.getContext('2d').getImageData(0,0,handle.width,handle.height));part.revision=handle.revision;
    }
    for(const tile of this.tiles){
      const image=changed.get(tile.handle);if(!image)continue;
      const part=this.fields.get(tile.handle),{cx,cy}=tile;
      let mass=0,r=0,g=0,b=0;
      for(const dy of [-.3,0,.3])for(const dx of [-.3,0,.3]){
        const x=Math.min(image.width-1,Math.max(0,Math.floor(cx+dx*part.tileSize))),y=Math.min(image.height-1,Math.max(0,Math.floor(cy+dy*part.tileSize))),p=(y*image.width+x)*4,a=image.data[p+3];
        mass+=a;r+=image.data[p]*a;g+=image.data[p+1]*a;b+=image.data[p+2]*a;
      }
      if(mass)tile.color=[r/mass/255,g/mass/255,b/mass/255];
    }
  }
}
