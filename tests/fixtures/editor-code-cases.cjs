const validCases = [
  {
    id: "print-basic",
    code: 'print("hello")\n',
    outputPattern: "hello"
  },
  {
    id: "input-echo",
    code: 'name = input("Name? ")\nprint("Hi,", name)\n',
    inputLines: ["Vasya"],
    outputPattern: "Hi, Vasya"
  },
  {
    id: "for-range-sum",
    code: "total = 0\nfor i in range(5):\n    total += i\nprint(total)\n",
    outputPattern: "10"
  },
  {
    id: "while-loop",
    code: "i = 0\nwhile i < 3:\n    print(i)\n    i += 1\n",
    outputPattern: "2"
  },
  {
    id: "function-call",
    code: "def answer():\n    return 42\nprint(answer())\n",
    outputPattern: "42"
  },
  {
    id: "recursion-factorial",
    code: "def fact(n):\n    return 1 if n <= 1 else n * fact(n - 1)\nprint(fact(5))\n",
    outputPattern: "120"
  },
  {
    id: "list-indexing",
    code: "items = [1, 2, 3, 4]\nprint(items[2])\n",
    outputPattern: "3"
  },
  {
    id: "dict-access",
    code: "user = {'name': 'Ada', 'age': 10}\nprint(user['name'])\n",
    outputPattern: "Ada"
  },
  {
    id: "try-except",
    code: "try:\n    int('x')\nexcept ValueError:\n    print('caught')\n",
    outputPattern: "caught"
  },
  {
    id: "import-math",
    code: "import math\nprint(math.sqrt(81))\n",
    outputPattern: "9"
  },
  {
    id: "multiline-string",
    code: "text = '''lineA\nlineB'''\nprint(text)\n",
    outputPattern: "lineB"
  },
  {
    id: "unicode-identifiers",
    code: "greeting = 'мир'\nprint(greeting)\n",
    outputPattern: "мир"
  },
  {
    id: "comments-and-code",
    code: "# comment\nx = 1  # inline\nprint(x + 2)\n",
    outputPattern: "3"
  },
  {
    id: "turtle-basic",
    code: "import turtle\nt = turtle.Turtle()\nt.shape('turtle')\nprint('turtle-ready')\n",
    outputPattern: "turtle-ready",
    expectTurtle: true
  },
  {
    id: "large-valid-script",
    code: "total = 0\nfor i in range(100):\n    total += i\nprint('sum', total)\n",
    outputPattern: "sum 4950"
  }
];

const invalidCases = [
  {
    id: "syntax-broken-def",
    code: "def broken(:\n  pass\n",
    errorPattern: "SyntaxError"
  },
  {
    id: "unclosed-parenthesis",
    code: "print((1 + 2)\n",
    errorPattern: "SyntaxError|was never closed|multi-line statement|EOF"
  },
  {
    id: "unclosed-string",
    code: "print(\"abc)\n",
    errorPattern: "SyntaxError|EOL while scanning|string literal"
  },
  {
    id: "name-error",
    code: "print(undefined_name)\n",
    errorPattern: "NameError"
  },
  {
    id: "type-error",
    code: "print(1 + '2')\n",
    errorPattern: "TypeError"
  },
  {
    id: "value-error",
    code: "int('x')\n",
    errorPattern: "ValueError"
  },
  {
    id: "zero-division",
    code: "print(1 / 0)\n",
    errorPattern: "ZeroDivisionError"
  },
  {
    id: "assertion-error",
    code: "assert False, 'boom'\n",
    errorPattern: "AssertionError"
  },
  {
    id: "indentation-error",
    code: "if True:\nprint('x')\n",
    errorPattern: "IndentationError|SyntaxError|expected an indented block|bad input"
  },
  {
    id: "missing-module-import",
    code: "import definitely_missing_module_xyz\n",
    errorPattern: "ImportError|ModuleNotFoundError|No module named"
  },
  {
    id: "invisible-char-in-keyword",
    code: "print(1\u200B\n",
    errorPattern: "SyntaxError|EOF|was never closed|multi-line statement"
  },
  {
    id: "control-char-with-syntax-error",
    code: "print('ok')\u0007\nif True print(1)\n",
    errorPattern: "SyntaxError|invalid syntax"
  },
  {
    id: "mixed-line-endings-invalid",
    code: "if True:\r\n    print('x')\r\nprint('oops'\n",
    errorPattern: "SyntaxError|EOF|was never closed"
  },
  {
    id: "long-multiline-invalid",
    code: `${Array.from({ length: 25 }, (_, i) => `print(${i})`).join("\n")}\nvalue = (\n  1 + 2\n`,
    errorPattern: "SyntaxError|EOF|multi-line statement"
  },
  {
    id: "user-report-noisy-snippet",
    code: "# переменная - место, где чтото хранится\ng = \"то, что хотим сохранить\"\n\n# ввод данных с клавиатуры\nm = input()\nl = int(input())\n------------------------------------------------------------------------------------------------\n#индексы - номер на котором стоит буквы\nk = \"П Р И В Е Т\"\n\np = П   Р  И  В  Е  Т\n",
    errorPattern: "SyntaxError|NameError|invalid syntax"
  }
];

module.exports = {
  validCases,
  invalidCases
};
