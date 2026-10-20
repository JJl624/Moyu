import { TableNodeView } from '@milkdown/kit/component/table-block';
import { tableSchema } from '@milkdown/kit/preset/gfm';
import { $view } from '@milkdown/kit/utils';

export class EditingTableNodeView extends TableNodeView {
  stopEvent(event:Event){
    if((event.type==='mousedown'||event.type==='pointerdown')&&event.target instanceof Element){
      const cell=event.target.closest('td,th');
      // Let ProseMirror place a text caret (or drag a cell range) directly.
      // Table chrome and its row/column controls keep the component handlers.
      if(cell&&this.contentDOM.contains(cell)&&!event.target.closest('button'))return false;
      // A handle click must not let the editor clear a cell range on mousedown:
      // that rebuilds the handle before its click handler can select the row.
      // Keep native drag events available to the table component.
      if(event.target.closest('[data-role="row-drag-handle"],[data-role="col-drag-handle"]'))return true;
    }
    return super.stopEvent(event);
  }
}
export const editingTableView=$view(tableSchema.node,ctx=>(node,view,getPos)=>new EditingTableNodeView(ctx,node,view,getPos));
