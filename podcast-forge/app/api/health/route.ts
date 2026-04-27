import { NextResponse } from "next/server";

export async function GET() {
  const pythonServerUrl =
    process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

  try {
    const res = await fetch(`${pythonServerUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      return NextResponse.json({ status: "online" });
    }
    return NextResponse.json({ status: "offline" });
  } catch {
    return NextResponse.json({ status: "offline" });
  }
}
