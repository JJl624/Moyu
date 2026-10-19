export const settingLabels={executionTimeoutSeconds:'代码执行时限',preparationTimeoutSeconds:'环境准备时限',stdinFile:'标准输入文件',autoMain:'自动补全入口',multiFile:'编译数据目录中的源文件',cHeaders:'默认 C 头文件',cppHeaders:'默认 C++ 头文件',cStandard:'C 语言标准',cppStandard:'C++ 语言标准',usings:'默认 using 命名空间',mainClass:'主类',databaseFile:'数据库文件',foreignKeys:'外键约束',maxRows:'查询行数上限',enableModules:'加载本地模块',maxCommands:'命令数上限',maxLoopIterations:'循环次数上限',memoryLimitMB:'内存上限',optimizationLevel:'编译优化'};
export const additionalExamples={
  Python:c=>`
## CSV、对象与异常处理

这段代码只使用标准库，无需安装包。CSV 的表头保留中文；结果同时以文本和文件提供。
${c('python',`import csv
from dataclasses import dataclass
from io import StringIO
from pathlib import Path

@dataclass
class Order:
    name: str
    amount: int

orders = [Order("苹果", 12), Order("梨", 8)]
buffer = StringIO()
writer = csv.writer(buffer)
writer.writerow(["名称", "金额"])
writer.writerows((order.name, order.amount) for order in orders)
Path("output").mkdir(exist_ok=True)
Path("output/orders.csv").write_text(buffer.getvalue(), encoding="utf-8")
print(buffer.getvalue(), end="")
try:
    int("不是数字")
except ValueError:
    print("输入格式错误")`)}
预期看到两条订单、CSV 文件和“输入格式错误”。保存结果或打开数据目录都可以查看完整 CSV。

## 二进制与嵌套目录
${c('py',`from pathlib import Path
import struct
folder = Path("output/nested")
folder.mkdir(parents=True, exist_ok=True)
(folder / "values.bin").write_bytes(struct.pack("<3i", 2, 4, 6))
print(struct.unpack("<3i", (folder / "values.bin").read_bytes()))`)}
输出为 (2, 4, 6)。二进制文件提供保存入口，文本文件提供有限长度的预览。

## 设置说明

依赖页用于管理 numpy、matplotlib 等 Pyodide 包。包随所选运行环境安装，不在不同环境之间混用。代码执行时限限制用户代码，环境准备时限用于加载核心与依赖；重启释放内存中的环境和包，不删除安装文件。

## 下载公共文件（需要联网）

download 将公共 HTTP(S) 文件保存到当前块的数据目录，单个文件上限为 20 MB。
${c('python',`from js import moyu_download
from pathlib import Path
await moyu_download("https://example.com/", "input/example.html")
print(Path("input/example.html").read_text(encoding="utf-8")[:200])`)}
`,
  JavaScript:c=>`
## 文件接口：文本、二进制和目录

用 JavaScript 模式运行。files 只访问当前块目录；writeFile 会创建所需的子目录。
${c('js',`await files.writeFile("output/nested/readme.txt", "你好，文件接口");
await files.writeFile("output/bytes.bin", new Uint8Array([0, 1, 127, 255]));
console.log(await files.readFile("output/nested/readme.txt"));
console.log(await files.list());`)}

## DOM：排序过程与交互

选择 DOM / HTML，再运行。点击“下一步”观察冒泡排序；点击“重置”恢复初始数组。原生 DOM、事件和样式均在这个块自己的页面中生效。
${c('js',`const values = [7, 3, 9, 1, 5];
const original = [...values];
const root = document.createElement("section");
root.style.cssText = "padding:16px;font:14px system-ui;background:#f3f6fa;color:#263238";
const bars = document.createElement("div");
bars.style.cssText = "display:flex;align-items:end;gap:8px;height:150px;margin-bottom:16px";
const step = document.createElement("button");
step.textContent = "下一步";
const reset = document.createElement("button");
reset.textContent = "重置";
let pass = 0, index = 0;
function draw() {
  bars.replaceChildren(...values.map((value, position) => {
    const bar = document.createElement("div");
    bar.textContent = String(value);
    bar.style.cssText = "width:32px;text-align:center;color:white;height:" + value * 14 + "px;background:" + (position === index ? "#c56a4d" : "#5178b1");
    return bar;
  }));
}
step.onclick = () => {
  if (pass >= values.length - 1) return;
  if (values[index] > values[index + 1]) [values[index], values[index + 1]] = [values[index + 1], values[index]];
  if (++index >= values.length - pass - 1) { index = 0; pass++; }
  draw();
};
reset.onclick = () => { values.splice(0, values.length, ...original); pass = index = 0; draw(); };
root.append(bars, step, reset);
document.body.append(root);
draw();`)}
结果可以调整高度并钉住；钉住后修改代码仍保留已有页面，成功重跑后替换。重新打开恢复的是代码生成的初始页面，而非当时的排序进度。

## 设置说明

依赖页管理共享的 npm 包；在线安装按选定版本下载，本地导入接受 .tgz 或带依赖的包目录。安装脚本不执行。普通 JS 与 DOM / HTML 共享依赖，各块的变量、文件和 DOM 独立。代码执行时限限制普通 JS 或 DOM 初始化，准备时限包含依赖打包。TypeScript 格式化选项同时作用于 JavaScript。

## 下载与 fetch（需要联网）

JavaScript 模式用 files.download，保存后可以继续读取文件。
${c('js',`await files.download("https://example.com/", "input/example.html");
console.log((await files.readFile("input/example.html")).slice(0, 200));`)}
DOM / HTML 模式支持 fetch 读取公共 HTTP(S) 资源。保存数据时写入当前块目录。
${c('js',`const response = await fetch("https://example.com/");
const html = await response.text();
await files.writeFile("input/example.html", html);
const preview = document.createElement("pre");
preview.textContent = html.slice(0, 200);
document.body.append(preview);`)}
`,
  'C-C++':c=>`
## C：程序参数与标准库

右键此块，选择“运行（参数）”，添加 hello 和 42 后运行。此例使用完整的 main 函数。
${c('c',`#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) printf("参数 %d：%s\\n", i, argv[i]);
    printf("整数转换：%d\\n", atoi("42"));
    return 0;
}`)}

## C++：容器、算法与文件
${c('cpp',`#include <vector>
#include <algorithm>
#include <fstream>
std::vector<int> values = {7, 3, 9, 1, 5};
std::sort(values.begin(), values.end());
std::ofstream out("output/sorted.txt");
for (int value : values) { std::cout << value << ' '; out << value << '\\n'; }
std::cout << std::endl;`)}
预期输出 1 3 5 7 9，并产生 sorted.txt。

## 设置说明

自动包裹为不含 main 的代码片段补充入口；完整 main 保持原样。默认头文件会在编译时添加 include，因此片段可以直接使用对应声明。多文件编译决定数据目录中的 .c / .cpp 是否参与链接，头文件仍可引用；关闭后，外部源文件中定义的函数不会参与链接。

标准输入文件默认 stdin.txt，scanf / cin 一次读取预置内容，不会弹出交互输入框。该路径可指向当前块目录的任何输入文件；留空表示没有标准输入。

编译优化使用 Clang 的实际 -O 参数：默认保持工具链设置；O0 便于观察未经优化的逻辑，O2 / O3 偏向运行性能，Os / Oz 偏向体积。更改优化级别会重新编译，程序参数的更改不需要更改源码。C 与 C++ 的语言标准和默认头文件分别设置。
`,
  CSharp:c=>`
## 泛型、LINQ 与分组
${c('csharp',`var orders = new[] {
    new { Source = "App", Amount = 120 },
    new { Source = "Web", Amount = 80 },
    new { Source = "App", Amount = 40 }
};
foreach (var group in orders.GroupBy(order => order.Source))
    Console.WriteLine($"{group.Key}: {group.Sum(order => order.Amount)}");`)}
输出 App: 160 和 Web: 80。

## 完整入口与异常处理
${c('cs',`public class Program {
    public static void Main(string[] args) {
        Console.WriteLine("参数：" + string.Join(", ", args));
        try { int.Parse("错误输入"); }
        catch (FormatException) { Console.WriteLine("请输入整数"); }
    }
}`)}

## 设置说明

“运行（参数）”中添加的参数传给入口的 args。标准输入文件用于 Console.ReadLine 等读取，路径相对块级数据目录。多文件编译决定辅助 .cs 是否加入当前项目。默认 using 为代码补充命名空间，引用 LINQ 等 API 时需要 System.Linq。

C# 环境由 .NET WebAssembly 和 Roslyn 组成。辅助源码和输出保存在当前块目录，类库由运行环境提供。
`,
  Java:c=>`
## 集合、Lambda 与完整主类
${c('java',`import java.util.ArrayList;
import java.util.Collections;
public class SortDemo {
    public static void main(String[] args) {
        ArrayList<Integer> values = new ArrayList<>();
        Collections.addAll(values, 7, 3, 9, 1, 5);
        values.sort((left, right) -> Integer.compare(left, right));
        System.out.println(values);
        System.out.println("参数：" + String.join(", ", args));
    }
}`)}
预期输出 [1, 3, 5, 7, 9]。主类留空自动检测 SortDemo；也可以在设置中指定 SortDemo。

## 设置说明

主类用于指定启动入口，适合项目包含多个 main 的情况；留空时自动识别。通过“运行（参数）”将参数传给 main 的 args。自动入口补全为片段添加类与 main，完整类保持原样。多文件编译决定辅助 .java 是否参与编译。

准备时限包含 javac 与 TeaVM 编译，执行时限只限制生成程序的运行。格式化使用 Java 插件；entrypoint 可选择完整文件、语句或其他片段的解析方式。Java 当前没有标准输入和运行时文件访问，预置 .java 文件仅参与编译。
`,
  SQL:c=>`
## 外键、触发器和窗口函数
${c('sql',`CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), amount INTEGER);
CREATE TABLE IF NOT EXISTS payment_log(payment_id INTEGER, amount INTEGER);
CREATE TRIGGER IF NOT EXISTS log_payment AFTER INSERT ON payments
BEGIN INSERT INTO payment_log VALUES (NEW.id, NEW.amount); END;
INSERT OR IGNORE INTO customers VALUES (1, '张三');
INSERT OR REPLACE INTO payments VALUES (1, 1, 120), (2, 1, 80);
SELECT id, amount, SUM(amount) OVER (ORDER BY id) AS running_total FROM payments;
SELECT * FROM payment_log;`)}
同一次运行可显示多个查询表格。外键约束开启时，无对应客户的付款插入会报错；关闭时允许插入。触发器和视图保存在所选数据库中。

## 长表与分页
${c('sqlite',`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 200)
SELECT n, n * n AS square FROM numbers;`)}
结果按页显示。把查询行数上限改为 25 后重跑，只预览前 25 行并提示截断；原表的数据不被删除。

## 设置说明

内存模式的数据库只在一次执行内存在，结束清除。块级数据库保存到本块目录；全局数据库保存到本文档的 SQL_GLOBAL，由文档内的 SQL 块共享。数据库文件名用于选择持久数据库：切换到其他文件会打开另一个数据库，旧文件保持原样。数据库文件浏览器提供只读查询和结构查看，包括表、视图、索引、触发器及系统元数据。
`,
  Lua:c=>`
## 表、元表与协程
${c('lua',`local point = setmetatable({x = 3, y = 4}, {
  __tostring = function(p) return string.format("(%d, %d)", p.x, p.y) end
})
print(point)
local sequence = coroutine.create(function()
  for i = 1, 3 do coroutine.yield(i * i) end
end)
while coroutine.status(sequence) ~= "dead" do
  local ok, value = coroutine.resume(sequence)
  if ok and value then print(value) end
end
for index, value in ipairs(arg) do print(index, value) end`)}
输出 (3, 4)、1、4、9。通过“运行（参数）”添加 alpha 和 beta 后，arg[1] 与 arg[2] 对应这两个值。

## 设置说明

标准输入文件用于 io.read，相对路径从当前块目录开始，读取至末尾返回 nil。加载本地模块控制 require：开启时可加载模块名.lua 或模块名/init.lua，不开放主机动态库。程序参数按顺序放入 arg，从 arg[1] 开始。准备时限限制 Wasmoon 加载，执行时限限制用户代码；重启释放引擎内存，数据文件保留。
`,
  Ruby:c=>`
## 集合、正则和异常
${c('ruby',`orders = [{name: "苹果", amount: 12}, {name: "梨", amount: 8}]
puts orders.map { |order| "#{order[:name]}: #{order[:amount]}" }
puts orders.sum { |order| order[:amount] }
puts "订单号: A102".match(/A\\d+/)[0]
begin
  Integer("错误输入")
rescue ArgumentError
  puts "请输入整数"
end`)}
输出两条订单、总额 20、A102 和“请输入整数”。

## 设置说明

“运行（参数）”中的参数对应 ARGV；标准输入文件对应 STDIN，路径相对块级目录。运行环境分别显示 Ruby 系列与 WASM 构建版本，RUBY_VERSION 返回实际引擎版本。环境包含标准库，不加载主机 Gem 或原生扩展。代码执行时限限制脚本，准备时限限制环境与依赖加载。
`,
  Bash:c=>`
## 函数、循环与文件
${c('bash',`total=0
for value in 2 4 6 8; do total=$((total + value)); done
printf "总和：%s\\n" "$total"
mkdir -p output/nested
printf "%s\\n" "$total" > output/nested/total.txt
if [ -f output/nested/total.txt ]; then cat output/nested/total.txt; fi`)}
输出总和 20 和文件内容 20。块模式保留该文件；内存模式执行结束后删除虚拟文件。

## 设置说明

“运行（参数）”中的参数通过 $1、$2、$* 等读取；标准输入文件用于 read。执行时限限制运行时间，命令数和循环次数分别限制解释器工作量，内存上限用于 Bashkit 的虚拟内存。块模式保留输入和输出文件；内存模式从空目录开始，运行后清除，适合独立脚本。

从终端的新建菜单选择 Bash (Wasm) 可以连续输入命令并保留会话状态；选择 PowerShell、cmd 或本机 Bash 会操作主机环境，与代码块的隔离运行方式不同。
`
};
