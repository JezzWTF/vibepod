import { NextRequest } from "next/server";
import { proxy } from "@/lib/proxy";
export const GET = (r: NextRequest) => proxy(r, "script-providers");
