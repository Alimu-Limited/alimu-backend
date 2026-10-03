export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-auth-token, x-paystack-signature, x-squad-encrypted-body, x-squad-signature",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function text(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

export function html(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html" },
  });
}

/** Returns an OPTIONS short-circuit response, or null when the request is real. */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

/**
 * The path segment AFTER the function name, so a function named `hotspot` maps
 * `.../functions/v1/hotspot/api/mikrotik-queue-text` to `/api/mikrotik-queue-text`.
 * Handles both the deployed shape and the local `serve` shape.
 */
export function routePath(req: Request): string {
  const seg = new URL(req.url).pathname.split("/").filter((s) => s.length > 0);
  if (seg[0] === "functions" && seg[1] === "v1") {
    return "/" + seg.slice(3).join("/");
  }
  return "/" + seg.slice(1).join("/");
}

export function queryParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

/** Raw body text, needed for HMAC verification before JSON parsing. */
export async function rawBody(req: Request): Promise<string> {
  return await req.text();
}
