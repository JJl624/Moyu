import fs from 'node:fs';
import path from 'node:path';
import {cdnFontConfig} from '@embedpdf/engines';
import {transformSync} from 'esbuild';
import {adaptAlphaTabAudio} from './alphatab-audio-adapter.mjs';
const root=path.resolve(import.meta.dirname,'..');
export function preparePreviewAssets() {
  for(const [name,version] of [['@embedpdf/snippet','2.15.1'],['@embedpdf/engines','2.15.1'],['@coderline/alphatab','1.8.4'],['mathlive','0.111.1']]) {
    const installed=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8')).version;
    if(installed!==version)throw Error(name+' '+installed+' requires preview adapter review before upgrading');
  }
  const target=path.join(root,'public/vendor');fs.mkdirSync(target,{recursive:true});
  const copy=(from,to)=>fs.cpSync(path.join(root,'node_modules',from),path.join(target,to),{recursive:true});
  // Unmodified upstream distributions; worker-relative imports remain intact.
  for(const name of fs.readdirSync(path.join(root,'node_modules/@embedpdf/snippet/dist')))
    if(/\.(js|wasm)$/.test(name))copy('@embedpdf/snippet/dist/'+name,'embedpdf/'+name);
  for(const name of fs.readdirSync(path.join(root,'node_modules/@coderline/alphatab/dist')))
    if(/^alphaTab(?:\.(?:core|worker|worklet))?(?:\.min)?\.mjs$/.test(name)||name==='font')copy('@coderline/alphatab/dist/'+name,'alphatab/'+name);
  for(const name of ['sonivox.sf3','LICENSE','README.md'])copy('@coderline/alphatab/dist/soundfont/'+name,'alphatab/soundfont/'+name);
  const audio=adaptAlphaTabAudio(fs.readFileSync(path.join(root,'node_modules/@coderline/alphatab/dist/alphaTab.core.mjs'),'utf8'));
  fs.writeFileSync(path.join(target,'alphatab/alphaTab.core.mjs'),audio);
  fs.writeFileSync(path.join(target,'alphatab/alphaTab.core.min.mjs'),transformSync(audio,{loader:'js',format:'esm',target:'es2022',minify:true,legalComments:'eof'}).code);
  fs.copyFileSync(path.join(root,'scripts/alphatab-audio-adapter.mjs'),path.join(target,'alphatab/moyu-audio-adapter.mjs'));
  copy('mathlive/fonts','mathlive/fonts');copy('mathlive/LICENSE.txt','mathlive/LICENSE.txt');
  const fonts={};
  for(const [charset,entries] of Object.entries(cdnFontConfig.fonts)) {
    const variants=Array.isArray(entries)?entries:[entries];
    const chosen=variants.find(item=>typeof item!=='string'&&item.weight===400&&!item.italic)||variants[0];
    const url=typeof chosen==='string'?chosen:chosen.url;
    const match=/(@embedpdf\/fonts-[^@/]+)@[^/]+\/fonts\/(.+)$/.exec(url);
    if(!match)throw Error('EmbedPDF font assets require upgrade review');
    copy(match[1]+'/fonts/'+match[2],'embedpdf/fonts/'+match[2]);
    fonts[charset]='fonts/'+match[2];
  }
  fs.writeFileSync(path.join(target,'embedpdf/fonts.json'),JSON.stringify({fonts}));
}
