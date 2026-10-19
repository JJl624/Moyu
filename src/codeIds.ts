import { normalizeIds } from "../shared/code-documents.mjs";
export const exhaustedIdsMessage = '代码块 ID 已用完，新代码块无法运行。请新建文档。';
const counters = new Map<string, number>();
let namespace = "";
export function setCodeNamespace(root: string) {
  namespace = root;
}
const key = (root: string | undefined, path: string) => `${root ?? namespace}\0${path}`;
export const idFloor = (root: string | undefined, path: string) =>
  counters.get(key(root, path)) || 1;
export function reserveIds(root: string | undefined, path: string, next: number) {
  counters.set(key(root, path), Math.max(idFloor(root, path), next));
}
export function normalizeCodeIds(root: string | undefined, path: string, content: string) {
  const result = normalizeIds(content, idFloor(root, path));
  reserveIds(root, path, result.next);
  return result;
}
