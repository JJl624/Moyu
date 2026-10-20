import { attachmentMarkdown } from '../attachmentLinks';
import { api } from '../bridge';
import { relativeHref } from '../markdownLinks';

export const attachmentDragType = 'application/x-moyu-attachment';
const imageFile = (name: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name);
export function acceptsAttachmentDrop(data: DataTransfer | null) {
  return !!data && (data.types.includes(attachmentDragType) || data.types.includes('Files'));
}
export async function droppedAttachmentLinks(data: DataTransfer, document: string, root?: string) {
  const internal = data.getData(attachmentDragType);
  if (internal) {
    const item = JSON.parse(internal) as { path: string; root: string; kind: string };
    if (
      item.root !== root || item.kind !== 'file' || !item.path
      || /^(?:\/|[a-z]:)|\\|(?:^|\/)\.\.(?:\/|$)/i.test(item.path)
    ) return [];
    const link = relativeHref(document, item.path), name = item.path.split('/').at(-1)!;
    return [
      attachmentMarkdown({
        type: imageFile(name) ? 'image' : 'link',
        url: link,
        alt: name,
        children: [{ type: 'text', value: name }],
      }),
    ];
  }
  // Capture Files synchronously: the browser protects DataTransfer after drop.
  const files = Array.from(data.files);
  if (Array.from(data.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
    throw Error('请拖入文件，不能直接插入文件夹。');
  }
  const links: string[] = [];
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) throw Error('附件超过 20 MB。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const link = api.desktop
      ? (await api.feature<{ link: string }>('attachment.upload', { root, document, name: file.name, bytes }))
        .link
      : await api.upload(document, file.name, bytes);
    links.push(
      attachmentMarkdown({
        type: imageFile(file.name) ? 'image' : 'link',
        url: link,
        alt: file.name,
        children: [{ type: 'text', value: file.name }],
      }),
    );
  }
  return links;
}
