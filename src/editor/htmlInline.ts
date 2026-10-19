import { attachmentMarkdown } from '../attachmentLinks';
export function htmlInlineMarkdown(node: globalThis.Node): string {
  if (node.nodeType === globalThis.Node.TEXT_NODE) {
    return (node.textContent || '').replace(/[\\`*_~$=\[\]]/g, '\\$&');
  }
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.tagName.toLowerCase(),
    inner = () => [...node.childNodes].map(htmlInlineMarkdown).join('');
  if (tag === 'code') {
    const value = node.textContent || '',
      ticks = '`'.repeat(Math.max(0, ...[...value.matchAll(/`+/g)].map(m => m[0].length)) + 1);
    return ticks + value + ticks;
  }
  if (tag === 'strong' || tag === 'b') return '**' + inner() + '**';
  if (tag === 'em' || tag === 'i') return '*' + inner() + '*';
  if (tag === 's' || tag === 'del') return '~~' + inner() + '~~';
  if (tag === 'mark') return '==' + inner() + '==';
  if (tag === 'u') return '__' + inner() + '__';
  if (tag === 'a') {
    const link = attachmentMarkdown({
      type: 'link',
      url: node.getAttribute('href') || '',
      children: [],
      title: node.getAttribute('title'),
    });
    return '[' + inner() + ']' + link.slice(2);
  }
  if (tag === 'img') {
    const url = node.getAttribute('src') || '';
    if (/^(blob:|data:)/i.test(url)) return node.getAttribute('alt') || '';
    return attachmentMarkdown({
      type: 'image',
      url,
      alt: node.getAttribute('alt'),
      title: node.getAttribute('title'),
    });
  }
  return inner();
}
