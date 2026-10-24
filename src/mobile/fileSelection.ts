import type {FileNode} from '../types';

/** A selected folder already contains its selected descendants. */
export function selectedRoots(tree:FileNode[],selected:Set<string>):FileNode[] {
  return tree.flatMap(node=>selected.has(node.path)?[node]:node.kind==='folder'?selectedRoots(node.children||[],selected):[]);
}

export function visibleFileNodes(tree:FileNode[],showHidden=false):FileNode[] {
  return tree.flatMap(node=>!showHidden&&(node.system||node.companionFor||node.name.endsWith('.assets')||node.name==='code-data')?[]:[node,...(node.kind==='folder'?visibleFileNodes(node.children||[],showHidden):[])]);
}
