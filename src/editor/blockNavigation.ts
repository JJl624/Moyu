import { Prec } from '@codemirror/state';
import { EditorView as CodeView, keymap } from '@codemirror/view';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { Fragment } from '@milkdown/kit/prose/model';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { type Command, NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection, deleteTable } from '@milkdown/kit/prose/tables';
import { $prose } from '@milkdown/kit/utils';
import {focusEditorSelection} from './selectionOwnership';
import {closeHistory} from '@milkdown/kit/prose/history';
import {codeBoundaryAt} from './codeBoundary';

// A code block is a separate editor, even when it has no text. Generic PM
// joins clear an empty preceding textblock; cross this boundary explicitly.
export function enterAdjacentCode(view:import('@milkdown/kit/prose/view').EditorView,backward:boolean,selection=view.state.selection){
  if(!view.editable||view.composing)return false;
  const boundary=codeBoundaryAt(view.state,selection,backward);
  if(!boundary)return false;
  const {container:parent,paragraphIndex:index,code:adjacent,position}=boundary;
  const at=boundary.selection.$head,tr=view.state.tr;
  // Only remove an empty outside paragraph. Text outside code stays outside.
  if(!at.parent.content.size&&parent.canReplace(index,index+1))tr.delete(at.before(),at.after());
  const mapped=tr.mapping.map(position,backward?1:-1),offset=backward?adjacent.content.size:0;
  view.dispatch(closeHistory(tr.setSelection(TextSelection.create(tr.doc,mapped+1+offset))).scrollIntoView());
  focusEditorSelection(view, 'edit');return true;
}

// An empty continuation after a block first becomes a sibling item. An empty
// item then lifts one level per Enter, including the final exit to a paragraph.
export const continueList: Command = (state, dispatch) => {
  const { empty, $from, $to } = state.selection;
  if (
    !empty || !$from.sameParent($to) || $from.parent.type.name !== 'paragraph'
    || $from.parent.content.size || $from.depth < 2
  ) return false;
  const item = $from.node(-1);
  if (item.type.name !== 'list_item') return false;
  if (item.childCount === 1) return liftListItem(item.type)(state, dispatch);
  const index = $from.index(-1);
  if (index !== item.childCount - 1 || index === 0) return false;
  const retained = item.copy(item.content.cut(0, item.content.size - $from.parent.nodeSize));
  const next = item.type.create({
    ...item.attrs,
    checked: item.attrs.checked == null ? item.attrs.checked : false,
  }, state.schema.nodes.paragraph.create());
  const position = $from.before($from.depth - 1);
  if (dispatch) {
    const tr = state.tr.replaceWith(
      position,
      position + item.nodeSize,
      Fragment.fromArray([retained, next]),
    );
    dispatch(
      tr.setSelection(TextSelection.create(tr.doc, position + retained.nodeSize + 2))
        .scrollIntoView(),
    );
  }
  return true;
};

export function leaveCodeBlock(view: import('@milkdown/kit/prose/view').EditorView, pos: number) {
  if (!view.editable) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node || !['code_block','math_block'].includes(node.type.name)) return false;
  const $start = view.state.doc.resolve(pos),
    position = pos + node.nodeSize,
    parent = $start.parent,
    index = $start.index() + 1;
  if (!parent.canReplaceWith(index, index, view.state.schema.nodes.paragraph)) return false;
  const tr = view.state.tr;
  const next = parent.maybeChild(index);
  if (next?.type.name !== 'paragraph') {
    tr.insert(position, view.state.schema.nodes.paragraph.create());
  }
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, position + 1)).scrollIntoView());
  focusEditorSelection(view, 'edit');
  return true;
}

// Touch keyboards have no reliable ArrowDown/Mod-Enter. Insert a sibling in the
// block's current container, so leaving a resource never breaks its list item.
export const adjacentParagraph=(side:'before'|'after'):Command=>(state,dispatch)=>{
  const at=state.selection.$from,selected=state.selection instanceof NodeSelection?state.selection.node:null;let depth=at.depth;
  for(let index=at.depth;index>0;index--)if(['paragraph','heading'].includes(at.node(index).type.name)){depth=index;break;}
  for(let index=at.depth;index>0;index--)if(['table','code_block','math_block'].includes(at.node(index).type.name)){depth=index;break;}
  if(!selected&&!depth)return false;
  const position=selected?(side==='before'?state.selection.from:state.selection.to):side==='before'?at.before(depth):at.after(depth),parent=selected?at.parent:at.node(depth-1),index=(selected?at.index():at.index(depth-1))+(side==='after'?1:0);
  if(!parent.canReplaceWith(index,index,state.schema.nodes.paragraph))return false;
  if(dispatch){const tr=state.tr.insert(position,state.schema.nodes.paragraph.create());dispatch(tr.setSelection(TextSelection.create(tr.doc,position+1)).scrollIntoView());}
  return true;
};
export function codeExitKeys(ctx: Ctx) {
  const backspace=(code:CodeView)=>{
    const selected=code.state.selection.main,view=ctx.get(editorViewCtx);
    if(code.state.selection.ranges.length!==1||!selected.empty||selected.head!==0||code.state.doc.lines!==1||code.compositionStarted||view.composing||!view.editable)return false;
    let position:number|undefined;
    view.state.doc.descendants((node,pos)=>{
      if(position!==undefined)return false;
      if(['code_block','math_block'].includes(node.type.name)&&view.nodeDOM(pos)?.contains(code.dom)&&node.textContent===code.state.doc.toString())position=pos;
      return position===undefined;
    });
    if(position===undefined)return false;
    const node=view.state.doc.nodeAt(position)!;
    const tr=view.state.tr.replaceWith(position,position+node.nodeSize,view.state.schema.nodes.paragraph.create({},node.content));
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc,position+1)).scrollIntoView());focusEditorSelection(view, 'edit');
    return true;
  };
  const leave = (code: CodeView) => {
    if (!code.state.selection.main.empty) return false;
    const view = ctx.get(editorViewCtx);
    let position: number | undefined;
    view.state.doc.descendants((node, pos) => {
      if (position !== undefined) return false;
      if (!['code_block','math_block'].includes(node.type.name)) return;
      const dom = view.nodeDOM(pos);
      if (dom?.contains(code.dom)) position = pos;
      return false;
    });
    return position !== undefined && leaveCodeBlock(view, position);
  };
  const before = (code:CodeView,line:boolean) => {
    const selected=code.state.selection.main,view=ctx.get(editorViewCtx);
    if(!selected.empty||code.compositionStarted||view.composing
      ||(line?code.state.doc.lineAt(selected.head).from:selected.head)>0)return false;
    let position:number|undefined;
    view.state.doc.descendants((node,pos)=>{
      if(position===undefined&&['code_block','math_block'].includes(node.type.name)&&view.nodeDOM(pos)?.contains(code.dom))position=pos;
      return position===undefined;
    });
    if(position===undefined)return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position),-1)).scrollIntoView());
    focusEditorSelection(view,'edit');return true;
  };
  return [CodeView.domEventHandlers({beforeinput:(event,code)=>event.inputType==='deleteContentBackward'&&!event.isComposing&&backspace(code)}),Prec.highest(keymap.of([
    {key:'Backspace',run:backspace},
    {key:'ArrowUp',run:code=>before(code,true)},
    {key:'ArrowLeft',run:code=>before(code,false)},
    {
      key: 'ArrowDown',
      run: code =>
        code.state.doc.lineAt(code.state.selection.main.head).to === code.state.doc.length
        && leave(code),
    },
    {
      key: 'ArrowRight',
      run: code => code.state.selection.main.head === code.state.doc.length && leave(code),
    },
    { key: 'Mod-Enter', run: leave },
  ]))];
}

export const tableDeleteKeys = $prose(() =>
  new Plugin({
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          if (view.composing || event.isComposing || !['Backspace', 'Delete'].includes(event.key)) {
            return false;
          }
          const selection = view.state.selection,
            whole = selection instanceof NodeSelection && selection.node.type.name === 'table'
              || selection instanceof CellSelection && selection.isRowSelection()
                && selection.isColSelection();
          if (!whole || !deleteTable(view.state, view.dispatch)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  })
);
