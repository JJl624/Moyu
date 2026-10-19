export type RuntimeFileEntry = {
  id?: string;
  name: string;
  type?: string;
  package?: string;
  version?: string;
  url?: string;
  projectURL?: string;
  sourcePage?: string;
  bytes?: number;
  builtin?: boolean;
  purpose?: string;
  dependencyIds?: string[];
  requiredFiles?: RuntimeFileEntry[];
};
export type RuntimeTreeNode<T extends RuntimeFileEntry = RuntimeFileEntry> = {
  key: string;
  name: string;
  detail?: string;
  kind: 'folder' | 'file' | 'package' | 'dependencies';
  entry?: T;
  children: RuntimeTreeNode<T>[];
};

export function runtimePathTree<T extends RuntimeFileEntry>(entries: T[]): RuntimeTreeNode<T>[] {
  const roots: RuntimeTreeNode<T>[] = [];
  for (const entry of entries) {
    const parts = entry.name.split(/[\\/]+/).filter(Boolean);
    let siblings = roots, key = '';
    parts.forEach((name, index) => {
      key += '/' + name;
      const leaf = index === parts.length - 1;
      let node = siblings.find(candidate => candidate.key === key);
      if (!node) {
        node = { key, name, kind: leaf ? 'file' : 'folder', children: [] };
        siblings.push(node);
      }
      if (leaf) node.entry = entry;
      siblings = node.children;
    });
  }
  return roots;
}

export function runtimeFileTree<T extends RuntimeFileEntry>(entries: T[], folder?: string): RuntimeTreeNode<T>[] {
  const identity = (entry: T) => entry.id || entry.name + '@' + (entry.version || '');
  const indexed = new Map(entries.map(entry => [identity(entry), entry]));
  const referenced = new Set(entries.flatMap(entry => entry.dependencyIds || []));
  const seen = new Set<string>();
  const visit = (entry: T, parents = new Set<string>()): RuntimeTreeNode<T> => {
    const key = identity(entry);
    const visited = seen.has(key);
    seen.add(key);
    const chain = new Set([...parents, key]);
    const dependencies = (visited ? [] : entry.dependencyIds || []).flatMap(id => {
      const dependency = indexed.get(id);
      return dependency && !chain.has(id) ? [visit(dependency, chain)] : [];
    });
    const children: RuntimeTreeNode<T>[] = entry.requiredFiles
      ? runtimePathTree(entry.requiredFiles) as RuntimeTreeNode<T>[] : [];
    if (dependencies.length) children.push({ key: key + ':dependencies', name: '依赖包', kind: 'dependencies', children: dependencies });
    return { key, name: entry.type === 'bundle' ? 'dist/' : entry.type === 'npm' && entry.package ? entry.package : entry.name,
      detail: entry.type === 'npm' ? entry.name : undefined,
      kind: entry.type === 'bundle' ? 'folder' : entry.type === 'npm' ? 'package' : 'file', entry, children };
  };
  const roots = entries.filter(entry => !referenced.has(identity(entry))).map(entry => visit(entry));
  // A dependency cycle may have no unreferenced root.
  for (const entry of entries) if (!seen.has(identity(entry))) roots.push(visit(entry));
  return folder ? [{ key: folder, name: folder + '/', kind: 'folder', children: roots }] : roots;
}

export function runtimeFolder(language: string, compiler = true): string | undefined {
  return compiler ? ({ python: 'Pyodide', java: 'TeaVM' } as Record<string, string>)[language] : undefined;
}
