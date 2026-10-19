# Python

语言声明 python / py。支持标准库、科学计算包、相对模块与文件读写；每次执行使用独立变量空间，复用已加载的包。

## 代码片段与包

```python {id=0001}
import json
values = [2, 4, 6, 8]
print(json.dumps({"mean": sum(values) / len(values)}, ensure_ascii=False))
```

在 Python 设置中查询并安装 numpy、matplotlib 等包。依赖项由环境管理，不单独提供卸载按钮。

```py {id=0002}
import numpy as np
import matplotlib.pyplot as plt
values = np.array([2, 4, 6, 8])
print(values.mean())
plt.plot(values, marker="o")
plt.title("Sample")
plt.show()
```


## 多文件与输入输出

此块的目录已放入 helper.py、input.json 和 stdin.txt。import 会找到当前目录的模块；通过显式读取 stdin.txt 获取输入；这里没有交互式 input。

```python {id=0003}
from helper import twice
import json
from pathlib import Path
values = json.loads(Path("input.json").read_text(encoding="utf-8"))
print([twice(v) for v in values])
print("输入：", Path("stdin.txt").read_text(encoding="utf-8").strip())
Path("output").mkdir(exist_ok=True)
Path("output/result.json").write_text(json.dumps(values), encoding="utf-8")
```

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

## CSV、对象与异常处理

这段代码只使用标准库，无需安装包。CSV 的表头保留中文；结果同时以文本和文件提供。

```python {id=0004}
import csv
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
    print("输入格式错误")
```

预期看到两条订单、CSV 文件和“输入格式错误”。保存结果或打开数据目录都可以查看完整 CSV。

## 二进制与嵌套目录

```py {id=0005}
from pathlib import Path
import struct
folder = Path("output/nested")
folder.mkdir(parents=True, exist_ok=True)
(folder / "values.bin").write_bytes(struct.pack("<3i", 2, 4, 6))
print(struct.unpack("<3i", (folder / "values.bin").read_bytes()))
```

输出为 (2, 4, 6)。二进制文件提供保存入口，文本文件提供有限长度的预览。

## 设置说明

依赖页用于管理 numpy、matplotlib 等 Pyodide 包。包随所选运行环境安装，不在不同环境之间混用。代码执行时限限制用户代码，环境准备时限用于加载核心与依赖；重启释放内存中的环境和包，不删除安装文件。

## 下载公共文件（需要联网）

download 将公共 HTTP(S) 文件保存到当前块的数据目录，单个文件上限为 20 MB。

```python {id=0006}
from js import moyu_download
from pathlib import Path
await moyu_download("https://example.com/", "input/example.html")
print(Path("input/example.html").read_text(encoding="utf-8")[:200])
```


## 程序参数

右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。

参数依次为 `--price=19.90`、`--quantity=3`、`--discount=0.9`，分别表示单价、数量和折扣。以下代码用于根据单价、数量和折扣计算订单金额。未填写参数时使用相同的默认值。

```py {id=0007}
import argparse
from decimal import Decimal

parser = argparse.ArgumentParser()
parser.add_argument("--price", type=Decimal, default=Decimal("19.90"))
parser.add_argument("--quantity", type=int, default=3)
parser.add_argument("--discount", type=Decimal, default=Decimal("0.9"))
options = parser.parse_args()
print(f"Total: {options.price * options.quantity * options.discount:.2f}")
```

预期输出：`Total: 53.73`。


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
