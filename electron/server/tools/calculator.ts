function tokenizeExpression(expression: string) {
  const tokens: string[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let value = ch;
      i++;
      while (i < expression.length && /[0-9.eE+-]/.test(expression[i])) {
        const prev = expression[i - 1];
        const next = expression[i];
        if ((next === "+" || next === "-") && prev.toLowerCase() !== "e") break;
        value += next;
        i++;
      }
      tokens.push(value);
      continue;
    }
    if (/[a-z_]/i.test(ch)) {
      let value = ch;
      i++;
      while (i < expression.length && /[a-z0-9_]/i.test(expression[i])) value += expression[i++];
      tokens.push(value.toLowerCase());
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    throw new Error(`Invalid character in expression: ${ch}`);
  }
  return tokens;
}

export function evaluateExpression(expression: string) {
  if (expression.length > 500) throw new Error("Expression is too long.");
  const tokens = tokenizeExpression(expression);
  let pos = 0;

  const peek = () => tokens[pos];
  const take = (expected?: string) => {
    const token = tokens[pos];
    if (expected && token !== expected) throw new Error(`Expected "${expected}" but found "${token ?? "end"}".`);
    pos++;
    return token;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take();
      const right = parsePower();
      if (op === "*") value *= right;
      else if (op === "/") value /= right;
      else value %= right;
    }
    return value;
  };

  const parsePower = (): number => {
    let value = parseUnary();
    if (peek() === "^") {
      take("^");
      value = value ** parsePower();
    }
    return value;
  };

  const parseUnary = (): number => {
    if (peek() === "+") {
      take("+");
      return parseUnary();
    }
    if (peek() === "-") {
      take("-");
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parseArguments = () => {
    const values: number[] = [];
    take("(");
    if (peek() === ")") {
      take(")");
      return values;
    }
    while (true) {
      values.push(parseExpression());
      if (peek() !== ",") break;
      take(",");
    }
    take(")");
    return values;
  };

  const functions: Record<string, (...values: number[]) => number> = {
    abs: Math.abs,
    sqrt: Math.sqrt,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    log: Math.log10,
    ln: Math.log,
    exp: Math.exp,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
  };

  const parsePrimary = (): number => {
    const token = peek();
    if (!token) throw new Error("Unexpected end of expression.");
    if (token === "(") {
      take("(");
      const value = parseExpression();
      take(")");
      return value;
    }
    if (/^\d|\./.test(token)) {
      take();
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error(`Invalid number: ${token}`);
      return value;
    }
    if (/^[a-z_]/.test(token)) {
      take();
      if (token === "pi") return Math.PI;
      if (token === "e") return Math.E;
      const fn = functions[token];
      if (!fn) throw new Error(`Unknown function or constant: ${token}`);
      const args = parseArguments();
      return fn(...args);
    }
    throw new Error(`Unexpected token: ${token}`);
  };

  const result = parseExpression();
  if (pos < tokens.length) throw new Error(`Unexpected token: ${tokens[pos]}`);
  if (!Number.isFinite(result)) throw new Error("Result is not finite.");
  return result;
}
