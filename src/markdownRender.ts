import rehypeKatex from 'rehype-katex';
import {codeId} from '../shared/code-documents.mjs';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkDocumentStructure from '../shared/remark-document-structure.mjs';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import remarkHighlight from '../shared/remark-highlight.mjs';
import remarkUnderline from '../shared/remark-underline.mjs';
import remarkFoldingQuotes, { foldingQuoteHTML } from '../shared/remark-folding-quotes.mjs';
import { readableHref } from '../shared/link-destinations.mjs';
import { applyAttachmentSize, attachmentSize } from './attachmentLayout';
import { attachmentMarkdown,attachmentLabel,isAttachmentLink } from './attachmentLinks';
import {previewKind,mountAttachmentPreview} from './attachments/previewRegistry';
import {standaloneAttachment} from '../shared/attachment-previews.mjs';
import { runnable } from './codeBlocks';
import { isTabbedCode } from './codeTabs';
import { heightFromMeta } from './editor/codeMetadata';
import { highlightReading } from './highlight';
import {  isPreviewResource, resourcePath } from './resourcePreview';
import { renderCodeTabs } from './tabbedCodePreview';
import 'katex/dist/katex.min.css';

const resourceAttributes = [
  'dataResourceLink',
  'dataResourceRaw',
  'dataResourceLabel',
  'dataResourceImage',
  'dataResourceAlt',
  'dataResourceStandalone',
  'dataSourceFrom',
  'dataSourceTo',
];
export async function renderMarkdown(
  value: string,
  path: string,
  options: { limitCodeHeight?: boolean; interactiveTabs?: boolean; sourceLocations?: boolean; attachmentPreviews?:boolean } = {},
) {
  const heights: (number | null)[] = [], metas: string[] = [];
  return unified().use(remarkParse).use(remarkGfm).use(remarkDocumentStructure).use(remarkMath).use(remarkHighlight).use(remarkUnderline).use(remarkFoldingQuotes).use(() => tree => {
    const definitions = new Map<string, string>();
    const collect = (node: any) => {
      if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
      node.children?.forEach(collect);
    };
    collect(tree);
    const walk = (node: any, parent?:any) => {
      if (options.sourceLocations && node.position && ['paragraph', 'heading', 'listItem', 'tableCell', 'code', 'math'].includes(node.type)) {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties,
          dataSourceFrom: node.position.start.offset, dataSourceTo: node.position.end.offset } };
      }
      if (node.type === 'code') {
        if (['latex', 'math'].includes((node.lang || '').toLowerCase())) {
          // Edited display formulas are serialized as LaTeX fences. KaTeX
          // consumes a math fence's entire <pre>, so it has no code toolbar or
          // entry in the remaining code blocks' height/attribute arrays.
          node.lang = 'math';
        } else {
          heights.push(heightFromMeta(node.meta || ''));
          metas.push(node.meta || '');
        }
      }
      if (['image', 'link', 'imageReference', 'linkReference'].includes(node.type)) {
        const alt = attachmentLabel(node);
        const href = node.url || definitions.get(node.identifier);
        const image = ['image', 'imageReference'].includes(node.type);
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            ...((image || isPreviewResource(href || '') || options.attachmentPreviews && isAttachmentLink({...node,url:href})) ? {
              dataResourceLink: href,
              dataResourceRaw: value.slice(node.position.start.offset, node.position.end.offset),
              dataResourceLabel: attachmentSize(alt).label,
              dataResourceImage: String(image),
              dataResourceAlt: alt,
              dataResourceStandalone:String(standaloneAttachment(parent)),
            } : {}),
            dataSourceFrom: node.position.start.offset,
            dataSourceTo: node.position.end.offset,
          },
        };
      }
      node.children?.forEach((child:any)=>walk(child,node));
    };
    walk(tree);
  }).use(remarkRehype, { handlers: { blockquote: foldingQuoteHTML } }).use(rehypeSanitize, {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'mark', 'u', 'details', 'summary'],
    attributes: {
      ...defaultSchema.attributes,
      '*': [...(defaultSchema.attributes?.['*'] || []), 'dataSourceFrom', 'dataSourceTo'],
      a: [...(defaultSchema.attributes?.a || []), ...resourceAttributes],
      img: [...(defaultSchema.attributes?.img || []), ...resourceAttributes],
      details: ['open', ['className', 'folding-quote']],
    },
  }).use(rehypeKatex).use(highlightReading).use(rehypeStringify).process(value).then(async file => {
    const root = document.createElement('div');
    root.innerHTML = String(file);
    // remark-rehype encodes destinations, including reference links. Keep the
    // same readable filenames as the editor while preserving URL delimiters.
    root.querySelectorAll<HTMLElement>('a[href],img[src]').forEach(resource => {
      const attribute = resource.tagName === 'A' ? 'href' : 'src';
      resource.setAttribute(attribute, readableHref(resource.getAttribute(attribute) || ''));
    });
    root.querySelectorAll<HTMLInputElement>('input').forEach(input => input.disabled = true);
    root.querySelectorAll<HTMLElement>('pre').forEach((pre, index) => {
      pre.dataset.codeMeta = metas[index];
      const code = pre.querySelector('code');
      if (code) {
        if (options.limitCodeHeight !== false && heights[index]) {
          code.style.maxHeight = heights[index] + 'px';
          code.style.overflow = 'auto';
        }
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let last: Node | null = null;
        while (walker.nextNode()) last = walker.currentNode;
        if (last?.textContent?.endsWith('\n')) last.textContent = last.textContent.slice(0, -1);
        const shell = document.createElement('div');
        shell.className = 'code-block-shell';
        shell.dataset.codeMeta=metas[index]||'';
        shell.dataset.codeId=codeId(metas[index]||'');
        shell.dataset.language = [...code.classList].find(c => c.startsWith('language-'))?.slice(9)
          || '';
        if (runnable(shell.dataset.language)) shell.dataset.runnable = 'true';
        pre.replaceWith(shell);
        shell.append(pre);
      }
    });
    await Promise.all(
      [...root.querySelectorAll<HTMLElement>('.code-block-shell')].map(async shell => {
        const pre = shell.querySelector('pre'), code = pre?.querySelector('code');
        if (code?.hasAttribute('data-source-from')) {
          shell.dataset.sourceFrom = code.dataset.sourceFrom || '';
          shell.dataset.sourceTo = code.dataset.sourceTo || '';
        }
        if (!isTabbedCode(shell.dataset.language || '')) return;
        if (pre && code) {
          const source = code.textContent || '';
          shell.dataset.codeRaw = source;
          pre.replaceWith(
            await renderCodeTabs(
              source,
              (pre as HTMLElement).dataset.codeMeta || '',
              options.interactiveTabs === true,
              options.limitCodeHeight !== false,
            ),
          );
        }
      }),
    );
    // Reference images enter through the same resource renderer as inline images.
    root.querySelectorAll<HTMLImageElement>('img:not([data-resource-link])').forEach(image => {
      image.dataset.resourceLink = image.getAttribute('src') || '';
      image.dataset.resourceRaw = attachmentMarkdown({
        type: 'image',
        url: image.dataset.resourceLink,
        alt: image.alt,
      });
      image.dataset.resourceAlt = image.alt;
      image.dataset.resourceLabel = attachmentSize(image.alt).label;
      image.dataset.resourceImage = 'true';
    });
    await Promise.all(
      [...root.querySelectorAll<HTMLElement>('[data-resource-link]')].map(async resource => {
        const href = resource.dataset.resourceLink || '',
          p = resourcePath(path, href),
          alt = resource.dataset.resourceAlt || '';
        resource.dataset.resourcePath = p;
        const kind=previewKind(href,resource instanceof HTMLImageElement,resource.dataset.resourceStandalone==='true');
        if (kind) {
          const link = document.createElement('span');
          Object.assign(link.dataset, resource.dataset);
          link.className = 'resource-preview';
          link.textContent = attachmentSize(alt).label || '绘图';
          resource.replaceWith(link);
          if(kind==='image')void mountAttachmentPreview(link,kind,path,href,alt);
          else await mountAttachmentPreview(link,kind,path,href,alt);
        } else if (!kind && resource instanceof HTMLImageElement) {
          const link=document.createElement('a');Object.assign(link.dataset,resource.dataset);link.href=href;link.textContent=attachmentSize(alt).label||'附件';resource.replaceWith(link);
        }
      }),
    );
    await Promise.all(
      [...root.querySelectorAll<HTMLImageElement>('img[data-resource-alt]')].map(async image => {
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([
          image.decode().catch(() => {}),
          new Promise<void>(resolve => {
            timer = setTimeout(resolve, 2000);
          }),
        ]).finally(() => clearTimeout(timer));
        if (image.naturalWidth) {
          image.width = image.naturalWidth;
          image.height = image.naturalHeight;
          applyAttachmentSize(image, image.dataset.resourceAlt || '', image.naturalWidth);
        }
      }),
    );
    await Promise.all(
      [...root.querySelectorAll<HTMLElement>('code[class~="language-mermaid" i]')].map(
        async code => {
          const { diagramSvg, applyMermaidSize } = await import('./Mermaid'),
            container = document.createElement('div');
          container.className = 'mermaid-diagram';
          container.dataset.mermaidSource = encodeURIComponent(code.textContent || '');
          container.dataset.mermaidMeta = code.parentElement?.dataset.codeMeta || '';
          try {
            const svg = await diagramSvg(code.textContent || '');
            applyMermaidSize(svg, container.dataset.mermaidMeta);
            container.append(svg);
          } catch (error) {
            container.classList.add('diagram-error');
            container.textContent = 'Mermaid：' + (error as Error).message;
          }
          code.parentElement?.replaceWith(container);
        },
      ),
    );
    return root;
  });
}
