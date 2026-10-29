import map from './fileIconMap.json';
import {scoreFile} from '../shared/attachment-previews.mjs';
const names=map.names as Record<string,string>,extensions=map.extensions as Record<string,string>;
export function FileIcon({path}:{path:string}) {
  const name=path.replace(/\\/g,'/').split('/').at(-1)!.toLowerCase();
  const extension=name.split('.').at(-1)!;
  let icon=/^(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/.test(extension)?extensions[extension]:names[name];
  if(!icon){const pieces=name.split('.');for(let i=1;i<pieces.length;i++){icon=extensions[pieces.slice(i).join('.')];if(icon)break;}}
  if(scoreFile(path))icon='audio';
  icon=icon||'file';
  const base=new URL('./file-icons/',document.baseURI).href;
  return <span className="file-icon" aria-hidden="true"><img src={base+icon+'.svg'} alt=""/>{map.light.includes(icon)&&<img className="file-icon-light" src={base+icon+'_light.svg'} alt=""/>}</span>;
}
