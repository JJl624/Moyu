// Bound the LCS table and refine only changed line pairs. Large replacements
// use common edges instead of allocating a quadratic document-sized matrix.
function sequenceDiff(left,right,budget){
  let prefix=0,suffix=0;
  while(prefix<left.length&&prefix<right.length&&left[prefix]===right[prefix])prefix++;
  while(suffix<left.length-prefix&&suffix<right.length-prefix&&left.at(-1-suffix)===right.at(-1-suffix))suffix++;
  const a=left.slice(prefix,left.length-suffix),b=right.slice(prefix,right.length-suffix),out=[];
  const add=(kind,value)=>{if(!value)return;const last=out.at(-1);if(last?.kind===kind)last.value+=value;else out.push({kind,value});};
  add('same',left.slice(0,prefix).join(''));
  if((a.length+1)*(b.length+1)>budget){add('left',a.join(''));add('right',b.join(''));}
  else{
    const width=b.length+1,table=new Uint32Array((a.length+1)*width);
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i*width+j]=a[i]===b[j]?table[(i+1)*width+j+1]+1:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
    let i=0,j=0;
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j]){add('same',a[i++]);j++;}
      else if(i<a.length&&(j===b.length||table[(i+1)*width+j]>=table[i*width+j+1]))add('left',a[i++]);
      else add('right',b[j++]);
    }
  }
  add('same',suffix?left.slice(-suffix).join(''):'');return out;
}
export function compareText(left,right){
  const lines=text=>text.match(/[^\n]*\n|[^\n]+$/g)||[];
  const pieces=sequenceDiff(lines(left),lines(right),250000),refined=[];
  for(let i=0;i<pieces.length;i++){
    const a=pieces[i],b=pieces[i+1];
    if(a.kind==='left'&&b?.kind==='right'&&a.value.length+b.value.length<=6000){
      refined.push(...sequenceDiff(Array.from(a.value),Array.from(b.value),100000));i++;
    }else refined.push(a);
  }
  const output={left:[],right:[]};
  for(const piece of refined)for(const side of ['left','right']){
    if(piece.kind!=='same'&&piece.kind!==side)continue;
    const list=output[side],changed=piece.kind!=='same',last=list.at(-1);
    if(last?.changed===changed)last.value+=piece.value;else list.push({value:piece.value,changed});
  }
  return output;
}
