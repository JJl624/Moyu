import { api,assetURL } from './bridge';
const imageRevisions=new Map<string,number>();let imageSequence=0,imageScope='';
export function invalidateResourceImages(root:string,paths:string[]){
  if(root!==imageScope){imageScope=root;imageRevisions.clear();imageSequence++;}
  for(const path of paths)imageRevisions.set(path,++imageSequence);
  while(imageRevisions.size>1024)imageRevisions.delete(imageRevisions.keys().next().value!);
}
export function resourceImageURL(document:string,href:string){
  const url=assetURL(document,href);
  if(!url.startsWith('moyu-asset:') && !(api.platform==='android' && url.startsWith('https://appassets.androidplatform.net/vault/')))return url;
  const fresh=new URL(url);fresh.searchParams.set('revision',String(imageRevisions.get(resourcePath(document,href))??imageSequence));return fresh.href;
}
export const isPreviewResource = (href: string) =>
  !/^([a-z][\w+.-]*:|\/)/i.test(href) && /\.excalidraw(?:[#?].*)?$/i.test(href);
export function resourcePath(document: string, href: string): string {
  let decoded;
  try {
    decoded = decodeURIComponent(href.split(/[?#]/)[0]);
  } catch {
    return '';
  }
  if (/^([a-z][\w+.-]*:|\/)/i.test(decoded)) return '';
  const parts = document.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) return '';
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
export function cleanSvg(svg: SVGSVGElement): SVGSVGElement {
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n => n.remove());
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) {
      if (
        /^on/i.test(attr.name)
        || (['href', 'xlink:href'].includes(attr.name)
          && /^(javascript:|https?:)/i.test(attr.value))
      ) {
        element.removeAttribute(attr.name);
      }
    }
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('role', 'img');
  return svg;
}
export async function drawingSvg(path: string): Promise<SVGSVGElement> {
  const file = await api.feature<{ content: string }>('drawing.read', { path });
  const scene = JSON.parse(file.content);
  if (!scene.elements.some((e: { isDeleted?: boolean }) => !e.isDeleted)) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 400 100');
    const text = document.createElementNS(svg.namespaceURI, 'text');
    text.setAttribute('x', '16');
    text.setAttribute('y', '54');
    text.setAttribute('fill', 'currentColor');
    text.textContent = '空白绘图';
    svg.append(text);
    return svg;
  }
  const { exportToSvg } = await import('moyu-excalidraw');
  const { initializeDrawingFonts } = await import('./DrawingFonts');
  await initializeDrawingFonts();
  return cleanSvg(
    await exportToSvg({
      elements: scene.elements,
      appState: {
        ...scene.appState,
        exportBackground: false,
        exportWithDarkMode: document.documentElement.dataset.theme === 'dark',
      },
      files: scene.files || {},
    }),
  );
}
