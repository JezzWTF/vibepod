import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxy(request, `voices/${path.map(encodeURIComponent).join("/")}`);
}
