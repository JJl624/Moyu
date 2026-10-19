# Ruby

声明 ruby / rb，使用 ruby+stdlib.wasm。刷新列出 Ruby 4.0、3.4、3.3、3.2 系列中可适配的稳定构建；“构建”是 ruby.wasm 的发布版本，和 Ruby 版本不同。

```ruby {id=0001}
require "json"
puts RUBY_VERSION
values = [2, 4, 6, 8]
puts JSON.generate({ total: values.sum, count: values.length })
```


## 相对模块、输入和文件

此块预置 helper.rb 与 stdin.txt。require_relative 从 /data 中加载；STDIN 读取输入文件；ARGV 来自设置。

```rb {id=0002}
require_relative "helper"
value = STDIN.read.to_i
puts Helper.twice(value)
puts ARGV.inspect
File.write("output/result.txt", Helper.twice(value).to_s)
puts File.read("output/result.txt")
```

Ruby 引擎提供标准库，每次执行创建独立的程序状态。文件通过块级数据目录读写。

## 集合、正则和异常

```ruby {id=0003}
orders = [{name: "苹果", amount: 12}, {name: "梨", amount: 8}]
puts orders.map { |order| "#{order[:name]}: #{order[:amount]}" }
puts orders.sum { |order| order[:amount] }
puts "订单号: A102".match(/A\d+/)[0]
begin
  Integer("错误输入")
rescue ArgumentError
  puts "请输入整数"
end
```

输出两条订单、总额 20、A102 和“请输入整数”。

## 设置说明

“运行（参数）”中的参数对应 ARGV；标准输入文件对应 STDIN，路径相对块级目录。运行环境分别显示 Ruby 系列与 WASM 构建版本，RUBY_VERSION 返回实际引擎版本。环境包含标准库，不加载主机 Gem 或原生扩展。代码执行时限限制脚本，准备时限限制环境与依赖加载。

## 程序参数

右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。

参数依次为 `--price=19.90`、`--quantity=3`、`--discount=0.9`，分别表示单价、数量和折扣。以下代码用于根据单价、数量和折扣计算订单金额。未填写参数时使用相同的默认值。

```ruby {id=0004}
options = {"price" => 19.90, "quantity" => 3, "discount" => 0.9}
ARGV.each do |argument|
  name, value = argument.delete_prefix("--").split("=", 2)
  raise ArgumentError, argument unless argument.start_with?("--") && options.key?(name) && value
  options[name] = Float(value)
end
printf("Total: %.2f\n", options["price"] * options["quantity"] * options["discount"])
```

预期输出：`Total: 53.73`。

## 设置

在“偏好设置 → 代码 → Ruby”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 60 | 环境、包或编译准备时限，单位秒 |
| 标准输入文件 | stdin.txt | 标准输入文件，路径相对当前块；留空为 EOF |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
