import { attachmentMarkdown } from '../attachmentLinks';
import { api } from '../bridge';
const extensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif',
};
const descriptions = new WeakMap<File, string>();
export function clipboardImages(event: ClipboardEvent): File[] {
  const data = event.clipboardData;
  if (!data) return [];
  const images = Array.from(data.files).filter(file => /^image\//i.test(file.type));
  const markup = data.getData('text/html');
  if (!/<img\b/i.test(markup)) return images;
  // Some clipboard producers expose a data image through HTML instead of Files.
  const html = new DOMParser().parseFromString(markup, 'text/html');
  const elements = Array.from(html.querySelectorAll('img'));
  if (images.length) {
    // Match only unambiguous image lists; an unrelated HTML image must not
    // supply the description of another clipboard file.
    if (elements.length === images.length) elements.forEach((image, index) => {
      if (image.hasAttribute('alt')) descriptions.set(images[index], image.alt);
    });
    return images;
  }
  for (const image of elements) {
    const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i.exec(
      image.getAttribute('src') || '',
    );
    if (!match) continue;
    if (match[2].length > Math.ceil(20 * 1024 * 1024 * 4 / 3) + 1024) {
      throw new Error('剪贴板图片超过 20 MB。');
    }
    try {
      const binary = atob(match[2]), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const file = new File(
          [bytes],
          '粘贴图片.' + (extensions[match[1].toLowerCase()] || match[1].split('/')[1]),
          { type: match[1] },
        );
      if (image.hasAttribute('alt')) descriptions.set(file, image.alt);
      images.push(file);
    } catch { /* Leave malformed clipboard HTML to normal text paste. */ }
  }
  return images;
}
export async function importClipboardImages(files: File[], document: string, root?: string) {
  const links: string[] = [];
  for (const file of files) {
    const suffix = extensions[file.type.toLowerCase()];
    if (!suffix) throw new Error('不支持此剪贴板图片格式。');
    if (file.size > 20 * 1024 * 1024) throw new Error('剪贴板图片超过 20 MB。');
    const name = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.name)
        ? file.name
        : '粘贴图片.' + suffix,
      bytes = new Uint8Array(await file.arrayBuffer());
    const link = api.desktop
      ? (await api.feature<{ link: string }>('attachment.upload', { root, document, name, bytes }))
        .link
      : await api.upload(document, name, bytes);
    links.push(attachmentMarkdown({ type: 'image', alt: descriptions.get(file) ?? name, url: link }));
  }
  return links;
}
