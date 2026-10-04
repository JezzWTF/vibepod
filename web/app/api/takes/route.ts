import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
export const GET = (r: NextRequest) => proxy(r, "takes");
export const POST = GET;
