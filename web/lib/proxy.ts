import { NextRequest, NextResponse } from "next/server";
export async function proxy(request: NextRequest, path: string) {
  try {
    const url = `${process.env.VIBEPOD_SERVER_URL ?? "http://127.0.0.1:8000"}/${path}${new URL(request.url).search}`;
    const headers = new Headers();
    for (const name of ["content-type", "range"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetch(url, {
      method: request.method,
      headers,
      cache: "no-store",
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
    const output = new Headers({ "Cache-Control": "no-store" });
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "content-disposition",
    ]) {
      const value = response.headers.get(name);
      if (value) output.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: output });
  } catch {
    return NextResponse.json({ error: "Cannot reach the GPU server" }, { status: 502 });
  }
}
