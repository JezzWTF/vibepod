import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibePod — TTS Podcast Generator",
  description: "Create and save podcast line takes with Qwen3-TTS",
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
