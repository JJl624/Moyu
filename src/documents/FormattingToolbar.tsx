import {
  Bold,
  ChevronDown,
  Code2,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  PencilLine,
  Music2,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Type,
  Undo2,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { EditorAction } from '../editorTypes';

interface FormattingToolbarProps {
  menu: 'document' | 'format' | 'insert' | null;
  setMenu: Dispatch<SetStateAction<FormattingToolbarProps['menu']>>;
  doAction(action: EditorAction): void;
  drawingAllowed: boolean;
  onDrawing(): void;
  onScore(): void;
}

export function FormattingToolbar({ menu, setMenu, doAction, drawingAllowed, onDrawing, onScore }: FormattingToolbarProps) {
  return (
    <div className='formatbar'>
      <div className='popover-anchor'>
        <button
          className='format-select'
          onClick={() => setMenu((previous) => previous === 'format' ? null : 'format')}
        >
          <Type size={15} />
          文本格式
          <ChevronDown size={12} />
        </button>
        {menu === 'format' && (
          <div className='popover-menu'>
            <button onClick={() => doAction('h1')}>
              H1<span>一级标题</span>
            </button>
            <button onClick={() => doAction('h2')}>
              H2<span>二级标题</span>
            </button>
            <button onClick={() => doAction('h3')}>
              H3<span>三级标题</span>
            </button>
            <button onClick={() => doAction('quote')}>
              <Quote size={15} />
              引用
            </button>
          </div>
        )}
      </div>
      <span className='toolbar-divider' />
      {(
        [
          {
            action: 'bold',
            label: '加粗',
            icon: <Bold size={16} />,
          },
          {
            action: 'italic',
            label: '斜体',
            icon: <Italic size={16} />,
          },
          {
            action: 'strike',
            label: '删除线',
            icon: <Strikethrough size={16} />,
          },
          {
            action: 'code',
            label: '行内代码',
            icon: <Code2 size={16} />,
          },
          {
            action: 'bullet',
            label: '无序列表',
            icon: <List size={17} />,
          },
          {
            action: 'ordered',
            label: '有序列表',
            icon: <ListOrdered size={17} />,
          },
          {
            action: 'task',
            label: '待办清单',
            icon: <ListTodo size={17} />,
          },
        ] as {
          action: EditorAction;
          label: string;
          icon: React.ReactNode;
        }[]
      ).map((item) => (
        <button
          key={item.action}
          className='icon-button'
          title={item.label}
          aria-label={item.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => doAction(item.action)}
        >
          {item.icon}
        </button>
      ))}
      <span className='toolbar-divider' />
      <div className='popover-anchor'>
        <button
          className='insert-button'
          onClick={() => setMenu((previous) => previous === 'insert' ? null : 'insert')}
        >
          <Plus size={15} />
          插入
          <ChevronDown size={12} />
        </button>
        {menu === 'insert' && (
          <div className='popover-menu'>
            <button onClick={() => doAction('table')}>
              <Table2 size={16} />
              表格
            </button>
            <button onClick={() => doAction('codeblock')}>
              <Code2 size={16} />
              代码块
            </button>
            <button
              disabled={!drawingAllowed}
              title={drawingAllowed ? '插入空白绘图' : '在正文中插入绘图链接'}
              onClick={() => {
                setMenu(null);
                onDrawing();
              }}
            >
              <PencilLine size={16} />Excalidraw 绘图
            </button>
            <button disabled={!drawingAllowed} onClick={()=>{setMenu(null);onScore();}}><Music2 size={16}/>乐谱</button>
          </div>
        )}
      </div>
      <div className='formatbar-spacer' />
      <button
        className='icon-button'
        aria-label='撤销'
        title='撤销'
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => doAction('undo')}
      >
        <Undo2 size={15} />
      </button>
      <button
        className='icon-button'
        aria-label='重做'
        title='重做'
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => doAction('redo')}
      >
        <Redo2 size={15} />
      </button>
    </div>
  );
}
