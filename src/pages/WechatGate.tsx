import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { expectedWechatAccessVersion, markWechatAccess, sanitizeNextPath } from '../lib/wechatAccess';

function isLocalhost() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function isWeChat() {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('micromessenger');
}

export default function WechatGate() {
  const loc = useLocation();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const accessCodeVerifyUrl = `${import.meta.env.BASE_URL}api/wechat/access-code/verify`;
  const oauthStartUrl = `${import.meta.env.BASE_URL}api/wechat/oauth-start`;

  const next = useMemo(() => {
    const params = new URLSearchParams(loc.search);
    return sanitizeNextPath(params.get('next'));
  }, [loc.search]);

  return (
    <div className="max-w-lg mx-auto pt-10">
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-sm border border-orange-50">
        <h1 className="text-2xl font-extrabold text-brand-brown mb-2">关注验证</h1>
        <p className="text-sm text-brand-gray mb-6">
          仅限关注“七笑果-文体有料”服务号的用户访问。推荐在微信内直接完成服务号验证；若微信授权异常，可通过后台留言获取访问码进入。
        </p>

        {!isWeChat() && !isLocalhost() && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-2xl text-sm font-medium mb-5">
            当前不是微信环境。建议先在微信内关注公众号并获取访问码，再返回此页面输入。
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm font-medium mb-5">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-sm text-left text-brand-gray">
            <div className="font-bold text-brand-brown mb-1">推荐进入方式</div>
            <div>1. 在微信中关注服务号“七笑果-文体有料”</div>
            <div>2. 点击下方“微信内一键进入”完成服务号身份验证</div>
            <div>3. 若授权异常，可后台留言，获取访问码</div>
            <div className="mt-2 text-xs">访问码仅作为异常情况下的最后兜底方式。</div>
          </div>

          <button
            onClick={() => {
              setError(null);
              window.location.href = `${oauthStartUrl}?next=${encodeURIComponent(next)}`;
            }}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all"
          >
            微信内一键进入
          </button>

          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="请输入访问码（仅兜底使用）"
            className="w-full px-4 py-3 rounded-2xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300"
          />

          <button
            onClick={async () => {
              setError(null);
              if (isLocalhost()) {
                markWechatAccess(expectedWechatAccessVersion(import.meta.env.VITE_WECHAT_ACCESS_VERSION));
                nav(next, { replace: true });
                return;
              }
              const trimmed = code.trim();
              if (!trimmed) {
                setError('请输入访问码');
                return;
              }
              setSubmitting(true);
              try {
                const res = await fetch(accessCodeVerifyUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ code: trimmed, next }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || !json?.ok) {
                  setError(json?.error || '访问码错误或已过期');
                  return;
                }
                markWechatAccess(
                  `${json?.version || import.meta.env.VITE_WECHAT_ACCESS_VERSION || new Date().toISOString().slice(0, 10)}`
                );
                nav(sanitizeNextPath(json?.next || next), { replace: true });
              } catch {
                setError('验证失败，请稍后重试');
              } finally {
                setSubmitting(false);
              }
            }}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? '验证中...' : '使用访问码兜底进入'}
          </button>
        </div>
      </div>
    </div>
  );
}
