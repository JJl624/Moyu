import { attachmentMarkdown } from '../attachmentLinks';

export const inlineWrappers: Record<string, readonly [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  highlight: ['==', '=='],
  underline: ['__', '__'],
  math: ['$', '$'],
  link: ['[', ']()'],
};
export function inlineCodeSource(text: string) {
  const marker = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length)) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || /^ .* $/.test(text) && /\S/.test(text) ? ' ' : '';
  return { raw: marker + pad + text + pad + marker, offset: marker.length + pad.length + text.length };
}
export function inlineActionText(action: string, text: string) {
  if (action === 'code') return inlineCodeSource(text).raw;
  if (action === 'link') {
    return attachmentMarkdown({ type: 'link', url: '', children: [{ type: 'text', value: text }] });
  }
  const wrapper = inlineWrappers[action];
  return wrapper[0] + text + wrapper[1];
}
