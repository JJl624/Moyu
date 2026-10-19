# Java

语言声明 java。TeaVM / javac 在浏览器中编译，再通过 WebAssembly 执行。没有类声明的片段可自动包裹 Main；完整程序应提供 main。

```java {id=0001}
int[] values = {2, 4, 6, 8};
int sum = 0;
for (int value : values) sum += value;
System.out.println(sum / (double) values.length);
```


## 多文件与参数

此块预置 Helper.java。勾选多文件后，目录中的 Java 源文件加入编译。可在设置中指定主类，否则从编译结果中自动检测。

```java {id=0002}
public class Main {
    public static void main(String[] args) {
        System.out.println(Helper.twice(21));
        System.out.println("参数数量：" + args.length);
    }
}
```

Java 使用 TeaVM 编译为 WebAssembly，支持其 Java 标准库子集；辅助 .java 文件参与同一项目编译。当前运行环境支持参数和控制台输出，文件 I/O、标准输入、线程与 JNI 暂不可用。

## 集合、Lambda 与完整主类

```java {id=0003}
import java.util.ArrayList;
import java.util.Collections;
public class SortDemo {
    public static void main(String[] args) {
        ArrayList<Integer> values = new ArrayList<>();
        Collections.addAll(values, 7, 3, 9, 1, 5);
        values.sort((left, right) -> Integer.compare(left, right));
        System.out.println(values);
        System.out.println("参数：" + String.join(", ", args));
    }
}
```

预期输出 [1, 3, 5, 7, 9]。主类留空自动检测 SortDemo；也可以在设置中指定 SortDemo。

## 设置说明

主类用于指定启动入口，适合项目包含多个 main 的情况；留空时自动识别。通过“运行（参数）”将参数传给 main 的 args。自动入口补全为片段添加类与 main，完整类保持原样。多文件编译决定辅助 .java 是否参与编译。

准备时限包含 javac 与 TeaVM 编译，执行时限只限制生成程序的运行。格式化使用 Java 插件；entrypoint 可选择完整文件、语句或其他片段的解析方式。Java 当前没有标准输入和运行时文件访问，预置 .java 文件仅参与编译。

## 程序参数

右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。

参数依次为 `--price=19.90`、`--quantity=3`、`--discount=0.9`，分别表示单价、数量和折扣。以下代码用于根据单价、数量和折扣计算订单金额。未填写参数时使用相同的默认值。

```java {id=0004}
public class ArgumentDemo {
    public static void main(String[] args) {
        long priceCents = 1990, discountPercent = 90;
        int quantity = 3;
        for (String argument : args) {
            String[] pair = argument.split("=", 2);
            if (pair.length != 2) throw new IllegalArgumentException(argument);
            switch (pair[0]) {
                case "--price": priceCents = Math.round(Double.parseDouble(pair[1]) * 100); break;
                case "--quantity": quantity = Integer.parseInt(pair[1]); break;
                case "--discount": discountPercent = Math.round(Double.parseDouble(pair[1]) * 100); break;
                default: throw new IllegalArgumentException(argument);
            }
        }
        long totalCents = Math.round(priceCents * quantity * discountPercent / 100.0);
        System.out.println("Total: " + totalCents / 100 + "." + (totalCents % 100 < 10 ? "0" : "") + totalCents % 100);
    }
}
```

预期输出：`Total: 53.73`。

## 设置

在“偏好设置 → 代码 → Java”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 120 | 环境、包或编译准备时限，单位秒 |
| 编译数据目录中的源文件 | 开启 | 一同编译数据目录中的源文件 |
| 自动补全入口 | 开启 | 代码片段自动包裹入口函数 |
| 主类 | 自动 / 空 | Java 主类；留空自动检测 |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
