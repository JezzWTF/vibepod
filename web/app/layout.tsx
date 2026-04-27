import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibePod — TTS Podcast Generator",
  description: "Generate podcast audio using Microsoft VibeVoice 0.5B",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ background: "var(--background)", color: "var(--foreground)" }}>
        {children}
      </body>
    </html>
  );
}
