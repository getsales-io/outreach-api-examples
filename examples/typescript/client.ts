// One fetch wrapper for the GetSales API, shared by every TypeScript example.
// There is nothing to install: fetch is built into Node 18 and later.
// Keys and headers: https://docs.getsales.io/authentication

// The only place the host is written. examples/curl/_env.sh reads this line
// too, so pointing every example at another host means editing it here alone.
export const API_HOST = "https://api2.getsales.io";

/** The services behind the host. A path names its service: {host}/{service}/v1/api/... */
export type Service = "playtables" | "unibox" | "integrations" | "id" | "signals";

export type QueryValue = string | number | boolean | ReadonlyArray<string | number>;
/** Query parameters of a GET. An array repeats its name: { "include[]": ["a", "b"] }. */
export type Query = Readonly<Record<string, QueryValue>>;

export interface Meta {
  trace_id: string;
  span_id?: string;
  timestamp?: string;
  duration_ms?: number;
  team_sid?: string | null;
  actor_type?: string | null;
}

/** Every success carries success: true, the operation that names its shape, and meta. */
export interface Envelope {
  success: true;
  operation: string;
  meta: Meta;
}

export interface Row<T, I = Record<string, unknown>> {
  item: T;
  included: I;
}

export interface SearchResult<T, I = Record<string, unknown>> extends Envelope {
  items: Row<T, I>[];
  pagination: { next_cursor: string | null; has_more: boolean; total_count: number | null };
  counts?: { total_count: number };
}

export interface GetResult<T, I = Record<string, unknown>> extends Envelope {
  item: T;
  included: I;
}

export interface CreateResult<T> extends Envelope {
  item: T;
  already_exists: boolean;
}

export interface ActionResult<R, T = unknown> extends Envelope {
  action: string;
  item: T;
  result: R;
}

/** The error envelope's error block: code is one of 16 values, suggestion is written for a person or a model. */
export interface ApiErrorBody {
  code: string;
  message: string;
  recoverable: boolean;
  suggestion?: string;
  field_errors?: Record<string, { rule: string; message: string }[]>;
  context?: Record<string, unknown>;
}

export class GetSalesError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string | undefined;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, code: string, message: string, traceId?: string, body?: ApiErrorBody) {
    super(`${code} (HTTP ${status}): ${message}${traceId ? ` [trace_id ${traceId}]` : ""}`);
    this.name = "GetSalesError";
    this.status = status;
    this.code = code;
    this.traceId = traceId;
    this.body = body;
  }
}

function host(): string {
  // GETSALES_API_HOST points the examples somewhere else, a local mock for instance.
  return (process.env.GETSALES_API_HOST ?? API_HOST).replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.GETSALES_API_KEY;
  if (!key) throw new Error("GETSALES_API_KEY is not set. Create a key in the app (Settings, API keys) and export it, as the README shows.");
  return key;
}

export function buildUrl(service: Service, path: string, query?: Query): string {
  const url = new URL(`${host()}/${service}/v1${path}`);
  for (const [name, value] of Object.entries(query ?? {})) {
    const values: ReadonlyArray<string | number | boolean> = Array.isArray(value) ? value : [value as string | number | boolean];
    for (const one of values) url.searchParams.append(name, String(one));
  }
  return url.toString();
}

async function request<T>(method: "GET" | "POST", service: Service, path: string, body?: object, query?: Query): Promise<T> {
  const hasBody = body !== undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    Accept: "application/json",
    // A GET goes out with no body, so it gets no Content-Type either.
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetch(buildUrl(service, path, query), {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text === "" ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  const envelope = json as { success?: boolean; error?: ApiErrorBody; meta?: Partial<Meta> } | undefined;
  if (!res.ok || envelope?.success !== true) {
    const error = envelope?.error;
    throw new GetSalesError(
      res.status,
      error?.code ?? `http_${res.status}`,
      error?.message ?? (text.slice(0, 200) || res.statusText),
      envelope?.meta?.trace_id ?? res.headers.get("x-trace-id") ?? undefined,
      error,
    );
  }
  return json as T;
}

export const gs = {
  get<T = Envelope>(service: Service, path: string, query?: Query): Promise<T> {
    return request<T>("GET", service, path, undefined, query);
  },
  post<T = Envelope>(service: Service, path: string, body: object = {}): Promise<T> {
    return request<T>("POST", service, path, body);
  },
};

/** Prints a usage line and stops. */
export function usage(line: string): never {
  console.error(`usage: ${line}`);
  process.exit(2);
}

/** Runs an example and prints a refused call as a few readable lines instead of a stack trace. */
export function run(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    if (err instanceof GetSalesError) {
      console.error(err.message);
      if (err.body?.suggestion) console.error(`suggestion: ${err.body.suggestion}`);
      if (err.body?.field_errors) console.error(JSON.stringify(err.body.field_errors, null, 2));
      if (err.body?.context) console.error(`context: ${JSON.stringify(err.body.context)}`);
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  });
}
