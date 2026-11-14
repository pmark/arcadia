import { NextResponse } from "next/server";
import { isOperatorBrowserPress } from "../../../../../../src/operatorActions/startRunDayGrant.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const looksLoopback = (host: string): boolean => {
  const name = host.toLowerCase().replace(/^\[([^\]]*)\](?::\d+)?$/, "$1").replace(/:\d+$/, "").replace(/\.+$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "::1" || name === "::" || name === "0.0.0.0" || /^127\.\d+\.\d+\.\d+$/.test(name);
};

/**
 * Read-only: reports whether a day-grant press arriving with this request's Origin and Host would pass
 * `isOperatorBrowserPress`, so the operator's Tailnet path can be checked without pressing anything. It starts no
 * process, writes nothing and changes no other route.
 */
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const accepted = isOperatorBrowserPress({ origin, host });
  let reason: string | null = null;
  if (!accepted) {
    if (!origin) reason = "No Origin header reached the server.";
    else if (!host) reason = "No Host header reached the server.";
    else if (looksLoopback(host)) reason = `The Host the server saw (${host}) is a loopback address; the Tailnet serve must preserve the Host header.`;
    else reason = `The Origin (${origin}) and the Host the server saw (${host}) do not agree, or the Origin is not a plain http(s) origin.`;
  }
  return NextResponse.json({ accepted, host, origin, reason });
}
