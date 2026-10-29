const {test}=require('node:test');
const assert=require('node:assert/strict');
const editorModule=require('./helpers/editor-module.cjs');
const modulePromise=editorModule('structuralViewport.ts');

function fixture(){
  const document=new EventTarget(),scroll=new EventTarget(),frames=new Map();let frameId=0,minHeight='100%',clamp=false;
  Object.assign(scroll,{scrollTop:1000,scrollLeft:12,clientHeight:300,getBoundingClientRect:()=>({top:0})});
  const style={get minHeight(){return minHeight;},set minHeight(value){minHeight=value;if(clamp&&value==='100%')scroll.scrollTop=400;}};
  document.defaultView={requestAnimationFrame(callback){frames.set(++frameId,callback);return frameId;},cancelAnimationFrame(id){frames.delete(id);}};
  const view={isDestroyed:false,state:{doc:{}},dom:{ownerDocument:document,style,closest:()=>scroll,getBoundingClientRect:()=>({top:-1000})},focus(){throw Error('Structural viewport must not acquire input');}};
  const tick=()=>{for(const [id,callback] of frames){frames.delete(id);callback();}};
  return{view,scroll,document,frames,tick,enableClamp:()=>{clamp=true;}};
}

test('Structural changes reserve the visible extent before DOM replacement and reconcile one frame',async()=>{
  const {withStructuralViewport}=await modulePromise,f=fixture();
  withStructuralViewport(f.view,()=>{assert.equal(f.view.dom.style.minHeight,'1300px');f.scroll.scrollTop=400;});
  assert.equal(f.scroll.scrollTop,1000);f.scroll.scrollTop=500;f.tick();assert.equal(f.scroll.scrollTop,1000);assert.equal(f.frames.size,0);
  f.scroll.dispatchEvent(new Event('wheel'));assert.equal(f.view.dom.style.minHeight,'100%');
});

test('Repeated block moves capture position before releasing the previous extent floor',async()=>{
  const {withStructuralViewport}=await modulePromise,f=fixture();
  withStructuralViewport(f.view,()=>{});f.tick();f.enableClamp();
  withStructuralViewport(f.view,()=>assert.equal(f.scroll.scrollTop,1000));f.tick();assert.equal(f.scroll.scrollTop,1000);
  f.scroll.dispatchEvent(new Event('compositionstart'));assert.equal(f.view.dom.style.minHeight,'100%');
});

test('New pointer input or document changes cannot be overwritten by deferred viewport work',async()=>{
  const {withStructuralViewport}=await modulePromise;
  for(const interrupt of ['pointer','document','destroy']){
    const f=fixture();withStructuralViewport(f.view,()=>{});f.scroll.scrollTop=800;
    if(interrupt==='pointer')f.document.dispatchEvent(new Event('pointerdown'));
    if(interrupt==='document')f.view.state.doc={};
    if(interrupt==='destroy')f.view.isDestroyed=true;
    f.tick();assert.equal(f.scroll.scrollTop,800,interrupt);
    f.scroll.dispatchEvent(new Event('beforeinput'));assert.equal(f.view.dom.style.minHeight,'100%');
  }
});

test('IME history is preserved, while real input releases temporary layout space',async()=>{
  const {withStructuralViewport}=await modulePromise,f=fixture();withStructuralViewport(f.view,()=>{});
  const history=new Event('beforeinput');Object.defineProperty(history,'inputType',{value:'historyUndo'});f.scroll.dispatchEvent(history);
  assert.equal(f.view.dom.style.minHeight,'1300px');assert.equal(f.frames.size,0);
  f.scroll.dispatchEvent(new Event('beforeinput'));assert.equal(f.view.dom.style.minHeight,'100%');
});
