import {isHistoryTransaction} from '@milkdown/kit/prose/history';
import {Plugin,PluginKey} from '@milkdown/kit/prose/state';
import type {EditorView} from '@milkdown/kit/prose/view';
import {$prose} from '@milkdown/kit/utils';
import {focusEditorSelection} from './selectionOwnership';
import {mayFocusSelection} from './codeSelection';

// A history transaction can replace a code node view while restoring a text
// selection inside it. Reconcile that selection after the replacement DOM
// exists, for toolbar, keyboard and IME history commands alike.
export const mobileHistorySelection=$prose(()=>{
  const key=new PluginKey<{revision:number;focus:boolean}>('mobileHistorySelection');
  let editor:EditorView|undefined;
  return new Plugin({
    key,
    state:{
      init:()=>({revision:0,focus:false}),
      apply(tr,previous){
        if(!isHistoryTransaction(tr))return previous;
        const mobile=editor?.dom.closest('.mobile-app');
        return{revision:previous.revision+1,focus:!!mobile&&mayFocusSelection(editor!,'history')};
      },
    },
    view(view){
      editor=view;let revision=key.getState(view.state)!.revision;
      return{
        update(view){
          const next=key.getState(view.state)!;if(next.revision===revision)return;
          revision=next.revision;
          if(next.focus)focusEditorSelection(view,'history');
        },
        destroy(){editor=undefined;},
      };
    },
  });
});
