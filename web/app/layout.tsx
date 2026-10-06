import type { Metadata } from "next";
import "./globals.css";
import "./shell.css";
import AppRail from "@/components/AppRail";

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
        <div className="app-frame">
          <AppRail />
          <div className="app-view">{children}</div>
        </div>
      </body>
    </html>
  );
}
