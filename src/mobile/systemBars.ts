export function systemBarColors(palette:Record<string,string>,documentView:boolean,modal:boolean){
  const background=palette[documentView?'--bg':'--sidebar']||'#ffffff';
  const dim=(value:string)=>/^#[\da-f]{6}$/i.test(value)?'#'+[1,3,5].map(index=>Math.round(parseInt(value.slice(index,index+2),16)*(1-7/15)).toString(16).padStart(2,'0')).join(''):value;
  return {background:modal?dim(background):background,navigationBackground:palette['--bg']||'#ffffff'};
}
