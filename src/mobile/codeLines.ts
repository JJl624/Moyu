// Keep syntax-highlight spans and the original text, so copying has no line numbers.
const numbered=new WeakMap<HTMLElement,string>();
export function numberMobileCode(code:HTMLElement){
  const text=code.textContent||'';
  if(numbered.get(code)===text&&code.querySelector('.mobile-code-line'))return;
  const document=code.ownerDocument,walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT),lines:DocumentFragment[]=[];
  let start:Node=code,offset=0,node:Node|null;
  const range=document.createRange();
  while((node=walker.nextNode())){
    const value=node.textContent||'';
    for(let index=value.indexOf('\n');index>=0;index=value.indexOf('\n',index+1)){
      range.setStart(start,offset);range.setEnd(node,index);lines.push(range.cloneContents());start=node;offset=index+1;
    }
  }
  range.setStart(start,offset);range.setEnd(code,code.childNodes.length);
  if(!text.endsWith('\n')||!lines.length)lines.push(range.cloneContents());
  const fragment=document.createDocumentFragment();
  lines.forEach((content,index)=>{
    const line=document.createElement('span'),source=document.createElement('span');
    line.className='mobile-code-line';line.dataset.line=String(index+1);source.className='mobile-code-source';source.append(content);line.append(source);fragment.append(line);
    if(index<lines.length-1||text.endsWith('\n'))fragment.append(document.createTextNode('\n'));
  });
  code.classList.add('mobile-numbered-code');code.style.setProperty('--mobile-number-width',`${String(lines.length).length+.8}ch`);
  code.replaceChildren(fragment);numbered.set(code,text);
}
