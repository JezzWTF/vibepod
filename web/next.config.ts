import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// One version for every build: desktop/package.json. Anything but the packaged build is a dev run.
const { version } = JSON.parse(readFileSync("../desktop/package.json", "utf8"));

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VIBEPOD_VERSION:
      process.env.VIBEPOD_DESKTOP_BUILD === "1" ? `v${version}` : `v${version} dev`,
  },
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
