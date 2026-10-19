import { useEffect, useRef } from 'react';
import { runtimeKind } from '../../shared/code-languages.mjs';
import { api } from '../bridge';
import { codeBlocks } from '../codeBlocks';

// Keep only language names for inactive documents, never a second code snapshot.
export function useRunEnvironments(root: string, path: string, markdown: string, tabs: string[]) {
  const retained = useRef({ root, kinds: new Map<string, Set<string>>() });
  useEffect(() => {
    if (retained.current.root !== root) retained.current = { root, kinds: new Map() };
    const { kinds } = retained.current;
    if (tabs.includes(path)) {
      kinds.set(
        path,
        new Set(
          codeBlocks(markdown).flatMap(b => {
            const kind = runtimeKind(b.language);
            return kind ? [kind] : [];
          }),
        ),
      );
    }
    let closed = false;
    for (const document of kinds.keys()) {
      if (!tabs.includes(document)) {
        kinds.delete(document);
        closed = true;
      }
    }
    // An unvisited restored tab may still need a warm environment. Wait until
    // its languages are known before releasing anything on its behalf.
    if (closed && root && api.desktop && tabs.every(tab => kinds.has(tab))) {
      void api.feature('code.release-idle', {
        root,
        keep: [...new Set([...kinds.values()].flatMap(k => [...k]))],
      }).catch(() => {});
    }
  }, [root, path, markdown, tabs]);
}
