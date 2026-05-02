import { NextResponse } from "next/server";

const OFFLINE_RESPONSE = { status: "offline" };
const COMMON_OPTIONS = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  const pythonServerUrl = process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

  try {
    const res = await fetch(`${pythonServerUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
      // Don't cache health checks
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      // Pass through the exact status the Python server reports:
      // "online" | "loading" | "error"
      const status: string = data.status ?? "online";
      return NextResponse.json(
        {
          status,
          device: data.device ?? null,
          message: data.message,
          progress: data.progress ?? null,
          voices: data.voices ?? [],
          config: data.config ?? null,
        },
        COMMON_OPTIONS
      );
    }
    return NextResponse.json(OFFLINE_RESPONSE, COMMON_OPTIONS);
  } catch {
    return NextResponse.json(OFFLINE_RESPONSE, COMMON_OPTIONS);
  }
}
