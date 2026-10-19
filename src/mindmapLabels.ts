// Mermaid's circular/rounded mindmap shapes put native SVG labels at x=0,
// while some labels retain the default start anchor. Normalize the complete
// text label around the node's origin, preserving vertical layout and tspans.
export function centerMindmapLabels(svg:SVGSVGElement){
  if(svg.getAttribute('aria-roledescription')!=='mindmap')return;
  svg.querySelectorAll<SVGGElement>('.mindmap-node').forEach(node=>{
    const label=node.querySelector<SVGGElement>(':scope > .label'),
      rows=label?.querySelectorAll<SVGTSpanElement>('.text-outer-tspan');
    if(!label||!rows?.length)return;
    const transform=label.getAttribute('transform')||'',match=transform.match(/translate\(\s*([-\d.e+]+)[,\s]+([-\d.e+]+)\s*\)/i);
    if(!match)return;
    label.setAttribute('transform',transform.replace(match[0],`translate(0, ${match[2]})`));
    label.querySelectorAll('text').forEach(text=>text.setAttribute('text-anchor','middle'));
    rows.forEach(row=>{row.setAttribute('x','0');row.setAttribute('text-anchor','middle');});
  });
}
