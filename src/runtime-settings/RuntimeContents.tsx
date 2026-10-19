import { useEffect, useRef, useState } from "react";
import { api } from "../bridge";
import { useRuntimePanelActive } from './RuntimeLayout';

import { RuntimeFileTree } from './RuntimeFileTree';
import { runtimeFileTree, runtimeFolder, type RuntimeFileEntry } from './runtimeTree';

type Contents = {
  version: string;
  installed: boolean;
  groups: { title: string; files: RuntimeFileEntry[] }[];
};
export function RuntimeContents({ language, version, sourceKey = "", active = true }: {
  language: string;
  version?: string;
  sourceKey?: string;
  active?: boolean;
}) {
  const panelActive = useRuntimePanelActive();
  const ref = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  const [contents, setContents] = useState<Contents | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    if (active && panelActive && visible && version) {
      setContents(null);
      setError("");
      void api.feature<Contents>("runtime.contents", { language, version }).then(value => {
        if (alive) setContents(value);
      }).catch(e => {
        if (alive) setError(e.message);
      });
    }
    return () => {
      alive = false;
    };
  }, [language, version, sourceKey, active, panelActive, visible]);
  return (
    <div className="runtime-contents" ref={ref} aria-label="环境内容">
      {error ? <p className="feature-error" role="alert">{error}</p> : contents
        ? (
          <>
            <p className="runtime-contents-title">
              <strong>{contents.installed ? "已安装内容" : "安装内容"}</strong>
              <span>{contents.version}</span>
            </p>
            {contents.groups.map((group, index) => (
              <section key={group.title}>
                <h5>{group.title}</h5>
                <RuntimeFileTree nodes={runtimeFileTree(group.files, runtimeFolder(language, index === 0))} downloads={!contents.installed} />
              </section>
            ))}
          </>
        )
        : <p className="muted-note" role="status">读取文件清单…</p>}
    </div>
  );
}
