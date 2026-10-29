import { defaultHandlers, type Handle, type Handlers, type Join } from 'mdast-util-to-markdown';
import {EMPTY_PARAGRAPH,isEmptyParagraphMarker} from '../../shared/empty-paragraph.mjs';

// Milkdown represents an empty list/quote paragraph as inline HTML. In a
// tight list the default join omits the blank line, so CommonMark consumes
// the following fence as part of that HTML block instead of parsing code.
export const emptyParagraphJoin:Join=left=>{
  if(left.type==='paragraph'&&left.children?.length===1&&left.children[0].type==='html'
    &&isEmptyParagraphMarker(left.children[0].value))return 1;
};

export function inlineMarkdownHandlers(
  handlers?: Partial<Handlers> | null,
): Partial<Handlers> & { inlineRaw: Handle } {
  return {
    ...handlers,
    text(node, parent, state, info) {
      // Milkdown emits whitespace-only text verbatim. At a paragraph boundary,
      // indentation would then turn the following inline resource into code.
      const serialize = /^\s+$/.test(node.value)
        ? defaultHandlers.text
        : handlers?.text || defaultHandlers.text;
      return serialize(node, parent, state, info);
    },
    paragraph(node,parent,state,info){
      if(!node.children?.length&&parent?.type==='root'){
        const siblings=parent.children,index=siblings.indexOf(node);
        let before=index-1,after=index+1;
        const empty=(at:number)=>siblings[at]?.type==='paragraph'&&!siblings[at].children?.length;
        while(before>=0&&empty(before))before--;
        while(after<siblings.length&&empty(after))after++;
        const left=siblings[before],right=siblings[after];
        // A Markdown gap alone cannot distinguish two independent lists of
        // the same kind. Retain the actual empty paragraph at this boundary.
        if(left?.type==='list'&&right?.type==='list'&&!!left.ordered===!!right.ordered)return EMPTY_PARAGRAPH;
      }
      return (handlers?.paragraph||defaultHandlers.paragraph)(node,parent,state,info);
    },
    inlineRaw: node => (node as { value: string }).value,
  };
}
