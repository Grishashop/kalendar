/**
 * Вычислитель Excel-подобных выражений для шаблонов кармана транзакций.
 *
 * Язык намеренно крошечный: разбор в AST и интерпретация с белым списком функций.
 * Никакого `eval`, `new Function` и прочего исполнения пользовательского текста —
 * шаблон правится оператором, а результат уходит рыночными заявками на биржу
 * (см. docs/adr/0001-pravila-generacii-v-vyrazheniyah-shablona.md).
 *
 * Ссылка на колонку — `[Имя колонки]`, разделитель аргументов — `;`, как в
 * русском Excel. Десятичный разделитель в литералах — точка: запятая в этом
 * языке не встречается вовсе, чтобы не спорить с разделителем аргументов.
 */

export type Value = number | string | boolean | Date;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

// ---------------------------------------------------------------- лексер

type Token =
  | { kind: "num"; value: number; pos: number }
  | { kind: "str"; value: string; pos: number }
  | { kind: "col"; name: string; pos: number }
  | { kind: "ident"; name: string; pos: number }
  | { kind: "op"; value: string; pos: number };

const IDENT_START = /[A-Za-zА-Яа-яЁё_]/;
const IDENT_PART = /[A-Za-zА-Яа-яЁё0-9_.]/;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === "[") {
      const end = src.indexOf("]", i + 1);
      if (end === -1) throw new ExpressionError("не закрыта скобка «[» в ссылке на колонку");
      tokens.push({ kind: "col", name: src.slice(i + 1, end).trim(), pos: i });
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= src.length) throw new ExpressionError("не закрыта кавычка в текстовом литерале");
        if (src[i] === '"') {
          // Удвоенная кавычка внутри строки — способ вставить саму кавычку.
          if (src[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += src[i];
        i += 1;
      }
      tokens.push({ kind: "str", value, pos: i });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const raw = src.slice(i, j);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new ExpressionError(`не число: «${raw}»`);
      tokens.push({ kind: "num", value: num, pos: i });
      i = j;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i;
      while (j < src.length && IDENT_PART.test(src[j])) j += 1;
      tokens.push({ kind: "ident", name: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ kind: "op", value: two, pos: i });
      i += 2;
      continue;
    }

    if ("=<>+-*/();".includes(ch)) {
      tokens.push({ kind: "op", value: ch, pos: i });
      i += 1;
      continue;
    }

    throw new ExpressionError(`непонятный символ «${ch}»`);
  }

  return tokens;
}

// ---------------------------------------------------------------- разбор

type Node =
  | { t: "lit"; v: Value }
  | { t: "col"; name: string }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "neg"; e: Node }
  | { t: "call"; name: string; args: Node[] };

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.comparison();
    if (this.pos < this.tokens.length) {
      throw new ExpressionError("лишний текст в конце выражения");
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(...ops: string[]): string | undefined {
    const token = this.peek();
    if (token?.kind === "op" && ops.includes(token.value)) {
      this.pos += 1;
      return token.value;
    }
    return undefined;
  }

  private expectOp(op: string): void {
    if (!this.eatOp(op)) throw new ExpressionError(`ожидался «${op}»`);
  }

  private comparison(): Node {
    let left = this.additive();
    const op = this.eatOp("=", "<>", "<", "<=", ">", ">=");
    if (op) left = { t: "bin", op, l: left, r: this.additive() };
    return left;
  }

  private additive(): Node {
    let left = this.multiplicative();
    for (;;) {
      const op = this.eatOp("+", "-");
      if (!op) return left;
      left = { t: "bin", op, l: left, r: this.multiplicative() };
    }
  }

  private multiplicative(): Node {
    let left = this.unary();
    for (;;) {
      const op = this.eatOp("*", "/");
      if (!op) return left;
      left = { t: "bin", op, l: left, r: this.unary() };
    }
  }

  private unary(): Node {
    if (this.eatOp("-")) return { t: "neg", e: this.unary() };
    return this.primary();
  }

  private primary(): Node {
    const token = this.peek();
    if (!token) throw new ExpressionError("выражение оборвалось");

    if (token.kind === "num") {
      this.pos += 1;
      return { t: "lit", v: token.value };
    }
    if (token.kind === "str") {
      this.pos += 1;
      return { t: "lit", v: token.value };
    }
    if (token.kind === "col") {
      this.pos += 1;
      if (!token.name) throw new ExpressionError("пустое имя колонки в «[]»");
      return { t: "col", name: token.name };
    }
    if (token.kind === "ident") {
      this.pos += 1;
      this.expectOp("(");
      const args: Node[] = [];
      if (!this.eatOp(")")) {
        for (;;) {
          args.push(this.comparison());
          if (this.eatOp(";")) continue;
          this.expectOp(")");
          break;
        }
      }
      return { t: "call", name: token.name.toUpperCase(), args };
    }
    if (token.value === "(") {
      this.pos += 1;
      const inner = this.comparison();
      this.expectOp(")");
      return inner;
    }

    throw new ExpressionError(`неожиданный «${token.value}»`);
  }
}

// ------------------------------------------------------------ вычисление

/** Пробелы (включая неразрывные) — мусор из QUIK, запятая — десятичный разделитель. */
export function normalizeNumeric(raw: string): string {
  return raw.replace(/[\s\u00A0\u202F\u2007]/g, "").replace(",", ".");
}

function toNumber(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) throw new ExpressionError("дату нельзя использовать как число");
  const num = Number(normalizeNumeric(v));
  if (!Number.isFinite(num)) throw new ExpressionError(`не число: «${v}»`);
  return num;
}

function toBoolean(v: Value): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v instanceof Date) return true;
  return v.length > 0;
}

function compare(op: string, l: Value, r: Value): boolean {
  let diff: number;
  if (l instanceof Date && r instanceof Date) {
    diff = l.getTime() - r.getTime();
  } else if (typeof l === "string" && typeof r === "string") {
    diff = l < r ? -1 : l > r ? 1 : 0;
  } else {
    diff = toNumber(l) - toNumber(r);
  }

  switch (op) {
    case "=":
      return diff === 0;
    case "<>":
      return diff !== 0;
    case "<":
      return diff < 0;
    case "<=":
      return diff <= 0;
    case ">":
      return diff > 0;
    default:
      return diff >= 0;
  }
}

function formatDate(date: Date, format: string): string {
  return format.replace(/ГГГГ|ГГ|ММ|ДД|YYYY|YY|MM|DD/g, (token) => {
    switch (token) {
      case "ГГГГ":
      case "YYYY":
        return String(date.getFullYear());
      case "ГГ":
      case "YY":
        return String(date.getFullYear() % 100).padStart(2, "0");
      case "ММ":
      case "MM":
        return String(date.getMonth() + 1).padStart(2, "0");
      default:
        return String(date.getDate()).padStart(2, "0");
    }
  });
}

function expectArgs(name: string, args: Value[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const expected = min === max ? `${min}` : `от ${min} до ${max}`;
    throw new ExpressionError(`${name}: ожидалось аргументов ${expected}, получено ${args.length}`);
  }
}

function callFunction(name: string, node: { args: Node[] }, scope: Scope): Value {
  // IF вычисляет только выбранную ветку — иначе `IF(x=0;0;10/x)` падал бы на нуле.
  if (name === "IF") {
    if (node.args.length !== 3) {
      throw new ExpressionError(`IF: ожидалось аргументов 3, получено ${node.args.length}`);
    }
    return toBoolean(evaluate(node.args[0], scope))
      ? evaluate(node.args[1], scope)
      : evaluate(node.args[2], scope);
  }

  const args = node.args.map((arg) => evaluate(arg, scope));

  switch (name) {
    case "ABS":
      expectArgs(name, args, 1);
      return Math.abs(toNumber(args[0]));
    case "INT":
      expectArgs(name, args, 1);
      return Math.trunc(toNumber(args[0]));
    case "ROUND": {
      expectArgs(name, args, 1, 2);
      const digits = args.length === 2 ? Math.trunc(toNumber(args[1])) : 0;
      const factor = 10 ** digits;
      return Math.round(toNumber(args[0]) * factor) / factor;
    }
    case "MAX":
      expectArgs(name, args, 1, Infinity);
      return Math.max(...args.map(toNumber));
    case "MIN":
      expectArgs(name, args, 1, Infinity);
      return Math.min(...args.map(toNumber));
    case "TODAY":
      expectArgs(name, args, 0);
      return new Date();
    case "TEXT": {
      expectArgs(name, args, 2);
      const [value, format] = args;
      if (typeof format !== "string") throw new ExpressionError("TEXT: формат должен быть текстом");
      if (value instanceof Date) return formatDate(value, format);
      const digits = /^0\.(0+)$/.exec(format);
      if (digits) return toNumber(value).toFixed(digits[1].length);
      return stringify(value);
    }
    // Склейка текста нужна для условных полей транзакции: комментарий с UID
    // строится как CONCATENATE("/&!";[UID]) и пустеет целиком, когда UID не задан.
    // Имя взято из Excel — там пачку собирали ровно этой функцией.
    case "CONCATENATE": {
      expectArgs(name, args, 1, Infinity);
      return args.map((value) => stringify(value)).join("");
    }
    default:
      throw new ExpressionError(`неизвестная функция «${name}»`);
  }
}

export type Scope = (column: string) => Value;

function evaluate(node: Node, scope: Scope): Value {
  switch (node.t) {
    case "lit":
      return node.v;
    case "col":
      return scope(node.name);
    case "neg":
      return -toNumber(evaluate(node.e, scope));
    case "call":
      return callFunction(node.name, node, scope);
    case "bin": {
      const left = evaluate(node.l, scope);
      const right = evaluate(node.r, scope);
      if (["=", "<>", "<", "<=", ">", ">="].includes(node.op)) {
        return compare(node.op, left, right);
      }
      const a = toNumber(left);
      const b = toNumber(right);
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        default:
          if (b === 0) throw new ExpressionError("деление на ноль");
          return a / b;
      }
    }
  }
}

/** Значение в текст транзакции. Дата обязана пройти через TEXT — формат у QUIK строгий. */
function stringify(value: Value): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) {
    throw new ExpressionError('дату нужно отформатировать: TEXT(...;"ГГГГММДД")');
  }
  return String(value);
}

// -------------------------------------------------- скомпилированный шаблон

export interface CompiledExpression {
  readonly source: string;
  readonly columns: readonly string[];
  run(scope: Scope): Value;
}

export function compileExpression(source: string): CompiledExpression {
  const ast = new Parser(tokenize(source)).parse();
  const columns = new Set<string>();
  (function walk(node: Node) {
    if (node.t === "col") columns.add(node.name);
    else if (node.t === "bin") {
      walk(node.l);
      walk(node.r);
    } else if (node.t === "neg") walk(node.e);
    else if (node.t === "call") node.args.forEach(walk);
  })(ast);

  return {
    source,
    columns: [...columns],
    run: (scope) => evaluate(ast, scope),
  };
}

type Segment = { literal: string } | { expression: CompiledExpression };

export interface CompiledLine {
  readonly segments: readonly Segment[];
  /** Все колонки, упомянутые хотя бы в одном выражении строки. */
  readonly columns: readonly string[];
  render(scope: Scope): string;
}

/**
 * Разбирает текст транзакции на literal-куски и выражения `${...}`.
 * Закрывающая скобка ищется с учётом вложенности и строковых литералов —
 * иначе `${IF(x;"}";"")}` оборвался бы посреди выражения.
 */
export function compileLine(text: string): CompiledLine {
  const segments: Segment[] = [];
  let i = 0;
  let literal = "";

  while (i < text.length) {
    if (text[i] === "$" && text[i + 1] === "{") {
      if (literal) {
        segments.push({ literal });
        literal = "";
      }
      let depth = 1;
      let j = i + 2;
      let inString = false;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (inString) {
          if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        j += 1;
      }
      if (depth > 0) throw new ExpressionError("не закрыта «${»");
      segments.push({ expression: compileExpression(text.slice(i + 2, j - 1)) });
      i = j;
      continue;
    }
    literal += text[i];
    i += 1;
  }
  if (literal) segments.push({ literal });

  const columns = new Set<string>();
  for (const segment of segments) {
    if ("expression" in segment) segment.expression.columns.forEach((c) => columns.add(c));
  }

  return {
    segments,
    columns: [...columns],
    render(scope) {
      let out = "";
      for (const segment of segments) {
        out += "literal" in segment ? segment.literal : stringify(segment.expression.run(scope));
      }
      return out;
    },
  };
}
