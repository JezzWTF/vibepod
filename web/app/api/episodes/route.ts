import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
export const GET = (request: NextRequest) => proxy(request, "episodes");
export const POST = GET;
