import {expect,type Locator} from '@playwright/test';

export async function foldLayout(title:Locator){
  return title.evaluate(element=>{
    const style=getComputedStyle(element),icon=getComputedStyle(element,'::before'),box=element.getBoundingClientRect();
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT,{acceptNode(node){return node.textContent?.trim()&&!node.parentElement?.closest('.folding-quote-marker,button')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
    const node=walker.nextNode();if(!node)throw Error('Expected a visible folding title');
    const range=document.createRange();range.selectNodeContents(node);const text=range.getClientRects()[0];
    return{font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight),padding:parseFloat(style.paddingTop),
      iconTop:parseFloat(icon.top),iconSize:parseFloat(icon.height),iconX:parseFloat(icon.left),
      textCenter:text.top+text.height/2-box.top,textX:text.left-box.left,
      height:box.height,lines:range.getClientRects().length,mask:icon.maskImage};
  });
}

export async function expectFoldAligned(title:Locator,size:number){
  const geometry=await foldLayout(title);
  expect(geometry.font).toBe(size);
  expect(geometry.mask).toContain('data:image/svg+xml');
  expect(Math.abs(geometry.iconTop+geometry.iconSize/2-geometry.textCenter)).toBeLessThan(2);
  expect(geometry.iconX+geometry.iconSize).toBeLessThan(geometry.textX);
  return geometry;
}
