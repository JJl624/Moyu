// SPDX-License-Identifier: MPL-2.0
// Version-bound build adaptation. node_modules stays untouched. The readable
// derived core is distributed beside the minified build under upstream MPL-2.0.
export function adaptAlphaTabAudio(source){
  const start=source.indexOf('class AlphaSynthAudioWorkletOutput extends AlphaSynthWebAudioOutputBase {');
  const end=source.indexOf('\n//#endregion',start);
  if(start<0||end<0)throw Error('alphaTab AudioWorklet implementation changed; review adapter');
  let output=source.slice(start,end);
  const replace=(before,after)=>{if(output.split(before).length!==2)throw Error('alphaTab AudioWorklet lifecycle changed; review adapter: '+before);output=output.replace(before,after);};
  replace('\t_worklet = null;','\t// Moyu: cancel pending async startup before pause/destroy/replay.\n\t_sourceStarted = false;\n\t_worklet = null;');
  replace('\t\tsuper.play();','\t\tsuper.play();\n\t\tthis._sourceStarted = false;\n\t\tconst source = this.source;');
  replace('BrowserUiFacade.createAlphaSynthAudioWorklet(ctx, this._settings).then(() => {','BrowserUiFacade.createAlphaSynthAudioWorklet(ctx, this._settings).then(() => {\n\t\t\tif (this.source !== source || this.context !== ctx) return;');
  replace('\t\t\tthis.source.connect(this._worklet);\n\t\t\tthis.source.start(0);','\t\t\tsource.connect(this._worklet);\n\t\t\tsource.start(0);\n\t\t\tthis._sourceStarted = true;');
  replace('\t\tsuper.pause();','\t\tif (this.source && !this._sourceStarted) {\n\t\t\tthis.source.disconnect();\n\t\t\tthis.source = null;\n\t\t}\n\t\tthis._sourceStarted = false;\n\t\tsuper.pause();');
  return source.slice(0,start)+output+source.slice(end);
}
