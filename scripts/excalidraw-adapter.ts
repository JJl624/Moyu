import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { externalizeFontWasm } from './excalidraw-wasm.ts';
// Version-pinned integration; no mutations of node_modules. Keep Excalidraw's
// own editor, offline assets, Chinese locale and numeric opacity control.
export function excalidrawAdapter():Plugin {
  const root=path.resolve('node_modules/@excalidraw/excalidraw/dist/dev').replaceAll('\\','/');
  const entry=root+'/index.js', locale=path.resolve('resources/excalidraw-zh-CN.json').replaceAll('\\','/');
  if(!fs.existsSync(locale))throw new Error('Missing bundled Chinese Excalidraw locale');
  return {name:'moyu-excalidraw',enforce:'pre',resolveId(id){if(id==='moyu-excalidraw')return entry;},transform(code,id){
    const normalized=id.replaceAll('\\','/');
    if(normalized.startsWith(root+'/chunk-')) {
      const next=code.replace('DEV: true','DEV: false').replace('urls.push(new URL(assetUrl, _ExcalidrawFontFace.ASSETS_FALLBACK_URL));','/* All font resources are bundled locally. */').replace('return `${fontFamilyString}${getFontFamilyFallbacks(id).map((x) => `, ${x}`).join("")}`;','return `${JSON.stringify(fontFamilyString)}${getFontFamilyFallbacks(id).map((x) => `, ${JSON.stringify(x)}`).join("")}`;').replace("return `format('${parts.pop()}')`;", "const extension=parts.pop().toLowerCase();return `format('${extension==='ttf'?'truetype':extension==='otf'?'opentype':extension}')`;");
      return externalizeFontWasm(next,(name,source)=>this.emitFile({type:'asset',name,source}));
    }
    if(normalized!==entry)return;
    const old='currentLangData = await globImport_locales_json(`./locales/${currentLang.code}.json`);';
    if(!code.includes(old)||!code.includes('  Fonts,'))throw new Error('Excalidraw 0.18.1 integration needs review before upgrading');
    const zero='/* @__PURE__ */ jsx33("div", { className: "zero-label", children: "0" })';
    if(!code.includes(zero))throw new Error('Excalidraw numeric property integration needs review');
    const libraryOpen=/libraryItems: fileOpen\(\{\s*description: "Excalidraw library files"[\s\S]*?\}\),/;
    if(!libraryOpen.test(code))throw new Error('Excalidraw library import integration needs review');
    const localized=code.replace(old,'currentLangData = moyuChinese;').replace(libraryOpen,'libraryItems: MoyuLibrary.open(),').replace('step: "10",','step: "any",').replace(zero,zero+', jsx33("input", {type:"number",className:"moyu-drawing-number", "aria-label":"透明度数值", min:0,max:100,step:1,value,onChange:(event)=>{const next=Number(event.target.value);if(event.target.value && Number.isFinite(next))updateData(Math.max(0,Math.min(100,next)));}})');
    return `import moyuChinese from ${JSON.stringify(locale)};\n`+localized+`\nexport const MoyuLibrary={loader:undefined,setLoader(loader){this.loader=loader;},open(){if(!this.loader)throw new Error("素材库加载器未就绪。");return this.loader();}};\nexport const MoyuFonts={async register(id,family,bytes){if(FONT_FAMILY[family]!==undefined&&FONT_FAMILY[family]!==id)throw new Error("此字体已在 Excalidraw 的内置列表中，无需添加。");const fontFace=new FontFace(family,bytes);await fontFace.load();FONT_FAMILY[family]=id;document.fonts.add(fontFace);let encoded;const dataUrl=()=>encoded ||= new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(new Blob([bytes],{type:'font/ttf'}));});Fonts.registered.set(id,{metadata:{metrics:{unitsPerEm:1000,ascender:800,descender:-200,lineHeight:1.25}},fontFaces:[{fontFace,urls:[],toCSS:async()=> '@font-face{font-family:'+JSON.stringify(family)+';src:url('+await dataUrl()+');}'}]});return fontFace.load();},remove(id){const entry=Fonts.registered.get(id);if(entry)for(const item of entry.fontFaces)document.fonts.delete(item.fontFace);Fonts.registered.delete(id);for(const name of Object.keys(FONT_FAMILY))if(FONT_FAMILY[name]===id)delete FONT_FAMILY[name];}};\n`;
  }};
}
