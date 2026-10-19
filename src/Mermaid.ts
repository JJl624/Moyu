import { applyAttachmentSize, attachmentSize } from './attachmentLayout';
import { vectorizeDiagramLabels } from './diagramLabels';
import { attributeFromMeta } from './editor/codeMetadata';
import { cleanSvg } from './resourcePreview';
import { centerMindmapLabels } from './mindmapLabels';
export function mermaidSize(meta: string) {
  const value = attributeFromMeta(meta, 'size') || '';
  return attachmentSize('|' + value).label === '' ? value : '';
}
export function applyMermaidSize(svg: SVGSVGElement, meta = '') {
  const width = Number((svg.getAttribute('viewBox') || '').split(/[ ,]+/)[2])
    || Number(svg.getAttribute('width')) || 720;
  applyAttachmentSize(svg, '|' + mermaidSize(meta), width);
  svg.style.maxHeight = '';
}
const cache = new Map<string, Promise<string>>(),
  cacheBytes = new Map<string, number>(),
  states = new WeakMap<HTMLElement, { code: string; revision: number }>();
let id = 0;
let renderer: Promise<typeof import('mermaid')['default']> | undefined, queue = Promise.resolve();
async function mermaid() {
  return renderer ||= Promise.all([import('mermaid'), import('@mermaid-js/layout-elk')]).then(
    ([m, elk]) => {
      m.default.registerLayoutLoaders(elk.default);
      return m.default;
    },
  );
}
export async function diagramSvg(code: string): Promise<SVGSVGElement> {
  if (code.length > 50000) throw new Error('Mermaid 图表超过 50,000 字符。');
  const dark = document.documentElement.dataset.theme === 'dark',
    style = getComputedStyle(document.querySelector('.app') || document.documentElement),
    family = style.getPropertyValue(
      document.querySelector('.reading-view') ? '--font-reading' : '--body-font',
    ).trim(),
    font = (family.match(/^"([^"]+)"/)?.[1] || family.split(',')[0] || 'sans-serif').replace(
      /[\n\r'<>]/g,
      '',
    ),
    colors = {
      bg: style.getPropertyValue('--bg').trim() || (dark ? '#20242b' : '#ffffff'),
      fg: style.getPropertyValue('--text').trim() || (dark ? '#dce2ec' : '#263142'),
      accent: style.getPropertyValue('--accent').trim() || (dark ? '#88adf2' : '#446dad'),
      muted: style.getPropertyValue('--secondary').trim() || (dark ? '#a5b0c0' : '#647184'),
      surface: style.getPropertyValue('--surface').trim() || (dark ? '#2b323d' : '#f3f5f8'),
      border: dark ? '#536174' : '#c1cad8',
    },
    key = JSON.stringify([code, dark, font, colors]);
  const palette = dark
    ? [
      '#6FA8E8',
      '#F5AC5B',
      '#80C785',
      '#C797DA',
      '#EF848A',
      '#71C7C2',
      '#EBCF5B',
      '#B7A5F0',
      '#CEAE8E',
      '#B8C2D2',
      '#AFCA79',
      '#F1B4D2',
    ]
    : [
      '#5B8BD4',
      '#EEA04B',
      '#67B383',
      '#C17DC6',
      '#E57B80',
      '#5BB7BE',
      '#C6AD45',
      '#AF9CE5',
      '#C49F7D',
      '#A8B2C3',
      '#93AE5B',
      '#E5A3C4',
    ];
  const categories = Object.fromEntries(palette.flatMap((color, index) => [
    ['pie' + (index + 1), color],
    ['cScale' + index, color],
    ['cScaleLabel' + index, '#182330'],
    ['fillType' + index, color],
    ['git' + index, color],
    ['gitBranchLabel' + index, '#182330'],
    ['venn' + (index + 1), color],
  ]));
  if (cache.has(key)) {
    const value = cache.get(key)!;
    cache.delete(key);
    cache.set(key, value);
  } else {
    const task = (async () => {
      const m = await mermaid();
      let output = '';
      const render = queue.then(async () => {
        m.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          htmlLabels: false,
          look: 'classic',
          theme: 'base',
          // ELK is a flowchart default, not a universal layout. For example,
          // mindmaps require their own native layout and root-node contract.
          ...(/^\s*(?:---[\s\S]*?---\s*)?(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\b/.test(code)
            ? { layout: 'elk' }
            : {}),
          fontFamily: font,
          flowchart: {
            curve: 'linear',
            padding: 14,
            nodeSpacing: 24,
            rankSpacing: 32,
            diagramPadding: 14,
          },
          sequence: { useMaxWidth: true },
          railroad: {
            terminalFill: colors.surface,
            terminalStroke: colors.border,
            terminalTextColor: colors.fg,
            nonTerminalFill: colors.surface,
            nonTerminalStroke: colors.border,
            nonTerminalTextColor: colors.fg,
            lineColor: colors.accent,
            markerFill: colors.accent,
            ruleNameColor: colors.fg,
          },
          gantt: {
            useWidth: 720,
            useMaxWidth: true,
            fontSize: 13,
            sectionFontSize: 13,
            barHeight: 26,
            barGap: 8,
            axisFormat: '%m-%d',
            // Mermaid chooses suitable ticks for the date range by default.
            // Explicit tickInterval in the document still takes precedence.
          },
          themeVariables: {
            darkMode: dark,
            fontFamily: font,
            fontSize: '14px',
            background: colors.bg,
            primaryColor: colors.surface,
            primaryTextColor: colors.fg,
            primaryBorderColor: colors.border,
            lineColor: colors.accent,
            secondaryColor: colors.bg,
            secondaryTextColor: colors.fg,
            tertiaryColor: colors.surface,
            tertiaryTextColor: colors.fg,
            textColor: colors.fg,
            mainBkg: colors.surface,
            nodeBorder: colors.border,
            clusterBkg: colors.bg,
            clusterBorder: colors.border,
            edgeLabelBackground: colors.bg,
            actorBkg: colors.surface,
            actorTextColor: colors.fg,
            actorBorder: colors.border,
            signalColor: colors.accent,
            signalTextColor: colors.fg,
            noteBkgColor: dark ? '#3E3929' : '#FFF4D5',
            noteTextColor: colors.fg,
            noteBorderColor: colors.border,
            gridColor: colors.border,
            sectionBkgColor: dark ? '#252931' : '#F5F6F8',
            sectionBkgColor2: colors.bg,
            excludeBkgColor: dark ? '#282C32' : '#EEF1F5',
            taskBkgColor: dark ? '#344961' : '#D8E7FA',
            taskBorderColor: colors.border,
            taskTextColor: colors.fg,
            taskTextDarkColor: colors.fg,
            taskTextOutsideColor: colors.fg,
            activeTaskBkgColor: dark ? '#345B8B' : '#BAD3F2',
            activeTaskBorderColor: colors.accent,
            doneTaskBkgColor: dark ? '#344B42' : '#DDECE2',
            doneTaskBorderColor: dark ? '#698D7B' : '#91B09E',
            // Categoric colors must not derive from the nearly identical app
            // background/surface colors. Keep category hues stable across themes.
            ...categories,
            packet: {
              startByteColor: colors.fg,
              endByteColor: colors.fg,
              labelColor: colors.fg,
              titleColor: colors.fg,
              blockStrokeColor: colors.border,
              blockFillColor: colors.surface,
            },
            treeView: {
              labelColor: colors.fg,
              lineColor: colors.muted,
              iconColor: colors.accent,
              descriptionColor: colors.fg,
            },
            emSwimlaneBackgroundOdd: colors.surface,
            emSwimlaneBackgroundStroke: colors.border,
            archEdgeColor: colors.accent,
            archEdgeArrowColor: colors.accent,
            archGroupBorderColor: colors.muted,
            wardley: {
              backgroundColor: colors.bg,
              axisColor: colors.muted,
              axisTextColor: colors.fg,
              gridColor: colors.border,
              componentFill: colors.surface,
              componentStroke: colors.accent,
              componentLabelColor: colors.fg,
              linkStroke: colors.accent,
              evolutionStroke: dark ? '#EF848A' : '#A52F44',
              annotationStroke: colors.accent,
              annotationTextColor: colors.fg,
              annotationFill: colors.surface,
            },
            cynefin: {
              textColor: colors.fg,
              labelColor: colors.fg,
              boundaryColor: colors.accent,
              arrowColor: colors.accent,
              cliffColor: dark ? '#EF848A' : '#A52F44',
              complexBg: dark ? '#243E32' : '#E8F5E9',
              complicatedBg: dark ? '#293C52' : '#E3F2FD',
              chaoticBg: dark ? '#47323A' : '#FBE9E7',
              clearBg: dark ? '#443E2C' : '#FFF8E1',
              confusionBg: dark ? '#3E3350' : '#F3E5F5',
            },
            xyChart: { plotColorPalette: palette.join(',') },
            radar: { axisColor: colors.fg, graticuleColor: colors.border },
            pieOpacity: '1',
            pieStrokeColor: colors.bg,
            pieStrokeWidth: '2px',
            pieOuterStrokeColor: colors.border,
            pieTitleTextColor: colors.fg,
            pieLegendTextColor: colors.fg,
            pieSectionTextColor: '#182330',
          },
          maxTextSize: 50000,
          maxEdges: 500,
        });
        output = (await m.render('moyu-mermaid-' + (++id), code)).svg;
      });
      queue = render.catch(() => {});
      await render;
      return output;
    })();
    cache.set(key, task);
    void task.then(value => {
      cacheBytes.set(key, value.length * 2);
      let bytes = [...cacheBytes.values()].reduce((sum, size) => sum + size, 0);
      // Keep a whole gallery reusable, with a bounded memory budget. Pending
      // renders stay shared so leaving a page never queues duplicate work.
      for (const oldest of cache.keys()) {
        if (cache.size <= 128 && bytes <= 12 * 1024 * 1024) break;
        const size = cacheBytes.get(oldest);
        if (size === undefined) continue;
        cache.delete(oldest);
        cacheBytes.delete(oldest);
        bytes -= size;
      }
    }, () => {
      cache.delete(key);
      cacheBytes.delete(key);
    });
  }
  const parsed = new DOMParser().parseFromString(await cache.get(key)!, 'image/svg+xml'),
    root = parsed.documentElement;
  if (root.tagName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) {
    throw new Error('图表渲染失败。');
  }
  const imported = document.importNode(root, true) as unknown as SVGSVGElement;
  vectorizeDiagramLabels(imported, font, colors.fg);
  centerMindmapLabels(imported);
  const svg = cleanSvg(imported),
    prefix = 'moyu-diagram-' + (++id),
    ids = new Map<string, string>();
  applyMermaidSize(svg);
  // Mermaid's Sankey multiply blend makes colored ribbons almost black on
  // dark backgrounds. Normal compositing keeps the original gradient visible.
  svg.querySelectorAll<SVGElement>('.links .link').forEach(link => {
    link.style.mixBlendMode = 'normal';
  });
  // Timeline's native renderer hardcodes black arrows. Keep this adjustment
  // scoped to its own SVG so other diagram styles remain document controlled.
  if (svg.getAttribute('aria-roledescription') === 'timeline') {
    svg.querySelectorAll<SVGElement>('.lineWrapper line').forEach(line => {
      line.style.stroke = colors.fg;
    });
    svg.querySelectorAll<SVGElement>('marker path').forEach(path => {
      path.style.fill = colors.fg;
    });
  }
  // Wardley anchors bypass its configurable component label color.
  if (dark && svg.getAttribute('aria-roledescription') === 'wardley') {
    svg.querySelectorAll<SVGElement>('.wardley-node-label[fill="#000"]').forEach(label => {
      label.style.fill = colors.fg;
    });
  }
  if (!svg.id) {
    svg.id = prefix;
    svg.querySelectorAll('style').forEach(style => {
      style.textContent = (style.textContent || '').replace(
        /^\s*text\s*\{/m,
        '#' + prefix + ' text {',
      ).replace(/^\s*svg\s*\{/m, '#' + prefix + ' {');
    });
  }
  for (const element of [svg, ...svg.querySelectorAll('[id]')]) {
    ids.set(element.id, prefix + '-' + element.id);
  }
  const urls = (text: string) =>
    text.replace(
      /url\(["']?#([^\s)'";]+)["']?\)/g,
      (whole, name) => ids.has(name) ? 'url(#' + ids.get(name) + ')' : whole,
    );
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) {
      if (attr.name === 'id') {
        element.id = ids.get(attr.value)!;
      } else if (
        ['href', 'xlink:href'].includes(attr.name) && attr.value.startsWith('#')
        && ids.has(attr.value.slice(1))
      ) {
        element.setAttribute(attr.name, '#' + ids.get(attr.value.slice(1)));
      } else element.setAttribute(attr.name, urls(attr.value));
    }
  }
  svg.querySelectorAll('style').forEach(style => {
    let css = urls((style.textContent || '').replace(/@import\s+(?:url\([^;]*\)|[^;]+);/gi, ''));
    for (const [old, next] of ids) {
      css = css.replaceAll('#' + old + '{', '#' + next + '{').replaceAll(
        '#' + old + ' ',
        '#' + next + ' ',
      ).replaceAll('#' + old + ':', '#' + next + ':');
    }
    style.textContent = css;
  });
  return svg;
}
async function update(element: HTMLElement) {
  const state = states.get(element);
  if (!state) return;
  const revision = ++state.revision;
  try {
    const svg = await diagramSvg(state.code);
    applyMermaidSize(svg, element.dataset.mermaidMeta || '');
    if (revision === state.revision) {
      element.replaceChildren(svg);
      element.classList.remove('diagram-error');
    }
  } catch (error) {
    if (revision === state.revision) {
      element.textContent = 'Mermaid：' + (error as Error).message;
      element.classList.add('diagram-error');
    }
  } finally {
    if (revision === state.revision) delete element.dataset.previewLoading;
  }
}
export function mermaidPreview(code: string, apply?: (value: HTMLElement) => void) {
  const element = document.createElement('div');
  element.className = 'mermaid-diagram';
  element.setAttribute('aria-label', 'Mermaid 图表');
  element.dataset.mermaidSource = encodeURIComponent(code);
  element.textContent = '正在绘制图表…';
  element.dataset.previewLoading = 'true';
  states.set(element, { code, revision: 0 });
  if (apply) {
    // Milkdown sanitizes and clones preview HTML. Updating the original node
    // does not update that clone; apply the completed preview explicitly.
    const token = 'preview-' + (++id);
    element.dataset.mermaidToken = token;
    void update(element).then(() => {
      if (document.querySelector('[data-mermaid-token="' + token + '"]')) {
        apply(element.cloneNode(true) as HTMLElement);
      }
    });
  } else void update(element);
  return element;
}
window.addEventListener('moyu-diagram-theme', () => {
  document.querySelectorAll<HTMLElement>('.mermaid-diagram[data-mermaid-source]').forEach(
    element => {
      if (!states.has(element)) {
        states.set(element, {
          code: decodeURIComponent(element.dataset.mermaidSource || ''),
          revision: 0,
        });
      }
      void update(element);
    },
  );
});
