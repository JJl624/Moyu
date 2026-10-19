# C / C++

语言声明 c 或 cpp / c++ / cc / cxx。使用 Clang WASI 工具链；头文件和 main 包裹可在设置中选择，编译和运行都与主机隔离。

## 片段与完整程序

默认 C 头文件为 stdio.h、stdlib.h，C++ 为 iostream。没有 main 时自动包裹，因此可以直接运行片段；已有 main 时使用原入口。

```c {id=0001}
printf("Hello C\n");
```


```cpp {id=0002}
std::cout << "Hello C++" << std::endl;
```


```c {id=0003}
#include <stdio.h>
int main(void) {
    printf("完整程序\n");
    return 0;
}
```


## 多文件 C

此块目录含 util.h、util.c 与 stdin.txt。开启多文件后，源文件加入同一次编译；本地 include 从当前块目录解析，scanf/cin 从设置中的输入文件读取。

```c {id=0004}
#include "util.h"
int value = 0;
scanf("%d", &value);
printf("%d\n", twice(value));
FILE *out = fopen("output/result.txt", "w");
if (out) { fprintf(out, "%d\n", twice(value)); fclose(out); }
```


## 多文件 C++

```cpp {id=0005}
#include "helper.hpp"
int value = 0;
std::cin >> value;
std::cout << twice_cpp(value) << std::endl;
```

设置页列出工具链提供的头文件。勾选后自动加入，也可在代码内 include。文件读写使用当前块数据目录中的相对路径。

## C：程序参数与标准库

右键此块，选择“运行（参数）”，添加 hello 和 42 后运行。此例使用完整的 main 函数。

```c {id=0006}
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) printf("参数 %d：%s\n", i, argv[i]);
    printf("整数转换：%d\n", atoi("42"));
    return 0;
}
```


## C++：容器、算法与文件

```cpp {id=0007}
#include <vector>
#include <algorithm>
#include <fstream>
std::vector<int> values = {7, 3, 9, 1, 5};
std::sort(values.begin(), values.end());
std::ofstream out("output/sorted.txt");
for (int value : values) { std::cout << value << ' '; out << value << '\n'; }
std::cout << std::endl;
```

预期输出 1 3 5 7 9，并产生 sorted.txt。

## 设置说明

自动包裹为不含 main 的代码片段补充入口；完整 main 保持原样。默认头文件会在编译时添加 include，因此片段可以直接使用对应声明。多文件编译决定数据目录中的 .c / .cpp 是否参与链接，头文件仍可引用；关闭后，外部源文件中定义的函数不会参与链接。

标准输入文件默认 stdin.txt，scanf / cin 一次读取预置内容，不会弹出交互输入框。该路径可指向当前块目录的任何输入文件；留空表示没有标准输入。

编译优化使用 Clang 的实际 -O 参数：默认保持工具链设置；O0 便于观察未经优化的逻辑，O2 / O3 偏向运行性能，Os / Oz 偏向体积。更改优化级别会重新编译，程序参数的更改不需要更改源码。C 与 C++ 的语言标准和默认头文件分别设置。

## 程序参数

右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。

参数依次为 `--price=19.90`、`--quantity=3`、`--discount=0.9`，分别表示单价、数量和折扣。以下代码用于根据单价、数量和折扣计算订单金额。未填写参数时使用相同的默认值。

```c {id=0008}
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
    double price = 19.90, discount = 0.9;
    int quantity = 3;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--price=", 8) == 0) price = atof(argv[i] + 8);
        else if (strncmp(argv[i], "--quantity=", 11) == 0) quantity = atoi(argv[i] + 11);
        else if (strncmp(argv[i], "--discount=", 11) == 0) discount = atof(argv[i] + 11);
        else { fprintf(stderr, "Unknown argument: %s\n", argv[i]); return 1; }
    }
    printf("Total: %.2f\n", price * quantity * discount);
    return 0;
}
```

预期输出：`Total: 53.73`。

## 设置

在“偏好设置 → 代码 → C / C++”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 60 | 环境、包或编译准备时限，单位秒 |
| 自动补全入口 | 开启 | 代码片段自动包裹入口函数 |
| 编译数据目录中的源文件 | 开启 | 一同编译数据目录中的源文件 |
| 标准输入文件 | stdin.txt | 标准输入文件，路径相对当前块；留空为 EOF |
| C 语言标准 | gnu23 | C 语言标准 |
| C++ 语言标准 | gnu++23 | C++ 语言标准 |
| 默认 C 头文件 | stdio.h, stdlib.h | 默认 C 头文件 |
| 默认 C++ 头文件 | iostream | 默认 C++ 头文件 |
| 编译优化 | 工具链默认 | 使用 Clang -O 优化级别，默认保持工具链设置 |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
