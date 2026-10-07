import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
type Context = { params: Promise<{ path: string[] }> };
async function forward(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return proxy(request, `voices/${path.map(encodeURIComponent).join("/")}`);
}
export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
