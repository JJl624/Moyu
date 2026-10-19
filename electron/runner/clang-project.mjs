import { prepareClangSource, analyze, maskedSource } from '../clang-source.cjs';
import { nameOf, decode } from './run-files.mjs';
const sourceFile = name => /\.(c|cc|cpp|cxx)$/i.test(name);
export function clangProject(input) {
  const settings = input.clangSettings;
  const files = (input.files || []).map(file => ({ name: nameOf(file.name), bytes: decode(file.data) }));
  const sourceNames = new Set(files.map(file => file.name));
  let entry = '_moyu_entry.' + (input.language === 'c' ? 'c' : 'cpp');
  while (sourceNames.has(entry)) entry = '_' + entry;
  let sourceBytes = 0, units = 0;
  const byName = new Map(files.map(file => [file.name, file]));
  // The compiler's MemFS uses JS string lengths for path buffers. Keep its
  // internal paths ASCII; actual data filenames and diagnostics stay readable.
  let unicodeRoot = '_moyu_utf8';
  while (files.some(file => file.name === unicodeRoot || file.name.startsWith(unicodeRoot + '/'))) unicodeRoot += '_';
  const compilerName = name => /[^\x00-\x7f]/.test(name)
    ? unicodeRoot + '/' + Array.from(new TextEncoder().encode(name), byte => byte.toString(16).padStart(2, '0')).join('') + (name.match(/\.[^.\/]+$/)?.[0].replace(/[^a-zA-Z.\d]/g, '') || '')
    : name;
  const relativeName = (directory, target) => {
    const parts = [];
    for (const part of (directory + target).split('/')) {
      if (part === '..') { if (!parts.length) return ''; parts.pop(); }
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  };
  const localInclude = (directory, name) => [relativeName(directory, name), name].find(value => byName.has(value));
  const rewriteIncludes = (text, directory = '') => {
    const masked = maskedSource(text);
    return text.replace(/^(\s*#\s*(?:include|embed)\s*)["<]([^">]+)[">]/gm, (whole, prefix, target, offset) => {
      if (!/^#\s*(?:include|embed)\s*$/.test(masked.slice(offset, offset + prefix.length).trim())) return whole;
      const name = localInclude(directory, target);
      return name ? prefix + '"' + compilerName(name) + '"' : whole;
    });
  };
  const binaryNames = new Set();
  const needed = new Set(files.filter(file => !file.name.startsWith('output/') && (sourceFile(file.name) ? settings.multiFile : /\.(h|hh|hpp|hxx|inc|inl|tpp)$/i.test(file.name))).map(file => file.name));
  for (const header of [...settings.cHeaders, ...settings.cppHeaders]) if (byName.has(header)) needed.add(header);
  const scanIncludes = (text, directory = '') => {
    const masked = maskedSource(text);
    for (const match of text.matchAll(/^(\s*#\s*(include|embed)\s*)["<]([^">]+)[">]/gm)) {
      if (!/^#\s*(?:include|embed)\s*$/.test(masked.slice(match.index, match.index + match[1].length).trim())) continue;
      const name = localInclude(directory, match[3]);
      if (name) { needed.add(name); if (match[2] === 'embed') binaryNames.add(name); }
    }
  };
  scanIncludes(input.code);
  // Set iteration visits newly discovered headers, including extensionless ones.
  for (const name of needed) {
    const file = byName.get(name);
    if (!binaryNames.has(name) && file.bytes.length <= 2 * 1024 * 1024) scanIncludes(new TextDecoder().decode(file.bytes), name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '');
  }
  const workspaceFiles = files.filter(file => needed.has(file.name) && (settings.multiFile || !sourceFile(file.name))).map(file => {
    let content = file.bytes;
    if (sourceFile(file.name)) {
      sourceBytes += content.length; units++;
      if (content.length > 2 * 1024 * 1024 || sourceBytes > 8 * 1024 * 1024 || units > 32) throw new Error('编译源文件最多 32 个、共 8 MB，单个最多 2 MB。');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
      content = prepareClangSource(text, file.name.endsWith('.c') ? 'c' : 'cpp', { ...settings, autoMain: false }, file.name);
    } else if (!binaryNames.has(file.name)) content = new TextDecoder('utf-8', { fatal: true }).decode(content);
    if (typeof content === 'string') content = rewriteIncludes(content, file.name.includes('/') ? file.name.slice(0, file.name.lastIndexOf('/') + 1) : '');
    return { path: 'workspace/' + compilerName(file.name), content };
  });
  const otherMain = workspaceFiles.some(file => sourceFile(file.path) && analyze(typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)).main);
  const code = rewriteIncludes(prepareClangSource(input.code, input.language === 'c' ? 'c' : 'cpp', { ...settings, autoMain: settings.autoMain && !otherMain }));
  const stdin = settings.stdinFile ? files.find(file => file.name === settings.stdinFile)?.bytes : undefined;
  return { code, entry: 'workspace/' + entry, workspaceFiles, stdin };
}
