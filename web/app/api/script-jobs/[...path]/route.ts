import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
export async function GET(r: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(r, `script-jobs/${path.map(encodeURIComponent).join("/")}`);
}
export const POST = GET;
