import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path } = await context.params;
  return proxy(request, `episodes/${[id, ...path].map(encodeURIComponent).join("/")}`);
}
export const POST = GET;
