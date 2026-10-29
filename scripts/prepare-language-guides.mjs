import {ARGUMENT_VALUES,ARGUMENT_CODE} from "../shared/argument-examples.mjs";
import {additionalExamples,settingLabels} from "./language-guide-examples.mjs";
import fs from 'node:fs/promises';import path from 'node:path';import{createRequire}from'node:module';const require=createRequire(import.meta.url),{DEFAULTS}=require('../electron/runtime-settings.cjs'),root=path.resolve(import.meta.dirname,'../resources/workspace-guide');
const descriptions={executionTimeoutSeconds:'执行时限，单位秒',preparationTimeoutSeconds:'环境、包或编译准备时限，单位秒',stdinFile:'标准输入文件，路径相对当前块；留空为 EOF',autoMain:'代码片段自动包裹入口函数',multiFile:'一同编译数据目录中的源文件',cHeaders:'默认 C 头文件',cppHeaders:'默认 C++ 头文件',cStandard:'C 语言标准',cppStandard:'C++ 语言标准',usings:'默认 using 命名空间',mainClass:'Java 主类；留空自动检测',databaseFile:'持久数据库文件名',foreignKeys:'启用外键约束',maxRows:'每个查询显示的行数上限，最多 1000',enableModules:'允许加载当前数据目录中的 Lua 模块',maxCommands:'单次执行命令数上限',maxLoopIterations:'循环迭代次数上限',memoryLimitMB:'解释器内存限制，单位 MB',optimizationLevel:'使用 Clang -O 优化级别，默认保持工具链设置'};
const back='\n\n[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)\n';
async function guide(name,kind,render){let next=1;const blocks=[],fixtures=[];const code=(language,source,files)=>{const id=(next++).toString(16).padStart(4,'0');blocks.push(id);if(files)fixtures.push({id,files});return '\n```'+language+' {id='+id+'}\n'+source.trim()+'\n```\n';};let text='# '+({CSharp:'C#','C-C++':'C / C++'}[name]||name)+'\n\n'+render(code)+(additionalExamples[name]?.(code)||'');const argumentKind=kind||(name==='Python'?'python':null);if(ARGUMENT_CODE[argumentKind]){const sample=ARGUMENT_CODE[argumentKind];text+='\n## 程序参数\n\n右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。\n\n参数依次为 '+ARGUMENT_VALUES[argumentKind].map(value=>'`'+value+'`').join('、')+'，分别表示单价、数量和折扣。以下代码用于'+sample.purpose+'。未填写参数时使用相同的默认值。\n'+code(sample.language,sample.code)+'\n预期输出：'+sample.output.split('\n').map(value=>'`'+value+'`').join('、')+'。\n';}if(kind){text+='\n## 设置\n\n在“偏好设置 → 代码 → '+({javascript:'JavaScript',clang:'C / C++',csharp:'C#',java:'Java',sql:'SQL',lua:'Lua',ruby:'Ruby',bash:'Bash'}[kind]||name)+'”配置该语言的运行环境与默认设置。\n\n| 设置 | 默认值 | 用途 |\n| --- | --- | --- |\n';for(const [key,value]of Object.entries(DEFAULTS[kind]))text+='| '+(settingLabels[key]||key)+' | '+(value===''?'自动 / 空':Array.isArray(value)?value.join(', ')||'空':typeof value==='boolean'?(value?'开启':'关闭'):(value==='default'?'工具链默认':String(value)))+' | '+(descriptions[key]||settingLabels[key])+' |\n';}text+=back;const doc='代码示例/'+name+'.md';await fs.mkdir(path.join(root,'代码示例'),{recursive:true});await fs.writeFile(path.join(root,doc),text);if(blocks.length){const assets=path.join(root,'代码示例/'+name+'.assets');await fs.mkdir(assets,{recursive:true});await fs.writeFile(path.join(assets,'document.json'),JSON.stringify({version:2,document:doc,nextId:next,blocks},null,2));for(const {id,files}of fixtures){const directory=path.join(assets,'code-data',id);await fs.mkdir(directory,{recursive:true});for(const [file,content]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(directory,file)),{recursive:true});await fs.writeFile(path.join(directory,file),content);}}}return {doc,blocks,nextId:next};}
const records=[];
records.push(await guide('运行与数据',null,()=>`代码块右上角的“运行”执行代码，结果显示在下方。“停止”结束当前执行。

## 程序参数

右键代码块，选择“运行（参数）”。逐项输入参数后点击“运行”；也可以粘贴多行参数，每行一项。空格和引号按输入原样传入。单击加号可添加空参数。

参数用于本次执行。再次打开弹框时内容为空，普通“运行”使用空参数。Python、C / C++、C#、Java、Lua、Ruby 和 Bash 支持程序参数。

## 环境与依赖

默认运行环境随程序提供。各语言的“环境”页可切换版本、安装其他版本或导入本地文件；Python 和 JavaScript 的“依赖”页管理共用包。

运行设置作用于该语言的代码块。下拉和开关即时应用，文本与数字输入在离开控件时应用。

## 本地导入

在“环境 → 本地导入”选择下载好的文件或文件夹。程序识别版本、列出依赖并验证文件，完成后点击“添加并启用”。

| 语言 | 所需文件 |
| --- | --- |
| Python | 同一版本的 Pyodide 核心文件：pyodide.mjs、pyodide.asm.mjs、pyodide.asm.wasm、python_stdlib.zip、pyodide-lock.json；旧版加载器为 .js |
| C / C++ | @live-codes/clang-wasm 及其依赖的 npm .tgz 文件 |
| SQL | sql.js 的 npm .tgz 文件 |
| Lua | wasmoon 及其依赖的 npm .tgz 文件 |
| Ruby | 对应系列的 Ruby WASM 包、同版本的 @ruby/wasm-wasi 及依赖 |
| Bash | @everruns/bashkit-wasm 的 npm .tgz 文件 |
| C# | 包含 dist/_framework 的运行文件夹或 ZIP，以及表中的格式化插件 |
| Java | 表中列出的 TeaVM 编译器、标准库和格式化依赖 |

C# 的“打开官方下载页”提供运行文件的获取入口，选择 roslynweb-source-and-wasm 压缩包。安装表格将运行文件与格式化工具分开列出。

Python 包导入选择当前清单中的 .whl / .zip；JavaScript 包选择 npm .tgz 或包含依赖的包目录。

## 下载源

npm 包与格式化工具使用“npm 下载源”。C# / Java 的运行文件有单独的下载源；自定义地址填写文件所在的服务器目录，并保留表中的相对路径。下载时可查看进度或取消。

## 数据目录

文档的附件和代码数据位于同级附属目录。例如，笔记.md 对应笔记.assets，其中 attachments 保存图片等资源，“code-data/0001”保存对应代码块的数据。

右键代码块 → 查看数据目录，可在“文档信息 → 数据”中定位该块。添加文件使用右上角的导入按钮，新建文件可指定名称和扩展名。数据页支持语言、已有目录和未关联目录筛选。

运行时的 /data 对应当前块的数据目录。输入文件从这里读取，写入的数据也保存在这里。代码块使用独立运行环境，主机文件通过数据页导入；终端可直接操作本机。

移动或复制文档时，附属目录一起处理。删除代码块后，已有数据保留为“未关联”，可在数据页重新关联。每个 ID 绑定一个代码块，修改语言保留 ID 和目录。

## 结果

文本、图片、文件、HTML 和 SQL 表格显示在代码块下方。表格可翻页，文本文件可预览或完整保存。临时结果在修改代码、关闭文档或退出时清除，已写入数据目录的文件保留。

HTML 结果可钉住，保存页面和窗口高度。重新运行成功后更新结果；重新打开时，页面从初始状态加载。

| 项目 | 上限 |
| --- | --- |
| 单个数据文件 | 20 MB |
| 每块代码数据 | 40 MB、128 个文件 |
| 文本输出 | 64 KB |
| 查询结果 | 每次最多显示 1000 行，分组翻页 |

## 编辑与格式化

语言声明支持缩写和大小写变化。height 属性设置代码块高度；Tab 缩进，Shift+Tab 减少缩进。

右键“格式化代码”使用当前格式化配置。各工具及其选项见“偏好设置 → 代码 → 通用 → 代码格式化”。标签代码块可切换标签和格式化代码。
`));
records.push(await guide('Python',null,c=>`语言声明 python / py。支持标准库、科学计算包、相对模块与文件读写；每次执行使用独立变量空间，复用已加载的包。

## 代码片段与包
${c('python','import json\nvalues = [2, 4, 6, 8]\nprint(json.dumps({"mean": sum(values) / len(values)}, ensure_ascii=False))')}
在 Python 设置中查询并安装 numpy、matplotlib 等包。依赖项由环境管理，不单独提供卸载按钮。
${c('py','import numpy as np\nimport matplotlib.pyplot as plt\nvalues = np.array([2, 4, 6, 8])\nprint(values.mean())\nplt.plot(values, marker="o")\nplt.title("Sample")\nplt.show()')}

## 多文件与输入输出

此块的目录已放入 helper.py、input.json 和 stdin.txt。import 会找到当前目录的模块；通过显式读取 stdin.txt 获取输入；这里没有交互式 input。
${c('python','from helper import twice\nimport json\nfrom pathlib import Path\nvalues = json.loads(Path("input.json").read_text(encoding="utf-8"))\nprint([twice(v) for v in values])\nprint("输入：", Path("stdin.txt").read_text(encoding="utf-8").strip())\nPath("output").mkdir(exist_ok=True)\nPath("output/result.json").write_text(json.dumps(values), encoding="utf-8")',{'helper.py':'def twice(value):\n    return value * 2\n','input.json':'[2,4,6,8]','stdin.txt':'21\n'})}
输出目录中的图片、表格和文件可显示为结果；写到其他路径的文件仍保留在代码数据中。

## 设置

在“偏好设置 → 代码 → Python”管理这些选项。环境目录位于应用数据中，不安装到系统 Python。

| 选项 | 默认 / 用法 |
| --- | --- |
| 执行时限 | 10 秒，只计代码执行 |
| 环境准备时限 | 60 秒，包含核心和首次加载包 |
| Runtime | 自带 314.0.7；刷新、安装、切换、删除其他兼容版本 |
| 包管理 | 名称搜索、安装状态筛选、安装、刷新包清单；被依赖的包不显示卸载 |
| 镜像 | 选择下载源，可添加、编辑和移除；填写名称与下载服务器 |
| 镜像目录结构 | 高级设置可选版本目录或 CDN 的 v版本/full/ 目录 |
| 版本列表地址 | 镜像高级设置中的目录索引，用于刷新可安装版本 |
| 重启环境 | 释放已加载的环境和包状态，保留已安装文件 |

输入文件添加到此块的数据目录，通过相对路径访问。下载文件使用 download(url, 文件名)，包版本由所选 Pyodide 环境决定。
`));
records.push(await guide('JavaScript','javascript',c=>`声明 js / javascript 或 ts / typescript。块上选择“JavaScript”或“DOM / HTML”，这是每块的运行选择，设置页没有默认运行模式。

## JavaScript 与 TypeScript

JavaScript 模式适合算法与数据处理，支持 console、顶层 await 和浏览器 API。DOM / HTML 模式用于页面交互。TypeScript 在运行前移除类型声明。
${c('js','const values = [2, 4, 6, 8];\nconsole.log(values.reduce((a, b) => a + b, 0) / values.length);')}
${c('ts','type Point = { x: number; y: number };\nconst point: Point = { x: 3, y: 4 };\nconsole.log(Math.hypot(point.x, point.y));')}

## 多文件与数据

此块目录预置 config.json 和 input.json。files 是软件提供的虚拟文件接口；本地文件用 files 读取，import 用于已安装的 npm 包。
${c('js','const { multiplier } = JSON.parse(await files.readFile("config.json"));\nconst values = JSON.parse(await files.readFile("input.json"));\nconsole.log(values.map(value => value * multiplier));\nawait files.writeFile("output/result.json", JSON.stringify(values));\nconsole.log(await files.list());',{'config.json':'{"multiplier":2}','input.json':'[2,4,6,8]'})}

## npm

在设置中安装 lodash-es 等浏览器兼容包；选择已安装版本后两个运行模式均能 import。依赖包供代码块共用，数据文件按代码块管理。请选择浏览器兼容的 npm 包。
${c('js','import { chunk } from "lodash-es";\nconsole.log(chunk([1, 2, 3, 4, 5], 2));')}

## DOM / HTML

以下块运行前切换为 DOM / HTML。每块拥有独立的 sandbox iframe，提供 document、Canvas、事件、计时器、Web Audio 等浏览器 API。初始化完成后可继续交互，执行时限作用于初始化阶段。fetch 支持公共 HTTP(S) GET。
${c('js','const button = document.createElement("button");\nbutton.textContent = "点击计数：0";\nlet count = 0;\nbutton.onclick = () => button.textContent = `点击计数：\u0024{++count}`;\ndocument.body.append(button);')}
${c('ts','const canvas = document.createElement("canvas");\ncanvas.width = 360; canvas.height = 180;\ndocument.body.append(canvas);\nconst ctx = canvas.getContext("2d")!;\nctx.fillStyle = "#5892fa";\nctx.fillRect(20, 30, 160, 80);')}

## 完整 HTML 页面

displayHTML 是软件提供的函数，可载入完整页面，应用 head/body 属性、样式并执行页面脚本。直接用 body.innerHTML 插入 HTML 时，浏览器不会执行其中的 script；简单交互可以像上面的示例一样用原生 DOM 创建并绑定。

以下两个目录分别预置像素鸟.html 与 PulseCore-8.html，用于演示完整页面的加载与交互。选择 DOM / HTML 运行；游戏使用点击/空格操作，音序器点击运行后启用声音。结果框可拖动到合适高度并钉住。HTML 文件也能直接打开，默认源码，切换阅读后交互。
${c('js','displayHTML(await files.readFile("像素鸟.html"));')}
${c('js','displayHTML(await files.readFile("PulseCore-8.html"));')}

使用 files 读取数据目录中的 HTML，再用 displayHTML 显示。页面引用的数据文件可转换为 blob 或 data URL。
`));
records.push(await guide('C-C++','clang',c=>`语言声明 c 或 cpp / c++ / cc / cxx。使用 Clang WASI 工具链；头文件和 main 包裹可在设置中选择，编译和运行都与主机隔离。

## 片段与完整程序

默认 C 头文件为 stdio.h、stdlib.h，C++ 为 iostream。没有 main 时自动包裹，因此可以直接运行片段；已有 main 时使用原入口。
${c('c','printf("Hello C\\n");')}
${c('cpp','std::cout << "Hello C++" << std::endl;')}
${c('c','#include <stdio.h>\nint main(void) {\n    printf("完整程序\\n");\n    return 0;\n}')}

## 多文件 C

此块目录含 util.h、util.c 与 stdin.txt。开启多文件后，源文件加入同一次编译；本地 include 从当前块目录解析，scanf/cin 从设置中的输入文件读取。
${c('c','#include "util.h"\nint value = 0;\nscanf("%d", &value);\nprintf("%d\\n", twice(value));\nFILE *out = fopen("output/result.txt", "w");\nif (out) { fprintf(out, "%d\\n", twice(value)); fclose(out); }',{'util.h':'int twice(int value);\n','util.c':'#include "util.h"\nint twice(int value) { return value * 2; }\n','stdin.txt':'21\n'})}

## 多文件 C++
${c('cpp','#include "helper.hpp"\nint value = 0;\nstd::cin >> value;\nstd::cout << twice_cpp(value) << std::endl;',{'helper.hpp':'int twice_cpp(int value);\n','helper.cpp':'#include "helper.hpp"\nint twice_cpp(int value) { return value * 2; }\n','stdin.txt':'21\n'})}
设置页列出工具链提供的头文件。勾选后自动加入，也可在代码内 include。文件读写使用当前块数据目录中的相对路径。
`));
records.push(await guide('CSharp','csharp',c=>`语言声明 csharp / cs / c#。安装 .NET WebAssembly / Roslyn 环境后，可写顶层语句或完整 Main；默认 using 在设置中配置。
${c('csharp','var values = new[] { 2, 4, 6, 8 };\nConsole.WriteLine(values.Average());')}

## 多文件与输入输出

此块预置 Helper.cs 与 stdin.txt；开启多文件时编译数据目录中的 .cs，读标准输入及输出文件都使用当前块目录。
${c('cs','int value = int.Parse(Console.ReadLine() ?? "0");\nConsole.WriteLine(Helper.Twice(value));\nFile.WriteAllText("output/result.txt", Helper.Twice(value).ToString());\nConsole.WriteLine(File.ReadAllText("output/result.txt"));',{'Helper.cs':'public static class Helper { public static int Twice(int value) => value * 2; }\n','stdin.txt':'21\n'})}
${c('csharp','Console.WriteLine(string.Join(", ", Environment.GetCommandLineArgs()));')}
C# 使用 .NET WebAssembly 环境，每次执行创建独立的程序状态。可用 API 以该环境提供的 .NET 类库为准。
`));
records.push(await guide('Java','java',c=>`语言声明 java。TeaVM / javac 在浏览器中编译，再通过 WebAssembly 执行。没有类声明的片段可自动包裹 Main；完整程序应提供 main。
${c('java','int[] values = {2, 4, 6, 8};\nint sum = 0;\nfor (int value : values) sum += value;\nSystem.out.println(sum / (double) values.length);')}

## 多文件与参数

此块预置 Helper.java。勾选多文件后，目录中的 Java 源文件加入编译。可在设置中指定主类，否则从编译结果中自动检测。
${c('java','public class Main {\n    public static void main(String[] args) {\n        System.out.println(Helper.twice(21));\n        System.out.println("参数数量：" + args.length);\n    }\n}',{'Helper.java':'public class Helper { public static int twice(int value) { return value * 2; } }\n'})}
Java 使用 TeaVM 编译为 WebAssembly，支持其 Java 标准库子集；辅助 .java 文件参与同一项目编译。当前运行环境支持参数和控制台输出，文件 I/O、标准输入、线程与 JNI 暂不可用。
`));
records.push(await guide('SQL','sql',c=>`声明 sql / sqlite，使用 sql.js。代码块上的下拉框选择块级、全局或内存数据库。

## 可独立执行的查询
${c('sql','SELECT 21 * 2 AS answer, sqlite_version() AS sqlite_version;')}

## 数据持久化

先运行下块建表；再将下一个块切换为全局运行，两个块才能共享同一库。若都选块级，它们各自拥有数据库，第二块会提示表不存在。
${c('sql','CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, source TEXT, amount REAL);\nINSERT INTO orders(source, amount) VALUES (\'App\', 120), (\'Web\', 80);\nSELECT * FROM orders;')}
${c('sqlite','SELECT source, COUNT(*) AS orders, SUM(amount) AS total\nFROM orders GROUP BY source;')}

块级数据库保存在本块目录；全局位于本页附属目录的code-data/SQL_GLOBAL，只在本文档内共享。SQL_GLOBAL 不随单块删除，随文档删除或手动删除而消失。内存模式每次从空库开始，运行结束关闭，不生成数据库文件。

## SQLite 语法与事务
${c('sql','CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, title TEXT);\nBEGIN;\nINSERT INTO notes(title) VALUES (\'第一条\');\nCOMMIT;\nCREATE VIEW IF NOT EXISTS note_titles AS SELECT title FROM notes;\nCREATE INDEX IF NOT EXISTS notes_title_idx ON notes(title);\nSELECT type, name FROM sqlite_schema WHERE name NOT LIKE \'sqlite_%\';')}
使用 SQLite 方言，查询结果按表展示并分页。行数上限控制结果预览。可从文件浏览器打开 .sqlite 文件进行只读查询和查看表、视图、索引、触发器等结构。
`));
records.push(await guide('Lua','lua',c=>`声明 lua，使用 Wasmoon。提供 Lua 标准库与本地模块，文件位于块级虚拟 /data。
${c('lua','local values = {2, 4, 6, 8}\nlocal total = 0\nfor _, value in ipairs(values) do total = total + value end\nprint(total / #values)')}

## 模块、标准输入与文件

此块预置 calc.lua 和 stdin.txt；开启模块设置后可以 require。io.read 使用配置的输入文件。
${c('lua','local calc = require("calc")\nlocal value = tonumber(io.read("*l"))\nprint(calc.twice(value))\nlocal out = assert(io.open("output/result.txt", "w"))\nout:write(tostring(calc.twice(value)))\nout:close()',{'calc.lua':'return { twice = function(value) return value * 2 end }\n','stdin.txt':'21\n'})}
没有主机进程、主机动态库或主机文件访问。新建 Lua 状态隔离变量；写进代码数据的文件会保留，临时结果关闭不删除文件。
`));
records.push(await guide('Ruby','ruby',c=>`声明 ruby / rb，使用 ruby+stdlib.wasm。刷新列出 Ruby 4.0、3.4、3.3、3.2 系列中可适配的稳定构建；“构建”是 ruby.wasm 的发布版本，和 Ruby 版本不同。
${c('ruby','require "json"\nputs RUBY_VERSION\nvalues = [2, 4, 6, 8]\nputs JSON.generate({ total: values.sum, count: values.length })')}

## 相对模块、输入和文件

此块预置 helper.rb 与 stdin.txt。require_relative 从 /data 中加载；STDIN 读取输入文件；ARGV 来自设置。
${c('rb','require_relative "helper"\nvalue = STDIN.read.to_i\nputs Helper.twice(value)\nputs ARGV.inspect\nFile.write("output/result.txt", Helper.twice(value).to_s)\nputs File.read("output/result.txt")',{'helper.rb':'module Helper\n  def self.twice(value)\n    value * 2\n  end\nend\n','stdin.txt':'21\n'})}
Ruby 引擎提供标准库，每次执行创建独立的程序状态。文件通过块级数据目录读写。
`));
records.push(await guide('Bash','bash',c=>`声明 bash / sh / shell，使用 Bashkit 解释器，不启动主机 shell。支持其内置命令、变量、函数、管道、重定向和虚拟文件系统。

代码块下拉可选“块”或“内存”。块模式读写自己的代码数据目录；内存模式每次从空目录开始，结束后丢弃文件，不创建持久目录，也不读取块模式已有的数据。选择属于当前会话的运行配置，不写入 Markdown。
${c('bash','printf "%s\\n" cherry apple banana | sort\nmkdir -p output\nprintf "hello\\n" > output/result.txt\ncat output/result.txt')}

## 多文件脚本与输入

此块预置 helper.sh 和 stdin.txt。source 在虚拟目录加载脚本；read 从输入文件读取，位置参数来自设置。
${c('sh','source helper.sh\nread value\ntwice "$value"\nprintf "参数：%s\\n" "$*"',{'helper.sh':'twice() { echo "$(( $1 * 2 ))"; }\n','stdin.txt':'21\n'})}
多文件示例应使用块模式；内存模式没有预置 helper.sh 或 stdin.txt。

Bashkit 提供内置命令、管道、重定向和脚本。主机命令在本机 Shell 终端执行；Bash (Wasm) 使用虚拟文件系统。资源上限可在设置中调整。
`));
records.push(await guide('终端',null,()=>`点击右下角终端按钮或 Ctrl+反引号打开。本机 Shell 默认工作目录是当前知识库，可直接操作本机文件和程序。新建下拉中的 Bash (Wasm) 则使用独立的虚拟文件系统。

## Shell 和启动选项

Shell 是解释命令的程序。“偏好设置 → 终端”选择默认 Shell，或指定程序文件。自动检测 Windows 的命令提示符、PowerShell、Git Bash / WSL，或 macOS/Linux 的 Zsh、Bash、Fish、Sh。没有安装的 Shell 不列出。

“启动选项”传给 Shell 程序。例如 PowerShell 可以每行填写 -NoLogo、-NoProfile，分别关闭启动横幅和个人配置加载；留空也可以。要执行的命令在终端中输入。更改默认programs/选项只影响之后新建的会话。

## 会话与布局

“新建终端”下拉可以临时选择不同 Shell。新会话插在当前之后；关闭回到前一个相邻标签。输入 exit 关闭当前会话，最后一个退出后关闭面板。面板右上角叉号关闭所有终端。

隐藏只收起界面，进程继续运行；右下角图标上的减号表示存在隐藏会话，普通图标表示已关闭。再次点击恢复。可以在编辑区下方或右侧显示，拖动分隔条调整大小。

字体、字号、行高、光标和回滚行数在设置中调整。Ctrl+Shift+C/V 复制/粘贴，本机 Shell 的 Ctrl+C 用于中断进程；右键也可复制/粘贴。输出和回滚有上限，不保存日志。退出应用会关闭终端进程。

## Bash (Wasm)

使用内置 Bash 环境，从新建终端下拉选择 Bash (Wasm)。当前目录是 /data；变量和文件在这个终端的会话内保留，关闭后清除，不与其他终端或代码块共享。

支持历史命令、左右移动、删除和多行循环、引号续行。输入未完成的语句时显示 > 提示符，补齐后执行。空输入时 Ctrl+D 或输入 exit 关闭当前会话。Ctrl+C 清除未执行的输入；执行期间 Ctrl+C 会关闭这个虚拟会话，随后可重新打开。

Bashkit 终端支持内置命令、管道、重定向和脚本，文件位于该会话的虚拟目录。每条命令遵循 Bash 设置中的时限、命令数、循环和内存限制。
`));
await fs.writeFile(path.join(root,'代码示例/索引.md'),'# 代码示例\n\n按语言查阅代码、输入文件和设置说明。HTML 小窗口可在电脑和手机上使用，其余运行示例在电脑版执行。\n\n- [HTML 小窗口](HTML.md)\n- [二叉树遍历：四种顺序](../数据结构/二叉树遍历.md)\n'+records.map(r=>'- ['+path.basename(r.doc,'.md')+']('+path.basename(r.doc)+')').join('\n')+'\n');
export const languageGuideRecords=records;
