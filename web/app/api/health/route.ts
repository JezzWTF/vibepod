/**
 * API Proxy Route: GET /api/health
 *
 * This route proxies health check requests from the frontend to the FastAPI backend's /health endpoint.
 *
 * Security Architecture:
 * The FastAPI backend is configured to bind only to localhost (127.0.0.1). This prevents
 * unauthenticated public access to the server status and configuration. Next.js acts as a secure
 * proxy, allowing the frontend to poll for server readiness and adaptive configuration
 * while maintaining a single public-facing origin.
 */
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
