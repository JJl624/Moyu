import {codeId,withAttribute} from '../shared/code-documents.mjs';
import { foldingQuoteRemark, foldingQuoteSchema, foldingQuotes } from './editor/foldingQuotes';
import {stableCodeIds, codeIdTransaction, exhaustedIdsMessage} from './editor/codeIds';
import { EditorView as CodeView } from '@codemirror/view';
import { Crepe } from '@milkdown/crepe';
import { codeBlockConfig, codeBlockView } from '@milkdown/kit/component/code-block';
import { tableBlockView } from '@milkdown/kit/component/table-block';
import { editingTableView } from './editor/tableEditing';
import type { Ctx } from '@milkdown/kit/ctx';
import { toggleLinkCommand as toolbarLinkCommand } from '@milkdown/kit/component/link-tooltip';
import {
  commandsCtx,
  editorViewCtx,
  parserCtx,
  remarkCtx,
  serializerCtx,
  remarkStringifyOptionsCtx,
} from '@milkdown/kit/core';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { trailingConfig } from '@milkdown/kit/plugin/trailing';
import { uploadPlugin } from '@milkdown/kit/plugin/upload';
import {
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  imageSchema,
  inlineCodeInputRule,
  insertHrCommand,
  insertImageCommand,
  insertImageInputRule,
  paragraphSchema,
  syncListOrderPlugin,
  strongInputRule,
  turnIntoTextCommand,
  updateImageCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInHeadingInputRule,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { insertTableCommand, strikethroughInputRule } from '@milkdown/kit/preset/gfm';
import { type Node, Slice } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { callCommand, insert, $remark } from '@milkdown/kit/utils';
import remarkDocumentStructure from '../shared/remark-document-structure.mjs';
const documentStructure=$remark('moyuDocumentStructure',()=>remarkDocumentStructure);
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import katex from 'katex';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { parseCodeTabs, replaceTabCode } from './codeTabs';
import { codeExitKeys, tableDeleteKeys } from './editor/blockNavigation';
import {codeBoundaryIme} from './editor/codeBoundaryIme';
import { codeAttributes, resizeCodeBlocks } from './editor/codeHeight';
import { codeContextAt } from './editor/codeIndex';
import { canInsertInlineDrawing } from './editor/drawingInsertion';
import { asyncDrawingInsert, prepareDrawingInsert } from './editor/asyncDrawingInsert';
import { prepareAttachmentDeletion } from './editor/attachmentDeletion';
import { documentTail } from './editor/documentTail';
import { selectionGesture } from './editor/selectionGesture';
import { indentPlugin } from '@milkdown/kit/plugin/indent';
import { inlinePaste } from './editor/inlinePaste';
import {resourceBlockPosition,indentBlockIntoList,outdentBlockFromList} from './editor/listContinuation';
import { contextCommands, prepareRichContext,richSelectionContext } from './editor/contextCommands';
import {
  headingSource,
  installHeadingCommands,
  sourceHeadingInputRule,
  sourceHeadings,
} from './editor/headingSource';
import { imagePaste } from './editor/imagePaste';
import { formatInline, inlineFormatting, installInlineCommands } from './editor/inlineFormatting';
import {mathRemark} from './editor/inlineMath';
import {displayMathSchema,displayMathView,displayMathInput} from './editor/displayMath';
import { inlinePresentation } from './editor/inlinePresentation';
import { inlineMarkdownHandlers,emptyParagraphJoin } from './editor/inlineSerialization';
import { DocumentSession } from './editor/documentSession';
import { insertMenu } from './editor/insertMenu';
import {
  headingListItems,
  stableListItemView,
  syncListTextSelection,
  consistentListOrder,
} from './editor/listExtensions';
import {
  resourceInput,
  resourceKeys,
  resourceSchema,
  resourceSources,
  resourceView,
} from './editor/resources';
import { tabbedCodeView } from './editor/tabbedCode';
import { captureRichSelection, restoreRichSelection } from './editor/viewSelection';
import {focusEditorSelection} from './editor/selectionOwnership';
import {resourceSelection} from './editor/resourceSelection';
import {prepareFormula} from './editor/formulaEditing';
import {structuralViewport} from './editor/structuralViewport';
import {mobileHistorySelection} from './editor/mobileHistorySelection';
import { fromMarkdownSelection,toMarkdownSelection } from './editor/selection';
import type { EditorHandle, EditorProps } from './editorTypes';
import type { CodeContext } from './editorTypes';
import { codeHighlight, languages } from './highlight';
import { codeIndentation } from './editor/codeIndentation';
import { htmlCommentSchema, htmlCommentKeys } from './editor/htmlComments';
import { inlineLinkAt } from './inlineSyntax';
import { containsDrawingLink } from './markdownLinks';
import { mermaidPreview } from './Mermaid';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

// Attachments have a single document representation: editable Markdown source.
// Remove the atom schema and every stock insertion route, rather than retaining
// an inactive image node with a different selection and clipboard model.
const ordinaryEmptyParagraphs = paragraphSchema.extendSchema(previous => ctx => {
  const schema = previous(ctx);
  return {
    ...schema,
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        if (!node.content.size && state.top()?.type === 'root') {
          state.openNode('paragraph');
          state.closeNode();
        } else schema.toMarkdown.runner(state, node);
      },
    },
  };
});

const Inner = forwardRef<EditorHandle, EditorProps>(function Inner(props, ref) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const documentSession = useRef<DocumentSession | null>(null);
  const documentMarkdown = (ctx: Ctx, current: Node) =>
    documentSession.current?.read(current, callbacks.current.savedValue) ?? ctx.get(serializerCtx)(current);
  const publishDocument = (ctx: Ctx) => documentSession.current?.publish(
    ctx.get(editorViewCtx).state.doc, callbacks.current.savedValue,
    callbacks.current.value, callbacks.current.onChange,
  );
  const identityReady = useRef(false);
  const stopRestore = useRef<() => void>(() => {});
  useEffect(() => () => stopRestore.current(), []);
  const drawingAllowed = (view: import('@milkdown/kit/prose/view').EditorView) =>
    !!view?.state && canInsertInlineDrawing(view.state);
  const { get, loading } = useEditor(
    (root) => {
      identityReady.current = false;
      documentSession.current = null;
      const crepe = new Crepe({
        root,
        defaultValue: props.value,
        features: {
          [Crepe.Feature.ListItem]: false,
          [Crepe.Feature.Latex]: false,
          [Crepe.Feature.ImageBlock]: false,
          [Crepe.Feature.LinkTooltip]: false,
          [Crepe.Feature.BlockEdit]: false,
          [Crepe.Feature.Placeholder]: false,
          [Crepe.Feature.Toolbar]: false,
        },
        featureConfigs: {
          [Crepe.Feature.Cursor]: { virtual: false },
          [Crepe.Feature.CodeMirror]: {
            languages,
            extensions: [codeHighlight, codeIndentation(), ...(props.codeWrap ? [CodeView.lineWrapping] : [])],
            renderPreview: (language, content, apply) =>
              language.toLowerCase() === 'mermaid'
                ? mermaidPreview(content, apply)
                : language.toLowerCase() === 'latex'
                ? katex.renderToString(content, { throwOnError: false, displayMode: true })
                : null,
            copyText: '复制代码',
            searchPlaceholder: '搜索语言',
            noResultText: '无匹配语言',
            previewToggleText: only => only ? '编辑' : '收起',
            previewLabel: '预览',
            previewLoading: '正在加载…',
          },
        },
      });
      void crepe.editor.remove([
        tableBlockView,
        ...imageSchema,
        uploadPlugin,
        insertImageCommand,
        updateImageCommand,
        insertImageInputRule,
        strongInputRule,
        emphasisStarInputRule,
        emphasisUnderscoreInputRule,
        inlineCodeInputRule,
        strikethroughInputRule,
        wrapInHeadingInputRule,
        codeBlockView,
        indentPlugin,
        syncListOrderPlugin,
      ]);
      crepe.editor
        .config(ctx =>
          ctx.update(
            remarkStringifyOptionsCtx,
            options => ({
              ...options,
              handlers: inlineMarkdownHandlers(options.handlers),
              join:[...(options.join||[]),emptyParagraphJoin],
            }),
          )
        )
        .config(ctx => {
          ctx.update(trailingConfig.key, value => ({ ...value, shouldAppend: () => false }));
          ctx.update(codeBlockConfig.key, value => ({
            ...value,
            renderPreview: (language, content, apply) =>
              language.toLowerCase() === 'mermaid'
                ? mermaidPreview(content, apply)
                : language.toLowerCase() === 'latex'
                ? katex.renderToString(content, { throwOnError: false, displayMode: true })
                : value.renderPreview(language, content, apply),
            extensions: [
              ...value.extensions,
              codeExitKeys(ctx),
            ],
          }));
        })
        .use(codeAttributes).use(stableCodeIds(props.root,props.path,()=>identityReady.current,message=>callbacks.current.onError(message))).use(tabbedCodeView).use(resizeCodeBlocks).use(
          insertMenu(() => callbacks.current.onDrawing?.(), () => callbacks.current.onScore?.()),
        ).use(asyncDrawingInsert)
        .use(mathRemark).use(displayMathSchema).use(displayMathView).use(displayMathInput).use(documentStructure).use(resourceSources).use(htmlCommentSchema).use(htmlCommentKeys).use(resourceSchema).use(
          resourceView(props.path),
        ).use(resourceKeys).use(resourceInput).use(toolbarLinkCommand).use(inlineFormatting).use(inlinePaste)
        .use(imagePaste(props.path, props.root, message => callbacks.current.onError(message)))
        .use(sourceHeadings).use(sourceHeadingInputRule).use(headingSource).use(inlinePresentation)
        .use(ordinaryEmptyParagraphs)
        .use(foldingQuoteRemark).use(foldingQuoteSchema).use(foldingQuotes)
        .use(headingListItems)
        .use(stableListItemView)
        .use(syncListTextSelection)
        .use(consistentListOrder)
        .use(mobileHistorySelection).use(structuralViewport)
        .use(tableDeleteKeys).use(codeBoundaryIme)
        .use(editingTableView)
        .use(documentTail).use(selectionGesture);
      crepe.on((listener) => {
        listener.selectionUpdated(ctx =>{callbacks.current.onDrawingAllowed?.(drawingAllowed(ctx.get(editorViewCtx)));callbacks.current.onContextChange?.();});
        listener.mounted((ctx) => {
          identityReady.current = true;
          installInlineCommands(ctx);
          installHeadingCommands(ctx);
          documentSession.current = new DocumentSession(props.value, ctx.get(editorViewCtx).state.doc, {
            parse: ctx.get(parserCtx), serialize: ctx.get(serializerCtx),
            spans: source => ctx.get(remarkCtx).parse(source).children.flatMap(node => {
              const from = node.position?.start.offset, to = node.position?.end.offset;
              return from === undefined || to === undefined ? [] : [{ from, to }];
            }),
          }, callbacks.current.savedValue);
          const view = ctx.get(editorViewCtx), selected = callbacks.current.selection;
          if (selected) {
            stopRestore.current();
            stopRestore.current = restoreRichSelection(view, callbacks.current.value, selected, callbacks.current.autoFocus !== false);
          } else {
            const host = view.dom.closest<HTMLElement>('.editor-host');
            if (host) delete host.dataset.editorPending;
          }
          window.dispatchEvent(new Event('moyu-code-dom'));
          callbacks.current.onDrawingAllowed?.(drawingAllowed(view));
          callbacks.current.onContextChange?.();
        });
        listener.updated(ctx => {
          callbacks.current.onContextChange?.();
          callbacks.current.onDrawingAllowed?.(drawingAllowed(ctx.get(editorViewCtx)));
          try { publishDocument(ctx); }
          catch (error) { callbacks.current.onError(error instanceof Error ? error.message : String(error)); }
          window.dispatchEvent(new Event('moyu-code-dom'));
        });
      });
      return crepe;
    },
    [props.path],
  );
  // The mounted callback can precede React publishing the ready editor handle.
  // Notify code controls again after that handle becomes usable.
  useEffect(() => {
    if (!loading) window.dispatchEvent(new Event('moyu-code-dom'));
  }, [loading, props.path]);
  useImperativeHandle(
    ref,
    () => ({
      selectionContext(){return !loading?get()?.action(ctx=>richSelectionContext(ctx.get(editorViewCtx)))||null:null;},
      prepareContext(target, coords) {
        if (loading) return null;
        return get()?.action(ctx => prepareRichContext(ctx.get(editorViewCtx), target, coords)) || null;
      },
      prepareAttachmentDelete(target, coords) {
        if (loading) return null;
        return get()?.action(ctx => prepareAttachmentDeletion(ctx.get(editorViewCtx), target, coords)) || null;
      },
      attachmentAt(target, coords) {
        let result: ReturnType<typeof inlineLinkAt> = null;
        if (!loading) {
          get()?.action(ctx => {
            const v = ctx.get(editorViewCtx),
              source = target.closest<HTMLElement>('.inline-syntax');
            if (!source) return;
            v.state.doc.descendants((node, pos) => {
              if (node.type.name === 'resource_link' && v.nodeDOM(pos) === source) {
                const link = target.closest<HTMLElement>('[data-link-offset]'),
                  at = link
                    ? Number(link.dataset.linkOffset)
                    : Math.max(0, (v.posAtCoords(coords)?.pos || pos + 1) - pos - 1);
                result = inlineLinkAt(node.textContent, at);
                return false;
              }
            });
          });
        }
        return result;
      },
      canInsertDrawing() {
        let allowed = false;
        if (!loading) {
          get()?.action(ctx => {
            allowed = drawingAllowed(ctx.get(editorViewCtx));
          });
        }
        return allowed;
      },
      prepareDrawingInsert() {
        if (loading) return null;
        return get()?.action(ctx => prepareDrawingInsert(ctx.get(editorViewCtx))) || null;
      },
      prepareFormula(target){return !loading?get()?.action(ctx=>prepareFormula(ctx.get(editorViewCtx),target))||null:null;},
      visibleOffset(){
        if(loading)return;
        return get()?.action(ctx=>{
          const v=ctx.get(editorViewCtx),scope=v.dom.closest('.document-scroll');if(!scope)return;
          const box=scope.getBoundingClientRect();let found:number|undefined;
          v.state.doc.descendants((node,pos)=>{
            if(found!==undefined)return false;if(!node.isTextblock)return true;
            const dom=v.nodeDOM(pos);if(!(dom instanceof HTMLElement))return false;
            const rect=dom.getBoundingClientRect();if(rect.bottom<=box.top+24||rect.top>=box.bottom)return false;
            const point=v.posAtCoords({left:rect.left+parseFloat(getComputedStyle(dom).paddingLeft)+4,top:Math.max(box.top+24,rect.top+2)});
            found=toMarkdownSelection(callbacks.current.value,v.state.doc,point?.pos??pos+1);return false;
          });return found;
        });
      },
      scrollToOffset(offset,options) {
        if(loading)return;
        get()?.action(ctx=>{const v=ctx.get(editorViewCtx),source=callbacks.current.value,pos=fromMarkdownSelection(source,v.state.doc,offset);
          stopRestore.current();
          const attachment=options?.selectAttachment?resourceSelection(v.state.doc,pos):null;
          const tr=v.state.tr.setSelection(attachment||TextSelection.between(v.state.doc.resolve(pos),v.state.doc.resolve(pos)));
          if(attachment){
            v.dispatch(tr);
            const source=v.nodeDOM(attachment.from) as HTMLElement|null;
            const preview=source?.dataset.attachmentPreview;
            (preview?v.dom.ownerDocument.getElementById(preview):source)?.scrollIntoView({block:'center'});
          }
          else if(options?.top===undefined)v.dispatch(tr.scrollIntoView());
          else{
            v.dispatch(tr);const scope=v.dom.closest('.document-scroll');
            const point=v.coordsAtPos(v.state.selection.head);if(scope)scope.scrollTop+=point.top-scope.getBoundingClientRect().top-options.top;
          }
          if(options?.focus!==false)focusEditorSelection(v, 'edit');
        });
      },
      scrollToCode(id) {
        if (!loading) {
          get()?.action(ctx => {
            const v = ctx.get(editorViewCtx);

            v.state.doc.descendants((node, pos) => {
              if (
                node.type.name !== 'code_block'
                || codeId(node.attrs.meta||'') !== id
              ) return;
              const dom = v.nodeDOM(pos) as HTMLElement | null;
              v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos + 1)));
              dom?.scrollIntoView({ block: 'center' });
              focusEditorSelection(v, 'edit');
            });
          });
        }
      },
      captureSelection() {
        const editor = get();
        if (!editor || loading) return null;
        return editor.action(ctx => {
          const v = ctx.get(editorViewCtx),
            md = documentMarkdown(ctx, v.state.doc);
          return captureRichSelection(v, md);
        });
      },
      restoreSelection(selected,options) {
        if (!loading) {
          get()?.action(ctx => {
            stopRestore.current();
            stopRestore.current = restoreRichSelection(
              ctx.get(editorViewCtx),
              callbacks.current.value,
              selected,
              options?.focus!==false,
              options?.viewport!==false,
            );
          });
        }
      },
      selectAt(target, coords) {
        const preview=target.closest<HTMLElement>('.attachment-overlay');
        const attachment = preview ? document.querySelector<HTMLElement>(`[data-attachment-preview="${preview.id}"]`) : target.closest('.inline-syntax');
        if (attachment && !loading) {
          get()?.action(ctx => {
            const v = ctx.get(editorViewCtx);
            v.state.doc.descendants((node, pos) => {
              if (node.type.name === 'resource_link' && v.nodeDOM(pos) === attachment) {
                v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos + 1)));
                focusEditorSelection(v, 'edit');
                return false;
              }
            });
          });
          return;
        }
        if (coords && !loading) {
          get()?.action(ctx => {
            const v = ctx.get(editorViewCtx), point = v.posAtCoords(coords);
            if (point) {
              v.dispatch(
                v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(point.pos))),
              );
              focusEditorSelection(v, 'edit');
            }
          });
          return;
        }
        if (!loading) {
          get()?.action(ctx => {
            const v = ctx.get(editorViewCtx);
            try {
              const table = target.closest('.milkdown-table-block,table');
              if (table) {
                let position: number | undefined;
                v.state.doc.descendants((node, pos) => {
                  if (node.type.name === 'table' && v.nodeDOM(pos)?.contains(target)) {
                    position = pos;
                  }
                });
                if (position !== undefined && !target.closest('td,th')) {
                  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, position)));
                  return;
                }
              }
              const cell = target.closest('td,th'),
                element = cell
                  ? (target.closest('p') || cell.querySelector('p') || target)
                  : target;
              const pos = v.posAtDOM(element, 0);
              v.dispatch(
                v.state.tr.setSelection(
                  TextSelection.near(
                    v.state.doc.resolve(Math.max(0, Math.min(v.state.doc.content.size, pos))),
                  ),
                ),
              );
            } catch {}
          });
        }
      },
      codeAt(target) {
        let result: CodeContext | null = null;
        if (!loading) {
          get()?.action(ctx => {
            const view = ctx.get(editorViewCtx);
            result = codeContextAt(view, callbacks.current.value, target);
            const dom = target.closest<HTMLElement>('.milkdown-code-block');
            if (result && dom) {
              if (dom.dataset.tabsDisplay === 'tabs' && target.closest('.tabs-editor')) {
                const index = Number(dom.dataset.codeTabIndex), tab = parseCodeTabs(result.code)[index];
                if (tab) result.tab = { index, language: tab.language || 'text', code: tab.code };
              }
            }
          });
        }
        return result;
      },
      setCodeAttributes(target,expected,patch) {
        let changed=false;
        if(!loading)get()?.action(ctx=>{
          const view=ctx.get(editorViewCtx);
          view.state.doc.descendants((node,pos)=>{
            if(changed||node.type.name!=='code_block'||node.textContent!==expected)return;
            const dom=view.nodeDOM(pos);if(!dom||!(dom===target||dom.contains(target)))return;
            let meta=node.attrs.meta||'';for(const [key,value]of Object.entries(patch))meta=withAttribute(meta,key,value);
            if(meta!==node.attrs.meta){view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,meta}));changed=true;}
          });
        });
        return changed;
      },
      replaceCode(target, code, expected, tabIndex) {
        let changed = false;
        if (!loading) {
          get()?.action(ctx => {
            const view = ctx.get(editorViewCtx);
            view.state.doc.descendants((node, pos) => {
              if (
                changed || node.type.name !== 'code_block' || node.textContent !== expected
              ) return;
              const dom = view.nodeDOM(pos);
              if (dom && (dom === target || dom.contains(target))) {
                const replacement = tabIndex === undefined
                  ? code
                  : replaceTabCode(node.textContent, tabIndex, code);
                const tr = view.state.tr.replaceWith(
                  pos + 1,
                  pos + node.nodeSize - 1,
                  replacement ? view.state.schema.text(replacement) : [],
                );
                const cursor = Math.max(
                  pos + 1,
                  Math.min(pos + replacement.length + 1, view.state.selection.head),
                );
                view.dispatch(tr.setSelection(TextSelection.create(tr.doc, cursor)));
                changed = true;
              }
            });
          });
        }
        return changed;
      },
      ensureCodeIds() {
        const editor = get();
        if (!editor || loading) return callbacks.current.value;
        editor.action(ctx => {
          const view = ctx.get(editorViewCtx);
          const result = codeIdTransaction(view.state, props.root, props.path);
          if(result.exhausted)callbacks.current.onError(exhaustedIdsMessage);
          if(result.transaction.docChanged) view.dispatch(result.transaction);

        });
        const value = editor.action(ctx => documentMarkdown(ctx, ctx.get(editorViewCtx).state.doc));
        return value;
      },
      flush() {
        const editor = get();
        if (!editor || loading) return;
        editor.action(publishDocument);
      },
      canIndentIntoList(target){
        if(loading)return false;
        return get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);return pos!==undefined&&indentBlockIntoList(view.state,pos);})||false;
      },
      indentIntoList(target){
        get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);if(pos!==undefined&&indentBlockIntoList(view.state,pos,view.dispatch,view))focusEditorSelection(view, 'edit');});
      },
      canOutdentFromList(target) {
        if(loading)return false;
        return get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);return pos!==undefined&&outdentBlockFromList(view.state,pos);})||false;
      },
      outdentFromList(target) {
        get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);if(pos!==undefined&&outdentBlockFromList(view.state,pos,view.dispatch,view))focusEditorSelection(view, 'edit');});
      },
      action(action,options) {
        const editor = get();
        if (!editor || loading) return;
        if (contextCommands[action]) {
          editor.action(ctx => { const view = ctx.get(editorViewCtx); contextCommands[action]!(view.state, view.dispatch, view); if(options?.focus!==false)focusEditorSelection(view, 'edit'); });
          return;
        }
        const actions: Partial<Record<Parameters<EditorHandle['action']>[0], () => void>> = {
          paragraph: () => editor.action(callCommand(turnIntoTextCommand.key)),
          bold: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('strong'))),
          italic: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('emphasis'))),
          strike: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('delete'))),
          highlight: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('highlight'))),
          underline: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('underline'))),
          math: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('inlineMath'))),
          link: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('link'))),
          code: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('inlineCode'))),
          bullet: () => editor.action(callCommand(wrapInBulletListCommand.key)),
          ordered: () => editor.action(callCommand(wrapInOrderedListCommand.key)),
          divider: () => editor.action(callCommand(insertHrCommand.key)),
          table: () =>
            editor.action(
              callCommand(insertTableCommand.key, { row: 3, col: 3 }),
            ),
          undo: () => editor.action(callCommand(undoCommand.key)),
          redo: () => editor.action(callCommand(redoCommand.key)),
          task: () => editor.action(insert('- [ ] \n')),
          codeblock: () => editor.action(insert('\n```\n\n```\n')),
          h1: () => editor.action(callCommand(wrapInHeadingCommand.key, 1)),
          h2: () => editor.action(callCommand(wrapInHeadingCommand.key, 2)),
          h3: () => editor.action(callCommand(wrapInHeadingCommand.key, 3)),
        };
        actions[action]?.();
        if(options?.focus!==false)editor.action((ctx) => focusEditorSelection(ctx.get(editorViewCtx), 'edit'));
      },
      insert(text,options) {
        const editor = get();
        if (!editor || loading) return;
        if (
          containsDrawingLink(text) && !editor.action(ctx => drawingAllowed(ctx.get(editorViewCtx)))
        ) {
          callbacks.current.onError('请在正文中插入绘图链接。');
          return;
        }
        editor.action(ctx => {
          const view = ctx.get(editorViewCtx),
            doc = ctx.get(parserCtx)(text),
            paragraph = doc?.childCount === 1 && doc.firstChild?.type.name === 'paragraph'
              ? doc.firstChild
              : null;
          if (
            paragraph && view.state.selection.$from.parent.isTextblock
            && !view.state.selection.$from.parent.type.spec.code
          ) {
            view.dispatch(
              view.state.tr.replaceSelection(new Slice(paragraph.content, 0, 0)).scrollIntoView(),
            );
          } else insert(text)(ctx);
        });
        if(options?.focus!==false)editor.action((ctx) => focusEditorSelection(ctx.get(editorViewCtx), 'edit'));
      },
      focus() {
        if (!loading) get()?.action((ctx) => focusEditorSelection(ctx.get(editorViewCtx), 'edit'));
      },
      scrollToHeading(index) {
        document
          .querySelectorAll(
            '.editor-host .ProseMirror h1, .editor-host .ProseMirror h2, .editor-host .ProseMirror h3, .editor-host .ProseMirror h4, .editor-host .ProseMirror h5, .editor-host .ProseMirror h6',
          )[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }),
    [get, loading],
  );
  return (
    <div
      className='editor-host'
      data-editor-pending='true'
      style={{ '--editor-font-size': `${props.fontSize}px` } as React.CSSProperties}
    >
      <Milkdown />
      {loading && <div className='editor-loading'>正在加载编辑器…</div>}
    </div>
  );
});

export default forwardRef<EditorHandle, EditorProps>(
  function WysiwygEditor(props, ref) {
    return (
      <MilkdownProvider>
        <Inner {...props} ref={ref} />
      </MilkdownProvider>
    );
  },
);
