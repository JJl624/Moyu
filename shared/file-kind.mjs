// The final extension determines the viewer (e.g. drawing.excalidraw.png is PNG).
const image = /\.(png|apng|jpe?g|jfif|pjpeg|pjp|gif|webp|avif|svg|bmp|ico|cur)$/i;
export function fileKind(path) {
  if (/\.(md|markdown)$/i.test(path)) return 'markdown';
  if (/\.excalidraw$/i.test(path)) return 'drawing';
  if (image.test(path)) return 'image';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (/\.(gp[345]?|gpx|mxl)$/i.test(path)) return 'score';
  if (/\.html?$/i.test(path)) return 'html';
  if (/\.(sqlite3?|db|db3)$/i.test(path)) return 'sqlite';
  return 'text';
}
