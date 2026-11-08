#!/usr/bin/env node
// Reads every API call in the examples, curl and TypeScript, and checks it.
//
// Always:
//   - every numbered example makes at least one call it can read,
//   - the curl and the TypeScript version of a task call the same operations,
//   - the API host is written once, as API_HOST in examples/typescript/client.ts.
// When the OpenAPI documents are at hand, each call is also checked against
// them: the method and path must name a documented operation, the body may
// only carry documented fields (with documented enum values), and a GET may
// only pass documented query parameters.
//
// Where the documents come from, first match wins:
//   --openapi <dir>       a folder holding services/<service>/openapi.yaml
//                         (or api-reference/<service>/openapi.yaml)
//   GETSALES_OPENAPI_DIR  the same, from the environment
//   --from-docs           the documents published at docs.getsales.io
//   ../../openapi/gs.openapi.public, a checkout next to this one, when it exists
// Usage: node scripts/check-paths.mjs [--openapi <dir> | --from-docs]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  OPEN,
  RUNTIME,
  RUNTIME_STRING,
  alternatives,
  checkBody,
  checkQuery,
  findOperation,
  loadContract,
  loadContractFromDocs,
  methodsOnPath,
} from "./lib/openapi.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CURL_DIR = join(ROOT, "examples", "curl");
const TS_DIR = join(ROOT, "examples", "typescript");
const CLIENT = join(TS_DIR, "client.ts");
const rel = (file) => relative(ROOT, file);

// ---------------------------------------------------------------- curl

/** Turns a heredoc body into a value: shell expansions become run-time markers. */
function heredocValue(text, expands) {
  if (!expands) return JSON.parse(text);
  let json = "";
  let i = 0;
  const readExpansion = () => {
    // at a "$": $NAME, ${...} or $(...)
    if (text[i + 1] === "{") {
      i = text.indexOf("}", i) + 1;
    } else if (text[i + 1] === "(") {
      let depth = 0;
      for (; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        if (text[i] === ")" && --depth === 0) break;
      }
      i += 1;
    } else {
      i += 1;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i += 1;
    }
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && (text[i + 1] === "$" || text[i + 1] === "`" || text[i + 1] === "\\")) {
      json += text[i + 1];
      i += 2;
    } else if (ch === '"') {
      // a JSON string: copy it, or mark it as run time when it holds an expansion
      let j = i + 1;
      let literal = '"';
      let runtime = false;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && text[j + 1] === "$") {
          literal += "$";
          j += 2;
          continue;
        }
        if (text[j] === "\\") {
          literal += text[j] + text[j + 1];
          j += 2;
          continue;
        }
        if (text[j] === "$" && /[A-Za-z_{(]/.test(text[j + 1] ?? "")) runtime = true;
        literal += text[j];
        j += 1;
      }
      json += runtime ? '"__RUNTIME_STRING__"' : `${literal}"`;
      i = j + 1;
    } else if (ch === "$" && /[A-Za-z_{(]/.test(text[i + 1] ?? "")) {
      readExpansion();
      json += '"__RUNTIME__"';
    } else {
      json += ch;
      i += 1;
    }
  }
  const mark = (v) => {
    if (v === "__RUNTIME__") return RUNTIME;
    if (v === "__RUNTIME_STRING__") return RUNTIME_STRING;
    if (Array.isArray(v)) return v.map(mark);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mark(x)]));
    return v;
  };
  return mark(JSON.parse(json));
}

function parseQuery(query) {
  const out = {};
  if (!query) return out;
  for (const pair of query.replace(/^\?/, "").split("&").filter(Boolean)) {
    const at = pair.indexOf("=");
    const name = at < 0 ? pair : pair.slice(0, at);
    const value = at < 0 ? "" : pair.slice(at + 1);
    (out[name] ??= []).push(value.includes("$") ? RUNTIME_STRING : decodeURIComponent(value));
  }
  return out;
}

const normalizePath = (path) =>
  path
    .split("/")
    .map((segment) => (segment.includes("$") || /^\{.*\}$/.test(segment) ? "{}" : segment))
    .join("/");

export function extractCurlCalls(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const calls = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("#") || !/(^|[\s(])curl\s/.test(lines[i])) continue;
    const start = i;
    let command = lines[i];
    while (command.trimEnd().endsWith("\\") && i + 1 < lines.length) {
      command = command.trimEnd().slice(0, -1) + " " + lines[++i].trim();
    }
    const call = { file, line: start + 1, problems: [] };
    const method = /\s-X\s+([A-Z]+)/.exec(command);
    const url = /"\$GETSALES_API\/([a-z]+)\/v1(\/[^"?\s]*)(\?[^"\s]*)?"/.exec(command);
    if (!method) call.problems.push("curl without -X METHOD");
    if (!url) call.problems.push('curl without a "$GETSALES_API/<service>/v1/..." URL');
    call.method = method?.[1];
    call.service = url?.[1];
    call.path = url ? normalizePath(url[2]) : undefined;
    call.query = parseQuery(url?.[3]);
    const heredoc = /--data-binary @-\s*<<\s*(['"]?)([A-Z_]+)\1/.exec(command);
    if (heredoc) {
      const end = lines.indexOf(heredoc[2], i + 1);
      if (end < 0) {
        call.problems.push(`heredoc ${heredoc[2]} is never closed`);
      } else {
        const text = lines.slice(i + 1, end).join("\n");
        try {
          call.body = heredocValue(text, heredoc[1] === "");
        } catch (err) {
          call.problems.push(`the body is not JSON: ${err.message}`);
        }
        i = end;
      }
    } else if (/\s(-d|--data[a-z-]*)\s/.test(command)) {
      call.problems.push("a body must come as --data-binary @- <<JSON so it can be checked");
    }
    calls.push(call);
  }
  return calls;
}

// ---------------------------------------------------------------- TypeScript

function constInitializers(source) {
  const found = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const list = found.get(node.name.text) ?? [];
      list.push(node.initializer);
      found.set(node.name.text, list);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function valueOf(node, consts, depth = 0) {
  if (!node || depth > 25) return RUNTIME;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return valueOf(node.expression, consts, depth + 1);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return RUNTIME_STRING;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") return undefined;
    const initializers = consts.get(node.text);
    return initializers?.length === 1 ? valueOf(initializers[0], consts, depth + 1) : RUNTIME;
  }
  if (ts.isConditionalExpression(node)) {
    return alternatives([valueOf(node.whenTrue, consts, depth + 1), valueOf(node.whenFalse, consts, depth + 1)]);
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return alternatives([valueOf(node.left, consts, depth + 1), valueOf(node.right, consts, depth + 1)]);
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        // ...list.map((x) => ({ ... })): check the object the callback returns
        const call = element.expression;
        const callback = ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "map"
          ? call.arguments[0]
          : undefined;
        if (callback && ts.isArrowFunction(callback) && !ts.isBlock(callback.body)) items.push(valueOf(callback.body, consts, depth + 1));
        items.push(RUNTIME);
      } else {
        items.push(valueOf(element, consts, depth + 1));
      }
    }
    return items;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = propertyName(prop.name);
        if (key === null) out[OPEN] = true;
        else out[key] = valueOf(prop.initializer, consts, depth + 1);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        out[prop.name.text] = valueOf(prop.name, consts, depth + 1);
      } else {
        out[OPEN] = true;
      }
    }
    return out;
  }
  return RUNTIME;
}

function pathOf(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => `{}${span.literal.text}`).join("");
  return undefined;
}

function queryOf(node, consts) {
  const value = valueOf(node, consts);
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [name, v] of Object.entries(value)) out[name] = Array.isArray(v) ? v : [v];
  return out;
}

export function extractTsCalls(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const consts = constInitializers(source);
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "gs"
    ) {
      const verb = node.expression.name.text;
      const [serviceArg, pathArg, thirdArg] = node.arguments;
      const call = {
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        method: verb.toUpperCase(),
        problems: [],
      };
      call.service = serviceArg && ts.isStringLiteral(serviceArg) ? serviceArg.text : undefined;
      const path = pathOf(pathArg);
      call.path = path === undefined ? undefined : normalizePath(path.split("?")[0]);
      if (!call.service) call.problems.push("the service must be a string literal");
      if (call.path === undefined) call.problems.push("the path must be a string or a template literal");
      if (verb === "get") {
        call.query = thirdArg ? queryOf(thirdArg, consts) : {};
      } else if (verb === "post") {
        call.query = {};
        call.body = thirdArg ? valueOf(thirdArg, consts) : {};
      } else {
        call.problems.push(`gs.${verb} is not a client method`);
      }
      calls.push(call);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

// ---------------------------------------------------------------- checks

function apiHost() {
  const match = /^export const API_HOST = "([^"]+)";$/m.exec(readFileSync(CLIENT, "utf8"));
  return match?.[1];
}

function* textFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const file = join(dir, name);
    if (statSync(file).isDirectory()) yield* textFiles(file);
    else if (!/\.(png|jpe?g|gif|ico|woff2?)$/i.test(name)) yield file;
  }
}

async function contractFrom(argv) {
  const at = argv.indexOf("--openapi");
  const dir = at >= 0 ? argv[at + 1] : process.env.GETSALES_OPENAPI_DIR;
  if (dir) return { contract: loadContract(resolve(dir)), from: resolve(dir) };
  if (argv.includes("--from-docs")) return { contract: await loadContractFromDocs(), from: "https://docs.getsales.io" };
  const nextDoor = resolve(ROOT, "..", "..", "openapi", "gs.openapi.public");
  if (existsSync(nextDoor)) return { contract: loadContract(nextDoor), from: nextDoor };
  return { contract: null, from: null };
}

async function main() {
  const argv = process.argv.slice(2);
  const problems = [];
  const files = [
    ...readdirSync(CURL_DIR).filter((n) => /^\d{2}-.*\.sh$/.test(n)).map((n) => join(CURL_DIR, n)),
    ...readdirSync(TS_DIR).filter((n) => n.endsWith(".ts")).map((n) => join(TS_DIR, n)),
  ].sort();

  const calls = [];
  for (const file of files) {
    const found = file.endsWith(".sh") ? extractCurlCalls(file) : extractTsCalls(file);
    if (found.length === 0 && /^\d{2}-/.test(basename(file))) problems.push(`${rel(file)}: no API call found`);
    calls.push(...found);
  }

  // The curl and TypeScript versions of a task call the same operations.
  const byTask = new Map();
  for (const call of calls) {
    const task = /^(\d{2})-/.exec(basename(call.file))?.[1];
    if (!task) continue;
    const kind = call.file.endsWith(".sh") ? "curl" : "typescript";
    const entry = byTask.get(task) ?? { curl: new Set(), typescript: new Set() };
    entry[kind].add(`${call.method} /${call.service}/v1${call.path}`);
    byTask.set(task, entry);
  }
  for (const [task, { curl, typescript }] of byTask) {
    const onlyCurl = [...curl].filter((c) => !typescript.has(c));
    const onlyTs = [...typescript].filter((c) => !curl.has(c));
    if (curl.size === 0 || typescript.size === 0) problems.push(`task ${task}: needs both a curl and a TypeScript version`);
    for (const c of onlyCurl) problems.push(`task ${task}: ${c} is called in curl only`);
    for (const c of onlyTs) problems.push(`task ${task}: ${c} is called in TypeScript only`);
  }

  // The host is written once.
  const host = apiHost();
  if (!host) {
    problems.push(`${rel(CLIENT)}: no API_HOST constant`);
  } else {
    for (const file of textFiles(ROOT)) {
      if (file !== CLIENT && readFileSync(file, "utf8").includes(host)) problems.push(`${rel(file)}: the API host is written here too; read API_HOST instead`);
    }
  }

  // The contract.
  const { contract, from } = await contractFrom(argv);
  const operations = new Map();
  if (contract) {
    for (const [service, entry] of contract) {
      if (host && entry.server && entry.server !== `${host}/${service}/v1`) {
        problems.push(`API_HOST ${host} does not match the ${service} document's server ${entry.server}`);
      }
    }
    for (const call of calls) {
      if (call.problems.length > 0 || !call.service) continue;
      const entry = contract.get(call.service);
      if (!entry) {
        call.problems.push(`no OpenAPI document for the service "${call.service}"`);
        continue;
      }
      const operation = findOperation(entry, call.method, call.path);
      if (!operation) {
        const methods = methodsOnPath(entry, call.path);
        call.problems.push(methods.length ? `${call.method} is not documented here; the path takes ${methods.join(", ")}` : "no such path");
        continue;
      }
      call.operationId = operation.op.operationId;
      operations.set(call.operationId, `${operation.method} /${call.service}/v1${operation.path}`);
      call.problems.push(...checkBody(entry, operation, call.method === "GET" ? undefined : call.body, "static"));
      call.problems.push(...checkQuery(entry, operation, call.query ?? {}, "static"));
    }
  }

  for (const call of calls) {
    const label = `${rel(call.file)}:${call.line}  ${call.method ?? "?"} /${call.service ?? "?"}/v1${call.path ?? "?"}`;
    console.log(`${label}${call.operationId ? `  ${call.operationId}` : ""}`);
    for (const problem of call.problems) problems.push(`${rel(call.file)}:${call.line}: ${problem}`);
  }

  console.log("");
  console.log(`${calls.length} calls in ${files.length} files.`);
  if (contract) {
    console.log(`Checked against the OpenAPI documents from ${from}: ${operations.size} operations.`);
    for (const [id, route] of [...operations].sort()) console.log(`  ${id}  ${route}`);
  } else {
    console.log("OpenAPI documents not found, so the calls were not checked against them.");
    console.log("Pass --openapi <dir>, set GETSALES_OPENAPI_DIR, or use --from-docs.");
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log("No problems.");
}

await main();
