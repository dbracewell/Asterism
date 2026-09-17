import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

const handler = async (request: Request) => getAuth().handler(request);

export const { POST, GET } = toNextJsHandler(handler);
