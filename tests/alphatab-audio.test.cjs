const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function fixture(){
  const {adaptAlphaTabAudio}=await import('../scripts/alphatab-audio-adapter.mjs');
  const adapted=adaptAlphaTabAudio(fs.readFileSync(require.resolve('@coderline/alphatab').replace(/alphaTab\.[^/\\]+$/,'alphaTab.core.mjs'),'utf8'));
  const start=adapted.indexOf('class AlphaSynthAudioWorkletOutput extends'),end=adapted.indexOf('\n//#endregion',start),pending=[],nodes=[];
  class Base{
    constructor(){this.context={destination:{}};this.sources=[];}
    play(){const source={started:false,stops:0,disconnected:0,connect(){},start(){this.started=true;},stop(){if(!this.started)throw Error('stop before start');this.stops++;},disconnect(){this.disconnected++;}};this.sources.push(source);this.source=source;}
    pause(){if(this.source){this.source.stop();this.source.disconnect();}this.source=null;}
    destroy(){this.pause();this.context=null;}
  }
  class Worklet{constructor(){nodes.push(this);this.messages=[];this.port={postMessage:message=>this.messages.push(message),addEventListener(){},removeEventListener(){},start(){}};}connect(){}disconnect(){this.disconnected=true;}}
  const Output=vm.runInNewContext('('+adapted.slice(start,end)+')',{AlphaSynthWebAudioOutputBase:Base,AudioWorkletNode:Worklet,BrowserUiFacade:{createAlphaSynthAudioWorklet:()=>new Promise(resolve=>pending.push(resolve))},Logger:{error(){}},Environment:{prepareForPostMessage:value=>value}});
  return {output:new Output({}),pending,nodes};
}
test('Worklet playback cancelled before module startup never stops or connects an unstarted source',async()=>{
  const {output,pending,nodes}=await fixture();output.play();output.addSamples(new Float32Array([1]));output.pause();pending.shift()();await Promise.resolve();assert.equal(nodes.length,0);assert.equal(output.source,null);assert.equal(output.sources[0].started,false);
});
test('Closing an opening score cancels its pending audio without a late worklet or callback',async()=>{
  const {output,pending,nodes}=await fixture();output.play();output.destroy();pending.shift()();await Promise.resolve();assert.equal(nodes.length,0);assert.equal(output.context,null);
});
test('An old startup cannot attach to or start a newer playback session',async()=>{
  const {output,pending,nodes}=await fixture();output.play();output.pause();output.play();pending[0]();await Promise.resolve();assert.equal(nodes.length,0);pending[1]();await Promise.resolve();assert.equal(nodes.length,1);assert.equal(output.sources[0].started,false);assert.equal(output.sources[1].started,true);output.pause();assert.equal(output.sources[1].stops,1);assert.equal(nodes[0].disconnected,true);
});
test('Unknown upstream audio implementations fail adaptation instead of silently publishing',async()=>{
  const {adaptAlphaTabAudio}=await import('../scripts/alphatab-audio-adapter.mjs');assert.throws(()=>adaptAlphaTabAudio('export const changed=true;'),/review adapter/);
});
