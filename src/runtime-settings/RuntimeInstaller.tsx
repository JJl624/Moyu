import { type ReactNode, useState } from "react";
import { ManualRuntimeImport } from "./ManualRuntimeImport";
import { RuntimeContents } from "./RuntimeContents";
import { RuntimeSection } from "./RuntimeLayout";

export function RuntimeInstaller(
  {
    language,
    version,
    busy,
    online,
    refresh,
    importEnvironment,
    installed = [],
    importFiles,
    checking,
    sourceKey = "",
  }: {
    language: string;
    version?: string;
    busy: boolean;
    online: ReactNode;
    refresh: ReactNode;
    installed?: string[];
    importEnvironment(token: string): Promise<void>;
    importFiles(token: string): Promise<void>;
    checking?(value: boolean): void;
    sourceKey?: string;
  },
) {
  const [mode, setMode] = useState("online");
  return (
    <RuntimeSection title="安装与导入">
      <div className="runtime-add-form">
        <div className="runtime-install-toolbar">
          <div className="runtime-install-method" role="group" aria-label="环境安装方式">
            <button aria-pressed={mode === "online"} disabled={busy} onClick={() => setMode("online")}>在线安装</button>
            <button aria-pressed={mode === "local"} disabled={busy} onClick={() => setMode("local")}>本地导入</button>
          </div>
          <div className="runtime-refresh-action" hidden={mode !== "online"}>{refresh}</div>
        </div>
        <div hidden={mode !== "online"}>
          {online}
          <RuntimeContents language={language} version={version} sourceKey={sourceKey} active={mode === "online"} />
        </div>
        <div className="runtime-local-import" hidden={mode !== "local"}>
          <ManualRuntimeImport
            language={language}
            active={mode === "local"}
            busy={busy}
            installed={installed}
            checking={checking}
            install={importFiles}
            importEnvironment={importEnvironment}
          />
        </div>
      </div>
    </RuntimeSection>
  );
}
