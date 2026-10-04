import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibePod Studio",
  description: "Write conversations, direct voices, keep the best takes, and export your podcast.",
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
