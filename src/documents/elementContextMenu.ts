import type { MouseEventHandler, RefObject } from 'react';
import { supportsRunArguments } from '../../shared/runtime-arguments.mjs';
import { wikiPath } from '../../shared/wiki-links.mjs';
import { codeId } from '../../shared/code-documents.mjs';
import { api } from '../bridge';
import { canonicalLanguage, codeBlocks, codeKey, formattable, runnable } from '../codeBlocks';
import { formatCode } from '../CodeFormatting';
import type { CodeContext, EditorAction, EditorHandle } from '../editorTypes';
import type { ElementMenuState, MenuAction } from '../ElementMenu';
import { isImage } from '../ImageViewer';
import { readableHref, relativeLink } from '../markdownLinks';
import { isPreviewResource, resourcePath } from '../resourcePreview';
import { displayName, type FileNode } from '../types';
import type { CodeRuns } from '../useCodeRuns';

interface Dependencies {
 editor: RefObject<EditorHandle | null>;
 ws: { active: string; tabs: string[] };
 mode: 'rich' | 'source' | 'read';
 files: FileNode[];
 markdownValue: string;
 codeRuns: CodeRuns;
 safe(action: () => Promise<unknown>): Promise<void>;
 notify(message: string): void;
 closeDocuments(paths: string[]): Promise<void>;
 openDocument(path: string, preview?: boolean): Promise<boolean>;
 showRename(path: string): void;
 showAttachmentTrash(path: string, target: HTMLElement, coords: {left:number;top:number}): void;
 imagePath(image: HTMLImageElement): string;
 setRightbar(value: boolean): void;
 setRightTab(value: 'data'): void;
 setDataReveal(update: (previous: {key:string;request:number}) => {key:string;request:number}): void;
 createDrawing(insertInNote?: boolean): Promise<void>;
 setContext(value: null): void;
 setElementMenu(menu: ElementMenuState): void;
}
export function createElementContextMenu({editor, ws, mode, files, markdownValue, codeRuns, safe, notify, closeDocuments, openDocument, showRename, showAttachmentTrash, imagePath, setRightbar, setRightTab, setDataReveal, createDrawing, setContext, setElementMenu}: Dependencies): MouseEventHandler<HTMLDivElement> {
 return event => {
        if ((event.target as Element).closest('.document-history-view')) return;
        if((event.target as Element).closest('.terminal-panel'))return;
        const target = event.target as HTMLElement;
        if (target.closest('.tree-row,.excalidraw,.element-menu')) return;
        if (target.closest('button,select') && !target.closest('.tab')) return;
        const preview = target.closest<HTMLElement>('.attachment-overlay');
        const actions: MenuAction[] = [],
          field = target.closest('input,textarea') as HTMLInputElement | HTMLTextAreaElement | null;
        const editorContext = editor.current?.prepareContext?.(target, { left: event.clientX, top: event.clientY });
        const selected = editorContext?.text ?? window.getSelection()?.toString() ?? '';
        const fieldSelection = field ? { from: field.selectionStart, to: field.selectionEnd } : null;
        const write = (text: string) =>
          void safe(() =>
            api.desktop
              ? api.feature('clipboard.write', { text })
              : navigator.clipboard.writeText(text)
          );
        const edit = (command: string) => {
          if (field) {
            field.focus({ preventScroll: true });
            if (fieldSelection?.from !== null && fieldSelection?.to !== null) {
              try { field.setSelectionRange(fieldSelection!.from, fieldSelection!.to); } catch {}
            }
          } else if (!editorContext?.restore()) {
            notify('编辑位置已改变，请重新打开菜单。');
            return;
          }
          void safe(() => api.feature('editing.command', { command }));
        };
        const apply = (action: EditorAction | import('../editorTypes').BlockAction) => {
          if (!editorContext?.run(action)) notify('此处无法执行该操作，请重新打开菜单。');
        };
        const rich = mode === 'rich' && !!target.closest('.ProseMirror');
        const editableRich = mode === 'rich' && (!!target.closest('.ProseMirror') || !!preview);
        const output = target.closest('.code-result'),
          tab = target.closest('.tab'),
          resource = target.closest<HTMLElement>(
            '.inline-syntax,.reading-view [data-resource-link]',
          );
        const visualResource = preview
          ? target.closest<HTMLElement>('[data-resource-link]') || preview
          : resource?.closest('.reading-view')
          ? resource
          : null;
        const linkedAttachment = visualResource
          ? {
            href: visualResource.dataset.resourceLink || '',
            label: visualResource.dataset.resourceLabel || '附件',
            image: visualResource.dataset.resourceImage === 'true'
              || !!visualResource.querySelector('img'),
            wiki: false,
            raw: visualResource.dataset.resourceRaw
              || `[${visualResource.dataset.resourceLabel || '附件'}](${
                visualResource.dataset.resourceLink || ''
              })`,
          }
          : mode !== 'read'
          ? editor.current?.attachmentAt?.(target, { left: event.clientX, top: event.clientY })
          : null;
        const math = target.closest('.math-block,.reading-view .katex-display');
        const image = target.closest('img');
        const anchor = target.closest('a'),
          table = target.closest('table')
            || target.closest('.milkdown-table-block')?.querySelector('table.children'),
          heading = target.closest('h1,h2,h3,h4,h5,h6'),
          list = target.closest('li,.milkdown-list-item-block'),
          quote = target.closest('blockquote');
        let code: CodeContext | null = target.closest('.milkdown-code-block,.source-editor')
          ? editor.current?.codeAt?.(target) || null
          : null;
        const pre = target.closest('.code-block-shell')?.querySelector('pre > code');
        if (pre) {
          code = {
            language: pre.className.match(/language-([^ ]+)/)?.[1] || '',
            code: pre.textContent?.replace(/\n$/, '') || '',
            id:codeId(pre.parentElement?.dataset.codeMeta||''),meta:pre.parentElement?.dataset.codeMeta||'',
          };
        }
        const tabbed = target.closest<HTMLElement>('[data-tabbed-code]');
        if (tabbed && mode === 'read') {code = {
            language: 'tabs',
            code: tabbed.dataset.codeRaw || '',
          };}
        if (field) {
          const text = field.value.slice(
            field.selectionStart ?? 0,
            field.selectionEnd ?? field.value.length,
          );
          actions.push({ id: 'copy', label: '复制', disabled: !text, action: () => write(text) });
          if (!field.readOnly && !field.disabled) {
            actions.push({
              id: 'cut', label: '剪切',
              disabled: !text,
              action: () => edit('cut'),
            }, { id: 'paste', label: '粘贴', action: () => edit('paste') });
          }
          actions.push({ id: 'selectAll', label: '全选', action: () => edit('selectAll') });
        } else if (target.closest('.text-file-editor')) {
          const text=selected;
          const readOnly=files.some(file=>file.path===ws.active&&file.system);
          actions.push({id: 'copy', label:'复制',disabled:!text,action:()=>write(text)});
          if(!readOnly)actions.push({id: 'cut', label:'剪切',disabled:!text,action:()=>edit('cut')},{id: 'paste', label:'粘贴',action:()=>edit('paste')});
          actions.push({id: 'selectAll', label:'全选',action:()=>edit('selectAll')});
        } else if (target.closest('.pdf-viewer')) {
          if(selected)actions.push({id: 'copy', label:'复制',action:()=>write(selected)});
        } else if (output) {
          const selection = window.getSelection(),
            part =
              selection?.anchorNode && selection.focusNode && output.contains(selection.anchorNode)
                && output.contains(selection.focusNode)
                ? selected
                : '';
          const artifact = target.closest('.run-artifact');
          const clickedText = target.closest('pre')?.textContent || '';
          if (part || clickedText || (!artifact && output.querySelector('pre')?.textContent)) actions.push({
            id:'copy', label: artifact ? '复制文本' : '复制运行结果',
            action: () => write(part || clickedText || output.querySelector('pre')?.textContent || ''),
          });
          const text = output.querySelector('pre')?.textContent || '';
          if (text && !artifact) {
            actions.push({
              id: 'save.file', label: '保存结果为文本文件',
              action: () =>
                void safe(() =>
                  api.feature('code.export', {
                    name: displayName(ws.active) + '-运行结果.txt',
                    bytes: new TextEncoder().encode(text),
                  })
                ),
            }, {
              id: 'save.attachment', label: '保存文本到附件',
              action: () =>
                void safe(async () => {
                  const result = await api.feature<{ path: string }>('attachment.upload', {
                    document: ws.active,
                    name: displayName(ws.active) + '-运行结果.txt',
                    bytes: new TextEncoder().encode(text),
                  });
                  notify('已保存到 ' + result.path);
                }),
            });
          }
        } else if (tab) {
          const path = tab.querySelector('.tab-name')?.getAttribute('title');
          if (path) {
            const index = ws.tabs.indexOf(path),
              others = ws.tabs.filter(tab => tab !== path),
              left = ws.tabs.slice(0, index),
              right = ws.tabs.slice(index + 1);
            actions.push({ id: 'copy', label: '复制文件路径', action: () => write(path) }, {
              id: 'close.others', label: '关闭其他',
              disabled: !others.length,
              action: () => void safe(() => closeDocuments(others)),
            }, {
              id: 'close.left', label: '关闭左侧',
              disabled: !left.length,
              action: () => void safe(() => closeDocuments(left)),
            }, {
              id: 'close.right', label: '关闭右侧',
              disabled: !right.length,
              action: () => void safe(() => closeDocuments(right)),
            });
          }
        } else if (math) {
          actions.push({ id: 'copy', label: '复制公式', action: () => write(selected || math.querySelector('annotation[encoding="application/x-tex"]')?.textContent || math.querySelector('.cm-content')?.textContent || '') });
        } else if (linkedAttachment || resource) {
          if (rich && resource && !resource.classList.contains('editing')) {
            editor.current
              ?.selectAt?.(resource);
          }
          if (linkedAttachment) {
            const { href, raw } = linkedAttachment,
              path = linkedAttachment.wiki
                ? wikiPath(ws.active, href, files)
                : resourcePath(ws.active, href);
            if (path && isPreviewResource(href)) {
              actions.push({
                id: 'open', label: '编辑绘图',
                action: () => void safe(() => openDocument(path)),
              });
            } else if (path) {
              actions.push({
                id:'open', label: linkedAttachment.image || isImage(path)
                  ? '查看图片'
                  : /\.(md|markdown)$/i.test(path)
                  ? '打开链接'
                  : '打开附件',
                action: () => void safe(() => openDocument(path)),
              });
            } else if (/^(https?:|mailto:)/i.test(href)) {
              actions.push({
                id: 'open', label: '打开链接',
                action: () => void safe(() => api.openExternal(href)),
              });
            }
            if (path) {
              actions.push({ id:'rename', label: /\.(md|markdown)$/i.test(path) ? '重命名文件' : '重命名附件', action: () => showRename(path) }, {
                id: 'reveal', label: '在文件夹中显示',
                action: () => void safe(() => api.reveal(path)),
              });
              if (!/\.(md|markdown)$/i.test(path)) actions.push({ id: 'delete', label: '删除附件', action: () => showAttachmentTrash(path, target, { left: event.clientX, top: event.clientY }) });
            }
            actions.push({ id: 'copy.link', label: '复制链接', action: () => write(raw) }, {
              id: 'link.address', label: '复制链接地址',
              action: () => write(readableHref(href)),
            });
          }
          if (mode !== 'read' && !preview) {
            actions.push({
              id: 'copy', label: '复制文本',
              disabled: !selected,
              action: () => write(selected),
            }, {
              id: 'cut', label: '剪切',
              disabled: !selected,
              action: () => edit('cut'),
            }, { id: 'paste', label: '粘贴', action: () => edit('paste') });
          }
        } else if (image) {
          const path = imagePath(image);
          actions.push({ id: 'link.image', label: '复制图片路径', action: () => write(path || image.src) });
          if (image.alt) actions.push({ id: 'copy.description', label: '复制图片说明', action: () => write(image.alt) });
          if (path) {
            actions.push({
              id: 'open', label: '查看图片',
              action: () => void safe(() => openDocument(path)),
            }, {
              id: 'rename', label: '重命名附件',
              action: () => showRename(path),
            }, { id: 'reveal', label: '在文件夹中显示图片', action: () => void safe(() => api.reveal(path)) }, {
              id: 'delete', label: '删除附件', action: () => showAttachmentTrash(path, target, { left: event.clientX, top: event.clientY }),
            });
          }
        } else if (code) {
          const c = code;
          const formatting = c.tab || c;
          actions.push({ id: 'copy', label: '复制代码', action: () => write(formatting.code) });
          if(c.id || runnable(c.language))actions.push({id: 'code.data', label:'查看数据目录',action:()=>{
            const original=codeBlocks(markdownValue).find(b=>c.id ? b.id===c.id : c.start!==undefined?b.start===c.start:b.language.toLowerCase()===c.language.toLowerCase()&&b.code===c.code);
            const id=c.id || original?.id,scope=codeRuns.scopeFor(id || (original ? codeKey(original):undefined));
            setRightbar(true);setRightTab('data');
            const key=canonicalLanguage(c.language)==='SQL'&&scope==='global'?'SQL_GLOBAL':id || 'pending-'+original?.start;
            setDataReveal(previous=>({key,request:previous.request+1}));
          }});



          if (mode !== 'read' && formattable(formatting.language)) {
            actions.push({
              id: 'code.format', label: '格式化代码',
              disabled: codeRuns.busy,
              action: () =>
                void safe(async () => {
                  const result = await formatCode(formatting.language, formatting.code);
                  if (!editor.current?.replaceCode?.(target, result, c.code, c.tab?.index)) {
                    throw new Error('代码块已改变，请重新格式化。');
                  }
                  editor.current.flush();
                }),
            });
          }
          if (mode !== 'source' && runnable(c.language)) {
            actions.push({
              id: 'code.run', label: '运行代码块',
              disabled: codeRuns.busy,
              action: () =>
                window.dispatchEvent(
                  new CustomEvent('moyu-run-code', { detail: { ...c, target } }),
                ),
            });
          }
          if (mode !== 'source' && runnable(c.language) && supportsRunArguments(c.language)) {
            actions.push({id: 'code.arguments', label:'运行（参数）',disabled:codeRuns.busy,action:()=>window.dispatchEvent(new CustomEvent('moyu-run-code-arguments',{detail:{...c,target}}))});
          }
        } else if (anchor?.getAttribute('href')) {
          const href = anchor.getAttribute('href')!;
          const linked = relativeLink(ws.active, href);
          if (linked && files.some(f => f.path === linked)) {
            actions.push({ id:'rename', label: /\.(md|markdown)$/i.test(linked) ? '重命名文件' : '重命名附件', action: () => showRename(linked) });
            if (!/\.(md|markdown)$/i.test(linked)) actions.push({
              id: 'delete', label: '删除附件', action: () => showAttachmentTrash(linked, target, { left: event.clientX, top: event.clientY }),
            });
          }
          actions.push({
            id: 'open', label: '打开链接',
            action: () => {
              if (/^(https?:|mailto:)/i.test(href)) void api.openExternal(href);
              else {
                const path = relativeLink(ws.active, href);
                if (path) void openDocument(path);
              }
            },
          }, {
            id: 'link.address', label: '复制链接地址',
            action: () => write(readableHref(href)),
          }, {
            id: 'copy.label', label: '复制链接文字',
            action: () => write(anchor.textContent || ''),
          });
        } else if (table) {
          const cell = target.closest('td,th');
          if (cell) actions.push({
            id: 'copy', label: '复制单元格',
            action: () => write(selected || editorContext?.textFor('cell') || target.closest<HTMLElement>('td,th')?.innerText || ''),
          });
          actions.push({
            id: 'table.copy', label: '复制表格文本',
            action: () =>
              write(
                editorContext?.textFor('table') || [...table.rows].map(row => [...row.cells].map(cell => cell.innerText).join('\t'))
                  .join('\n'),
              ),
          });
          if (rich) {
            if (cell) actions.push(
              { id: 'table.rowAfter', label: '在下方插入行', action: () => apply('rowAfter') },
              { id: 'table.columnAfter', label: '在右侧插入列', action: () => apply('columnAfter') },
              { id: 'table.deleteRow', label: '删除当前行', action: () => apply('deleteRow') },
              {
                id: 'table.deleteColumn', label: '删除当前列',
                action: () => apply('deleteColumn'),
              },
            );
            actions.push({ id: 'table.select', label: '选中表格', action: () => apply('selectTable') }, { id: 'table.deleteTable', label: '删除表格', action: () => apply('deleteTable') });
          }
        } else if (heading) {
          actions.push({
            id: 'copy', label: '复制标题',
            action: () => write(selected || editorContext?.textFor('heading') || (heading as HTMLElement).innerText || ''),
          });
        } else if (list) {
          actions.push({
            id: 'copy', label: '复制列表项',
            action: () => write(selected || editorContext?.textFor('list_item') || (list as HTMLElement).innerText || ''),
          });
          if (rich) {
            actions.push({ id: 'indent', label: '增加缩进', disabled: !editorContext?.can('indent'), action: () => apply('indent') }, {
              id: 'outdent', label: '减少缩进',
              disabled: !editorContext?.can('outdent'),
              action: () => apply('outdent'),
            });
          }
        } else if (quote) {
          actions.push({
            id: 'copy', label: '复制引用',
            action: () => write(selected || editorContext?.textFor('blockquote') || (quote as HTMLElement).innerText || ''),
          });
        } else if (target.closest('.ProseMirror,.source-editor,.reading-view')) {
          const text = selected || editorContext?.textFor('paragraph') || target.closest<HTMLElement>('p,.cm-line')?.innerText || '';
          if (text) actions.push({ id: 'copy', label: '复制文本', action: () => write(text) });
          if (mode !== 'read' && /\.(md|markdown)$/i.test(ws.active)) {
            actions.push({ id: 'cut', label: '剪切', disabled: !selected, action: () => edit('cut') }, {
              id: 'paste', label: '粘贴',
              action: () => edit('paste'),
            });
          }
        }
        if(selected && editorContext && !output && !field && !code && !math && (rich || mode==='source' && target.closest('.source-editor'))){
          for(const [action,label] of [['bold','加粗'],['italic','斜体'],['strike','删除线'],['code','行内代码'],['highlight','高亮'],['underline','下划线'],['link','链接'],['math','行内公式']] as const){
            if(editorContext.can(action))actions.push({id:'format.'+action,label,checked:!!editorContext.active?.(action),action:()=>apply(action)});
          }
        }
        if(editableRich && !output && !field){
          if(!table && editorContext?.can('quote'))actions.push({id: 'quote', label:'引用',action:()=>apply('quote')});
          const resourceBlock = table || code || math || preview || resource?.classList.contains('visual-attachment');
          if(resourceBlock && editor.current?.canIndentIntoList?.(target))
            actions.push({id: 'indent', label:'缩进至列表',action:()=>editor.current?.indentIntoList?.(target)});
          if(resourceBlock && editor.current?.canOutdentFromList?.(target))
            actions.push({id: 'outdent', label:'脱离列表',action:()=>editor.current?.outdentFromList?.(target)});
        }
        if (rich && quote && !output && !field && !table && editorContext?.can('unquote')) {
          actions.push({ id: 'unquote', label: '去除一层引用', action: () => apply('unquote') });
        }
        const paragraph = target.closest('.ProseMirror p');
        if (
          rich && paragraph && !target.closest('code,.inline-syntax') && !code
          && !resource && !output && !table && !math && !target.closest('.code-ui')
          && editorContext?.canInsertDrawing
        ) {
          actions.push({
            id: 'insert.drawing', label: '插入空白 Excalidraw 绘图',
            action: () => {
              if (!editorContext.restore()) { notify('编辑位置已改变，请重新打开菜单。'); return; }
              void safe(() => createDrawing(true));
            },
          });
        }
        if(table&&rich){
          const insert=actions.filter(a=>a.id==='table.rowAfter'||a.id==='table.columnAfter');
          const remove=actions.filter(a=>['table.deleteRow','table.deleteColumn','table.deleteTable'].includes(a.id||''));
          const nest=(items:MenuAction[],id:string,label:string)=>{
            if(!items.length)return;const index=actions.indexOf(items[0]);
            for(const item of items)actions.splice(actions.indexOf(item),1);
            actions.splice(index,0,{id,label,children:items});
          };
          nest(insert,'table.insert','插入');nest(remove,'table.delete','删除');
        }
        if (!actions.length) return;
        event.preventDefault();
        setContext(null);
        setElementMenu({
          x: event.clientX,
          y: event.clientY,
          actions,
          preview: preview ?? undefined,
        });
      };
}
