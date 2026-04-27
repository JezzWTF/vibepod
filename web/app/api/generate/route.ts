import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const pythonServerUrl = process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

  try {
    const body = await request.json() as {
      text: string;
      speaker?: string;
      cfg_scale?: number;
      inference_steps?: number;
    };

    if (!body.text?.trim()) {
      return NextResponse.json({ error: "Missing or empty text field" }, { status: 400 });
    }

    const upstream = await fetch(`${pythonServerUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: body.text.trim(),
        speaker: body.speaker ?? "carter",
        cfg_scale: body.cfg_scale ?? 1.5,
        inference_steps: body.inference_steps ?? 10,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "Unknown error");
      return NextResponse.json({ error: text }, { status: upstream.status });
    }

    // Proxy the SSE stream through to the browser
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect to VibeVoice server";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
