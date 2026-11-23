import type { HttpResponse } from "@hato/sdk/types";

export const DEFAULT_SERVER = "https://cloud-dev.hatopad.dev";
export const UNAVAILABLE = "This feature is not available over Cloud yet.";
const loopback = new Set(["127.0.0.1", "[::1]", "localhost"]);

export function serverOrigin(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a Cloud server URL.");
  const match = /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i.exec(value.trim());
  if (!match) throw new Error("Use a Cloud server origin, such as https://cloud-dev.hatopad.dev.");
  const scheme = match[1].toLowerCase();
  let host = match[2].toLowerCase();
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65535)) throw new Error("Enter a valid Cloud server port.");
  if (scheme === "http" && !loopback.has(host)) throw new Error("Cloud servers require HTTPS, except on loopback.");
  if (host === "localhost" && scheme === "http") host = "127.0.0.1";
  return `${scheme}://${host}${port && port !== (scheme === "https" ? 443 : 80) ? ":" + port : ""}`;
}

export function webPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\u0000-\u0020\u007f]/u.test(value)) throw new Error("Use a path on the Cloud server.");
  return value;
}

export class CloudHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function jsonResponse<T>(response: HttpResponse): T {
  let value: any = null;
  try { if (response.body) value = JSON.parse(response.body); } catch { /* map invalid server replies below */ }
  if (response.status >= 200 && response.status < 300 && (value !== null || response.status === 204)) return value;
  const code = typeof value?.error?.code === "string" ? value.error.code : "unavailable";
  const message = response.status === 401 ? "Your Cloud session expired. Sign in again."
    : typeof value?.error?.message === "string" ? value.error.message.trim().slice(0, 400)
    : "The Cloud server returned an invalid response.";
  throw new CloudHttpError(response.status, code, message);
}

export function callback(text: string, state: string): string | null {
  const line = text.split("\r\n", 1)[0];
  const match = /^GET \/callback\?([^ ]+) HTTP\/1\.[01]$/.exec(line);
  if (!match) return null;
  const values = new Map<string, string>();
  try {
    for (const field of match[1].split("&")) {
      const i = field.indexOf("=");
      if (i < 1) return null;
      const key = decodeURIComponent(field.slice(0, i));
      if (values.has(key)) return null;
      values.set(key, decodeURIComponent(field.slice(i + 1)));
    }
  } catch { return null; }
  const code = values.get("code") ?? "";
  return values.get("state") === state && /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}

export function eventFrames(buffer: string, chunk: string) {
  const text = (buffer + chunk).replace(/\r\n/g, "\n");
  if (text.length > 1024 * 1024) return { buffer: "", events: [] };
  const records = text.split("\n\n");
  const rest = records.pop() ?? "";
  const events = records.flatMap(record => {
    const data = record.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
    try { return data ? [JSON.parse(data)] : []; } catch { return []; }
  });
  return { buffer: rest, events };
}
