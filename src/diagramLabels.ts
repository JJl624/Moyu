// Some Mermaid renderers emit HTML labels even when htmlLabels is false.
// Convert their plain text to SVG before sanitizing, so previews and vector
// exports retain the labels without retaining executable HTML content.
export function vectorizeDiagramLabels(svg: SVGSVGElement, font: string, foreground: string) {
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = '14px ' + font;
  svg.querySelectorAll<SVGElement>('foreignObject').forEach(object => {
    object.querySelectorAll('script,style,iframe,object,embed').forEach(node => node.remove());
    object.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    const value = (object.textContent || '').trim();
    const x = Number(object.getAttribute('x') || 0),
      y = Number(object.getAttribute('y') || 0),
      width = Number(object.getAttribute('width')),
      height = Number(object.getAttribute('height'));
    if (!value || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return;
    }
    const lines: string[] = [];
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (const character of paragraph) {
        if (line && context.measureText(line + character).width > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
      lines.push(line);
    }
    const text = document.createElementNS(svg.namespaceURI, 'text');
    text.setAttribute('font-size', '14');
    text.setAttribute('font-family', font);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    // Event-model boxes use bright semantic colors independent of the app theme.
    const box = object.parentElement?.classList.contains('em-box');
    text.setAttribute('fill', box ? '#182330' : foreground);
    lines.forEach((line, index) => {
      const span = document.createElementNS(svg.namespaceURI, 'tspan');
      span.setAttribute('x', String(x + width / 2));
      span.setAttribute('y', String(y + height / 2 + (index - (lines.length - 1) / 2) * 17));
      span.textContent = line;
      text.append(span);
    });
    object.replaceWith(text);
  });
}
