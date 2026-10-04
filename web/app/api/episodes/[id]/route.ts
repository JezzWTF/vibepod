import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxy(request, `episodes/${encodeURIComponent(id)}`);
}
export const PUT = GET;
