import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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

  const next = useMemo(() => {
    const params = new URLSearchParams(loc.search);
    return params.get('next') || '/';
  }, [loc.search]);

  return (
    <div className="max-w-lg mx-auto pt-10">
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-sm border border-orange-50">
        <h1 className="text-2xl font-extrabold text-brand-brown mb-2">关注验证</h1>
        <p className="text-sm text-brand-gray mb-6">
          仅限关注“七笑果-文体有料”公众号的用户访问。最佳体验是在公众号内回复关键词“比赛生涯”获取直达链接；如未能直接打开，再使用访问码作为兜底验证。
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
          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-sm text-brand-gray">
            <div className="font-bold text-brand-brown mb-1">推荐进入方式</div>
            <div>1. 关注公众号“七笑果-文体有料”</div>
            <div>2. 回复关键词“比赛生涯”</div>
            <div>3. 点击公众号返回的直达链接，无需手输访问码</div>
            <div className="mt-2 text-xs">若链接过期或无法打开，再使用下方访问码输入框兜底进入。</div>
          </div>

          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="请输入公众号回复的访问码"
            className="w-full px-4 py-3 rounded-2xl border border-orange-100 bg-white text-brand-brown outline-none focus:border-orange-300"
          />

          <button
            onClick={async () => {
              setError(null);
              if (isLocalhost()) {
                sessionStorage.setItem('matchlife_wechat_ok', '1');
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
                sessionStorage.setItem(
                  'matchlife_wechat_ok',
                  `${json?.version || import.meta.env.VITE_WECHAT_ACCESS_VERSION || new Date().toISOString().slice(0, 10)}`
                );
                nav(json?.next || next, { replace: true });
              } catch {
                setError('验证失败，请稍后重试');
              } finally {
                setSubmitting(false);
              }
            }}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? '验证中...' : '输入访问码进入'}
          </button>
        </div>
      </div>
    </div>
  );
}
