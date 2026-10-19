# Bash

声明 bash / sh / shell，使用 Bashkit 解释器，不启动主机 shell。支持其内置命令、变量、函数、管道、重定向和虚拟文件系统。

代码块下拉可选“块”或“内存”。块模式读写自己的代码数据目录；内存模式每次从空目录开始，结束后丢弃文件，不创建持久目录，也不读取块模式已有的数据。选择属于当前会话的运行配置，不写入 Markdown。

```bash {id=0001}
printf "%s\n" cherry apple banana | sort
mkdir -p output
printf "hello\n" > output/result.txt
cat output/result.txt
```


## 多文件脚本与输入

此块预置 helper.sh 和 stdin.txt。source 在虚拟目录加载脚本；read 从输入文件读取，位置参数来自设置。

```sh {id=0002}
source helper.sh
read value
twice "$value"
printf "参数：%s\n" "$*"
```

多文件示例应使用块模式；内存模式没有预置 helper.sh 或 stdin.txt。

Bashkit 提供内置命令、管道、重定向和脚本。主机命令在本机 Shell 终端执行；Bash (Wasm) 使用虚拟文件系统。资源上限可在设置中调整。

## 函数、循环与文件

```bash {id=0003}
total=0
for value in 2 4 6 8; do total=$((total + value)); done
printf "总和：%s\n" "$total"
mkdir -p output/nested
printf "%s\n" "$total" > output/nested/total.txt
if [ -f output/nested/total.txt ]; then cat output/nested/total.txt; fi
```

输出总和 20 和文件内容 20。块模式保留该文件；内存模式执行结束后删除虚拟文件。

## 设置说明

“运行（参数）”中的参数通过 $1、$2、$* 等读取；标准输入文件用于 read。执行时限限制运行时间，命令数和循环次数分别限制解释器工作量，内存上限用于 Bashkit 的虚拟内存。块模式保留输入和输出文件；内存模式从空目录开始，运行后清除，适合独立脚本。

从终端的新建菜单选择 Bash (Wasm) 可以连续输入命令并保留会话状态；选择 PowerShell、cmd 或本机 Bash 会操作主机环境，与代码块的隔离运行方式不同。

## 程序参数

右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。

参数依次为 `--price=19.90`、`--quantity=3`、`--discount=0.9`，分别表示单价、数量和折扣。以下代码用于根据单价、数量和折扣计算订单金额。未填写参数时使用相同的默认值。

```bash {id=0004}
price=19.90
quantity=3
discount=0.9
for argument in "$@"; do
  case "$argument" in
    --price=*) price="${argument#*=}" ;;
    --quantity=*) quantity="${argument#*=}" ;;
    --discount=*) discount="${argument#*=}" ;;
    *) printf 'Unknown argument: %s\n' "$argument" >&2; exit 1 ;;
  esac
done
awk -v price="$price" -v quantity="$quantity" -v discount="$discount" 'BEGIN {printf "Total: %.2f\n", price * quantity * discount}'
```

预期输出：`Total: 53.73`。

## 设置

在“偏好设置 → 代码 → Bash”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 60 | 环境、包或编译准备时限，单位秒 |
| 标准输入文件 | stdin.txt | 标准输入文件，路径相对当前块；留空为 EOF |
| 命令数上限 | 100000 | 单次执行命令数上限 |
| 循环次数上限 | 100000 | 循环迭代次数上限 |
| 内存上限 | 128 | 解释器内存限制，单位 MB |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
