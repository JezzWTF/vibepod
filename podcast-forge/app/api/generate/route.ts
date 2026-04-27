import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, cfg_scale, inference_steps } = body as {
      text: string;
      cfg_scale: number;
      inference_steps: number;
    };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or empty text field" },
        { status: 400 }
      );
    }

    const pythonServerUrl =
      process.env.VIBEVOICE_SERVER_URL ?? "http://localhost:8000";

    const upstream = await fetch(`${pythonServerUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.trim(),
        cfg_scale: cfg_scale ?? 2.5,
        inference_steps: inference_steps ?? 20,
      }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "Unknown error");
      return NextResponse.json(
        { error: `VibeVoice server error: ${errorText}` },
        { status: upstream.status }
      );
    }

    const audioBuffer = await upstream.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": 'attachment; filename="vibepod-output.wav"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to connect to VibeVoice server";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
