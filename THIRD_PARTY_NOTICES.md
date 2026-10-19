# Third-party notices

## PDF reader

PDF.js / pdfjs-dist **6.4.299** (Apache-2.0; https://github.com/mozilla/pdf.js).
Worker, CMaps, standard fonts and WASM decoders are bundled offline.
Only the text-layer stylesheet is reused, scoped to the PDF reader.
Complete license and dependency notices are in resources/licenses/DIAGRAM-DEPENDENCIES.txt.

## SQL and Lua

SQL runs in unmodified sql.js **1.14.2** (MIT; https://github.com/sql-js/sql.js).
SQLite is in the public domain (https://www.sqlite.org/copyright.html).
Lua runs in Wasmoon **1.16.0** (MIT; https://github.com/ceifa/wasmoon), using
Lua 5.4 (MIT; https://www.lua.org/license.html). Runtime assets and their
SHA-256 manifests are under resources/sql/ and resources/lua/. The sandbox
integration under electron/runner/ is Moyu source; no host runtime is invoked.

SQL formatting uses the community Lax SQL **0.3.0** dprint WASM plugin
(MIT; https://github.com/bartlomieju/lax-sql).
Lua formatting uses the unmodified community dprint-plugin-stylua **0.2.1**
(GPL-3.0-only; https://github.com/RubixDev/dprint-plugin-stylua), adapting
StyLua **0.15.2** (MPL-2.0; https://github.com/JohnnyMorganz/StyLua).
Complete formatter license notices are in resources/formatters/.
The original plugin and StyLua source archives, their hashes and build
instructions are distributed in resources/formatters/source/ in both the
application and the source archive. This third-party module retains its GPL
license; it is not relicensed under Moyu's MIT notice. The plugins run offline
through @dprint/formatter in a separate worker and have no WASM host imports.

Moyu uses [Milkdown](https://github.com/Milkdown/milkdown) and its Crepe editor,
version **7.22.2**. The upstream repository was cloned from GitHub and inspected
at commit `bbb8bcbbb8ce0aa16f92567c23f6236747be9b3b` on 2026-10-04. The application
uses the official published packages of that same version, not a substitute
editor. React integration follows the upstream `@milkdown/react` API.

## Milkdown MIT license

The MIT License (MIT)

Copyright (c) 2020-present Mirone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Other dependencies

The integrated canvas uses @excalidraw/excalidraw **0.18.1** (MIT), loaded on
demand. Its upstream license is included in resources/EXCALIDRAW_LICENSE.txt.
The editor includes the package's offline font assets without modification.
Font copyright and license information is included in resources/FONT_LICENSES.txt
and the original WOFF2 metadata. The bundled fonts include the SIL Open Font
License; they are distributed as application assets, not sold separately.

WebDAV uses webdav **5.11.0** (MIT, Perry Mitchell).

Sources: [Excalidraw](https://github.com/excalidraw/excalidraw),
[webdav-client](https://github.com/perry-mitchell/webdav-client).

Electron (MIT), React (MIT), CodeMirror (MIT), Lucide (ISC), KaTeX (MIT),
ProseMirror (MIT), and the dependencies of Milkdown retain their own licenses.
The package lock records exact resolved versions. Electron's distributed
Chromium notices are included in the packaged runtime.

## Offline Python and Markdown reading dependencies

The unmodified Pyodide 314.0.7 core is distributed from the official npm package
with integrity pinned in package-lock.json. Corresponding source:
https://github.com/pyodide/pyodide/tree/314.0.7 . Mozilla Public License 2.0 text:
resources/PYODIDE_LICENSE.txt . Python 3.14.2 license and additional notices:
resources/PYTHON_LICENSE.txt and resources/PYTHON_THIRD_PARTY_LICENSES.txt .
No Python package collection or user-installed package cache is included.
The application runner is separate source under electron/runner/.

The reading pipeline uses unified, remark, rehype and KaTeX. Their license
notices, together with bundled dependency notices, are in
resources/DEPENDENCY_LICENSES.txt . Renderer and native bundlers also retain
license comments. Excalidraw and KaTeX font files include their corresponding
font notices.

The complete Chinese Excalidraw locale in resources/excalidraw-zh-CN.json is
derived from Excalidraw 0.18.1 (MIT), with wording corrections and translations
for missing entries.
scripts/excalidraw-adapter.ts integrates that locale, numeric opacity input, and
offline fonts at build time; it disables development hooks and remote font
fallbacks. It does not modify files in node_modules.

File icons are from Material Icon Theme for VS Code:
https://github.com/material-extensions/vscode-material-icon-theme
Upstream commit dd1547babd192e3a307d8acfb2325306b6e89e4d (2026-10-05).
628 static SVGs and generated file associations are included; no VS Code runtime
or extension dependency is installed. MIT license and original copyright:
resources/Material-Icon-Theme-LICENSE.txt.

Custom drawing fonts are selected from user-installed system fonts through local font access. They are not added to the distributed application or copied to a font attachment cache. SVG exports may embed selected font glyphs; users remain responsible for those fonts’ export permissions. Offline Python version/package catalogs contain metadata only; optional runtimes and packages are downloaded solely on explicit user installation and retain upstream licenses.


Code formatting uses @dprint/formatter 0.5.1 (MIT; https://github.com/dprint/js-formatter), dprint-plugin-typescript 0.96.1 (MIT; https://github.com/dprint/dprint-plugin-typescript), dprint-plugin-ruff 0.9.1 (MIT; https://github.com/dprint/dprint-plugin-ruff), which adapts Ruff (https://github.com/astral-sh/ruff), and the community dprint-clang-format 0.1.0 plugin (MIT wrapper and Apache-2.0 with LLVM exceptions; https://github.com/sargunv/dprint-clang-format). Pinned Wasm plugins run offline in a dedicated worker thread, without executing document code or starting a host runtime/compiler. The clang-format WASM has no host imports and supports native clang-format JSON options. Package source URLs and SHA-256 hashes are in resources/formatters/manifest.json; complete upstream license texts, including plugin dependency notices, are in that directory. Prettier, autopep8 and pycodestyle are no longer used for code formatting.


Mermaid 12.1.0 (MIT; https://github.com/mermaid-js/mermaid),
@mermaid-js/layout-elk 1.0.1 (MIT; the same upstream),
and ELK.js (EPL-2.0; https://github.com/kieler/elkjs) provide local SVG diagrams.
Unmodified upstream JavaScript is bundled; complete direct license notices
are included under resources/licenses/. Corresponding ELK source is linked
from that license and https://github.com/kieler/elkjs; no ELK source changes
are made. Diagrams do not load remote font stylesheets. Third-party packages
remain pinned in package-lock.json.


## Runtime installation and npm bundling

esbuild 0.28.2 (MIT) provides the packaged Windows bundler. node-semver 7.7.4
(ISC) resolves npm dependency versions. Complete notices are included in
resources/licenses/esbuild-LICENSE.txt and resources/licenses/semver-LICENSE.txt.
C/C++, SQL and Lua engines are installed separately; their upstream license
files remain in the downloaded packages. Package install scripts are not run.

## Highlight delimiters

The == delimiter resolver in shared/remark-highlight.mjs adapts the attention
resolution algorithm from micromark-extension-gfm-strikethrough (MIT).

(The MIT License)

Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Optional .NET and Java WebAssembly environments

C# uses the MIT-licensed RoslynWeb compiled browser bridge, .NET runtime and Roslyn.
Verified runtime assets are downloaded from https://wieslawsoltes.github.io/RoslynWeb/dist/; the exact sizes and SHA-256 receipts are in resources/browser-runtimes/catalog.json.
Java uses TeaVM and teavm-javac under Apache-2.0, downloaded from https://teavm.org/playground/. The class library includes OpenJDK components under GPL-2.0 with the Classpath Exception.
The corresponding license texts are in resources/licenses and are copied into each installed environment. These engines are not embedded in the application package.
C# formatting uses @dprint/roslyn 0.23.1 (MIT). Java formatting uses prettier-plugin-java 2.8.1 (Apache-2.0) with Prettier 3.6.2 (MIT), through the common formatting configuration. Formatter packages retain their upstream license files in the installed environment.

## Optional Ruby and Bash environments and terminal

Ruby uses @ruby/4.0-wasm-wasi and @ruby/wasm-wasi 2.10.1. Ruby is licensed under the Ruby or BSD 2-Clause license; ruby.wasm is MIT licensed. Original Ruby sources: https://github.com/ruby/ruby; Ruby.wasm sources: https://github.com/ruby/ruby.wasm. Bash uses @everruns/bashkit-wasm 0.18.2 under MIT (https://github.com/everruns/bashkit). Engines install on demand; license texts in resources/licenses are copied into installed environments. npm package versions retain upstream sources and notices.
The terminal uses @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0 and node-pty 1.1.0 under MIT; Windows ConPTY native components and upstream notices are included in resources/terminal/node-pty.
