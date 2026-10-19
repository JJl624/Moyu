export const ARGUMENT_VALUES = {
  "clang": [
    "--price=19.90",
    "--quantity=3",
    "--discount=0.9",
  ],
  "csharp": [
    "--price=19.90",
    "--quantity=3",
    "--discount=0.9",
  ],
  "java": [
    "--price=19.90",
    "--quantity=3",
    "--discount=0.9",
  ],
  "lua": [
    "--price=19.90",
    "--quantity=3",
    "--discount=0.9",
  ],
  "ruby": [
    "--price=19.90",
    "--quantity=3",
    "--discount=0.9",
  ],
  "bash": [
    "--price=19.90",
    "--quantity=3",
    "--discount=0.9",
  ],
  "python": [
    "--price=19.90",
    "--quantity=3",
    "--discount=0.9",
  ],
};

export const ARGUMENT_CODE = {
  "clang": {
    "language": "c",
    "purpose": "根据单价、数量和折扣计算订单金额",
    "output": "Total: 53.73",
    "code":
      "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(int argc, char **argv) {\n    double price = 19.90, discount = 0.9;\n    int quantity = 3;\n    for (int i = 1; i < argc; i++) {\n        if (strncmp(argv[i], \"--price=\", 8) == 0) price = atof(argv[i] + 8);\n        else if (strncmp(argv[i], \"--quantity=\", 11) == 0) quantity = atoi(argv[i] + 11);\n        else if (strncmp(argv[i], \"--discount=\", 11) == 0) discount = atof(argv[i] + 11);\n        else { fprintf(stderr, \"Unknown argument: %s\\n\", argv[i]); return 1; }\n    }\n    printf(\"Total: %.2f\\n\", price * quantity * discount);\n    return 0;\n}",
  },
  "csharp": {
    "language": "csharp",
    "purpose": "根据单价、数量和折扣计算订单金额",
    "output": "Total: 53.73",
    "code":
      "using System;\nusing System.Globalization;\npublic class Program {\n    public static void Main(string[] args) {\n        decimal price = 19.90m, discount = 0.9m;\n        int quantity = 3;\n        foreach (string argument in args) {\n            string[] pair = argument.Split('=', 2);\n            if (pair.Length != 2) throw new ArgumentException(argument);\n            switch (pair[0]) {\n                case \"--price\": price = decimal.Parse(pair[1], CultureInfo.InvariantCulture); break;\n                case \"--quantity\": quantity = int.Parse(pair[1]); break;\n                case \"--discount\": discount = decimal.Parse(pair[1], CultureInfo.InvariantCulture); break;\n                default: throw new ArgumentException(argument);\n            }\n        }\n        Console.WriteLine(\"Total: \" + (price * quantity * discount).ToString(\"F2\", CultureInfo.InvariantCulture));\n    }\n}",
  },
  "java": {
    "language": "java",
    "purpose": "根据单价、数量和折扣计算订单金额",
    "output": "Total: 53.73",
    "code":
      "public class ArgumentDemo {\n    public static void main(String[] args) {\n        long priceCents = 1990, discountPercent = 90;\n        int quantity = 3;\n        for (String argument : args) {\n            String[] pair = argument.split(\"=\", 2);\n            if (pair.length != 2) throw new IllegalArgumentException(argument);\n            switch (pair[0]) {\n                case \"--price\": priceCents = Math.round(Double.parseDouble(pair[1]) * 100); break;\n                case \"--quantity\": quantity = Integer.parseInt(pair[1]); break;\n                case \"--discount\": discountPercent = Math.round(Double.parseDouble(pair[1]) * 100); break;\n                default: throw new IllegalArgumentException(argument);\n            }\n        }\n        long totalCents = Math.round(priceCents * quantity * discountPercent / 100.0);\n        System.out.println(\"Total: \" + totalCents / 100 + \".\" + (totalCents % 100 < 10 ? \"0\" : \"\") + totalCents % 100);\n    }\n}",
  },
  "lua": {
    "language": "lua",
    "purpose": "根据单价、数量和折扣计算订单金额",
    "output": "Total: 53.73",
    "code":
      "local options = {price = 19.90, quantity = 3, discount = 0.9}\nfor _, argument in ipairs(arg) do\n    local name, value = argument:match(\"^%-%-([%a]+)=(.+)$\")\n    assert(name and options[name] ~= nil and tonumber(value), \"Invalid argument: \" .. argument)\n    options[name] = tonumber(value)\nend\nprint(string.format(\"Total: %.2f\", options.price * options.quantity * options.discount))",
  },
  "ruby": {
    "language": "ruby",
    "purpose": "根据单价、数量和折扣计算订单金额",
    "output": "Total: 53.73",
    "code":
      "options = {\"price\" => 19.90, \"quantity\" => 3, \"discount\" => 0.9}\nARGV.each do |argument|\n  name, value = argument.delete_prefix(\"--\").split(\"=\", 2)\n  raise ArgumentError, argument unless argument.start_with?(\"--\") && options.key?(name) && value\n  options[name] = Float(value)\nend\nprintf(\"Total: %.2f\\n\", options[\"price\"] * options[\"quantity\"] * options[\"discount\"])",
  },
  "bash": {
    "language": "bash",
    "purpose": "根据单价、数量和折扣计算订单金额",
    "output": "Total: 53.73",
    "code":
      "price=19.90\nquantity=3\ndiscount=0.9\nfor argument in \"$@\"; do\n  case \"$argument\" in\n    --price=*) price=\"${argument#*=}\" ;;\n    --quantity=*) quantity=\"${argument#*=}\" ;;\n    --discount=*) discount=\"${argument#*=}\" ;;\n    *) printf 'Unknown argument: %s\\n' \"$argument\" >&2; exit 1 ;;\n  esac\ndone\nawk -v price=\"$price\" -v quantity=\"$quantity\" -v discount=\"$discount\" 'BEGIN {printf \"Total: %.2f\\n\", price * quantity * discount}'",
  },
  "python": {
    "language": "py",
    "purpose": "根据单价、数量和折扣计算订单金额",
    "output": "Total: 53.73",
    "code":
      "import argparse\nfrom decimal import Decimal\n\nparser = argparse.ArgumentParser()\nparser.add_argument(\"--price\", type=Decimal, default=Decimal(\"19.90\"))\nparser.add_argument(\"--quantity\", type=int, default=3)\nparser.add_argument(\"--discount\", type=Decimal, default=Decimal(\"0.9\"))\noptions = parser.parse_args()\nprint(f\"Total: {options.price * options.quantity * options.discount:.2f}\")",
  },
};
