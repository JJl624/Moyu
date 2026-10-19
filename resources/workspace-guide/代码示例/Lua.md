# Lua

声明 lua，使用 Wasmoon。提供 Lua 标准库与本地模块，文件位于块级虚拟 /data。

```lua {id=0001}
local values = {2, 4, 6, 8}
local total = 0
for _, value in ipairs(values) do total = total + value end
print(total / #values)
```


## 模块、标准输入与文件

此块预置 calc.lua 和 stdin.txt；开启模块设置后可以 require。io.read 使用配置的输入文件。

```lua {id=0002}
local calc = require("calc")
local value = tonumber(io.read("*l"))
print(calc.twice(value))
local out = assert(io.open("output/result.txt", "w"))
out:write(tostring(calc.twice(value)))
out:close()
```

没有主机进程、主机动态库或主机文件访问。新建 Lua 状态隔离变量；写进代码数据的文件会保留，临时结果关闭不删除文件。

## 表、元表与协程

```lua {id=0003}
local point = setmetatable({x = 3, y = 4}, {
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
for index, value in ipairs(arg) do print(index, value) end
```

输出 (3, 4)、1、4、9。通过“运行（参数）”添加 alpha 和 beta 后，arg[1] 与 arg[2] 对应这两个值。

## 设置说明

标准输入文件用于 io.read，相对路径从当前块目录开始，读取至末尾返回 nil。加载本地模块控制 require：开启时可加载模块名.lua 或模块名/init.lua，不开放主机动态库。程序参数按顺序放入 arg，从 arg[1] 开始。准备时限限制 Wasmoon 加载，执行时限限制用户代码；重启释放引擎内存，数据文件保留。

## 程序参数

右键此代码块，选择“运行（参数）”，逐项添加下列参数后运行。

参数依次为 `--price=19.90`、`--quantity=3`、`--discount=0.9`，分别表示单价、数量和折扣。以下代码用于根据单价、数量和折扣计算订单金额。未填写参数时使用相同的默认值。

```lua {id=0004}
local options = {price = 19.90, quantity = 3, discount = 0.9}
for _, argument in ipairs(arg) do
    local name, value = argument:match("^%-%-([%a]+)=(.+)$")
    assert(name and options[name] ~= nil and tonumber(value), "Invalid argument: " .. argument)
    options[name] = tonumber(value)
end
print(string.format("Total: %.2f", options.price * options.quantity * options.discount))
```

预期输出：`Total: 53.73`。

## 设置

在“偏好设置 → 代码 → Lua”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 60 | 环境、包或编译准备时限，单位秒 |
| 标准输入文件 | stdin.txt | 标准输入文件，路径相对当前块；留空为 EOF |
| 加载本地模块 | 开启 | 允许加载当前数据目录中的 Lua 模块 |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
