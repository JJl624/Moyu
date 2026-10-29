// Selection, focus and Markdown serialization do not belong to a renderer.
export const scoreText = path => /\.(alphatex|atex|musicxml)$/i.test(path.split(/[?#]/)[0]);
export const scoreFile = path => scoreText(path) || /\.(gp[345]?|gpx|mxl)$/i.test(path.split(/[?#]/)[0]);
export function attachmentPreviewKind(href, {image = false, standalone = false, platform = ''} = {}) {
  if (!standalone) return null;
  const local = !/^([a-z][\w+.-]*:|\/|#)/i.test(href);
  if (/\.excalidraw(?:[?#].*)?$/i.test(href) && local) return 'drawing';
  // New embedded formats are initially enabled on Windows only.
  if (platform === 'win32' && local) {
    if (/\.pdf(?:[?#].*)?$/i.test(href)) return 'pdf';
    if (scoreFile(href)) return 'score';
  }
  if (/\.pdf(?:[?#].*)?$/i.test(href) || scoreFile(href)) return null;
  return image || local && /\.(png|apng|jpe?g|jfif|pjpeg|pjp|gif|webp|avif|svg|bmp|ico|cur)(?:[?#].*)?$/i.test(href) ? 'image' : null;
}
export function standaloneAttachment(paragraph, source) {
  const children = paragraph?.children?.filter(child => child.type !== 'text' || String(child.value || '').trim());
  return paragraph?.type === 'paragraph' && children?.length === 1
    && ['link','image','linkReference','imageReference','inlineSource'].includes(children[0].type)
    && (!source || String(children[0].value ?? source).trim() === source.trim());
}
