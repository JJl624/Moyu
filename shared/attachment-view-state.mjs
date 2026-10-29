export function viewerPages(value) {
  const valid=(Array.isArray(value) ? value : []).filter(row => Array.isArray(row) && row.length === 2
    && typeof row[0] === 'string' && row[0].length <= 16384
    && Number.isInteger(row[1]) && row[1] >= 1 && row[1] <= 1000000);
  const unique=new Map();for(const [key,page]of valid){unique.delete(key);unique.set(key,page);}return [...unique].slice(-256);
}
export function rememberViewerPage(value, key, page) {
  const rows = viewerPages(value);
  if (!Number.isInteger(page) || page < 1 || page > 1000000) return rows;
  return [...rows.filter(row => row[0] !== key), [key, page]].slice(-256);
}

// Persist preferences, never transient DOM layout, selection or playback state.
export function attachmentView(value) {
  const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;
  const numbers={height:[0,4000],imageWindowWidth:[0,10000],imageWindowHeight:[0,10000],pdfPage:[1,1000000],pdfRotation:[0,3],scoreZoom:[.1,4],scoreSpeed:[.25,4],scoreVolume:[0,100],scorePosition:[0,86400000],imageRotation:[0,270]};
  for(const [key,[min,max]]of Object.entries(numbers))if(Number.isFinite(value[key])&&value[key]>=min&&value[key]<=max)out[key]=Math.round(value[key]*1000)/1000;
  if(out.height>0&&out.height<120)delete out.height;
  for(const key of ['pdfPage','pdfRotation','imageRotation'])if(out[key]!==undefined&&!Number.isInteger(out[key]))delete out[key];
  if(out.imageRotation%90!==0)delete out.imageRotation;
  for(const key of ['scoreLoop','scoreMetronome','pdfPan'])if(typeof value[key]==='boolean')out[key]=value[key];
  const sidebar=value.pdfSidebar;
  if(sidebar&&typeof sidebar==='object'&&['placement','slot','id'].every(key=>typeof sidebar[key]==='string'&&sidebar[key].length>0&&sidebar[key].length<256)&&typeof sidebar.open==='boolean')out.pdfSidebar={placement:sidebar.placement,slot:sidebar.slot,id:sidebar.id,open:sidebar.open,...(typeof sidebar.tab==='string'&&sidebar.tab.length<256?{tab:sidebar.tab}:{})};
  for(const [key,values]of Object.entries({scoreLayout:['page','horizontal'],pdfSpread:['none','odd','even'],pdfScroll:['vertical','horizontal']}))if(values.includes(value[key]))out[key]=value[key];
  for(const [key,modes]of Object.entries({pdfZoom:['automatic','fit-page','fit-width'],imageZoom:['fit']}))if(modes.includes(value[key])||Number.isFinite(value[key])&&value[key]>=.05&&value[key]<=16)out[key]=value[key];
  if(value.scoreTrack==='all'||Number.isInteger(value.scoreTrack)&&value.scoreTrack>=0&&value.scoreTrack<512)out.scoreTrack=value.scoreTrack;
  return out;
}
export function attachmentViews(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([key])=>key.length>0&&key.length<=16384&&!['__proto__','constructor','prototype'].includes(key)).map(([key,state])=>[key,attachmentView(state)]));
}
