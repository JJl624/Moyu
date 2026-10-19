# JavaScript

声明 js / javascript 或 ts / typescript。块上选择“JavaScript”或“DOM / HTML”，这是每块的运行选择，设置页没有默认运行模式。

## JavaScript 与 TypeScript

JavaScript 模式适合算法与数据处理，支持 console、顶层 await 和浏览器 API。DOM / HTML 模式用于页面交互。TypeScript 在运行前移除类型声明。

```js {id=0001}
const values = [2, 4, 6, 8];
console.log(values.reduce((a, b) => a + b, 0) / values.length);
```


```ts {id=0002}
type Point = { x: number; y: number };
const point: Point = { x: 3, y: 4 };
console.log(Math.hypot(point.x, point.y));
```


## 多文件与数据

此块目录预置 config.json 和 input.json。files 是软件提供的虚拟文件接口；本地文件用 files 读取，import 用于已安装的 npm 包。

```js {id=0003}
const { multiplier } = JSON.parse(await files.readFile("config.json"));
const values = JSON.parse(await files.readFile("input.json"));
console.log(values.map(value => value * multiplier));
await files.writeFile("output/result.json", JSON.stringify(values));
console.log(await files.list());
```


## npm

在设置中安装 lodash-es 等浏览器兼容包；选择已安装版本后两个运行模式均能 import。依赖包供代码块共用，数据文件按代码块管理。请选择浏览器兼容的 npm 包。

```js {id=0004}
import { chunk } from "lodash-es";
console.log(chunk([1, 2, 3, 4, 5], 2));
```


## DOM / HTML

以下块运行前切换为 DOM / HTML。每块拥有独立的 sandbox iframe，提供 document、Canvas、事件、计时器、Web Audio 等浏览器 API。初始化完成后可继续交互，执行时限作用于初始化阶段。fetch 支持公共 HTTP(S) GET。

```js {id=0005}
const button = document.createElement("button");
button.textContent = "点击计数：0";
let count = 0;
button.onclick = () => button.textContent = `点击计数：${++count}`;
document.body.append(button);
```


```ts {id=0006}
const canvas = document.createElement("canvas");
canvas.width = 360; canvas.height = 180;
document.body.append(canvas);
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#5892fa";
ctx.fillRect(20, 30, 160, 80);
```


## 完整 HTML 页面

displayHTML 是软件提供的函数，可载入完整页面，应用 head/body 属性、样式并执行页面脚本。直接用 body.innerHTML 插入 HTML 时，浏览器不会执行其中的 script；简单交互可以像上面的示例一样用原生 DOM 创建并绑定。

以下两个目录分别预置像素鸟.html 与 PulseCore-8.html，用于演示完整页面的加载与交互。选择 DOM / HTML 运行；游戏使用点击/空格操作，音序器点击运行后启用声音。结果框可拖动到合适高度并钉住。HTML 文件也能直接打开，默认源码，切换阅读后交互。

```js {id=0007}
displayHTML(await files.readFile("像素鸟.html"));
```


```js {id=0008}
displayHTML(await files.readFile("PulseCore-8.html"));
```


使用 files 读取数据目录中的 HTML，再用 displayHTML 显示。页面引用的数据文件可转换为 blob 或 data URL。

## 文件接口：文本、二进制和目录

用 JavaScript 模式运行。files 只访问当前块目录；writeFile 会创建所需的子目录。

```js {id=0009}
await files.writeFile("output/nested/readme.txt", "你好，文件接口");
await files.writeFile("output/bytes.bin", new Uint8Array([0, 1, 127, 255]));
console.log(await files.readFile("output/nested/readme.txt"));
console.log(await files.list());
```


## DOM：排序过程与交互

选择 DOM / HTML，再运行。点击“下一步”观察冒泡排序；点击“重置”恢复初始数组。原生 DOM、事件和样式均在这个块自己的页面中生效。

```js {id=000a}
const values = [7, 3, 9, 1, 5];
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
draw();
```

结果可以调整高度并钉住；钉住后修改代码仍保留已有页面，成功重跑后替换。重新打开恢复的是代码生成的初始页面，而非当时的排序进度。

## 设置说明

依赖页管理共享的 npm 包；在线安装按选定版本下载，本地导入接受 .tgz 或带依赖的包目录。安装脚本不执行。普通 JS 与 DOM / HTML 共享依赖，各块的变量、文件和 DOM 独立。代码执行时限限制普通 JS 或 DOM 初始化，准备时限包含依赖打包。TypeScript 格式化选项同时作用于 JavaScript。

## 下载与 fetch（需要联网）

JavaScript 模式用 files.download，保存后可以继续读取文件。

```js {id=000b}
await files.download("https://example.com/", "input/example.html");
console.log((await files.readFile("input/example.html")).slice(0, 200));
```

DOM / HTML 模式支持 fetch 读取公共 HTTP(S) 资源。保存数据时写入当前块目录。

```js {id=000c}
const response = await fetch("https://example.com/");
const html = await response.text();
await files.writeFile("input/example.html", html);
const preview = document.createElement("pre");
preview.textContent = html.slice(0, 200);
document.body.append(preview);
```


## 设置

在“偏好设置 → 代码 → JavaScript”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 60 | 环境、包或编译准备时限，单位秒 |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
