import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verify a production build without overwriting a running development preview.
  distDir:
    process.env.VIBEPOD_DESKTOP_BUILD === "1"
      ? ".next-desktop"
      : process.env.VIBEPOD_CHECK_BUILD === "1"
        ? ".next-check"
        : ".next",
  ...(process.env.VIBEPOD_DESKTOP_BUILD === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
