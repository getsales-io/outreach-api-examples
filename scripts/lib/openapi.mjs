// Reads the GetSales OpenAPI documents and checks API calls against them: the
// operation behind a method and a path, the request body, the query, and the
// shape of an answer. Used by scripts/check-paths.mjs (calls read from the
// example files) and by the tests' mock API (calls as the examples send them).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const SERVICES = ["playtables", "unibox", "integrations", "id", "signals"];

/** Where the published documents live, one per service. */
export const DOCS_SPEC_URL = (service) => `https://docs.getsales.io/api-reference/${service}/openapi.yaml`;

/** A value known only when the example runs: a variable, a function result. */
export const RUNTIME = Symbol("runtime value");
/** A string whose content is known only at run time, such as a template with a variable in it. */
export const RUNTIME_STRING = Symbol("runtime string");
/** Marks a value that is one of several (a conditional, a ?? fallback): each one must fit. */
export const ALTERNATIVES = Symbol("alternatives");
/** Marks an object that also takes keys from a spread, so its full key set is unknown. */
export const OPEN = Symbol("open object");

export const alternatives = (values) => ({ [ALTERNATIVES]: values });

// ---------------------------------------------------------------- loading

/** The document file of a service under dir, in the layouts the documents ship in. */
export function specFile(dir, service) {
  const candidates = [
    join(dir, "services", service, "openapi.yaml"),
    join(dir, "api-reference", service, "openapi.yaml"),
    join(dir, service, "openapi.yaml"),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

export function indexDocument(doc, source) {
  const operations = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item?.[method];
      if (!op) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        segments: path.split("/").filter(Boolean),
        op,
        parameters: [...(item.parameters ?? []), ...(op.parameters ?? [])],
      });
    }
  }
  return { doc, source, operations, server: doc.servers?.[0]?.url ?? null };
}

/** Loads every service document found under dir. Returns Map(service -> index). */
export function loadContract(dir) {
  const contract = new Map();
  for (const service of SERVICES) {
    const file = specFile(dir, service);
    if (!file) continue;
    contract.set(service, indexDocument(parse(readFileSync(file, "utf8"), { maxAliasCount: -1 }), file));
  }
  return contract;
}

/** Loads the documents the docs site publishes. */
export async function loadContractFromDocs() {
  const contract = new Map();
  for (const service of SERVICES) {
    const url = DOCS_SPEC_URL(service);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    contract.set(service, indexDocument(parse(await res.text(), { maxAliasCount: -1 }), url));
  }
  return contract;
}

// ---------------------------------------------------------------- operations

const isTemplateParam = (segment) => /^\{[^}]*\}$/.test(segment);

/**
 * The operation behind a method and a path. In the path, a segment written as
 * {} (or any {name}) stands for a value known only at run time.
 */
export function findOperation(entry, method, path) {
  const segments = path.split("/").filter(Boolean);
  let best = null;
  let bestScore = -1;
  for (const candidate of entry.operations) {
    if (candidate.method !== method || candidate.segments.length !== segments.length) continue;
    let score = 0;
    let fits = true;
    for (let i = 0; i < segments.length; i += 1) {
      const want = candidate.segments[i];
      const got = segments[i];
      if (isTemplateParam(want)) continue;
      if (isTemplateParam(got) || want !== got) {
        fits = false;
        break;
      }
      score += 1;
    }
    if (fits && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** The methods the document offers on a path of the same shape, for error messages. */
export function methodsOnPath(entry, path) {
  const methods = new Set();
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    if (findOperation(entry, method, path)) methods.add(method);
  }
  return [...methods];
}

// ---------------------------------------------------------------- schemas

export function deref(doc, schema) {
  let node = schema;
  const seen = new Set();
  while (node && typeof node === "object" && typeof node.$ref === "string") {
    if (seen.has(node.$ref)) break;
    seen.add(node.$ref);
    node = node.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce((at, key) => at?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], doc);
  }
  return node ?? {};
}

function typeOf(value) {
  if (value === null) return "null";
  if (value === RUNTIME_STRING) return "string";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function fitsType(type, value) {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

function regex(pattern) {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return new RegExp(pattern);
  }
}

function isAlternatives(value) {
  return value !== null && typeof value === "object" && ALTERNATIVES in value;
}

/**
 * Checks value against schema. mode:
 *   "static"   a body read from the source: unknown fields, enum values, types
 *              and required fields where the value is known,
 *   "request"  a body as sent: everything above plus lengths, patterns, bounds,
 *   "response" an answer, read partially: unknown fields, enum values and
 *              types, no required fields.
 */
export function validate(doc, schema, value, mode, at = "body") {
  const problems = [];
  check(doc, schema, value, at, mode, problems);
  return problems;
}

function check(doc, rawSchema, value, at, mode, out) {
  if (value === undefined || value === RUNTIME) return;
  if (isAlternatives(value)) {
    for (const one of value[ALTERNATIVES]) check(doc, rawSchema, one, at, mode, out);
    return;
  }
  const schema = deref(doc, rawSchema);
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    if (value === null && schema.nullable) return;
    let closest = null;
    for (const branch of branches) {
      const found = [];
      check(doc, branch, value, at, mode, found);
      if (found.length === 0) return;
      if (closest === null || found.length < closest.length) closest = found;
    }
    out.push(...(closest ?? [`${at}: fits none of the allowed shapes`]));
    return;
  }
  if (value === null) {
    if (schema.nullable || (!schema.type && !schema.properties && !schema.enum)) return;
    out.push(`${at}: null is not allowed here`);
    return;
  }
  if (Array.isArray(schema.enum) && value !== RUNTIME_STRING && !schema.enum.includes(value)) {
    out.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
    return;
  }
  const type = schema.type ?? (schema.properties ? "object" : undefined);
  if (!type) return;
  if (!fitsType(type, value)) {
    out.push(`${at}: expected ${type}, got ${typeOf(value)}`);
    return;
  }
  if (type === "object") checkObject(doc, schema, value, at, mode, out);
  else if (type === "array") checkArray(doc, schema, value, at, mode, out);
  else if (type === "string") checkString(schema, value, at, mode, out);
  else if (type === "number" || type === "integer") checkNumber(schema, value, at, mode, out);
}

function checkObject(doc, schema, value, at, mode, out) {
  const properties = schema.properties ?? {};
  const extra = schema.additionalProperties;
  for (const [key, child] of Object.entries(value)) {
    const where = `${at}.${key}`;
    if (Object.hasOwn(properties, key)) check(doc, properties[key], child, where, mode, out);
    else if (extra && typeof extra === "object") check(doc, extra, child, where, mode, out);
    else if (extra !== true) out.push(`${where}: not a field of this schema`);
  }
  if (mode !== "response" && value[OPEN] !== true) {
    for (const name of schema.required ?? []) {
      if (value[name] === undefined) out.push(`${at}.${name}: required`);
    }
  }
}

function checkArray(doc, schema, value, at, mode, out) {
  const complete = !value.includes(RUNTIME);
  if (mode !== "response" && complete) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${at}: at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${at}: at most ${schema.maxItems} items`);
  }
  value.forEach((item, i) => check(doc, schema.items ?? {}, item, `${at}[${i}]`, mode, out));
}

function checkString(schema, value, at, mode, out) {
  if (value === RUNTIME_STRING || mode === "response") return;
  if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${at}: shorter than ${schema.minLength}`);
  if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${at}: longer than ${schema.maxLength}`);
  if (schema.pattern && !regex(schema.pattern).test(value)) out.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
}

function checkNumber(schema, value, at, mode, out) {
  if (mode === "response") return;
  if (schema.minimum !== undefined) {
    const below = schema.exclusiveMinimum === true ? value <= schema.minimum : value < schema.minimum;
    if (below) out.push(`${at}: below the minimum ${schema.minimum}`);
  }
  if (schema.maximum !== undefined) {
    const above = schema.exclusiveMaximum === true ? value >= schema.maximum : value > schema.maximum;
    if (above) out.push(`${at}: above the maximum ${schema.maximum}`);
  }
}

// ---------------------------------------------------------------- requests and answers

/** Checks a request body against the operation. body undefined = no body sent. */
export function checkBody(entry, operation, body, mode) {
  const requestBody = operation.op.requestBody ? deref(entry.doc, operation.op.requestBody) : null;
  const schema = requestBody?.content?.["application/json"]?.schema;
  if (body === undefined) return requestBody?.required ? [`body: required by ${operation.op.operationId}`] : [];
  if (!schema) return [`body: ${operation.op.operationId} takes no body`];
  return validate(entry.doc, schema, body, mode);
}

function coerce(schema, value) {
  if (typeof value !== "string") return value;
  if ((schema.type === "integer" || schema.type === "number") && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (schema.type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

/** Checks query parameters, given as { name: [values] }, against the operation. */
export function checkQuery(entry, operation, query, mode) {
  const problems = [];
  const params = operation.parameters.map((p) => deref(entry.doc, p));
  for (const [name, values] of Object.entries(query)) {
    const param = params.find((p) => p.in === "query" && p.name === name);
    if (!param) {
      problems.push(`query ${name}: not a parameter of ${operation.op.operationId}`);
      continue;
    }
    const schema = deref(entry.doc, param.schema ?? {});
    if (schema.type === "array") {
      const items = deref(entry.doc, schema.items ?? {});
      check(entry.doc, schema, values.map((v) => coerce(items, v)), `query ${name}`, mode, problems);
    } else {
      for (const v of values) check(entry.doc, schema, coerce(schema, v), `query ${name}`, mode, problems);
    }
  }
  for (const param of params) {
    if (param.in === "query" && param.required && !(param.name in query)) problems.push(`query ${param.name}: required`);
  }
  return problems;
}

/** Checks the run-time values in a concrete path against the path parameters' schemas. */
export function checkPathValues(entry, operation, path) {
  const problems = [];
  const segments = path.split("/").filter(Boolean);
  const params = operation.parameters.map((p) => deref(entry.doc, p));
  operation.segments.forEach((segment, i) => {
    if (!isTemplateParam(segment)) return;
    const name = segment.slice(1, -1);
    const param = params.find((p) => p.in === "path" && p.name === name);
    if (!param) return;
    check(entry.doc, param.schema ?? {}, decodeURIComponent(segments[i] ?? ""), `path ${name}`, "request", problems);
  });
  return problems;
}

/** Checks an answer partially: every field in it must exist in the documented answer. */
export function checkResponse(entry, operation, status, body) {
  const responses = operation.op.responses ?? {};
  const described = responses[String(status)] ?? responses[`${String(status)[0]}XX`] ?? responses.default;
  const schema = described ? deref(entry.doc, described)?.content?.["application/json"]?.schema : undefined;
  if (!schema) return [`response ${status}: not described for ${operation.op.operationId}`];
  return validate(entry.doc, schema, body, "response", "response");
}
