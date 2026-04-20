import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

type WechatOauthResp = {
  errcode?: number;
  errmsg?: string;
  openid?: string;
};

type WechatTokenResp = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

type WechatUserInfoResp = {
  errcode?: number;
  errmsg?: string;
  subscribe?: number;
  openid?: string;
};

const ACCESS_COOKIE = "matchlife_wechat_ok";
const ACCESS_COOKIE_TTL = 7 * 24 * 60 * 60;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function b64urlDecode(input: string) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

function safeNext(next: unknown) {
  const v = String(next || "/").trim();
  if (!v.startsWith("/")) return "/";
  return v;
}

function normalizeBasePath(input: string) {
  const v = String(input || "/").trim();
  if (!v || v === "/") return "";
  return `/${v.replace(/^\/+|\/+$/g, "")}`;
}

function toAppUrl(origin: string, path: string) {
  const basePath = normalizeBasePath(Deno.env.get("APP_BASE_PATH") || "/");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${basePath}${normalizedPath}`;
}

function accessCookie(enabled: boolean) {
  const path = normalizeBasePath(Deno.env.get("APP_BASE_PATH") || "/") || "/";
  const maxAge = enabled ? ACCESS_COOKIE_TTL : 0;
  const value = enabled ? "1" : "";
  return `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`;
}

let cachedMpToken: { token: string; expiresAt: number } | null = null;

async function getMpAccessToken(appid: string, secret: string) {
  const now = Date.now();
  if (cachedMpToken && cachedMpToken.expiresAt > now + 30_000) {
    return cachedMpToken.token;
  }

  const url =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}` +
    `&secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const json = (await res.json()) as WechatTokenResp;
  if (!res.ok || json.errcode || !json.access_token) {
    throw new Error(json.errmsg || `Get mp access_token failed: ${res.status}`);
  }

  const expiresIn = Number(json.expires_in || 7200) * 1000;
  cachedMpToken = { token: json.access_token, expiresAt: now + expiresIn };
  return json.access_token;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const appid = Deno.env.get("WECHAT_MP_APPID") || "";
  const secret = Deno.env.get("WECHAT_MP_SECRET") || "";
  const appOrigin = Deno.env.get("APP_ORIGIN") || "";

  if (!appid || !secret || !appOrigin) {
    return new Response(
      JSON.stringify({
        error: "Missing secrets",
        missing: {
          WECHAT_MP_APPID: !appid,
          WECHAT_MP_SECRET: !secret,
          APP_ORIGIN: !appOrigin,
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } },
    );
  }

  const decodedState = (() => {
    try {
      return JSON.parse(b64urlDecode(state || ""));
    } catch {
      return {};
    }
  })();
  const next = safeNext(decodedState?.next);

  const goFollow = toAppUrl(appOrigin, "/follow");
  const goOk = new URL(toAppUrl(appOrigin, "/wechat/complete"));
  goOk.searchParams.set("ok", "1");
  goOk.searchParams.set("next", next);

  if (!code) {
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders(), Location: goFollow, "Set-Cookie": accessCookie(false) },
    });
  }

  try {
    const oauthUrl =
      `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&code=${encodeURIComponent(code)}` +
      `&grant_type=authorization_code`;
    const oauthRes = await fetch(oauthUrl);
    const oauthJson = (await oauthRes.json()) as WechatOauthResp;
    if (!oauthRes.ok || oauthJson.errcode || !oauthJson.openid) {
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders(), Location: goFollow, "Set-Cookie": accessCookie(false) },
      });
    }

    const openid = oauthJson.openid;
    const mpToken = await getMpAccessToken(appid, secret);

    const userInfoUrl =
      `https://api.weixin.qq.com/cgi-bin/user/info?access_token=${encodeURIComponent(mpToken)}` +
      `&openid=${encodeURIComponent(openid)}&lang=zh_CN`;
    const userRes = await fetch(userInfoUrl);
    const userJson = (await userRes.json()) as WechatUserInfoResp;
    if (!userRes.ok || userJson.errcode) {
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders(), Location: goFollow, "Set-Cookie": accessCookie(false) },
      });
    }

    if (Number(userJson.subscribe) === 1) {
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders(), Location: goOk.toString(), "Set-Cookie": accessCookie(true) },
      });
    }

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders(), Location: goFollow, "Set-Cookie": accessCookie(false) },
    });
  } catch {
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders(), Location: goFollow, "Set-Cookie": accessCookie(false) },
    });
  }
});
