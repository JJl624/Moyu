/** Standard hit-testing first (Firefox); WebKit/Blink fallback for older engines. */
export function caretRangeAt(document:Document,x:number,y:number):Range|null{
  const standard=document as Document&{caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null};
  if(standard.caretPositionFromPoint){
    const caret=standard.caretPositionFromPoint(x,y);if(!caret)return null;
    const range=document.createRange();range.setStart(caret.offsetNode,caret.offset);range.collapse(true);return range;
  }
  return document.caretRangeFromPoint?.(x,y)??null;
}
