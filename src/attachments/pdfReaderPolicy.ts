import type {MenuItem,ToolbarItem,UISchema} from '@embedpdf/plugin-ui';

/** PDF is a reader. File lifetime belongs to Moyu, editing/saving to the
 * document session; embedded readers keep only reading controls. */
export function pdfDisabledCategories(embedded=false){
  return ['annotation','redaction','signature','form','insert','history','document-open','document-close','document-protect','document-fullscreen',
    ...(embedded?['document-menu','document-print','document-export','document-capture','capture']:[])];
}
export function pdfReaderMenus(schema:UISchema,disabled:string[]){
  const unavailable=(categories:string[]|undefined)=>categories?.some(category=>disabled.some(key=>category===key||category.startsWith(key+'-')));
  const clean=(items:MenuItem[]):MenuItem[]=>{
    const result:MenuItem[]=[];
    for(let item of items){
      if(unavailable(item.categories))continue;
      if(item.type==='section'){const nested=clean(item.items);if(!nested.length)continue;item={...item,items:nested};}
      if(item.type==='divider'&&(!result.length||result.at(-1)?.type==='divider'))continue;
      result.push(item);
    }
    if(result.at(-1)?.type==='divider')result.pop();return result;
  };
  return Object.fromEntries(Object.entries(schema.menus).map(([id,menu])=>[id,{...menu,items:clean(menu.items)}]));
}
export function pdfReaderToolbar(items:ToolbarItem[],embedded=false):ToolbarItem[]{
  const hidden=['mode-select-button','mode-tabs','overflow-tabs-button',...(embedded?['document-menu-button','divider-1']:[])];
  return items.filter(item=>!hidden.includes(item.id)).map(item=>item.type==='group'?{...item,items:pdfReaderToolbar(item.items,embedded)}:item);
}
