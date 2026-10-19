import {useEffect,useRef,useState} from 'react';
export function useFileHistory(root:string,active:string,exists:(path:string)=>boolean,open:(path:string)=>Promise<boolean|void>){
  const history=useRef({root,paths:[] as string[],index:-1,pending:''}),busy=useRef(false),[,refresh]=useState(0);
  useEffect(()=>{const h=history.current;if(h.root!==root){h.root=root;h.paths=[];h.index=-1;h.pending='';}if(active){if(h.pending===active)h.pending='';else if(h.paths[h.index]!==active){h.paths=h.paths.slice(0,h.index+1);h.paths.push(active);if(h.paths.length>100)h.paths.shift();h.index=h.paths.length-1;}}refresh(n=>n+1);},[root,active]);
  const find=(direction:number)=>{const h=history.current;if(h.root!==root)return -1;for(let i=h.index+direction;i>=0&&i<h.paths.length;i+=direction)if(h.paths[i]!==active&&exists(h.paths[i]))return i;return -1;};
  const move=async(direction:number)=>{const index=find(direction);if(index<0||busy.current)return;const h=history.current,previous=h.index,target=h.paths[index];busy.current=true;h.index=index;h.pending=target;refresh(n=>n+1);try{const opened=await open(target);if(opened===false&&h.root===root){h.index=previous;h.pending='';}}catch(error){if(h.root===root){h.index=previous;h.pending='';}throw error;}finally{busy.current=false;refresh(n=>n+1);}};
  return {back:find(-1)>=0&&!busy.current,forward:find(1)>=0&&!busy.current,move};
}
