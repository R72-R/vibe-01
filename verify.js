/**
 * 学习打卡清单的自动检查脚本。
 *
 * 用法：在项目文件夹里执行  node verify.js
 * 只依赖 Node 内置模块，不需要安装任何依赖。
 *
 * 做法：读出 index.html 里的页面脚本，用一套最小的假 DOM 把它跑起来，
 * 然后模拟用户操作，检查清单状态、计数显示和存档读写。
 * 它检查的是逻辑，看不出版式和布局，页面外观仍然需要人工过一遍（见 README）。
 */
const fs = require("node:fs");
const path = require("node:path");

const APP_FILE = path.join(__dirname, "index.html");
const STORAGE_KEY = "study-checklist-v1";

function readAppScript() {
  const html = fs.readFileSync(APP_FILE, "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("index.html 里找不到 <script> 代码块，检查脚本需要同步更新");
  }
  return match[1];
}

function makeElement(tagName) {
  return {
    tagName: tagName,
    children: [],
    className: "",
    type: "",
    value: "",
    hidden: false,
    _text: "",
    get textContent() {
      return this._text;
    },
    set textContent(value) {
      this._text = value;
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener() {},
    focus() {},
  };
}

/** 用假 DOM 启动页面脚本，返回可以调用的内部函数。 */
function bootApp(store) {
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  const elements = {
    "new-item": makeElement("input"),
    "add-btn": makeElement("button"),
    list: makeElement("ul"),
    summary: makeElement("div"),
  };
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tagName) => makeElement(tagName),
  };
  const factory = new Function(
    "document",
    "localStorage",
    readAppScript() +
      "\nreturn { items: () => items, add: addItem, toggle: toggleItem," +
      " remove: deleteItem, input: input, summary: summary, list: list };"
  );
  return factory(document, localStorage);
}

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    return;
  }
  failures.push(
    name +
      "\n     实际：" + JSON.stringify(actual) +
      "\n     期望：" + JSON.stringify(expected)
  );
}

function addItem(app, text) {
  app.input.value = text;
  app.add();
}

// 场景一：全新用户，空清单
let store = new Map();
let app = bootApp(store);
check("空清单时统计行隐藏", app.summary.hidden, true);
check("空清单时没有统计文本", app.summary.textContent, "");
check("空清单时显示空态提示", app.list.children.length, 1);
check("空清单时不动存档", store.size, 0);

// 场景二：添加、勾选、取消、删除
addItem(app, "  背单词  ");
check("添加后统计为 0/1", app.summary.textContent, "已完成 0 / 1 条");
check("有内容时统计行显示", app.summary.hidden, false);
check("首尾空格被去掉", app.items()[0].text, "背单词");
check("新条目默认未完成", app.items()[0].done, false);

addItem(app, "写周报");
check("再添加一条后为 0/2", app.summary.textContent, "已完成 0 / 2 条");

app.toggle(0);
check("勾选后为 1/2", app.summary.textContent, "已完成 1 / 2 条");
check("勾选状态已写入存档", JSON.parse(store.get(STORAGE_KEY))[0].done, true);

app.toggle(0);
check("取消勾选后回到 0/2", app.summary.textContent, "已完成 0 / 2 条");

app.toggle(0);
app.toggle(1);
check("全部完成后为 2/2", app.summary.textContent, "已完成 2 / 2 条");

addItem(app, "     ");
check("只输入空格不新增", app.summary.textContent, "已完成 2 / 2 条");
check("只输入空格不改变条目数", app.items().length, 2);

app.remove(0);
check("删除已完成项后为 1/1", app.summary.textContent, "已完成 1 / 1 条");

app.remove(0);
check("删空后统计行隐藏", app.summary.hidden, true);
check("删空后没有统计文本", app.summary.textContent, "");
check("删空后回到空态提示", app.list.children.length, 1);

// 场景三：刷新页面（沿用同一份存档）
store = new Map();
store.set(STORAGE_KEY, JSON.stringify([
  { text: "复习", done: true },
  { text: "做题", done: false },
]));
app = bootApp(store);
check("刷新后重新算出 1/2", app.summary.textContent, "已完成 1 / 2 条");
check("刷新后条目仍然渲染", app.list.children.length, 2);

// 场景四：旧数据没有 done 字段
store = new Map();
store.set(STORAGE_KEY, JSON.stringify([{ text: "旧条目" }]));
check("缺 done 字段按未完成计", bootApp(store).summary.textContent, "已完成 0 / 1 条");

// 场景五：存档被写坏
store = new Map();
store.set(STORAGE_KEY, "{坏掉的 JSON");
check("坏存档不崩溃且隐藏统计行", bootApp(store).summary.hidden, true);

// 场景六：存档键和格式不变
store = new Map();
app = bootApp(store);
addItem(app, "甲");
check("存档只有一个键", Array.from(store.keys()).join(","), STORAGE_KEY);
check("存档里是数组", Array.isArray(JSON.parse(store.get(STORAGE_KEY))), true);

// 结果
console.log(passed + " 项通过，失败 " + failures.length + " 项");
if (failures.length > 0) {
  console.log("\n失败明细：");
  failures.forEach((detail) => console.log("  - " + detail));
  process.exit(1);
}
console.log("结论：index.html 的核心逻辑符合预期。");
