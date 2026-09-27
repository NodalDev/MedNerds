/** Read-only parsing of HyperHeart animation data. Never evaluates the export.
 * Adapted data: CC BY-NC 4.0; see third_party/hyperheart/NOTICE.md.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const directory = new URL('_reference/hyperheart-original/', root);
const filename = (await readdir(directory)).find((name) => /^hyperheart\.js$/i.test(name));
if (!filename) throw new Error('Missing HyperHeart source');
const source = await readFile(new URL(filename, directory), 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const getText = (node) => node.getText(ast);
function literal(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) throw new Error('Non-literal motion property');
    return [getText(property.name), literal(property.initializer)];
  }));
  throw new Error('Unsupported source expression: ' + getText(node));
}
let stage;
function findStage(node) {
  if (ts.isBinaryExpression(node) && getText(node.left) === 'lib.HyperHeart_html5' && ts.isFunctionExpression(node.right)) stage = node.right.body;
  ts.forEachChild(node, findStage);
}
findStage(ast);
if (!stage) throw new Error('Source stage not found');
const elements = new Map();
const keys = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'regX', 'regY'];
const allowed = new Set([...keys, 'alpha', '_off', 'guide']);
const markers = [];
for (const statement of stage.statements) {
  if (!ts.isExpressionStatement(statement)) continue;
  const expression = statement.expression;
  if (ts.isBinaryExpression(expression)) {
    const left = getText(expression.left);
    if (ts.isNewExpression(expression.right) && /^lib\.(?:(?:red|blue)(?:dot|smallcircle|midcircle|medbiggercircle|bigcircle|arrow)|yellow_arrow(?:_lower|head)?|time_marker)$/.test(getText(expression.right.expression))) {
      const symbol = getText(expression.right.expression).slice(4);
      // End-of-tween ghost groups (shape176 etc.) and unrelated UI pointers are not motion instances.
      elements.set(left, { id: left.slice(5), symbol, initial: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, regX: 0, regY: 0, alpha: 1, _off: false }, segments: [] });
    } else {
      const field = left.slice(left.lastIndexOf('.') + 1);
      const element = elements.get(left.slice(0, left.lastIndexOf('.')));
      if (element && ['alpha', '_off'].includes(field)) element.initial[field] = literal(expression.right);
    }
  }
  if (!ts.isCallExpression(expression)) continue;
  const callee = getText(expression.expression);
  if (callee.endsWith('.setTransform')) {
    const element = elements.get(callee.slice(0, -13));
    if (element) expression.arguments.forEach((arg, index) => { element.initial[keys[index]] = literal(arg); });
  }
  if (callee !== 'this.timeline.addTween') continue;
  const calls = [];
  let cursor = expression.arguments[0];
  while (ts.isCallExpression(cursor) && ts.isPropertyAccessExpression(cursor.expression)) {
    calls.unshift({ name: cursor.expression.name.text, args: cursor.arguments });
    cursor = cursor.expression.expression;
  }
  const get = calls.shift();
  if (get?.name !== 'get') continue;
  const element = elements.get(getText(get.args[0]));
  if (!element) continue;
  let frame = 0;
  for (const call of calls) {
    if (call.name === 'wait') { frame += literal(call.args[0]); continue; }
    if (call.name !== 'to' || call.args.length > 2) throw new Error('Unsupported tween/easing for ' + element.id);
    const target = literal(call.args[0]);
    if (Object.keys(target).some((key) => !allowed.has(key))) throw new Error('Unexpected motion field');
    const duration = call.args[1] ? literal(call.args[1]) : 0;
    element.segments.push({ start: frame, end: frame + duration, target });
    frame += duration;
  }
  if (element.symbol === 'time_marker') markers.push(element);
}

// Port compact CreateJS Graphics paths into plain SVG, not a legacy runtime.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodePath(encoded) {
  const counts = [2, 2, 4, 6, 0];
  const commands = ['M', 'L', 'Q', 'C', 'Z'];
  let index = 0, x = 0, y = 0;
  const output = [];
  while (index < encoded.length) {
    const header = alphabet.indexOf(encoded[index++]);
    const instruction = header >> 3;
    if (instruction > 4 || (header & 3)) throw new Error('Invalid compact path');
    if (instruction === 0) x = y = 0;
    const length = ((header >> 2) & 1) + 2;
    const parameters = [];
    for (let p = 0; p < counts[instruction]; p++) {
      let first = alphabet.indexOf(encoded[index]);
      const sign = (first >> 5) ? -1 : 1;
      let number = ((first & 31) << 6) | alphabet.indexOf(encoded[index + 1]);
      if (length === 3) number = (number << 6) | alphabet.indexOf(encoded[index + 2]);
      number = sign * number / 10;
      if (p % 2) number = y += number; else number = x += number;
      parameters.push(Math.round(number * 1000) / 1000);
      index += length;
    }
    output.push(commands[instruction] + parameters.join(' '));
  }
  return output.join(' ');
}
const symbols = {};
for (const symbol of new Set([...elements.values()].filter((element) => element.segments.length).map((element) => element.symbol))) {
  if (symbol === 'time_marker') continue;
  const block = source.slice(source.indexOf('(lib.' + symbol + ' = function'), source.indexOf('(lib.' + symbol + ' = function') + 3500);
  const graphic = block.match(/this\.shape\.graphics\.f\("([^"]+)"\).*?\.p\("([^"]+)"\)/);
  const transform = block.match(/this\.shape\.setTransform\(([^)]+)\)/);
  if (!graphic || !transform) throw new Error('Missing symbol geometry: ' + symbol);
  symbols[symbol] = { fill: graphic[1], path: decodePath(graphic[2]), offset: transform[1].split(',').map(Number).slice(0, 2) };
}
const flows = [...elements.values()].filter((element) => element.symbol !== 'time_marker' && element.segments.length);
// instance_29 / instance_30 have only one-frame ghost states, not an independent motion tween.
const result = `// Generated from HyperHeart (${createHash('sha256').update(source).digest('hex')}).\n// CC BY-NC 4.0; see third_party/hyperheart/NOTICE.md. Do not edit manually.\nimport type { FlowElement, FlowSymbol, MotionElement } from './motion-types';\n\nexport const flowSymbols = ${JSON.stringify(symbols, null, 2)} as const satisfies Readonly<Record<string, FlowSymbol>>;\n\nexport const flowElements = [\n${flows.map((element) => `  // Original ${element.id} / ${element.symbol}\n  ${JSON.stringify(element)},`).join('\n')}\n] as const satisfies readonly FlowElement[];\n\n// Original instance_92 (Wiggers) and instance_100 (ECG / heart sounds).\nexport const sourceTimeMarkers = ${JSON.stringify(markers, null, 2)} as const satisfies readonly MotionElement[];\n`;
const output = new URL('src/lib/tools/hyperheart/motion-data.ts', root);
if (process.argv.includes('--verify')) {
  if ((await readFile(output, 'utf8')).replaceAll('\r\n', '\n') !== result) throw new Error('Motion data is stale');
} else await writeFile(output, result);
console.log(`Verified/extracted ${flows.length} flow elements, ${Object.keys(symbols).length} symbols, ${markers.length} time-marker tracks.`);

// Inspection-only access for calibration/tests; no legacy execution.
export { source, decodePath };
