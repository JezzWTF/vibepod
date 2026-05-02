import { NextRequest, NextResponse } from "next/server";

const pythonUrl = () => process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit") ?? "50";
  const offset = searchParams.get("offset") ?? "0";

  try {
    const res = await fetch(`${pythonUrl()}/generations?limit=${limit}&offset=${offset}`, {
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: "Upstream error" }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Failed to reach server" }, { status: 502 });
  }
}
