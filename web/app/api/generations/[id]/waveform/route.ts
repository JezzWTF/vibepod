import { NextRequest, NextResponse } from "next/server";

const pythonUrl = () => process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${pythonUrl()}/generations/${id}/waveform`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "Waveform not found" }, { status: res.status });
    return NextResponse.json(await res.json(), {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to reach server" }, { status: 502 });
  }
}
