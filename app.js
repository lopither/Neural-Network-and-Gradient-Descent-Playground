import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

(() => {
  const $ = (id) => document.getElementById(id);
  const urlParams = new URLSearchParams(window.location.search);
  const debugSnapshots = urlParams.has("debugSnapshot");
  const startupOptimizerSteps = Number(urlParams.get("autoSteps") || 0);
  const startupMaxEpochs = Number(urlParams.get("maxEpoch") || 0);
  const startupNetworkTrain = urlParams.has("autoNetworkTrain");

  const colors = {
    bg: "#0b0d0f",
    grid: "rgba(255,255,255,0.08)",
    text: "#f1f3f2",
    muted: "#a7afad",
    teal: "#4cc9b0",
    coral: "#ef6f6c",
    amber: "#f0ad4e",
    blue: "#6ca6e8",
    violet: "#b58cff",
    green: "#85d36b",
  };

  let seed = 851321;
  let spareNormal = null;

  function random() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function randBetween(min, max) {
    return min + random() * (max - min);
  }

  function randNormal() {
    if (spareNormal !== null) {
      const value = spareNormal;
      spareNormal = null;
      return value;
    }

    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    const mag = Math.sqrt(-2 * Math.log(u));
    spareNormal = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value, digits = 3) {
    if (!Number.isFinite(value)) return "inf";
    if (Math.abs(value) >= 1000) return value.toExponential(2);
    if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(2);
    return value.toFixed(digits);
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function mix(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }

  function interpolateColor(stops, t) {
    const value = clamp(t, 0, 1);
    const scaled = value * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(scaled));
    const local = scaled - index;
    const a = hexToRgb(stops[index]);
    const b = hexToRgb(stops[index + 1]);
    return `rgb(${mix(a.r, b.r, local)}, ${mix(a.g, b.g, local)}, ${mix(a.b, b.b, local)})`;
  }

  const mathFunctions = {
    abs: Math.abs,
    acos: Math.acos,
    asin: Math.asin,
    atan: Math.atan,
    atan2: Math.atan2,
    ceil: Math.ceil,
    cos: Math.cos,
    cosh: Math.cosh,
    exp: Math.exp,
    floor: Math.floor,
    log: Math.log,
    log10: Math.log10,
    max: Math.max,
    min: Math.min,
    pow: Math.pow,
    round: Math.round,
    sign: Math.sign,
    sin: Math.sin,
    sinh: Math.sinh,
    sqrt: Math.sqrt,
    tan: Math.tan,
    tanh: Math.tanh,
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
        if (/[eE]/.test(source[index] ?? "")) {
          index += 1;
          if (/[+-]/.test(source[index] ?? "")) index += 1;
          while (index < source.length && /[0-9]/.test(source[index])) index += 1;
        }
        const value = Number(source.slice(start, index));
        if (!Number.isFinite(value)) throw new Error(`Invalid number near "${source.slice(start, index)}"`);
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
        throw new Error(`Unsupported character "${char}"`);
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
      if (!match(type)) throw new Error(`Expected "${type}"`);
    };

    const parseExpression = () => parseAddSub();

    const parseAddSub = () => {
      let left = parseMulDiv();
      while (peek().type === "+" || peek().type === "-") {
        const operator = tokens[index].type;
        index += 1;
        const right = parseMulDiv();
        const previous = left;
        left = operator === "+"
          ? (ctx) => previous(ctx) + right(ctx)
          : (ctx) => previous(ctx) - right(ctx);
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
        left = operator === "*"
          ? (ctx) => previous(ctx) * right(ctx)
          : (ctx) => previous(ctx) / right(ctx);
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
      if (match("number")) {
        return () => token.value;
      }

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
          if (!fn) throw new Error(`Unknown function "${name}"`);
          return (ctx) => fn(...args.map((arg) => arg(ctx)));
        }

        if (name === "x") return (ctx) => ctx.x;
        if (name === "y") return (ctx) => ctx.y;
        if (name === "pi") return () => Math.PI;
        if (name === "e") return () => Math.E;
        throw new Error(`Unknown symbol "${name}"`);
      }

      if (match("(")) {
        const expression = parseExpression();
        expect(")");
        return expression;
      }

      throw new Error("Expected a number, variable, function, or parenthesized expression");
    };

    const evaluator = parseExpression();
    if (peek().type !== "end") throw new Error(`Unexpected token "${peek().value ?? peek().type}"`);
    return (x, y) => evaluator({ x, y });
  }

  const classifierCanvas = $("classifierCanvas");
  const classifierCtx = classifierCanvas.getContext("2d");

  const classifier = {
    points: [],
    trainPoints: [],
    validationPoints: [],
    network: null,
    running: false,
    epoch: 0,
    metrics: {
      trainLoss: 0,
      trainAccuracy: 0,
      validationLoss: 0,
      validationAccuracy: 0,
    },
    confusion: { tp: 0, tn: 0, fp: 0, fn: 0 },
    history: [],
    timelineIndex: null,
    overfitWarning: false,
    drawClass: 1,
    drawing: false,
    lastDrawPoint: null,
  };

  class NeuralNetwork {
    constructor(hiddenUnits, depth, activation, optimizer) {
      this.activation = activation;
      this.optimizer = optimizer;
      this.layers = [2, ...Array(depth).fill(hiddenUnits), 1];
      this.weights = [];
      this.biases = [];
      this.mW = [];
      this.vW = [];
      this.mB = [];
      this.vB = [];
      this.t = 0;

      for (let layer = 0; layer < this.layers.length - 1; layer += 1) {
        const inputSize = this.layers[layer];
        const outputSize = this.layers[layer + 1];
        const scale = Math.sqrt(2 / (inputSize + outputSize));
        const weights = Array.from({ length: inputSize }, () =>
          Array.from({ length: outputSize }, () => randNormal() * scale)
        );
        const biases = Array.from({ length: outputSize }, () => 0);
        this.weights.push(weights);
        this.biases.push(biases);
        this.mW.push(weights.map((row) => row.map(() => 0)));
        this.vW.push(weights.map((row) => row.map(() => 0)));
        this.mB.push(biases.map(() => 0));
        this.vB.push(biases.map(() => 0));
      }
    }

    hiddenActivation(z) {
      if (this.activation === "relu") return Math.max(0, z);
      if (this.activation === "sigmoid") return 1 / (1 + Math.exp(-clamp(z, -50, 50)));
      return Math.tanh(z);
    }

    hiddenDerivative(z) {
      if (this.activation === "relu") return z > 0 ? 1 : 0;
      if (this.activation === "sigmoid") {
        const s = 1 / (1 + Math.exp(-clamp(z, -50, 50)));
        return s * (1 - s);
      }
      const t = Math.tanh(z);
      return 1 - t * t;
    }

    forward(input) {
      const activations = [input.slice()];
      const zs = [];
      let current = input.slice();

      for (let layer = 0; layer < this.weights.length; layer += 1) {
        const outputSize = this.layers[layer + 1];
        const z = Array.from({ length: outputSize }, (_, out) => {
          let sum = this.biases[layer][out];
          for (let i = 0; i < current.length; i += 1) {
            sum += current[i] * this.weights[layer][i][out];
          }
          return sum;
        });

        const isOutput = layer === this.weights.length - 1;
        current = z.map((value) =>
          isOutput ? 1 / (1 + Math.exp(-clamp(value, -50, 50))) : this.hiddenActivation(value)
        );
        zs.push(z);
        activations.push(current);
      }

      return { activations, zs, output: current[0] };
    }

    predict(input) {
      return this.forward(input).output;
    }

    evaluateBatch(points, l2 = 0) {
      if (!points.length) {
        return { loss: 0, accuracy: 0 };
      }

      let loss = 0;
      let correct = 0;
      const epsilon = 1e-7;

      for (const point of points) {
        const output = this.predict([point.x, point.y]);
        const y = point.label;
        const p = clamp(output, epsilon, 1 - epsilon);
        loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
        if ((output >= 0.5 ? 1 : 0) === y) correct += 1;
      }

      loss /= points.length;
      for (const matrix of this.weights) {
        for (const row of matrix) {
          for (const weight of row) {
            loss += 0.5 * l2 * weight ** 2;
          }
        }
      }

      return { loss, accuracy: correct / points.length };
    }

    trainBatch(points, learningRate, l2) {
      if (!points.length) {
        return { loss: 0, accuracy: 0 };
      }

      const gradW = this.weights.map((matrix) => matrix.map((row) => row.map(() => 0)));
      const gradB = this.biases.map((bias) => bias.map(() => 0));
      let loss = 0;
      let correct = 0;
      const epsilon = 1e-7;

      for (const point of points) {
        const { activations, zs, output } = this.forward([point.x, point.y]);
        const y = point.label;
        const p = clamp(output, epsilon, 1 - epsilon);
        loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
        if ((output >= 0.5 ? 1 : 0) === y) correct += 1;

        const deltas = Array.from({ length: this.weights.length }, () => []);
        deltas[deltas.length - 1] = [output - y];

        for (let layer = this.weights.length - 2; layer >= 0; layer -= 1) {
          const size = this.layers[layer + 1];
          const nextSize = this.layers[layer + 2];
          deltas[layer] = Array.from({ length: size }, (_, i) => {
            let sum = 0;
            for (let j = 0; j < nextSize; j += 1) {
              sum += this.weights[layer + 1][i][j] * deltas[layer + 1][j];
            }
            return sum * this.hiddenDerivative(zs[layer][i]);
          });
        }

        for (let layer = 0; layer < this.weights.length; layer += 1) {
          for (let i = 0; i < this.weights[layer].length; i += 1) {
            for (let j = 0; j < this.weights[layer][i].length; j += 1) {
              gradW[layer][i][j] += activations[layer][i] * deltas[layer][j];
            }
          }
          for (let j = 0; j < this.biases[layer].length; j += 1) {
            gradB[layer][j] += deltas[layer][j];
          }
        }
      }

      const n = points.length;
      loss /= n;

      for (let layer = 0; layer < this.weights.length; layer += 1) {
        for (let i = 0; i < this.weights[layer].length; i += 1) {
          for (let j = 0; j < this.weights[layer][i].length; j += 1) {
            gradW[layer][i][j] = gradW[layer][i][j] / n + l2 * this.weights[layer][i][j];
            loss += 0.5 * l2 * this.weights[layer][i][j] ** 2;
          }
        }
        for (let j = 0; j < this.biases[layer].length; j += 1) {
          gradB[layer][j] /= n;
        }
      }

      if (this.optimizer === "adam") {
        this.applyAdam(gradW, gradB, learningRate);
      } else {
        this.applySgd(gradW, gradB, learningRate);
      }

      return { loss, accuracy: correct / n };
    }

    applySgd(gradW, gradB, learningRate) {
      for (let layer = 0; layer < this.weights.length; layer += 1) {
        for (let i = 0; i < this.weights[layer].length; i += 1) {
          for (let j = 0; j < this.weights[layer][i].length; j += 1) {
            this.weights[layer][i][j] -= learningRate * gradW[layer][i][j];
          }
        }
        for (let j = 0; j < this.biases[layer].length; j += 1) {
          this.biases[layer][j] -= learningRate * gradB[layer][j];
        }
      }
    }

    applyAdam(gradW, gradB, learningRate) {
      this.t += 1;
      const beta1 = 0.9;
      const beta2 = 0.999;
      const epsilon = 1e-8;

      for (let layer = 0; layer < this.weights.length; layer += 1) {
        for (let i = 0; i < this.weights[layer].length; i += 1) {
          for (let j = 0; j < this.weights[layer][i].length; j += 1) {
            const grad = gradW[layer][i][j];
            this.mW[layer][i][j] = beta1 * this.mW[layer][i][j] + (1 - beta1) * grad;
            this.vW[layer][i][j] = beta2 * this.vW[layer][i][j] + (1 - beta2) * grad * grad;
            const mHat = this.mW[layer][i][j] / (1 - beta1 ** this.t);
            const vHat = this.vW[layer][i][j] / (1 - beta2 ** this.t);
            this.weights[layer][i][j] -= learningRate * mHat / (Math.sqrt(vHat) + epsilon);
          }
        }
        for (let j = 0; j < this.biases[layer].length; j += 1) {
          const grad = gradB[layer][j];
          this.mB[layer][j] = beta1 * this.mB[layer][j] + (1 - beta1) * grad;
          this.vB[layer][j] = beta2 * this.vB[layer][j] + (1 - beta2) * grad * grad;
          const mHat = this.mB[layer][j] / (1 - beta1 ** this.t);
          const vHat = this.vB[layer][j] / (1 - beta2 ** this.t);
          this.biases[layer][j] -= learningRate * mHat / (Math.sqrt(vHat) + epsilon);
        }
      }
    }

    toState() {
      return {
        activation: this.activation,
        optimizer: this.optimizer,
        layers: this.layers.slice(),
        weights: this.weights.map((matrix) => matrix.map((row) => row.slice())),
        biases: this.biases.map((bias) => bias.slice()),
        mW: this.mW.map((matrix) => matrix.map((row) => row.slice())),
        vW: this.vW.map((matrix) => matrix.map((row) => row.slice())),
        mB: this.mB.map((bias) => bias.slice()),
        vB: this.vB.map((bias) => bias.slice()),
        t: this.t,
      };
    }

    static fromState(state) {
      const hiddenUnits = state.layers?.[1] ?? 8;
      const depth = Math.max(1, (state.layers?.length ?? 3) - 2);
      const network = new NeuralNetwork(hiddenUnits, depth, state.activation || "tanh", state.optimizer || "adam");
      if (Array.isArray(state.weights) && Array.isArray(state.biases)) {
        if (Array.isArray(state.layers)) network.layers = state.layers.slice();
        network.weights = state.weights.map((matrix) => matrix.map((row) => row.slice()));
        network.biases = state.biases.map((bias) => bias.slice());
        network.mW = (state.mW || network.weights.map((matrix) => matrix.map((row) => row.map(() => 0))))
          .map((matrix) => matrix.map((row) => row.slice()));
        network.vW = (state.vW || network.weights.map((matrix) => matrix.map((row) => row.map(() => 0))))
          .map((matrix) => matrix.map((row) => row.slice()));
        network.mB = (state.mB || network.biases.map((bias) => bias.map(() => 0))).map((bias) => bias.slice());
        network.vB = (state.vB || network.biases.map((bias) => bias.map(() => 0))).map((bias) => bias.slice());
        network.t = Number(state.t) || 0;
      }
      return network;
    }
  }

  function generateDataset(kind, count, noise) {
    const points = [];
    const half = Math.floor(count / 2);

    const push = (x, y, label) => {
      const flip = random() < noise * 0.35;
      points.push({
        x: clamp(x, -1, 1),
        y: clamp(y, -1, 1),
        label: flip ? 1 - label : label,
      });
    };

    if (kind === "circles") {
      for (let i = 0; i < count; i += 1) {
        const label = i < half ? 0 : 1;
        const angle = randBetween(0, Math.PI * 2);
        const radius = label === 0 ? randBetween(0.12, 0.42) : randBetween(0.62, 0.9);
        push(
          Math.cos(angle) * radius + randNormal() * noise,
          Math.sin(angle) * radius + randNormal() * noise,
          label
        );
      }
    } else if (kind === "moons") {
      for (let i = 0; i < half; i += 1) {
        const t = randBetween(0, Math.PI);
        push(Math.cos(t) * 0.72 - 0.25 + randNormal() * noise, Math.sin(t) * 0.52 + 0.12 + randNormal() * noise, 0);
        push(0.52 - Math.cos(t) * 0.72 + randNormal() * noise, -Math.sin(t) * 0.52 - 0.16 + randNormal() * noise, 1);
      }
    } else if (kind === "spirals") {
      for (let i = 0; i < half; i += 1) {
        const t = randBetween(0.25, Math.PI * 2.7);
        const radius = t / (Math.PI * 2.9);
        push(
          Math.cos(t) * radius + randNormal() * noise * 0.7,
          Math.sin(t) * radius + randNormal() * noise * 0.7,
          0
        );
        push(
          Math.cos(t + Math.PI) * radius + randNormal() * noise * 0.7,
          Math.sin(t + Math.PI) * radius + randNormal() * noise * 0.7,
          1
        );
      }
    } else if (kind === "xor") {
      for (let i = 0; i < count; i += 1) {
        const x = randBetween(-1, 1);
        const y = randBetween(-1, 1);
        const label = x * y > 0 ? 1 : 0;
        push(clamp(x + randNormal() * noise * 0.45, -1, 1), clamp(y + randNormal() * noise * 0.45, -1, 1), label);
      }
    } else {
      const centers = [
        [-0.46, -0.36, 0],
        [0.45, 0.38, 1],
        [-0.35, 0.45, 1],
        [0.42, -0.42, 0],
      ];
      for (let i = 0; i < count; i += 1) {
        const [cx, cy, label] = centers[i % centers.length];
        push(cx + randNormal() * (0.12 + noise), cy + randNormal() * (0.12 + noise), label);
      }
    }

    return points;
  }

  function splitKey(point, index) {
    const x = Math.round((point.x + 1.5) * 100000);
    const y = Math.round((point.y + 1.5) * 100000);
    let value = (index + 1) * 2654435761;
    value ^= x * 2246822519;
    value ^= y * 3266489917;
    value ^= point.label ? 0x9e3779b9 : 0x85ebca6b;
    return value >>> 0;
  }

  function refreshClassifierSplit() {
    const sorted = classifier.points
      .map((point, index) => ({ point, key: splitKey(point, index) }))
      .sort((a, b) => a.key - b.key);
    const validationCount = classifier.points.length >= 10
      ? Math.max(1, Math.round(classifier.points.length * 0.2))
      : 0;
    const validation = new Set(sorted.slice(0, validationCount).map((item) => item.point));
    classifier.validationPoints = classifier.points.filter((point) => validation.has(point));
    classifier.trainPoints = classifier.points.filter((point) => !validation.has(point));
    if (!classifier.trainPoints.length && classifier.points.length) {
      classifier.trainPoints = classifier.points.slice();
      classifier.validationPoints = [];
    }
  }

  function classifierEvaluationPoints() {
    return classifier.validationPoints.length ? classifier.validationPoints : classifier.points;
  }

  function calculateConfusionMatrix(points) {
    const matrix = { tp: 0, tn: 0, fp: 0, fn: 0 };
    if (!classifier.network) return matrix;
    for (const point of points) {
      const predicted = classifier.network.predict([point.x, point.y]) >= 0.5 ? 1 : 0;
      if (predicted === 1 && point.label === 1) matrix.tp += 1;
      else if (predicted === 0 && point.label === 0) matrix.tn += 1;
      else if (predicted === 1 && point.label === 0) matrix.fp += 1;
      else matrix.fn += 1;
    }
    return matrix;
  }

  function evaluateClassifierState() {
    const l2 = Number($("l2Input").value);
    const train = classifier.network.evaluateBatch(classifier.trainPoints, l2);
    const validation = classifier.validationPoints.length
      ? classifier.network.evaluateBatch(classifier.validationPoints, l2)
      : { loss: train.loss, accuracy: train.accuracy };
    classifier.metrics = {
      trainLoss: train.loss,
      trainAccuracy: train.accuracy,
      validationLoss: validation.loss,
      validationAccuracy: validation.accuracy,
    };
    classifier.confusion = calculateConfusionMatrix(classifierEvaluationPoints());
  }

  function detectOverfitting() {
    const history = classifier.history;
    if (history.length < 14 || classifier.validationPoints.length < 4) return false;
    const current = history[history.length - 1].metrics;
    const previous = history[Math.max(0, history.length - 13)].metrics;
    return (
      current.trainLoss < previous.trainLoss * 0.96 &&
      current.validationLoss > previous.validationLoss * 1.04
    );
  }

  function classifierHistoryEntry() {
    return {
      epoch: classifier.epoch,
      metrics: { ...classifier.metrics },
      confusion: { ...classifier.confusion },
      overfitWarning: classifier.overfitWarning,
    };
  }

  function recordClassifierHistory() {
    const last = classifier.history[classifier.history.length - 1];
    if (last && last.epoch === classifier.epoch) {
      classifier.history[classifier.history.length - 1] = classifierHistoryEntry();
    } else {
      classifier.history.push(classifierHistoryEntry());
    }
    classifier.overfitWarning = detectOverfitting();
    classifier.history[classifier.history.length - 1].overfitWarning = classifier.overfitWarning;
    syncNetworkTimeline();
  }

  function displayedClassifierEntry() {
    if (classifier.timelineIndex === null || !classifier.history.length) {
      return classifierHistoryEntry();
    }
    const index = clamp(classifier.timelineIndex, 0, classifier.history.length - 1);
    return classifier.history[index] ?? classifierHistoryEntry();
  }

  function resetNetwork() {
    const hiddenUnits = Number($("hiddenUnitsInput").value);
    const depth = Number($("depthInput").value);
    const activation = $("activationSelect").value;
    const optimizer = $("networkOptimizerSelect").value;
    refreshClassifierSplit();
    classifier.network = new NeuralNetwork(hiddenUnits, depth, activation, optimizer);
    classifier.epoch = 0;
    classifier.running = false;
    classifier.timelineIndex = null;
    classifier.history = [];
    classifier.overfitWarning = false;
    evaluateClassifierState();
    recordClassifierHistory();
    updateClassifierMetrics();
    drawClassifier();
  }

  function regenerateDataset() {
    const kind = $("datasetSelect").value;
    const count = Number($("pointCountInput").value);
    const noise = Number($("noiseInput").value);
    classifier.points = generateDataset(kind, count, noise);
    resetNetwork();
  }

  function maxNetworkEpochs() {
    return Math.max(1, Math.floor(Number($("maxEpochInput").value) || 1));
  }

  function trainNetworkStep(updateUi = true) {
    if (classifier.epoch >= maxNetworkEpochs() || !classifier.trainPoints.length) {
      classifier.running = false;
      if (updateUi) updateClassifierMetrics();
      return false;
    }

    const learningRate = Number($("networkLrInput").value);
    const l2 = Number($("l2Input").value);
    classifier.timelineIndex = null;
    classifier.network.trainBatch(classifier.trainPoints, learningRate, l2);
    classifier.epoch += 1;
    evaluateClassifierState();
    recordClassifierHistory();
    if (classifier.epoch >= maxNetworkEpochs()) {
      classifier.running = false;
    }
    if (updateUi) updateClassifierMetrics();
    return true;
  }

  function updateClassifierMetrics() {
    const maxEpoch = maxNetworkEpochs();
    const entry = displayedClassifierEntry();
    const metrics = entry.metrics;
    $("epochValue").textContent = `${entry.epoch} / ${maxEpoch}`;
    $("lossValue").textContent = formatNumber(metrics.trainLoss, 3);
    $("validationLossValue").textContent = classifier.validationPoints.length ? formatNumber(metrics.validationLoss, 3) : "n/a";
    $("accuracyValue").textContent = formatPercent(metrics.trainAccuracy);
    $("validationAccuracyValue").textContent = classifier.validationPoints.length ? formatPercent(metrics.validationAccuracy) : "n/a";
    $("networkStatus").textContent = classifier.running ? `network training to ${maxEpoch}` : classifier.epoch >= maxEpoch ? "network epoch limit reached" : "network idle";
    $("trainNetworkButton").textContent = classifier.running ? "Pause" : "Train";
    updateClassifierAnalysis();
    drawLearningCharts();
  }

  function syncNetworkTimeline() {
    const input = $("networkTimelineInput");
    const value = $("networkTimelineValue");
    if (!input || !value) return;
    const max = Math.max(0, classifier.history.length - 1);
    input.max = String(max);
    if (classifier.timelineIndex === null) {
      input.value = String(max);
      value.textContent = classifier.history.length ? `Live epoch ${classifier.epoch}` : "Live";
    } else {
      const index = clamp(classifier.timelineIndex, 0, max);
      input.value = String(index);
      value.textContent = `Epoch ${classifier.history[index]?.epoch ?? 0}`;
    }
  }

  function updateClassifierAnalysis() {
    const panel = $("classifierAnalysis");
    if (!panel) return;
    const entry = displayedClassifierEntry();
    const metrics = entry.metrics;
    const confusion = entry.confusion;
    const evaluatedCount = classifierEvaluationPoints().length;
    const validationLabel = classifier.validationPoints.length
      ? `${classifier.validationPoints.length} validation points`
      : "no validation holdout";
    const splitLabel = `${classifier.trainPoints.length} train / ${classifier.validationPoints.length} validation`;
    const warning = entry.overfitWarning
      ? `<div class="warning-note">Possible overfitting: training loss is still improving while validation loss has worsened recently.</div>`
      : "";

    panel.innerHTML = `
      <div class="analysis-summary">
        <div class="analysis-stat"><span>Split</span><strong>${splitLabel}</strong></div>
        <div class="analysis-stat"><span>Validation accuracy</span><strong>${classifier.validationPoints.length ? formatPercent(metrics.validationAccuracy) : "n/a"}</strong></div>
        <div class="analysis-stat"><span>Validation loss</span><strong>${classifier.validationPoints.length ? formatNumber(metrics.validationLoss, 4) : "n/a"}</strong></div>
        <div class="analysis-stat"><span>Evaluated on</span><strong>${validationLabel}</strong></div>
      </div>
      ${warning}
      <div class="confusion-matrix">
        <span class="header">Confusion</span><span class="header">Pred A</span><span class="header">Pred B</span>
        <span class="axis">Actual A</span><span>${confusion.tp}</span><span>${confusion.fn}</span>
        <span class="axis">Actual B</span><span>${confusion.fp}</span><span>${confusion.tn}</span>
      </div>
      <div class="analysis-targets">Validation uses a deterministic 80/20 split when the dataset has at least 10 points. Confusion matrix is computed on validation data when available (${evaluatedCount} points).</div>
    `;
  }

  function prepareChartCanvas(canvas, cssHeight = 150) {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const rect = canvas.getBoundingClientRect();
    const logicalWidth = Math.max(220, Math.round(rect.width || canvas.clientWidth || 320));
    const logicalHeight = cssHeight;
    const pixelWidth = Math.round(logicalWidth * dpr);
    const pixelHeight = Math.round(logicalHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: logicalWidth, height: logicalHeight };
  }

  function drawChartFrame(ctx, width, height, title, yLabel) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0d1013";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = 30 + ((height - 48) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(36, y);
      ctx.lineTo(width - 12, y);
      ctx.stroke();
    }
    ctx.fillStyle = colors.text;
    ctx.font = "700 13px Inter, Segoe UI, sans-serif";
    ctx.fillText(title, 12, 18);
    ctx.fillStyle = colors.muted;
    ctx.font = "11px Inter, Segoe UI, sans-serif";
    ctx.fillText(yLabel, 12, height - 12);
  }

  function plotMetricLine(ctx, values, min, max, color, width, height) {
    if (values.length < 2 || max <= min) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const left = 36;
    const top = 28;
    const plotWidth = width - 48;
    const plotHeight = height - 52;
    const stride = Math.max(1, Math.floor(values.length / 240));
    let drawn = 0;
    for (let i = 0; i < values.length; i += stride) {
      const t = values.length === 1 ? 0 : i / (values.length - 1);
      const yValue = clamp((values[i] - min) / (max - min), 0, 1);
      const x = left + t * plotWidth;
      const y = top + (1 - yValue) * plotHeight;
      if (drawn === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      drawn += 1;
    }
    const last = values[values.length - 1];
    const lastT = 1;
    const lastY = top + (1 - clamp((last - min) / (max - min), 0, 1)) * plotHeight;
    ctx.lineTo(left + lastT * plotWidth, lastY);
    ctx.stroke();
    ctx.restore();
  }

  function drawLearningCharts() {
    const lossCanvas = $("lossChartCanvas");
    const accuracyCanvas = $("accuracyChartCanvas");
    if (!lossCanvas || !accuracyCanvas) return;
    const lossChart = prepareChartCanvas(lossCanvas);
    const accuracyChart = prepareChartCanvas(accuracyCanvas);
    const lossCtx = lossChart.ctx;
    const accuracyCtx = accuracyChart.ctx;
    const history = classifier.history.length ? classifier.history : [classifierHistoryEntry()];
    const trainLoss = history.map((entry) => entry.metrics.trainLoss).filter(Number.isFinite);
    const valLoss = history.map((entry) => entry.metrics.validationLoss).filter(Number.isFinite);
    const trainAccuracy = history.map((entry) => entry.metrics.trainAccuracy).filter(Number.isFinite);
    const valAccuracy = history.map((entry) => entry.metrics.validationAccuracy).filter(Number.isFinite);
    let lossMin = 0;
    let lossMax = 1e-6;
    for (const value of trainLoss.concat(valLoss)) {
      lossMin = Math.min(lossMin, value);
      lossMax = Math.max(lossMax, value);
    }

    drawChartFrame(lossCtx, lossChart.width, lossChart.height, "Loss", "train / validation");
    plotMetricLine(lossCtx, trainLoss, lossMin, lossMax, colors.blue, lossChart.width, lossChart.height);
    plotMetricLine(lossCtx, valLoss, lossMin, lossMax, colors.amber, lossChart.width, lossChart.height);

    drawChartFrame(accuracyCtx, accuracyChart.width, accuracyChart.height, "Accuracy", "train / validation");
    plotMetricLine(accuracyCtx, trainAccuracy, 0, 1, colors.teal, accuracyChart.width, accuracyChart.height);
    plotMetricLine(accuracyCtx, valAccuracy, 0, 1, colors.coral, accuracyChart.width, accuracyChart.height);
  }

  function classifierWorldToCanvas(x, y) {
    return [
      ((x + 1) / 2) * classifierCanvas.width,
      ((1 - y) / 2) * classifierCanvas.height,
    ];
  }

  function classifierCanvasToWorld(clientX, clientY) {
    const rect = classifierCanvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    return [clamp(px * 2 - 1, -1, 1), clamp(1 - py * 2, -1, 1)];
  }

  function drawClassifier() {
    const ctx = classifierCtx;
    const width = classifierCanvas.width;
    const height = classifierCanvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const cell = 8;
    if (classifier.network) {
      for (let y = 0; y < height; y += cell) {
        for (let x = 0; x < width; x += cell) {
          const wx = (x / width) * 2 - 1;
          const wy = 1 - (y / height) * 2;
          const probability = classifier.network.predict([wx, wy]);
          const alpha = 0.12 + Math.abs(probability - 0.5) * 0.58;
          const fill = probability >= 0.5 ? `rgba(76, 201, 176, ${alpha})` : `rgba(239, 111, 108, ${alpha})`;
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, cell + 1, cell + 1);
        }
      }
    }

    drawClassifierGrid(ctx, width, height);

    for (const point of classifier.points) {
      const [x, y] = classifierWorldToCanvas(point.x, point.y);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = point.label === 1 ? colors.teal : colors.coral;
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = "rgba(10, 12, 14, 0.86)";
      ctx.stroke();
    }
  }

  function drawClassifierGrid(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;

    for (let i = 1; i < 4; i += 1) {
      const x = (width * i) / 4;
      const y = (height * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.restore();
  }

  function addClassifierPoint(event) {
    const [x, y] = classifierCanvasToWorld(event.clientX, event.clientY);
    if (classifier.lastDrawPoint) {
      const dx = x - classifier.lastDrawPoint[0];
      const dy = y - classifier.lastDrawPoint[1];
      if (Math.hypot(dx, dy) < 0.028) return;
    }

    classifier.points.push({ x, y, label: classifier.drawClass });
    classifier.lastDrawPoint = [x, y];
    refreshClassifierSplit();
    evaluateClassifierState();
    recordClassifierHistory();
    updateClassifierMetrics();
    drawClassifier();
  }

  function bindClassifierControls() {
    $("classifierControls").addEventListener("submit", (event) => event.preventDefault());
    $("generateDatasetButton").addEventListener("click", regenerateDataset);
    $("clearDatasetButton").addEventListener("click", () => {
      classifier.points = [];
      resetNetwork();
    });
    $("trainNetworkButton").addEventListener("click", () => {
      if (!classifier.running && classifier.epoch >= maxNetworkEpochs()) {
        resetNetwork();
      }
      classifier.running = !classifier.running;
      updateClassifierMetrics();
    });
    $("stepNetworkButton").addEventListener("click", () => {
      if (trainNetworkStep()) drawClassifier();
    });
    $("resetNetworkButton").addEventListener("click", resetNetwork);
    $("maxEpochInput").addEventListener("change", updateClassifierMetrics);
    $("networkTimelineInput").addEventListener("input", () => {
      classifier.running = false;
      classifier.timelineIndex = Number($("networkTimelineInput").value);
      syncNetworkTimeline();
      updateClassifierMetrics();
    });
    $("l2Input").addEventListener("input", () => {
      evaluateClassifierState();
      recordClassifierHistory();
      updateClassifierMetrics();
    });

    for (const id of ["hiddenUnitsInput", "depthInput", "activationSelect", "networkOptimizerSelect"]) {
      $(id).addEventListener("change", resetNetwork);
    }

    document.querySelectorAll("[data-draw-class]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-draw-class]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        classifier.drawClass = Number(button.dataset.drawClass);
      });
    });

    classifierCanvas.addEventListener("pointerdown", (event) => {
      classifier.drawing = true;
      classifierCanvas.setPointerCapture(event.pointerId);
      classifier.lastDrawPoint = null;
      addClassifierPoint(event);
    });

    classifierCanvas.addEventListener("pointermove", (event) => {
      if (classifier.drawing) addClassifierPoint(event);
    });

    classifierCanvas.addEventListener("pointerup", (event) => {
      classifier.drawing = false;
      classifier.lastDrawPoint = null;
      classifierCanvas.releasePointerCapture(event.pointerId);
    });

    classifierCanvas.addEventListener("pointerleave", () => {
      classifier.drawing = false;
      classifier.lastDrawPoint = null;
    });
  }

  const optimizerCanvas = $("optimizerCanvas");
  const optimizer3d = {
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    surfaceMesh: null,
    wireMesh: null,
    axesGroup: null,
    minimaGroup: null,
    startMarker: null,
    pathGroup: null,
    pathObjects: {},
    needsRender: true,
    needsPixelSample: debugSnapshots,
    surfaceSize: 7,
    heightScale: 3.2,
  };

  const functions = {
    quadratic: {
      name: "x^2 + y^2",
      domain: { x: [-3, 3], y: [-3, 3] },
      start: [2.4, -1.8],
      minima: [[0, 0]],
      f: (x, y) => x * x + y * y,
      grad: (x, y) => [2 * x, 2 * y],
    },
    rosenbrock: {
      name: "Rosenbrock",
      domain: { x: [-2, 2], y: [-1, 3] },
      start: [-1.5, 2.2],
      minima: [[1, 1]],
      f: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
      grad: (x, y) => [
        -2 * (1 - x) - 400 * x * (y - x * x),
        200 * (y - x * x),
      ],
    },
    himmelblau: {
      name: "Himmelblau",
      domain: { x: [-6, 6], y: [-6, 6] },
      start: [-4.3, 4.2],
      minima: [
        [3, 2],
        [-2.805, 3.131],
        [-3.779, -3.283],
        [3.584, -1.848],
      ],
      f: (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2,
      grad: (x, y) => [
        4 * x * (x * x + y - 11) + 2 * (x + y * y - 7),
        2 * (x * x + y - 11) + 4 * y * (x + y * y - 7),
      ],
    },
  };

  function numericGradient(f, domain, x, y) {
    const span = Math.max(domain.x[1] - domain.x[0], domain.y[1] - domain.y[0]);
    const h = Math.max(1e-5, span * 1e-5);
    const x1 = clamp(x + h, domain.x[0], domain.x[1]);
    const x0 = clamp(x - h, domain.x[0], domain.x[1]);
    const y1 = clamp(y + h, domain.y[0], domain.y[1]);
    const y0 = clamp(y - h, domain.y[0], domain.y[1]);
    const fx1 = f(x1, y);
    const fx0 = f(x0, y);
    const fy1 = f(x, y1);
    const fy0 = f(x, y0);
    const gx = Number.isFinite(fx1) && Number.isFinite(fx0) && x1 !== x0 ? (fx1 - fx0) / (x1 - x0) : 0;
    const gy = Number.isFinite(fy1) && Number.isFinite(fy0) && y1 !== y0 ? (fy1 - fy0) / (y1 - y0) : 0;
    return [gx, gy];
  }

  function estimateCustomMinima(f, domain) {
    const candidates = [];
    const samples = 63;
    const span = Math.max(domain.x[1] - domain.x[0], domain.y[1] - domain.y[0]);
    const minSpacing = span * 0.045;

    for (let row = 0; row < samples; row += 1) {
      const y = domain.y[0] + (row / (samples - 1)) * (domain.y[1] - domain.y[0]);
      for (let col = 0; col < samples; col += 1) {
        const x = domain.x[0] + (col / (samples - 1)) * (domain.x[1] - domain.x[0]);
        const value = f(x, y);
        if (!Number.isFinite(value)) continue;
        const duplicate = candidates.some((candidate) => Math.hypot(candidate.x - x, candidate.y - y) < minSpacing);
        if (!duplicate || candidates.length < 18) {
          candidates.push({ x, y, value });
          candidates.sort((a, b) => a.value - b.value);
          candidates.length = Math.min(candidates.length, 18);
        }
      }
    }

    if (!candidates.length) {
      throw new Error("The function is not finite anywhere in the selected domain");
    }

    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.707, 0.707],
      [-0.707, 0.707],
      [0.707, -0.707],
      [-0.707, -0.707],
    ];

    const refine = (start) => {
      let best = { ...start };
      let step = span * 0.07;
      for (let i = 0; i < 120; i += 1) {
        let improved = false;
        let bestCandidate = best;
        const [gx, gy] = numericGradient(f, domain, best.x, best.y);
        const gradNorm = Math.hypot(gx, gy);
        const trialDirections = gradNorm > 1e-10
          ? directions.concat([[-gx / gradNorm, -gy / gradNorm]])
          : directions;
        for (const [dx, dy] of trialDirections) {
          const x = clamp(best.x + dx * step, domain.x[0], domain.x[1]);
          const y = clamp(best.y + dy * step, domain.y[0], domain.y[1]);
          const value = f(x, y);
          if (Number.isFinite(value) && value < bestCandidate.value) {
            bestCandidate = { x, y, value };
            improved = true;
          }
        }
        if (improved) {
          best = bestCandidate;
          step *= 1.06;
        } else {
          step *= 0.52;
        }
        if (step < span * 1e-7) break;
      }
      return best;
    };

    const refined = candidates.map(refine).sort((a, b) => a.value - b.value);
    return [[refined[0].x, refined[0].y]];
  }

  function readCustomDomain() {
    const xMin = Number($("customXMinInput").value);
    const xMax = Number($("customXMaxInput").value);
    const yMin = Number($("customYMinInput").value);
    const yMax = Number($("customYMaxInput").value);
    if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
      throw new Error("Domain bounds must be finite numbers");
    }
    if (xMax <= xMin || yMax <= yMin) {
      throw new Error("Domain max values must be greater than min values");
    }
    return { x: [xMin, xMax], y: [yMin, yMax] };
  }

  function setCustomFunctionMessage(message, type = "") {
    const target = $("customFunctionMessage");
    target.textContent = message;
    target.className = `form-message ${type}`.trim();
  }

  function createCustomFunctionDefinition() {
    const expression = $("customFunctionInput").value.trim();
    if (!expression) throw new Error("Enter a function of x and y");

    const evaluator = compileMathExpression(expression);
    const domain = readCustomDomain();
    const f = (x, y) => {
      const value = evaluator(x, y);
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    };
    const centerX = (domain.x[0] + domain.x[1]) / 2;
    const centerY = (domain.y[0] + domain.y[1]) / 2;
    const minima = estimateCustomMinima(f, domain);
    let start = [
      clamp(Number($("startXInput").value) || centerX, domain.x[0], domain.x[1]),
      clamp(Number($("startYInput").value) || centerY, domain.y[0], domain.y[1]),
    ];
    if (!Number.isFinite(f(start[0], start[1]))) {
      start = [
        domain.x[0] + (domain.x[1] - domain.x[0]) * 0.75,
        domain.y[0] + (domain.y[1] - domain.y[0]) * 0.25,
      ];
    }
    if (!Number.isFinite(f(start[0], start[1]))) start = minima[0].slice();

    return {
      name: expression,
      domain,
      start,
      minima,
      estimatedMinima: true,
      f,
      grad: (x, y) => numericGradient(f, domain, x, y),
    };
  }

  const optimizerDefs = {
    gd: { label: "GD", color: colors.blue },
    momentum: { label: "Momentum", color: colors.amber },
    adam: { label: "Adam", color: colors.teal },
    rmsprop: { label: "RMSprop", color: colors.violet },
  };

  const customExamples = {
    wavy: {
      expression: "sin(x * y) + 0.08 * (x^2 + y^2) + cos(1.7*x)",
      domain: { x: [-5, 5], y: [-5, 5] },
      start: [-4.2, -2.3],
    },
    saddle: {
      expression: "0.18 * (x^2 + y^2) + sin(2*x) - cos(2*y)",
      domain: { x: [-4, 4], y: [-4, 4] },
      start: [3.2, -3.1],
    },
    ripples: {
      expression: "0.06 * (x^2 + y^2) + sin(3*x) * cos(2*y)",
      domain: { x: [-5, 5], y: [-5, 5] },
      start: [4.1, 3.4],
    },
    beale: {
      expression: "(1.5 - x + x*y)^2 + (2.25 - x + x*y^2)^2 + (2.625 - x + x*y^3)^2",
      domain: { x: [-4.5, 4.5], y: [-4.5, 4.5] },
      start: [-3.5, 3.8],
    },
  };

  const optimizer = {
    running: false,
    replaying: false,
    functionKey: "quadratic",
    start: [2.4, -1.8],
    step: 0,
    stepAccumulator: 0,
    timelineIndex: null,
    runners: {},
    heatCache: null,
  };
  const maxOptimizerSteps = 520;

  function selectedOptimizerKeys() {
    return [...document.querySelectorAll('input[name="optimizer"]:checked')].map((input) => input.value);
  }

  function optimizerFunction() {
    return functions[optimizer.functionKey] ?? functions.quadratic;
  }

  function nearestMinimum(position) {
    const fn = optimizerFunction();
    let best = null;

    for (const minimum of fn.minima) {
      const distance = Math.hypot(position[0] - minimum[0], position[1] - minimum[1]);
      if (!best || distance < best.distance) {
        best = { point: minimum, distance, loss: fn.f(minimum[0], minimum[1]) };
      }
    }

    return best;
  }

  function convergenceTolerance() {
    const fn = optimizerFunction();
    const span = Math.max(fn.domain.x[1] - fn.domain.x[0], fn.domain.y[1] - fn.domain.y[0]);
    return span * 0.018;
  }

  function optimizerMaxHistoryIndex() {
    return Math.max(0, ...Object.values(optimizer.runners).map((runner) => runner.path.length - 1));
  }

  function optimizerDisplayIndex() {
    return optimizer.timelineIndex === null ? null : clamp(optimizer.timelineIndex, 0, optimizerMaxHistoryIndex());
  }

  function runnerPositionAt(runner, index = optimizerDisplayIndex()) {
    if (index === null) return runner.position;
    return runner.path[Math.min(index, runner.path.length - 1)] ?? runner.position;
  }

  function runnerPathAt(runner) {
    const index = optimizerDisplayIndex();
    if (index === null) return runner.path;
    return runner.path.slice(0, Math.min(index, runner.path.length - 1) + 1);
  }

  function setRunnerStatus(runner, status, reason, done = false) {
    runner.status = status;
    runner.reason = reason;
    runner.done = done;
  }

  function statusClass(status) {
    if (status === "Converged") return "good";
    if (status === "Boundary clipped" || status === "Max steps reached") return "warn";
    if (status === "Diverging") return "bad";
    return "";
  }

  function optimizerGlobalStatus() {
    const runners = Object.values(optimizer.runners);
    if (!runners.length) return "Paused";
    if (optimizer.replaying) return "Running";
    if (optimizer.running) return "Running";
    if (optimizer.step === 0) return "Paused";
    if (runners.some((runner) => runner.status === "Diverging")) return "Diverging";
    if (runners.some((runner) => runner.status === "Boundary clipped")) return "Boundary clipped";
    if (runners.every((runner) => runner.status === "Converged")) return "Converged";
    if (runners.every((runner) => runner.status === "Max steps reached")) return "Max steps reached";
    if (optimizer.step >= maxOptimizerSteps) return "Max steps reached";
    return "Paused";
  }

  function optimizerSummaries() {
    const fn = optimizerFunction();
    return Object.entries(optimizer.runners).map(([key, runner]) => {
      const position = runnerPositionAt(runner);
      const loss = fn.f(position[0], position[1]);
      const target = nearestMinimum(position);
      const lossDelta = runner.initialLoss - loss;
      const displayStatus = !optimizer.running && !optimizer.replaying && runner.status === "Running"
        ? "Paused"
        : runner.status;
      return {
        key,
        label: optimizerDefs[key].label,
        position: position.slice(),
        loss,
        initialLoss: runner.initialLoss,
        bestLoss: runner.bestLoss,
        bestPosition: runner.bestPosition.slice(),
        lossDelta,
        distance: target.distance,
        minimum: target.point,
        status: displayStatus,
        reason: displayStatus === "Paused" ? "Paused before termination" : runner.reason,
        clippedSteps: runner.clippedSteps,
      };
    });
  }

  function bestOptimizerSummary() {
    return optimizerSummaries().sort((a, b) => a.bestLoss - b.bestLoss)[0] ?? null;
  }

  function optimizerRunComplete() {
    const runners = Object.values(optimizer.runners);
    if (!runners.length || optimizer.step === 0) return false;
    return runners.every((runner) => runner.done) || optimizer.step >= maxOptimizerSteps;
  }

  function scheduleFactor(step) {
    const schedule = $("scheduleSelect").value;
    if (schedule === "step") return 0.5 ** Math.floor(step / 80);
    if (schedule === "cosine") return 0.12 + 0.88 * (0.5 + 0.5 * Math.cos(Math.min(step, 360) / 360 * Math.PI));
    if (schedule === "inverse") return 1 / Math.sqrt(1 + step / 40);
    return 1;
  }

  function createRunner() {
    const fn = optimizerFunction();
    const startLoss = fn.f(optimizer.start[0], optimizer.start[1]);
    return {
      position: optimizer.start.slice(),
      velocity: [0, 0],
      m: [0, 0],
      v: [0, 0],
      cache: [0, 0],
      t: 0,
      initialLoss: startLoss,
      bestLoss: startLoss,
      bestPosition: optimizer.start.slice(),
      clippedSteps: 0,
      status: "Paused",
      reason: "Ready",
      done: false,
      path: [optimizer.start.slice()],
    };
  }

  function resetOptimizer() {
    optimizer.running = false;
    optimizer.replaying = false;
    optimizer.step = 0;
    optimizer.stepAccumulator = 0;
    optimizer.timelineIndex = null;
    optimizer.runners = {};
    optimizer3d.needsPixelSample = debugSnapshots;
    for (const key of selectedOptimizerKeys()) {
      optimizer.runners[key] = createRunner();
    }
    syncOptimizerTimeline();
    updateOptimizerMetrics();
    drawOptimizer();
  }

  function syncCustomFunctionPanel() {
    $("customFunctionPanel").hidden = $("functionSelect").value !== "custom";
  }

  function applyCustomFunction() {
    try {
      functions.custom = createCustomFunctionDefinition();
      optimizer.functionKey = "custom";
      $("functionSelect").value = "custom";
      syncCustomFunctionPanel();
      optimizer.start = functions.custom.start.slice();
      $("startXInput").value = optimizer.start[0].toFixed(2);
      $("startYInput").value = optimizer.start[1].toFixed(2);
      optimizer.heatCache = null;
      if (optimizer3d.surfaceMesh) optimizer3d.surfaceMesh.userData.functionKey = "";
      setCustomFunctionMessage(`Applied custom surface. Estimated minimum near (${formatNumber(functions.custom.minima[0][0], 3)}, ${formatNumber(functions.custom.minima[0][1], 3)}). Gradients and minima are approximate for custom formulas.`, "ok");
      resetOptimizer();
      return true;
    } catch (error) {
      setCustomFunctionMessage(error.message, "error");
      optimizer.running = false;
      updateOptimizerMetrics();
      return false;
    }
  }

  function setOptimizerFunction(key) {
    let nextKey = key || $("functionSelect").value || "quadratic";
    if (nextKey !== "custom" && !functions[nextKey]) {
      nextKey = $("functionSelect").value || "quadratic";
    }
    if (nextKey !== "custom" && !functions[nextKey]) nextKey = "quadratic";

    $("functionSelect").value = nextKey;
    syncCustomFunctionPanel();
    if (nextKey === "custom") {
      applyCustomFunction();
      return;
    }

    optimizer.functionKey = nextKey;
    const fn = optimizerFunction();
    optimizer.start = fn.start.slice();
    $("startXInput").value = optimizer.start[0].toFixed(2);
    $("startYInput").value = optimizer.start[1].toFixed(2);
    optimizer.heatCache = null;
    setCustomFunctionMessage("");
    resetOptimizer();
  }

  function applyStartFromInputs() {
    const fn = optimizerFunction();
    optimizer.start = [
      clamp(Number($("startXInput").value), fn.domain.x[0], fn.domain.x[1]),
      clamp(Number($("startYInput").value), fn.domain.y[0], fn.domain.y[1]),
    ];
    $("startXInput").value = optimizer.start[0].toFixed(2);
    $("startYInput").value = optimizer.start[1].toFixed(2);
    resetOptimizer();
  }

  function randomizeStart() {
    const fn = optimizerFunction();
    optimizer.start = [
      randBetween(fn.domain.x[0], fn.domain.x[1]),
      randBetween(fn.domain.y[0], fn.domain.y[1]),
    ];
    $("startXInput").value = optimizer.start[0].toFixed(2);
    $("startYInput").value = optimizer.start[1].toFixed(2);
    resetOptimizer();
  }

  function optimizerStepOnce() {
    const fn = optimizerFunction();
    const baseLr = Number($("optimizerLrInput").value);
    const lr = baseLr * scheduleFactor(optimizer.step);
    const tolerance = convergenceTolerance();

    for (const [key, runner] of Object.entries(optimizer.runners)) {
      if (runner.done) continue;
      setRunnerStatus(runner, "Running", "Still updating");
      const [x, y] = runner.position;
      let [gx, gy] = fn.grad(x, y);
      const gradNorm = Math.hypot(gx, gy);
      if (!Number.isFinite(gradNorm)) {
        setRunnerStatus(runner, "Diverging", "Gradient became non-finite", true);
        continue;
      }
      if (gradNorm > 80) {
        gx = (gx / gradNorm) * 80;
        gy = (gy / gradNorm) * 80;
      }

      let nextX = runner.position[0];
      let nextY = runner.position[1];
      if (key === "gd") {
        nextX -= lr * gx;
        nextY -= lr * gy;
      } else if (key === "momentum") {
        runner.velocity[0] = 0.88 * runner.velocity[0] - lr * gx;
        runner.velocity[1] = 0.88 * runner.velocity[1] - lr * gy;
        nextX += runner.velocity[0];
        nextY += runner.velocity[1];
      } else if (key === "rmsprop") {
        runner.cache[0] = 0.9 * runner.cache[0] + 0.1 * gx * gx;
        runner.cache[1] = 0.9 * runner.cache[1] + 0.1 * gy * gy;
        nextX -= lr * gx / (Math.sqrt(runner.cache[0]) + 1e-8);
        nextY -= lr * gy / (Math.sqrt(runner.cache[1]) + 1e-8);
      } else if (key === "adam") {
        runner.t += 1;
        runner.m[0] = 0.9 * runner.m[0] + 0.1 * gx;
        runner.m[1] = 0.9 * runner.m[1] + 0.1 * gy;
        runner.v[0] = 0.999 * runner.v[0] + 0.001 * gx * gx;
        runner.v[1] = 0.999 * runner.v[1] + 0.001 * gy * gy;
        const mHatX = runner.m[0] / (1 - 0.9 ** runner.t);
        const mHatY = runner.m[1] / (1 - 0.9 ** runner.t);
        const vHatX = runner.v[0] / (1 - 0.999 ** runner.t);
        const vHatY = runner.v[1] / (1 - 0.999 ** runner.t);
        nextX -= lr * mHatX / (Math.sqrt(vHatX) + 1e-8);
        nextY -= lr * mHatY / (Math.sqrt(vHatY) + 1e-8);
      }

      const clampedX = clamp(nextX, fn.domain.x[0], fn.domain.x[1]);
      const clampedY = clamp(nextY, fn.domain.y[0], fn.domain.y[1]);
      const clipped = clampedX !== nextX || clampedY !== nextY;
      if (clipped) runner.clippedSteps += 1;
      runner.position[0] = clampedX;
      runner.position[1] = clampedY;
      runner.path.push(runner.position.slice());
      if (runner.path.length > 900) runner.path.shift();

      const loss = fn.f(runner.position[0], runner.position[1]);
      const target = nearestMinimum(runner.position);
      if (!Number.isFinite(loss)) {
        setRunnerStatus(runner, "Diverging", "Loss became non-finite", true);
      } else {
        if (loss < runner.bestLoss) {
          runner.bestLoss = loss;
          runner.bestPosition = runner.position.slice();
        }
        const divergingLimit = Math.max(250, Math.abs(runner.initialLoss) * 80, Math.abs(runner.bestLoss) * 120);
        if (loss - runner.bestLoss > divergingLimit) {
          setRunnerStatus(runner, "Diverging", "Loss is moving far away from the best value", true);
        } else if (target.distance <= tolerance || gradNorm < 1e-5) {
          setRunnerStatus(runner, "Converged", "Near the selected minimum estimate", true);
        } else if (runner.clippedSteps >= 8) {
          setRunnerStatus(runner, "Boundary clipped", "Updates repeatedly hit the domain boundary", true);
        } else if (clipped) {
          setRunnerStatus(runner, "Boundary clipped", "This step hit the domain boundary", false);
        }
      }
    }

    optimizer.step += 1;
    if (optimizer.step >= maxOptimizerSteps) {
      for (const runner of Object.values(optimizer.runners)) {
        if (!runner.done) setRunnerStatus(runner, "Max steps reached", "Stopped at the step limit", true);
      }
    }
    syncOptimizerTimeline();
    if (debugSnapshots && optimizer.step % 24 === 0) {
      optimizer3d.needsPixelSample = true;
    }
    updateOptimizerMetrics();
  }

  function worldToOptimizerCanvas(x, y) {
    const fn = optimizerFunction();
    const width = optimizerCanvas.width;
    const height = optimizerCanvas.height;
    return [
      ((x - fn.domain.x[0]) / (fn.domain.x[1] - fn.domain.x[0])) * width,
      (1 - (y - fn.domain.y[0]) / (fn.domain.y[1] - fn.domain.y[0])) * height,
    ];
  }

  function optimizerCanvasToWorld(clientX, clientY) {
    const rect = optimizerCanvas.getBoundingClientRect();
    const fn = optimizerFunction();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    return [
      fn.domain.x[0] + px * (fn.domain.x[1] - fn.domain.x[0]),
      fn.domain.y[0] + (1 - py) * (fn.domain.y[1] - fn.domain.y[0]),
    ];
  }

  function computeHeatCache() {
    const fn = optimizerFunction();
    const cell = 1;
    const cols = 84;
    const rows = 84;
    const raw = [];
    const values = [];

    for (let row = 0; row < rows; row += 1) {
      raw[row] = [];
      const py = row / (rows - 1);
      const y = fn.domain.y[0] + (1 - py) * (fn.domain.y[1] - fn.domain.y[0]);
      for (let col = 0; col < cols; col += 1) {
        const px = col / (cols - 1);
        const x = fn.domain.x[0] + px * (fn.domain.x[1] - fn.domain.x[0]);
        const value = fn.f(x, y);
        raw[row][col] = value;
        if (Number.isFinite(value)) values.push(value);
      }
    }

    values.sort((a, b) => a - b);
    const min = values[0] ?? 0;
    const p96 = values[Math.floor(values.length * 0.96)] ?? 1;
    const denom = Math.max(1e-9, Math.log1p(p96 - min));
    const normalized = raw.map((row) =>
      row.map((value) => clamp(Math.log1p(Math.max(0, value - min)) / denom, 0, 1))
    );

    optimizer.heatCache = { cell, cols, rows, raw, normalized, min, p96, denom };
  }

  function hasWebGLSupport() {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  }

  function initOptimizer3D() {
    if (optimizer3d.renderer) return;
    const fallback = $("webglFallback");
    if (!hasWebGLSupport()) {
      if (fallback) fallback.hidden = false;
      optimizer3d.needsRender = false;
      return;
    }

    try {
      optimizer3d.renderer = new THREE.WebGLRenderer({
        canvas: optimizerCanvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    } catch {
      if (fallback) fallback.hidden = false;
      optimizer3d.renderer = null;
      optimizer3d.needsRender = false;
      return;
    }
    if (fallback) fallback.hidden = true;
    optimizer3d.renderer.setClearColor(0x0b0d0f, 1);
    optimizer3d.renderer.setPixelRatio(1);

    optimizer3d.scene = new THREE.Scene();
    optimizer3d.scene.fog = new THREE.Fog(0x0b0d0f, 10, 22);

    optimizer3d.camera = new THREE.PerspectiveCamera(42, 720 / 520, 0.1, 100);
    optimizer3d.camera.position.set(6.7, 4.8, 7.2);

    optimizer3d.controls = new OrbitControls(optimizer3d.camera, optimizerCanvas);
    optimizer3d.controls.enableDamping = true;
    optimizer3d.controls.dampingFactor = 0.08;
    optimizer3d.controls.minDistance = 4.8;
    optimizer3d.controls.maxDistance = 15;
    optimizer3d.controls.maxPolarAngle = Math.PI * 0.48;
    optimizer3d.controls.target.set(0, 1.1, 0);
    optimizer3d.controls.addEventListener("change", () => {
      optimizer3d.needsRender = true;
    });

    const ambient = new THREE.AmbientLight(0xffffff, 0.58);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3.5, 7, 4.5);
    const fill = new THREE.DirectionalLight(0x6ca6e8, 0.42);
    fill.position.set(-5, 3, -4);
    optimizer3d.scene.add(ambient, key, fill);

    optimizer3d.axesGroup = new THREE.Group();
    optimizer3d.minimaGroup = new THREE.Group();
    optimizer3d.pathGroup = new THREE.Group();
    optimizer3d.scene.add(optimizer3d.axesGroup, optimizer3d.minimaGroup, optimizer3d.pathGroup);

    window.addEventListener("resize", renderOptimizer3D);
  }

  function syncOptimizerRendererSize() {
    const renderer = optimizer3d.renderer;
    const camera = optimizer3d.camera;
    if (!renderer || !camera) return;

    const width = Math.max(1, Math.round(optimizerCanvas.clientWidth || 720));
    const height = Math.max(1, Math.round(optimizerCanvas.clientHeight || 520));
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function lossToNormalizedHeight(value) {
    if (!optimizer.heatCache) computeHeatCache();
    const cache = optimizer.heatCache;
    return clamp(Math.log1p(Math.max(0, value - cache.min)) / cache.denom, 0, 1);
  }

  function lossToSurfaceHeight(value) {
    return lossToNormalizedHeight(value) ** 1.15 * optimizer3d.heightScale;
  }

  function surfacePointFromWorld(x, y, lift = 0) {
    const fn = optimizerFunction();
    const sx = ((x - fn.domain.x[0]) / (fn.domain.x[1] - fn.domain.x[0]) - 0.5) * optimizer3d.surfaceSize;
    const sz = ((y - fn.domain.y[0]) / (fn.domain.y[1] - fn.domain.y[0]) - 0.5) * optimizer3d.surfaceSize;
    return new THREE.Vector3(sx, lossToSurfaceHeight(fn.f(x, y)) + lift, sz);
  }

  function disposeObject3D(object) {
    if (!object) return;
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }

  function clearGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      disposeObject3D(child);
    }
  }

  function makeLabelSprite(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(11, 13, 15, 0.78)";
    ctx.strokeStyle = "rgba(76, 201, 176, 0.72)";
    ctx.lineWidth = 4;
    roundRect(ctx, 12, 20, 488, 80, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f1f3f2";
    ctx.font = "700 34px Inter, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, 60);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(1.5, 0.38, 1);
    return sprite;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function downsamplePoints(points, limit = 150) {
    if (points.length <= limit) return points;
    const result = [];
    const stride = Math.ceil(points.length / limit);
    for (let i = 0; i < points.length; i += stride) {
      result.push(points[i]);
    }
    const last = points[points.length - 1];
    if (result[result.length - 1] !== last) result.push(last);
    return result;
  }

  function makeTube(points, radius, color, opacity = 1) {
    const safePoints = points.length >= 2 ? points : [points[0], points[0].clone().add(new THREE.Vector3(0.001, 0, 0))];
    const curve = new THREE.CatmullRomCurve3(safePoints, false, "catmullrom", 0.18);
    const geometry = new THREE.TubeGeometry(curve, Math.max(8, safePoints.length * 4), radius, 8, false);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    return new THREE.Mesh(geometry, material);
  }

  function rebuildOptimizerSurfaceIfNeeded() {
    if (!optimizer.heatCache) computeHeatCache();
    if (optimizer3d.surfaceMesh?.userData.functionKey === optimizer.functionKey) return;

    const scene = optimizer3d.scene;
    const cache = optimizer.heatCache;
    const fn = optimizerFunction();

    if (optimizer3d.surfaceMesh) {
      scene.remove(optimizer3d.surfaceMesh);
      disposeObject3D(optimizer3d.surfaceMesh);
      optimizer3d.surfaceMesh = null;
    }
    if (optimizer3d.wireMesh) {
      scene.remove(optimizer3d.wireMesh);
      disposeObject3D(optimizer3d.wireMesh);
      optimizer3d.wireMesh = null;
    }

    clearGroup(optimizer3d.axesGroup);
    clearGroup(optimizer3d.minimaGroup);

    const positions = [];
    const colorsBuffer = [];
    const indices = [];
    const heatStops = ["#122022", "#1c3d48", "#1f7167", "#b88a42", "#e76d55", "#f6d782"];

    for (let row = 0; row < cache.rows; row += 1) {
      const y = fn.domain.y[0] + (row / (cache.rows - 1)) * (fn.domain.y[1] - fn.domain.y[0]);
      for (let col = 0; col < cache.cols; col += 1) {
        const x = fn.domain.x[0] + (col / (cache.cols - 1)) * (fn.domain.x[1] - fn.domain.x[0]);
        const point = surfacePointFromWorld(x, y);
        positions.push(point.x, point.y, point.z);

        const color = new THREE.Color(interpolateColor(heatStops, cache.normalized[row][col]));
        colorsBuffer.push(color.r, color.g, color.b);
      }
    }

    for (let row = 0; row < cache.rows - 1; row += 1) {
      for (let col = 0; col < cache.cols - 1; col += 1) {
        const a = row * cache.cols + col;
        const b = a + 1;
        const c = a + cache.cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colorsBuffer, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0.03,
    });
    optimizer3d.surfaceMesh = new THREE.Mesh(geometry, material);
    optimizer3d.surfaceMesh.userData.functionKey = optimizer.functionKey;
    scene.add(optimizer3d.surfaceMesh);

    const wireGeometry = new THREE.WireframeGeometry(geometry);
    const wireMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
    });
    optimizer3d.wireMesh = new THREE.LineSegments(wireGeometry, wireMaterial);
    scene.add(optimizer3d.wireMesh);

    const grid = new THREE.GridHelper(optimizer3d.surfaceSize, 10, 0x67727d, 0x30363d);
    grid.position.y = -0.035;
    optimizer3d.axesGroup.add(grid);

    const axisMaterial = new THREE.LineBasicMaterial({ color: 0xb6c0c8, transparent: true, opacity: 0.62 });
    const heightMaterial = new THREE.LineBasicMaterial({ color: 0x4cc9b0, transparent: true, opacity: 0.58 });
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-optimizer3d.surfaceSize / 2, 0, 0),
      new THREE.Vector3(optimizer3d.surfaceSize / 2, 0, 0),
      new THREE.Vector3(0, 0, -optimizer3d.surfaceSize / 2),
      new THREE.Vector3(0, 0, optimizer3d.surfaceSize / 2),
    ]);
    optimizer3d.axesGroup.add(new THREE.LineSegments(axisGeo, axisMaterial));
    optimizer3d.axesGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-optimizer3d.surfaceSize / 2 - 0.15, 0, -optimizer3d.surfaceSize / 2 - 0.15),
          new THREE.Vector3(-optimizer3d.surfaceSize / 2 - 0.15, optimizer3d.heightScale + 0.35, -optimizer3d.surfaceSize / 2 - 0.15),
        ]),
        heightMaterial
      )
    );

    const minimaMaterial = new THREE.MeshStandardMaterial({
      color: 0xf1f3f2,
      emissive: 0x4cc9b0,
      emissiveIntensity: 0.9,
      roughness: 0.28,
      depthTest: false,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
    });
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: 0x4cc9b0,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false,
    });
    for (const [x, y] of fn.minima) {
      const target = new THREE.Group();
      const position = surfacePointFromWorld(x, y, 0.22);

      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.13, 26, 18), minimaMaterial.clone());
      marker.position.copy(position);
      marker.renderOrder = 5;

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 10, 48), ringMaterial.clone());
      ring.position.copy(position);
      ring.rotation.x = Math.PI / 2;
      ring.renderOrder = 6;
      ring.userData.pulse = true;

      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.9, 12), beamMaterial.clone());
      beam.position.copy(position.clone().add(new THREE.Vector3(0, 0.45, 0)));
      beam.renderOrder = 4;

      const label = makeLabelSprite(`${fn.estimatedMinima ? "est min" : "min"} (${formatNumber(x, 2)}, ${formatNumber(y, 2)})`);
      label.position.copy(position.clone().add(new THREE.Vector3(0, 0.78, 0)));
      label.renderOrder = 7;

      target.add(marker, ring, beam, label);
      optimizer3d.minimaGroup.add(target);
    }

    if (!optimizer3d.startMarker) {
      optimizer3d.startMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 20, 12),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2 })
      );
      optimizer3d.pathGroup.add(optimizer3d.startMarker);
    }
  }

  function updateOptimizer3DPaths() {
    const activeKeys = new Set(Object.keys(optimizer.runners));
    for (const [key, objectSet] of Object.entries(optimizer3d.pathObjects)) {
      if (!activeKeys.has(key)) {
        optimizer3d.pathGroup.remove(objectSet.trail, objectSet.marker, objectSet.guide);
        disposeObject3D(objectSet.trail);
        disposeObject3D(objectSet.guide);
        disposeObject3D(objectSet.marker);
        delete optimizer3d.pathObjects[key];
      }
    }

    if (optimizer3d.startMarker) {
      optimizer3d.startMarker.position.copy(surfacePointFromWorld(optimizer.start[0], optimizer.start[1], 0.14));
    }

    for (const [key, runner] of Object.entries(optimizer.runners)) {
      const def = optimizerDefs[key];
      if (!def) continue;

      const visiblePath = runnerPathAt(runner);
      const visiblePosition = runnerPositionAt(runner);
      const points = downsamplePoints(visiblePath).map(([x, y]) => surfacePointFromWorld(x, y, 0.24));
      if (points.length === 1) points.push(points[0].clone().add(new THREE.Vector3(0.001, 0, 0)));
      const currentPoint = points[points.length - 1];
      const target = nearestMinimum(visiblePosition);
      const guidePoints = [currentPoint, surfacePointFromWorld(target.point[0], target.point[1], 0.28)];

      let objectSet = optimizer3d.pathObjects[key];
      if (!objectSet) {
        const markerMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(def.color),
          emissive: new THREE.Color(def.color),
          emissiveIntensity: 0.72,
          roughness: 0.32,
          depthTest: false,
        });
        objectSet = {
          trail: makeTube(points, 0.045, def.color, 0.98),
          guide: makeTube(guidePoints, 0.014, "#f1f3f2", 0.38),
          marker: new THREE.Mesh(new THREE.SphereGeometry(0.13, 26, 18), markerMaterial),
        };
        optimizer3d.pathObjects[key] = objectSet;
        objectSet.trail.renderOrder = 9;
        objectSet.guide.renderOrder = 8;
        objectSet.marker.renderOrder = 10;
        optimizer3d.pathGroup.add(objectSet.trail, objectSet.guide, objectSet.marker);
      } else {
        optimizer3d.pathGroup.remove(objectSet.trail, objectSet.guide);
        disposeObject3D(objectSet.trail);
        disposeObject3D(objectSet.guide);
        objectSet.trail = makeTube(points, 0.045, def.color, 0.98);
        objectSet.guide = makeTube(guidePoints, 0.014, "#f1f3f2", 0.38);
        objectSet.trail.renderOrder = 9;
        objectSet.guide.renderOrder = 8;
        optimizer3d.pathGroup.add(objectSet.trail, objectSet.guide);
      }

      objectSet.marker.position.copy(currentPoint);
    }
  }

  function sampleOptimizerPixels() {
    const renderer = optimizer3d.renderer;
    if (!renderer) return;

    const gl = renderer.getContext();
    const canvas = renderer.domElement;
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const stride = Math.max(4, Math.floor(Math.min(width, height) / 40));
    let samples = 0;
    let nonDark = 0;
    let mean = 0;
    let m2 = 0;

    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const index = (y * width + x) * 4;
        const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
        samples += 1;
        if (luminance > 18) nonDark += 1;
        const delta = luminance - mean;
        mean += delta / samples;
        m2 += delta * (luminance - mean);
      }
    }

    const variance = samples > 1 ? m2 / (samples - 1) : 0;
    optimizerCanvas.dataset.pixelSamples = String(samples);
    optimizerCanvas.dataset.nonDarkPixels = String(nonDark);
    optimizerCanvas.dataset.pixelVariance = variance.toFixed(2);
    if (debugSnapshots) {
      optimizerCanvas.dataset.snapshotUrl = canvas.toDataURL("image/png");
    }
    optimizer3d.needsPixelSample = false;
  }

  function renderOptimizer3D() {
    if (!optimizer3d.renderer) return;
    syncOptimizerRendererSize();
    optimizer3d.controls.autoRotate = optimizer.running;
    optimizer3d.controls.autoRotateSpeed = 0.35;
    optimizer3d.controls.update();
    const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.14;
    optimizer3d.minimaGroup.traverse((child) => {
      if (child.userData.pulse) child.scale.setScalar(pulse);
    });
    optimizer3d.renderer.render(optimizer3d.scene, optimizer3d.camera);
    if (debugSnapshots && optimizer3d.needsPixelSample) {
      sampleOptimizerPixels();
    }
    optimizer3d.needsRender = false;
  }

  function drawOptimizer() {
    initOptimizer3D();
    if (!optimizer3d.renderer) {
      updateOptimizerAnalysis();
      return;
    }
    if (!optimizer.heatCache) computeHeatCache();
    rebuildOptimizerSurfaceIfNeeded();
    updateOptimizer3DPaths();
    optimizer3d.needsRender = true;
    renderOptimizer3D();
  }

  function contourIntersection(a, b, pa, pb, level) {
    if ((a < level && b < level) || (a > level && b > level) || a === b) return null;
    const t = clamp((level - a) / (b - a), 0, 1);
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  }

  function drawContours(ctx, cache) {
    ctx.save();
    ctx.lineWidth = 0.75;
    const levels = [0.12, 0.2, 0.3, 0.42, 0.56, 0.7, 0.84];

    for (const level of levels) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 + level * 0.1})`;
      ctx.beginPath();
      for (let row = 0; row < cache.rows - 1; row += 1) {
        for (let col = 0; col < cache.cols - 1; col += 1) {
          const x = col * cache.cell;
          const y = row * cache.cell;
          const p0 = [x, y];
          const p1 = [x + cache.cell, y];
          const p2 = [x + cache.cell, y + cache.cell];
          const p3 = [x, y + cache.cell];
          const v0 = cache.normalized[row][col];
          const v1 = cache.normalized[row][col + 1];
          const v2 = cache.normalized[row + 1][col + 1];
          const v3 = cache.normalized[row + 1][col];
          const hits = [
            contourIntersection(v0, v1, p0, p1, level),
            contourIntersection(v1, v2, p1, p2, level),
            contourIntersection(v2, v3, p2, p3, level),
            contourIntersection(v3, v0, p3, p0, level),
          ].filter(Boolean);

          if (hits.length === 2) {
            ctx.moveTo(hits[0][0], hits[0][1]);
            ctx.lineTo(hits[1][0], hits[1][1]);
          } else if (hits.length === 4) {
            ctx.moveTo(hits[0][0], hits[0][1]);
            ctx.lineTo(hits[1][0], hits[1][1]);
            ctx.moveTo(hits[2][0], hits[2][1]);
            ctx.lineTo(hits[3][0], hits[3][1]);
          }
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawOptimizerAxes(ctx, fn, width, height) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    if (fn.domain.x[0] < 0 && fn.domain.x[1] > 0) {
      const [x] = worldToOptimizerCanvas(0, 0);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    if (fn.domain.y[0] < 0 && fn.domain.y[1] > 0) {
      const [, y] = worldToOptimizerCanvas(0, 0);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMinima(ctx, fn) {
    ctx.save();
    for (const [x, y] of fn.minima) {
      const [cx, cy] = worldToOptimizerCanvas(x, y);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx + 6, cy);
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx, cy + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawOptimizerPaths(ctx) {
    ctx.save();

    for (const [key, runner] of Object.entries(optimizer.runners)) {
      const def = optimizerDefs[key];
      const visiblePath = runnerPathAt(runner);
      const visiblePosition = runnerPositionAt(runner);
      if (!def || visiblePath.length === 0) continue;

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = def.color;
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      visiblePath.forEach(([x, y], index) => {
        const [cx, cy] = worldToOptimizerCanvas(x, y);
        if (index === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();

      const [sx, sy] = worldToOptimizerCanvas(visiblePath[0][0], visiblePath[0][1]);
      const [cx, cy] = worldToOptimizerCanvas(visiblePosition[0], visiblePosition[1]);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#f1f3f2";
      ctx.beginPath();
      ctx.arc(sx, sy, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(cx, cy, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    ctx.restore();
  }

  function updateOptimizerAnalysis() {
    const panel = $("optimizerAnalysis");
    if (!panel) return;

    const fn = optimizerFunction();
    const summaries = optimizerSummaries();
    const best = bestOptimizerSummary();
    const minimumKind = fn.estimatedMinima ? "Estimated minimum point" : "Known minimum point";
    const targetText = fn.minima
      .map(([x, y]) => `(${formatNumber(x, 2)}, ${formatNumber(y, 2)})`)
      .join("  ");

    if (!best) {
      panel.innerHTML = `
        <div class="analysis-targets">${minimumKind}: ${targetText}</div>
      `;
      return;
    }

    const globalStatus = optimizerGlobalStatus();
    const positionText = `(${formatNumber(best.bestPosition[0], 3)}, ${formatNumber(best.bestPosition[1], 3)})`;
    const minimumText = `(${formatNumber(best.minimum[0], 3)}, ${formatNumber(best.minimum[1], 3)})`;
    const rows = summaries
      .sort((a, b) => a.bestLoss - b.bestLoss)
      .map((summary) => `
        <div class="optimizer-result-card">
          <div class="optimizer-result-head">
            <strong>${escapeHtml(summary.label)}</strong>
            <span class="status-pill ${statusClass(summary.status)}">${escapeHtml(summary.status)}</span>
          </div>
          <div class="optimizer-result-grid">
            <span>Initial<b>${formatNumber(summary.initialLoss, 4)}</b></span>
            <span>Best<b>${formatNumber(summary.bestLoss, 4)}</b></span>
            <span>Current<b>${formatNumber(summary.loss, 4)}</b></span>
            <span>Delta<b>${formatNumber(summary.lossDelta, 4)}</b></span>
            <span>Position<b>(${formatNumber(summary.position[0], 2)}, ${formatNumber(summary.position[1], 2)})</b></span>
            <span>Distance<b>${formatNumber(summary.distance, 4)}</b></span>
            <span>Clipped<b>${summary.clippedSteps}</b></span>
            <span>Nearest min<b>(${formatNumber(summary.minimum[0], 2)}, ${formatNumber(summary.minimum[1], 2)})</b></span>
          </div>
          <div class="optimizer-reason">${escapeHtml(summary.reason)}${summary.clippedSteps ? ` (${summary.clippedSteps} clipped)` : ""}</div>
        </div>
      `)
      .join("");
    const estimateNote = fn.estimatedMinima
      ? `<div class="warning-note">Custom surfaces use finite-difference gradients and an estimated minimum from multi-start local search. Nonconvex formulas can have better minima outside the sampled basin or at the domain boundary.</div>`
      : "";

    panel.innerHTML = `
      <div class="analysis-summary">
        <div class="analysis-stat"><span>Status</span><strong>${globalStatus}</strong></div>
        <div class="analysis-stat"><span>Best optimizer</span><strong>${best.label}</strong></div>
        <div class="analysis-stat"><span>Best position</span><strong>${positionText}</strong></div>
        <div class="analysis-stat"><span>Nearest min</span><strong>${minimumText}</strong></div>
      </div>
      ${estimateNote}
      <div class="optimizer-result-list">
        ${rows}
      </div>
      <div class="analysis-targets">${minimumKind}${fn.minima.length > 1 ? "s" : ""}: ${targetText}</div>
    `;
  }

  function updateOptimizerMetrics() {
    const metrics = $("optimizerMetrics");
    const fn = optimizerFunction();
    metrics.innerHTML = "";

    const step = document.createElement("span");
    step.innerHTML = `Step <strong>${optimizer.step}</strong>`;
    metrics.appendChild(step);

    for (const [key, runner] of Object.entries(optimizer.runners)) {
      const position = runnerPositionAt(runner);
      const value = fn.f(position[0], position[1]);
      const item = document.createElement("span");
      item.innerHTML = `${optimizerDefs[key].label} <strong>${formatNumber(value, 2)}</strong>`;
      metrics.appendChild(item);
    }

    updateOptimizerAnalysis();
    syncOptimizerTimeline();
    $("optimizerStatus").textContent = `optimizer ${optimizerGlobalStatus().toLowerCase()}`;
    $("runOptimizerButton").textContent = optimizer.running ? "Pause" : "Run";
  }

  function syncOptimizerTimeline() {
    const input = $("optimizerTimelineInput");
    const value = $("optimizerTimelineValue");
    if (!input || !value) return;
    const max = optimizerMaxHistoryIndex();
    input.max = String(max);
    if (optimizer.timelineIndex === null) {
      input.value = String(max);
      value.textContent = max > 0 ? `Live step ${optimizer.step}` : "Live";
    } else {
      const index = clamp(optimizer.timelineIndex, 0, max);
      input.value = String(index);
      value.textContent = optimizer.replaying ? `Replay step ${index}` : `Step ${index}`;
    }
  }

  function updateOptimizerSpeedLabel() {
    $("optimizerSpeedValue").textContent = `${$("optimizerSpeedInput").value}x`;
  }

  function optimizerRunnersState() {
    return Object.fromEntries(Object.entries(optimizer.runners).map(([key, runner]) => [key, {
      position: runner.position.slice(),
      velocity: runner.velocity.slice(),
      m: runner.m.slice(),
      v: runner.v.slice(),
      cache: runner.cache.slice(),
      t: runner.t,
      initialLoss: runner.initialLoss,
      bestLoss: runner.bestLoss,
      bestPosition: runner.bestPosition.slice(),
      clippedSteps: runner.clippedSteps,
      status: runner.status,
      reason: runner.reason,
      done: runner.done,
      path: runner.path.map((point) => point.slice()),
    }]));
  }

  function buildExperimentState() {
    const fn = optimizerFunction();
    return {
      version: 1,
      mode: "combined",
      exportedAt: new Date().toISOString(),
      dataset: {
        kind: $("datasetSelect").value,
        pointCount: Number($("pointCountInput").value),
        noise: Number($("noiseInput").value),
        points: classifier.points.map((point) => ({ x: point.x, y: point.y, label: point.label })),
        split: { train: classifier.trainPoints.length, validation: classifier.validationPoints.length },
      },
      networkConfig: {
        hiddenUnits: Number($("hiddenUnitsInput").value),
        depth: Number($("depthInput").value),
        activation: $("activationSelect").value,
        optimizer: $("networkOptimizerSelect").value,
        learningRate: Number($("networkLrInput").value),
        l2: Number($("l2Input").value),
        stepsPerFrame: Number($("networkSpeedInput").value),
        maxEpochs: maxNetworkEpochs(),
        epoch: classifier.epoch,
        networkState: classifier.network?.toState() ?? null,
      },
      optimizerConfig: {
        functionKey: optimizer.functionKey,
        selectedOptimizers: selectedOptimizerKeys(),
        learningRate: Number($("optimizerLrInput").value),
        schedule: $("scheduleSelect").value,
        animationSpeed: Number($("optimizerSpeedInput").value),
        start: optimizer.start.slice(),
        step: optimizer.step,
        runners: optimizerRunnersState(),
      },
      surfaceConfig: {
        key: optimizer.functionKey,
        name: fn.name,
        domain: { x: fn.domain.x.slice(), y: fn.domain.y.slice() },
        minima: fn.minima.map((point) => point.slice()),
        estimatedMinima: Boolean(fn.estimatedMinima),
        customExpression: optimizer.functionKey === "custom" ? $("customFunctionInput").value.trim() : null,
      },
      history: {
        classifier: classifier.history.map((entry) => ({
          epoch: entry.epoch,
          metrics: { ...entry.metrics },
          confusion: { ...entry.confusion },
          overfitWarning: entry.overfitWarning,
        })),
        optimizer: {
          step: optimizer.step,
          runners: optimizerRunnersState(),
        },
      },
      analysis: {
        classifier: classifierHistoryEntry(),
        optimizer: optimizerSummaries(),
      },
    };
  }

  function exportExperiment() {
    const state = buildExperimentState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ml-playground-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function sanitizePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    const label = Number(point?.label) === 1 ? 1 : 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), label };
  }

  function restoreOptimizerRunners(runnerState) {
    optimizer.runners = {};
    for (const key of selectedOptimizerKeys()) {
      const saved = runnerState?.[key];
      const runner = createRunner();
      if (saved) {
        const path = Array.isArray(saved.path)
          ? saved.path
              .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
              .filter((point) => point && point.every(Number.isFinite))
          : [];
        runner.path = path.length ? path : runner.path;
        runner.position = Array.isArray(saved.position) && saved.position.length >= 2
          ? [Number(saved.position[0]), Number(saved.position[1])]
          : runner.path[runner.path.length - 1].slice();
        runner.velocity = Array.isArray(saved.velocity) ? saved.velocity.slice(0, 2).map(Number) : runner.velocity;
        runner.m = Array.isArray(saved.m) ? saved.m.slice(0, 2).map(Number) : runner.m;
        runner.v = Array.isArray(saved.v) ? saved.v.slice(0, 2).map(Number) : runner.v;
        runner.cache = Array.isArray(saved.cache) ? saved.cache.slice(0, 2).map(Number) : runner.cache;
        runner.t = Number(saved.t) || 0;
        runner.initialLoss = Number.isFinite(Number(saved.initialLoss)) ? Number(saved.initialLoss) : runner.initialLoss;
        runner.bestLoss = Number.isFinite(Number(saved.bestLoss)) ? Number(saved.bestLoss) : runner.bestLoss;
        runner.bestPosition = Array.isArray(saved.bestPosition) ? saved.bestPosition.slice(0, 2).map(Number) : runner.bestPosition;
        runner.clippedSteps = Math.max(0, Math.floor(Number(saved.clippedSteps) || 0));
        runner.status = typeof saved.status === "string" ? saved.status : runner.status;
        runner.reason = typeof saved.reason === "string" ? saved.reason : runner.reason;
        runner.done = Boolean(saved.done);
      }
      optimizer.runners[key] = runner;
    }
    optimizer.step = optimizerMaxHistoryIndex();
    optimizer.timelineIndex = null;
    optimizer.replaying = false;
    optimizer.running = false;
  }

  function applyImportedExperiment(state) {
    if (!state || state.version !== 1) throw new Error("Unsupported experiment JSON");

    const networkConfig = state.networkConfig ?? {};
    const dataset = state.dataset ?? {};
    if (dataset.kind) $("datasetSelect").value = dataset.kind;
    if (Number.isFinite(Number(dataset.pointCount))) $("pointCountInput").value = Number(dataset.pointCount);
    if (Number.isFinite(Number(dataset.noise))) $("noiseInput").value = Number(dataset.noise);
    if (Number.isFinite(Number(networkConfig.hiddenUnits))) $("hiddenUnitsInput").value = Number(networkConfig.hiddenUnits);
    if (Number.isFinite(Number(networkConfig.depth))) $("depthInput").value = Number(networkConfig.depth);
    if (networkConfig.activation) $("activationSelect").value = networkConfig.activation;
    if (networkConfig.optimizer) $("networkOptimizerSelect").value = networkConfig.optimizer;
    if (Number.isFinite(Number(networkConfig.learningRate))) $("networkLrInput").value = Number(networkConfig.learningRate);
    if (Number.isFinite(Number(networkConfig.l2))) $("l2Input").value = Number(networkConfig.l2);
    if (Number.isFinite(Number(networkConfig.stepsPerFrame))) $("networkSpeedInput").value = Number(networkConfig.stepsPerFrame);
    if (Number.isFinite(Number(networkConfig.maxEpochs))) $("maxEpochInput").value = Math.max(1, Math.floor(Number(networkConfig.maxEpochs)));

    classifier.points = Array.isArray(dataset.points) ? dataset.points.map(sanitizePoint).filter(Boolean) : classifier.points;
    refreshClassifierSplit();
    classifier.network = networkConfig.networkState
      ? NeuralNetwork.fromState(networkConfig.networkState)
      : new NeuralNetwork(Number($("hiddenUnitsInput").value), Number($("depthInput").value), $("activationSelect").value, $("networkOptimizerSelect").value);
    classifier.epoch = Math.max(0, Math.floor(Number(networkConfig.epoch) || 0));
    classifier.running = false;
    classifier.timelineIndex = null;
    evaluateClassifierState();
    classifier.overfitWarning = false;
    classifier.history = Array.isArray(state.history?.classifier) && state.history.classifier.length
      ? state.history.classifier
      : [classifierHistoryEntry()];
    recordClassifierHistory();
    updateClassifierMetrics();
    drawClassifier();

    const surface = state.surfaceConfig ?? {};
    const optimizerConfig = state.optimizerConfig ?? {};
    document.querySelectorAll('input[name="optimizer"]').forEach((input) => {
      input.checked = Array.isArray(optimizerConfig.selectedOptimizers)
        ? optimizerConfig.selectedOptimizers.includes(input.value)
        : input.checked;
    });
    if (Number.isFinite(Number(optimizerConfig.learningRate))) $("optimizerLrInput").value = Number(optimizerConfig.learningRate);
    if (optimizerConfig.schedule) $("scheduleSelect").value = optimizerConfig.schedule;
    if (Number.isFinite(Number(optimizerConfig.animationSpeed))) $("optimizerSpeedInput").value = Number(optimizerConfig.animationSpeed);
    updateOptimizerSpeedLabel();

    if (surface.key === "custom" || optimizerConfig.functionKey === "custom") {
      $("functionSelect").value = "custom";
      $("customFunctionInput").value = surface.customExpression || "x^2 + y^2";
      $("customXMinInput").value = surface.domain?.x?.[0] ?? -4;
      $("customXMaxInput").value = surface.domain?.x?.[1] ?? 4;
      $("customYMinInput").value = surface.domain?.y?.[0] ?? -4;
      $("customYMaxInput").value = surface.domain?.y?.[1] ?? 4;
      applyCustomFunction();
    } else {
      setOptimizerFunction(optimizerConfig.functionKey || surface.key || "quadratic");
    }
    if (Array.isArray(optimizerConfig.start)) {
      optimizer.start = [Number(optimizerConfig.start[0]), Number(optimizerConfig.start[1])].map((value, index) => {
        const fn = optimizerFunction();
        const domain = index === 0 ? fn.domain.x : fn.domain.y;
        return clamp(Number.isFinite(value) ? value : optimizer.start[index], domain[0], domain[1]);
      });
      $("startXInput").value = optimizer.start[0].toFixed(2);
      $("startYInput").value = optimizer.start[1].toFixed(2);
    }
    restoreOptimizerRunners(optimizerConfig.runners || state.history?.optimizer?.runners);
    optimizer.heatCache = null;
    if (optimizer3d.surfaceMesh) optimizer3d.surfaceMesh.userData.functionKey = "";
    syncOptimizerTimeline();
    updateOptimizerMetrics();
    drawOptimizer();
  }

  function importExperiment(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        applyImportedExperiment(JSON.parse(String(reader.result || "{}")));
      } catch (error) {
        alert(`Could not import experiment: ${error.message}`);
      }
    });
    reader.readAsText(file);
  }

  function bindExperimentControls() {
    $("exportExperimentButton").addEventListener("click", exportExperiment);
    $("importExperimentInput").addEventListener("change", (event) => {
      importExperiment(event.target.files?.[0]);
      event.target.value = "";
    });
  }

  function bindOptimizerControls() {
    $("optimizerControls").addEventListener("submit", (event) => event.preventDefault());
    $("functionSelect").addEventListener("change", (event) => setOptimizerFunction(event.target.value));
    $("applyCustomFunctionButton").addEventListener("click", applyCustomFunction);
    $("useCustomExampleButton").addEventListener("click", () => {
      const example = customExamples[$("customExampleSelect").value] ?? customExamples.wavy;
      $("customFunctionInput").value = example.expression;
      $("customXMinInput").value = String(example.domain.x[0]);
      $("customXMaxInput").value = String(example.domain.x[1]);
      $("customYMinInput").value = String(example.domain.y[0]);
      $("customYMaxInput").value = String(example.domain.y[1]);
      $("startXInput").value = String(example.start[0]);
      $("startYInput").value = String(example.start[1]);
      applyCustomFunction();
    });
    $("applyStartButton").addEventListener("click", applyStartFromInputs);
    $("randomStartButton").addEventListener("click", randomizeStart);
    $("runOptimizerButton").addEventListener("click", () => {
      if (!optimizer.running) {
        if (optimizerRunComplete()) resetOptimizer();
        optimizer.replaying = false;
        optimizer.timelineIndex = null;
        for (const runner of Object.values(optimizer.runners)) {
          if (!runner.done) setRunnerStatus(runner, "Running", "Still updating");
        }
      }
      optimizer.running = !optimizer.running;
      updateOptimizerMetrics();
    });
    $("stepOptimizerButton").addEventListener("click", () => {
      optimizer.running = false;
      optimizer.replaying = false;
      optimizer.timelineIndex = null;
      if (!optimizerRunComplete()) optimizerStepOnce();
      drawOptimizer();
    });
    $("replayOptimizerButton").addEventListener("click", () => {
      optimizer.running = false;
      optimizer.replaying = optimizerMaxHistoryIndex() > 0;
      optimizer.timelineIndex = optimizer.replaying ? 0 : null;
      optimizer.stepAccumulator = 0;
      updateOptimizerMetrics();
      drawOptimizer();
    });
    $("resetOptimizerButton").addEventListener("click", resetOptimizer);
    $("scheduleSelect").addEventListener("change", resetOptimizer);
    $("optimizerSpeedInput").addEventListener("input", updateOptimizerSpeedLabel);
    $("optimizerTimelineInput").addEventListener("input", () => {
      optimizer.running = false;
      optimizer.replaying = false;
      optimizer.timelineIndex = Number($("optimizerTimelineInput").value);
      syncOptimizerTimeline();
      updateOptimizerMetrics();
      drawOptimizer();
    });
    document.querySelectorAll('input[name="optimizer"]').forEach((input) => {
      input.addEventListener("change", resetOptimizer);
    });
    syncCustomFunctionPanel();
    updateOptimizerSpeedLabel();
  }

  function animationLoop() {
    if (classifier.running) {
      const steps = Number($("networkSpeedInput").value);
      let changed = false;
      for (let i = 0; i < steps; i += 1) {
        if (!trainNetworkStep(false)) break;
        changed = true;
      }
      if (changed) {
        updateClassifierMetrics();
        drawClassifier();
      }
    }

    if (optimizer.running) {
      optimizer.stepAccumulator += Number($("optimizerSpeedInput").value);
      const steps = Math.floor(optimizer.stepAccumulator);
      optimizer.stepAccumulator -= steps;
      if (steps > 0) {
        for (let i = 0; i < steps; i += 1) optimizerStepOnce();
        if (optimizerRunComplete()) {
          optimizer.running = false;
          updateOptimizerMetrics();
        }
        drawOptimizer();
      } else {
        renderOptimizer3D();
      }
    } else if (optimizer.replaying) {
      optimizer.stepAccumulator += Number($("optimizerSpeedInput").value);
      const steps = Math.floor(optimizer.stepAccumulator);
      optimizer.stepAccumulator -= steps;
      if (steps > 0) {
        optimizer.timelineIndex = Math.min(optimizerMaxHistoryIndex(), (optimizer.timelineIndex ?? 0) + steps);
        if (optimizer.timelineIndex >= optimizerMaxHistoryIndex()) {
          optimizer.replaying = false;
        }
        updateOptimizerMetrics();
        drawOptimizer();
      } else {
        renderOptimizer3D();
      }
    } else if (optimizer3d.renderer && optimizer3d.needsRender) {
      renderOptimizer3D();
    }

    requestAnimationFrame(animationLoop);
  }

  bindClassifierControls();
  bindOptimizerControls();
  bindExperimentControls();
  if (startupMaxEpochs > 0) {
    $("maxEpochInput").value = Math.max(1, Math.floor(startupMaxEpochs));
  }
  regenerateDataset();
  if (startupNetworkTrain) {
    while (trainNetworkStep(false)) {
      if (classifier.epoch >= maxNetworkEpochs()) break;
    }
    updateClassifierMetrics();
    drawClassifier();
  }
  resetOptimizer();
  if (startupOptimizerSteps > 0) {
    for (let i = 0; i < startupOptimizerSteps; i += 1) {
      optimizerStepOnce();
    }
    drawOptimizer();
  }
  requestAnimationFrame(animationLoop);
})();
