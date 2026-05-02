import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const pythonUrl = () => process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${pythonUrl()}/generations/${id}/audio`);
    if (!res.ok) return NextResponse.json({ error: "Audio not found" }, { status: res.status });
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": `attachment; filename="${id}.wav"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to reach server" }, { status: 502 });
  }
}
