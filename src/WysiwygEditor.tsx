import {codeId} from '../shared/code-documents.mjs';
import {stableCodeIds, codeIdTransaction, exhaustedIdsMessage} from './editor/codeIds';
import { EditorView as CodeView } from '@codemirror/view';
import { Crepe } from '@milkdown/crepe';
import { codeBlockConfig, codeBlockView } from '@milkdown/kit/component/code-block';
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
import { callCommand, insert } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import katex from 'katex';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { parseCodeTabs, replaceTabCode } from './codeTabs';
import { codeExitKeys, tableDeleteKeys } from './editor/blockNavigation';
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
import { contextCommands, prepareRichContext } from './editor/contextCommands';
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
import { inlineMarkdownHandlers } from './editor/inlineSerialization';
import { MarkdownSource } from './editor/markdownSource';
import { insertMenu } from './editor/insertMenu';
import {
  headingListItems,
  stableListItemView,
  syncListTextSelection,
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
import { fromMarkdownSelection } from './editor/selection';
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
        if (!node.content.size) {
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
  const lastDocument = useRef<Node | null>(null);
  const sourceSnapshot = useRef<{ markdown: MarkdownSource; savedValue?: string } | null>(null);
  const publishedSource = useRef<{ source: string; document: Node } | null>(null);
  const createSnapshot = (ctx: Ctx, source: string, document: Node) => new MarkdownSource(
    source, document, ctx.get(parserCtx), ctx.get(serializerCtx),
    source => ctx.get(remarkCtx).parse(source).children.flatMap(node => {
      const from = node.position?.start.offset, to = node.position?.end.offset;
      return from === undefined || to === undefined ? [] : [{ from, to }];
    }),
  );
  const documentMarkdown = (ctx: Ctx, current: Node) => {
    const snapshot = sourceSnapshot.current, savedValue = callbacks.current.savedValue;
    // Keep the original source until a real save advances the baseline. Parsing
    // is needed only for a new saved snapshot, never on every keystroke.
    if (snapshot && savedValue !== undefined && savedValue !== snapshot.savedValue) {
      const document = publishedSource.current?.source === savedValue ? publishedSource.current.document : ctx.get(parserCtx)(savedValue);
      sourceSnapshot.current = { markdown: createSnapshot(ctx, savedValue, document), savedValue };
    }
    const source = sourceSnapshot.current?.markdown.write(current) ?? ctx.get(serializerCtx)(current);
    publishedSource.current = { source, document: current };
    return source;
  };
  const identityReady = useRef(false);
  const stopRestore = useRef<() => void>(() => {});
  useEffect(() => () => stopRestore.current(), []);
  const drawingAllowed = (view: import('@milkdown/kit/prose/view').EditorView) =>
    !!view?.state && canInsertInlineDrawing(view.state);
  const { get, loading } = useEditor(
    (root) => {
      identityReady.current = false;
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
        },
        featureConfigs: {
          [Crepe.Feature.Cursor]: { virtual: false },
          [Crepe.Feature.CodeMirror]: {
            languages,
            extensions: [codeHighlight, codeIndentation()],
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
          [Crepe.Feature.Toolbar]: {
            boldLabel: '加粗',
            italicLabel: '斜体',
            codeLabel: '行内代码',
            linkLabel: '链接',
            strikethroughLabel: '删除线',
            latexLabel: '数学公式',
            aiLabel: '辅助编辑',
          },
        },
      });
      void crepe.editor.remove([
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
      ]);
      crepe.editor
        .config(ctx =>
          ctx.update(
            remarkStringifyOptionsCtx,
            options => ({
              ...options,
              handlers: inlineMarkdownHandlers(options.handlers),
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
          insertMenu(() => callbacks.current.onDrawing?.()),
        ).use(asyncDrawingInsert)
        .use(mathRemark).use(displayMathSchema).use(displayMathView).use(displayMathInput).use(resourceSources).use(htmlCommentSchema).use(htmlCommentKeys).use(resourceSchema).use(
          resourceView(props.path),
        ).use(resourceKeys).use(resourceInput).use(toolbarLinkCommand).use(inlineFormatting).use(inlinePaste)
        .use(imagePaste(props.path, props.root, message => callbacks.current.onError(message)))
        .use(sourceHeadings).use(sourceHeadingInputRule).use(headingSource).use(inlinePresentation)
        .use(ordinaryEmptyParagraphs)
        .use(headingListItems)
        .use(stableListItemView)
        .use(syncListTextSelection)
        .use(tableDeleteKeys)
        .use(documentTail).use(selectionGesture);
      crepe.on((listener) => {
        listener.selectionUpdated(ctx =>
          callbacks.current.onDrawingAllowed?.(drawingAllowed(ctx.get(editorViewCtx)))
        );
        listener.mounted((ctx) => {
          identityReady.current = true;
          installInlineCommands(ctx);
          installHeadingCommands(ctx);
          lastDocument.current = ctx.get(editorViewCtx).state.doc;
          sourceSnapshot.current = {
            markdown: createSnapshot(ctx, props.value, lastDocument.current),
            savedValue: callbacks.current.savedValue,
          };
          const view = ctx.get(editorViewCtx), selected = callbacks.current.selection;
          if (selected) {
            stopRestore.current();
            stopRestore.current = restoreRichSelection(view, callbacks.current.value, selected);
          } else {
            const host = view.dom.closest<HTMLElement>('.editor-host');
            if (host) delete host.dataset.editorPending;
          }
          window.dispatchEvent(new Event('moyu-code-dom'));
          callbacks.current.onDrawingAllowed?.(drawingAllowed(view));
        });
        listener.updated(ctx => {
          callbacks.current.onDrawingAllowed?.(drawingAllowed(ctx.get(editorViewCtx)));
          const current = ctx.get(editorViewCtx).state.doc;
          if (lastDocument.current && !lastDocument.current.eq(current)) {
            // Milkdown debounces a transaction snapshot. Non-history transactions
            // can advance the live document before that snapshot is published.
            // Never acknowledge a live document while emitting an older string.
            const latest = documentMarkdown(ctx, current);
            if (latest !== callbacks.current.value) callbacks.current.onChange(latest);
          }
          lastDocument.current = current;
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
      scrollToOffset(offset) {
        if(loading)return;
        get()?.action(ctx=>{const v=ctx.get(editorViewCtx),source=callbacks.current.value,pos=fromMarkdownSelection(source,v.state.doc,offset);
          v.dispatch(v.state.tr.setSelection(TextSelection.between(v.state.doc.resolve(pos),v.state.doc.resolve(pos))).scrollIntoView());v.focus();
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
              const content = dom?.querySelector<HTMLElement>('.cm-content'),
                code = content ? CodeView.findFromDOM(content) : null;
              if (code) {
                code.dispatch({ selection: { anchor: 0 } });
                code.focus();
              } else v.focus();
            });
          });
        }
      },
      captureSelection() {
        const editor = get();
        if (!editor || loading) return null;
        return editor.action(ctx => {
          const v = ctx.get(editorViewCtx),
            md = lastDocument.current?.eq(v.state.doc)
              ? callbacks.current.value
              : documentMarkdown(ctx, v.state.doc);
          return captureRichSelection(v, md);
        });
      },
      restoreSelection(selected) {
        if (!loading) {
          get()?.action(ctx => {
            stopRestore.current();
            stopRestore.current = restoreRichSelection(
              ctx.get(editorViewCtx),
              callbacks.current.value,
              selected,
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
                v.focus();
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
              v.focus();
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
        let changed = false;
        editor.action(ctx => {
          const view = ctx.get(editorViewCtx);
          const result = codeIdTransaction(view.state, props.root, props.path);
          if(result.exhausted)callbacks.current.onError(exhaustedIdsMessage);
          if(result.transaction.docChanged) {changed=true;view.dispatch(result.transaction);}

        });
        if(!changed && lastDocument.current?.eq(editor.action(ctx => ctx.get(editorViewCtx).state.doc))) return callbacks.current.value;
        const value = editor.action(ctx => documentMarkdown(ctx, ctx.get(editorViewCtx).state.doc));
        lastDocument.current = editor.action(ctx => ctx.get(editorViewCtx).state.doc);
        return value;
      },
      flush() {
        const editor = get();
        if (!editor || loading) return;
        editor.action((ctx) => {
          const current = ctx.get(editorViewCtx).state.doc;
          if (lastDocument.current && !lastDocument.current.eq(current)) {
            callbacks.current.onChange(documentMarkdown(ctx, current));
            lastDocument.current = current;
          }
        });
      },
      canIndentIntoList(target){
        if(loading)return false;
        return get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);return pos!==undefined&&indentBlockIntoList(view.state,pos);})||false;
      },
      indentIntoList(target){
        get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);if(pos!==undefined&&indentBlockIntoList(view.state,pos,view.dispatch))view.focus();});
      },
      canOutdentFromList(target) {
        if(loading)return false;
        return get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);return pos!==undefined&&outdentBlockFromList(view.state,pos);})||false;
      },
      outdentFromList(target) {
        get()?.action(ctx=>{const view=ctx.get(editorViewCtx),pos=resourceBlockPosition(view,target);if(pos!==undefined&&outdentBlockFromList(view.state,pos,view.dispatch))view.focus();});
      },
      action(action) {
        const editor = get();
        if (!editor || loading) return;
        if (contextCommands[action]) {
          editor.action(ctx => { const view = ctx.get(editorViewCtx); contextCommands[action]!(view.state, view.dispatch); view.focus(); });
          return;
        }
        const actions: Partial<Record<Parameters<EditorHandle['action']>[0], () => void>> = {
          paragraph: () => editor.action(callCommand(turnIntoTextCommand.key)),
          bold: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('strong'))),
          italic: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('emphasis'))),
          strike: () => editor.action(ctx => ctx.get(commandsCtx).inline(formatInline('delete'))),
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
          task: () => editor.action(insert('- [ ] 待办事项\n')),
          codeblock: () => editor.action(insert('\n```typescript\n// 在这里写代码\n```\n')),
          h1: () => editor.action(callCommand(wrapInHeadingCommand.key, 1)),
          h2: () => editor.action(callCommand(wrapInHeadingCommand.key, 2)),
          h3: () => editor.action(callCommand(wrapInHeadingCommand.key, 3)),
        };
        actions[action]?.();
        editor.action((ctx) => ctx.get(editorViewCtx).focus());
      },
      insert(text) {
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
        editor.action((ctx) => ctx.get(editorViewCtx).focus());
      },
      focus() {
        if (!loading) get()?.action((ctx) => ctx.get(editorViewCtx).focus());
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
