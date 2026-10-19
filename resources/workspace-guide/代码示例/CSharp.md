# C#

语言声明 csharp / cs / c#。安装 .NET WebAssembly / Roslyn 环境后，可写顶层语句或完整 Main；默认 using 在设置中配置。

```csharp {id=0001}
var values = new[] { 2, 4, 6, 8 };
Console.WriteLine(values.Average());
```


## 多文件与输入输出

此块预置 Helper.cs 与 stdin.txt；开启多文件时编译数据目录中的 .cs，读标准输入及输出文件都使用当前块目录。

```cs {id=0002}
int value = int.Parse(Console.ReadLine() ?? "0");
Console.WriteLine(Helper.Twice(value));
File.WriteAllText("output/result.txt", Helper.Twice(value).ToString());
Console.WriteLine(File.ReadAllText("output/result.txt"));
```


```csharp {id=0003}
Console.WriteLine(string.Join(", ", Environment.GetCommandLineArgs()));
```

C# 使用 .NET WebAssembly 环境，每次执行创建独立的程序状态。可用 API 以该环境提供的 .NET 类库为准。

## 泛型、LINQ 与分组

```csharp {id=0004}
var orders = new[] {
    new { Source = "App", Amount = 120 },
    new { Source = "Web", Amount = 80 },
    new { Source = "App", Amount = 40 }
};
foreach (var group in orders.GroupBy(order => order.Source))
    Console.WriteLine($"{group.Key}: {group.Sum(order => order.Amount)}");
```

输出 App: 160 和 Web: 80。

## 完整入口与异常处理

```cs {id=0005}
public class Program {
    public static void Main(string[] args) {
        Console.WriteLine("参数：" + string.Join(", ", args));
        try { int.Parse("错误输入"); }
        catch (FormatException) { Console.WriteLine("请输入整数"); }
    }
}
```


## 设置说明

“运行（参数）”中添加的参数传给入口的 args。标准输入文件用于 Console.ReadLine 等读取，路径相对块级数据目录。多文件编译决定辅助 .cs 是否加入当前项目。默认 using 为代码补充命名空间，引用 LINQ 等 API 时需要 System.Linq。

C# 环境由 .NET WebAssembly 和 Roslyn 组成。辅助源码和输出保存在当前块目录，类库由运行环境提供。

## 程序参数

右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。

参数依次为 `--price=19.90`、`--quantity=3`、`--discount=0.9`，分别表示单价、数量和折扣。以下代码用于根据单价、数量和折扣计算订单金额。未填写参数时使用相同的默认值。

```csharp {id=0006}
using System;
using System.Globalization;
public class Program {
    public static void Main(string[] args) {
        decimal price = 19.90m, discount = 0.9m;
        int quantity = 3;
        foreach (string argument in args) {
            string[] pair = argument.Split('=', 2);
            if (pair.Length != 2) throw new ArgumentException(argument);
            switch (pair[0]) {
                case "--price": price = decimal.Parse(pair[1], CultureInfo.InvariantCulture); break;
                case "--quantity": quantity = int.Parse(pair[1]); break;
                case "--discount": discount = decimal.Parse(pair[1], CultureInfo.InvariantCulture); break;
                default: throw new ArgumentException(argument);
            }
        }
        Console.WriteLine("Total: " + (price * quantity * discount).ToString("F2", CultureInfo.InvariantCulture));
    }
}
```

预期输出：`Total: 53.73`。

## 设置

在“偏好设置 → 代码 → C#”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 120 | 环境、包或编译准备时限，单位秒 |
| 编译数据目录中的源文件 | 开启 | 一同编译数据目录中的源文件 |
| 标准输入文件 | stdin.txt | 标准输入文件，路径相对当前块；留空为 EOF |
| 默认 using 命名空间 | System, System.IO, System.Linq, System.Collections.Generic | 默认 using 命名空间 |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
