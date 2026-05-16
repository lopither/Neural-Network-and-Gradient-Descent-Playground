import assert from "node:assert/strict";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const mathFunctions = {
  abs: Math.abs,
  cos: Math.cos,
  exp: Math.exp,
  log: Math.log,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

function tokenizeExpression(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
    } else if (/[0-9.]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9.]/.test(source[index])) index += 1;
      const value = Number(source.slice(start, index));
      if (!Number.isFinite(value)) throw new Error("Invalid number");
      tokens.push({ type: "number", value });
    } else if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index += 1;
      tokens.push({ type: "name", value: source.slice(start, index).toLowerCase() });
    } else if ("+-*/^(),".includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
    } else {
      throw new Error("Unsupported character");
    }
  }
  tokens.push({ type: "end" });
  return tokens;
}

function compileMathExpression(source) {
  const tokens = tokenizeExpression(source);
  let index = 0;
  const peek = () => tokens[index];
  const match = (type) => {
    if (peek().type !== type) return false;
    index += 1;
    return true;
  };
  const expect = (type) => {
    if (!match(type)) throw new Error(`Expected ${type}`);
  };
  const parseExpression = () => parseAddSub();
  const parseAddSub = () => {
    let left = parseMulDiv();
    while (peek().type === "+" || peek().type === "-") {
      const operator = tokens[index].type;
      index += 1;
      const right = parseMulDiv();
      const previous = left;
      left = operator === "+" ? (ctx) => previous(ctx) + right(ctx) : (ctx) => previous(ctx) - right(ctx);
    }
    return left;
  };
  const parseMulDiv = () => {
    let left = parseUnary();
    while (peek().type === "*" || peek().type === "/") {
      const operator = tokens[index].type;
      index += 1;
      const right = parseUnary();
      const previous = left;
      left = operator === "*" ? (ctx) => previous(ctx) * right(ctx) : (ctx) => previous(ctx) / right(ctx);
    }
    return left;
  };
  const parseUnary = () => {
    if (match("+")) return parseUnary();
    if (match("-")) {
      const value = parseUnary();
      return (ctx) => -value(ctx);
    }
    return parsePower();
  };
  const parsePower = () => {
    const left = parsePrimary();
    if (match("^")) {
      const right = parseUnary();
      return (ctx) => Math.pow(left(ctx), right(ctx));
    }
    return left;
  };
  const parsePrimary = () => {
    const token = peek();
    if (match("number")) return () => token.value;
    if (match("name")) {
      const name = token.value;
      if (match("(")) {
        const args = [];
        if (!match(")")) {
          do {
            args.push(parseExpression());
          } while (match(","));
          expect(")");
        }
        const fn = mathFunctions[name];
        if (!fn) throw new Error(`Unknown function ${name}`);
        return (ctx) => fn(...args.map((arg) => arg(ctx)));
      }
      if (name === "x") return (ctx) => ctx.x;
      if (name === "y") return (ctx) => ctx.y;
      if (name === "pi") return () => Math.PI;
      if (name === "e") return () => Math.E;
      throw new Error(`Unknown symbol ${name}`);
    }
    if (match("(")) {
      const expression = parseExpression();
      expect(")");
      return expression;
    }
    throw new Error("Expected expression");
  };
  const evaluator = parseExpression();
  assert.equal(peek().type, "end");
  return (x, y) => evaluator({ x, y });
}

function numericGradient(f, domain, x, y) {
  const span = Math.max(domain.x[1] - domain.x[0], domain.y[1] - domain.y[0]);
  const h = Math.max(1e-5, span * 1e-5);
  const x1 = clamp(x + h, domain.x[0], domain.x[1]);
  const x0 = clamp(x - h, domain.x[0], domain.x[1]);
  const y1 = clamp(y + h, domain.y[0], domain.y[1]);
  const y0 = clamp(y - h, domain.y[0], domain.y[1]);
  return [
    (f(x1, y) - f(x0, y)) / (x1 - x0),
    (f(x, y1) - f(x, y0)) / (y1 - y0),
  ];
}

function estimateCustomMinima(f, domain) {
  let best = { x: 0, y: 0, value: Number.POSITIVE_INFINITY };
  const samples = 41;
  for (let row = 0; row < samples; row += 1) {
    const y = domain.y[0] + (row / (samples - 1)) * (domain.y[1] - domain.y[0]);
    for (let col = 0; col < samples; col += 1) {
      const x = domain.x[0] + (col / (samples - 1)) * (domain.x[1] - domain.x[0]);
      const value = f(x, y);
      if (Number.isFinite(value) && value < best.value) best = { x, y, value };
    }
  }
  const span = Math.max(domain.x[1] - domain.x[0], domain.y[1] - domain.y[0]);
  let step = span * 0.06;
  for (let i = 0; i < 120; i += 1) {
    const [gx, gy] = numericGradient(f, domain, best.x, best.y);
    const norm = Math.hypot(gx, gy);
    if (norm < 1e-9) break;
    const next = {
      x: clamp(best.x - (gx / norm) * step, domain.x[0], domain.x[1]),
      y: clamp(best.y - (gy / norm) * step, domain.y[0], domain.y[1]),
    };
    next.value = f(next.x, next.y);
    if (Number.isFinite(next.value) && next.value < best.value) {
      best = next;
      step *= 1.04;
    } else {
      step *= 0.55;
    }
  }
  return [best.x, best.y, best.value];
}

function confusionMatrix(points, predict) {
  const matrix = { tp: 0, tn: 0, fp: 0, fn: 0 };
  for (const point of points) {
    const predicted = predict(point) >= 0.5 ? 1 : 0;
    if (predicted === 1 && point.label === 1) matrix.tp += 1;
    else if (predicted === 0 && point.label === 0) matrix.tn += 1;
    else if (predicted === 1) matrix.fp += 1;
    else matrix.fn += 1;
  }
  return matrix;
}

function classifyOptimizerStatus({ step, maxSteps, distance, tolerance, clippedSteps, finiteLoss }) {
  if (!finiteLoss) return "Diverging";
  if (clippedSteps >= 8) return "Boundary clipped";
  if (distance <= tolerance) return "Converged";
  if (step >= maxSteps) return "Max steps reached";
  return "Running";
}

const expr = compileMathExpression("sin(x) + y^2 + max(1, x)");
assert.ok(Math.abs(expr(0, 2) - 5) < 1e-9);

const domain = { x: [-5, 5], y: [-5, 5] };
const quadratic = (x, y) => x * x + y * y;
const [gx, gy] = numericGradient(quadratic, domain, 2, -3);
assert.ok(Math.abs(gx - 4) < 1e-3);
assert.ok(Math.abs(gy + 6) < 1e-3);

const [qx, qy, qLoss] = estimateCustomMinima(quadratic, domain);
assert.ok(Math.hypot(qx, qy) < 0.1);
assert.ok(qLoss < 0.02);

const rosenbrock = (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2;
const [, , rLoss] = estimateCustomMinima(rosenbrock, { x: [-2, 2], y: [-1, 3] });
assert.ok(rLoss < 0.25);

const himmelblau = (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2;
const [, , hLoss] = estimateCustomMinima(himmelblau, { x: [-6, 6], y: [-6, 6] });
assert.ok(hLoss < 0.5);

assert.deepEqual(
  confusionMatrix([
    { label: 1, score: 0.8 },
    { label: 1, score: 0.2 },
    { label: 0, score: 0.7 },
    { label: 0, score: 0.1 },
  ], (point) => point.score),
  { tp: 1, tn: 1, fp: 1, fn: 1 }
);

assert.equal(classifyOptimizerStatus({ step: 12, maxSteps: 520, distance: 0.001, tolerance: 0.01, clippedSteps: 0, finiteLoss: true }), "Converged");
assert.equal(classifyOptimizerStatus({ step: 12, maxSteps: 520, distance: 1, tolerance: 0.01, clippedSteps: 8, finiteLoss: true }), "Boundary clipped");
assert.equal(classifyOptimizerStatus({ step: 520, maxSteps: 520, distance: 1, tolerance: 0.01, clippedSteps: 0, finiteLoss: true }), "Max steps reached");
assert.equal(classifyOptimizerStatus({ step: 12, maxSteps: 520, distance: 1, tolerance: 0.01, clippedSteps: 0, finiteLoss: false }), "Diverging");

let epoch = 0;
const maxEpochs = 7;
while (epoch < maxEpochs) epoch += 1;
assert.equal(epoch, maxEpochs);

const exported = {
  version: 1,
  mode: "combined",
  dataset: { points: [{ x: 0, y: 0, label: 1 }] },
  networkConfig: { maxEpochs },
  optimizerConfig: { selectedOptimizers: ["gd"] },
  surfaceConfig: { key: "quadratic" },
  history: { classifier: [], optimizer: { runners: {} } },
  analysis: {},
};
assert.deepEqual(JSON.parse(JSON.stringify(exported)).optimizerConfig.selectedOptimizers, ["gd"]);

console.log("core tests passed");
