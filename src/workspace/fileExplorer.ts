import type { FileNode } from '../types';
export type FileSort = 'name' | 'type' | 'updated' | 'created';
export interface ExplorerOrder {
  key: FileSort;
  descending: boolean;
}
const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export const sortLabels: Record<FileSort, string> = {
  name: '文件名',
  type: '文件类型',
  updated: '修改日期',
  created: '创建日期',
};
const extension = (name: string) => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
const defaults: ExplorerOrder[] = [
  { key: 'name', descending: false },
  { key: 'type', descending: false },
  { key: 'updated', descending: true },
  { key: 'created', descending: true },
];
export function normalizeOrder(value: unknown): ExplorerOrder[] {
  const input = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const result: ExplorerOrder[] = [];
  for (const item of input) {
    if (
      item && typeof item === 'object' && typeof item.key === 'string' && Object.hasOwn(sortLabels, item.key)
      && !result.some(order => order.key === item.key)
    ) {
      result.push({ key: item.key as FileSort, descending: item.descending === true });
    }
  }
  for (const item of defaults) if (!result.some(order => order.key === item.key)) result.push({ ...item });
  return result;
}
export function toggleOrder(order: ExplorerOrder[], key: FileSort): ExplorerOrder[] {
  return order.map(item => item.key === key ? { ...item, descending: !item.descending } : item);
}
export function moveOrder(order: ExplorerOrder[], key: FileSort, target: FileSort): ExplorerOrder[] {
  const from = order.findIndex(item => item.key === key), to = order.findIndex(item => item.key === target);
  if (from < 0 || to < 0 || from === to) return order;
  const result = [...order], [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}
export function explorerTree(nodes: FileNode[], order: ExplorerOrder[], showCompanions: boolean): FileNode[] {
  return nodes.filter(n => showCompanions || !n.companionFor && !n.system).map(n =>
    n.children
      ? { ...n, children: explorerTree(n.children, order, showCompanions) }
      : n
  ).sort((a, b) => {
    for (const item of order) {
      let comparison = 0;
      if (item.key === 'updated' || item.key === 'created') {
        const av = a[item.key], bv = b[item.key];
        if (av === undefined || bv === undefined) {
          if (av !== bv) return av === undefined ? 1 : -1;
        } else comparison = av - bv;
      } else {comparison = names.compare(
          item.key === 'type' ? extension(a.name) : a.name,
          item.key === 'type' ? extension(b.name) : b.name,
        );}
      if (comparison) return comparison * (item.descending ? -1 : 1);
    }
    return a.path.localeCompare(b.path);
  });
}
export function companionNode(nodes: FileNode[], active: string): FileNode | null {
  for (const node of nodes) {
    if (node.companionFor === active || node.companionFor && active.startsWith(node.path + '/')) return node;
    const nested = node.children && companionNode(node.children, active);
    if (nested) return nested;
  }
  return null;
}
