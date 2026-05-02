import { NextRequest, NextResponse } from "next/server";

const pythonUrl = () => process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${pythonUrl()}/generations/${id}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "Not found" }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Failed to reach server" }, { status: 502 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${pythonUrl()}/generations/${id}`, { method: "DELETE" });
    if (res.status === 404)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!res.ok) return NextResponse.json({ error: "Upstream error" }, { status: res.status });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Failed to reach server" }, { status: 502 });
  }
}
