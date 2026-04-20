import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function b64url(input: string) {
  const b64 = btoa(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeNext(next: string | null) {
  const v = (next || "/").trim();
  if (!v.startsWith("/")) return "/";
  return v;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  const url = new URL(req.url);
  const appid = Deno.env.get("WECHAT_MP_APPID") || "";
  const callbackBase =
    Deno.env.get("WECHAT_CALLBACK_BASE") ||
    `https://${url.hostname}/functions/v1/wechat-oauth-callback`;

  if (!appid) {
    return new Response(JSON.stringify({ error: "Missing WECHAT_MP_APPID" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  const next = safeNext(url.searchParams.get("next"));
  const state = b64url(JSON.stringify({ next, t: Date.now() }));

  const redirectUri = encodeURIComponent(callbackBase);
  const authUrl =
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(appid)}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code&scope=snsapi_base&state=${encodeURIComponent(state)}#wechat_redirect`;

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders(),
      Location: authUrl,
    },
  });
});

