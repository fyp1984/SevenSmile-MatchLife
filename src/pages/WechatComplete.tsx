import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { markWechatAccess, sanitizeNextPath } from '../lib/wechatAccess';

export default function WechatComplete() {
  const nav = useNavigate();
  const loc = useLocation();
  const [message, setMessage] = useState('正在为你确认访问资格...');
  const magicLinkConsumeUrl = `${import.meta.env.BASE_URL}api/wechat/magic-link/consume`;

  const { ok, next, ticket } = useMemo(() => {
    const params = new URLSearchParams(loc.search);
    return {
      ok: params.get('ok'),
      next: sanitizeNextPath(params.get('next')),
      ticket: params.get('ticket') || '',
    };
  }, [loc.search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (ticket) {
        try {
          const res = await fetch(`${magicLinkConsumeUrl}?ticket=${encodeURIComponent(ticket)}`);
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json?.ok) {
            if (!cancelled) {
              const target = json?.redirectToFollow
                ? `/follow?next=${encodeURIComponent(next)}`
                : `/gate/wechat?next=${encodeURIComponent(next)}`;
              setMessage(json?.error || '当前链接已失效，正在带你返回...');
              window.setTimeout(() => {
                nav(target, { replace: true });
              }, 800);
            }
            return;
          }
          markWechatAccess(
            `${json?.version || import.meta.env.VITE_WECHAT_ACCESS_VERSION || new Date().toISOString().slice(0, 10)}`
          );
          if (!cancelled) nav(sanitizeNextPath(json?.next || next), { replace: true });
          return;
        } catch {
          if (!cancelled) {
            setMessage('暂时没能完成验证，正在带你返回...');
            window.setTimeout(() => {
              nav(`/gate/wechat?next=${encodeURIComponent(next)}`, { replace: true });
            }, 800);
          }
          return;
        }
      }

      if (ok === '1') {
        markWechatAccess(
          `${import.meta.env.VITE_WECHAT_ACCESS_VERSION || new Date().toISOString().slice(0, 10)}`
        );
        nav(next, { replace: true });
        return;
      }
      nav(`/gate/wechat?next=${encodeURIComponent(next)}`, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [ok, next, ticket, nav]);

  return (
    <div className="mx-auto max-w-lg pt-12">
      <div className="rounded-3xl border border-orange-100 bg-white/80 p-8 text-center shadow-sm backdrop-blur-sm">
        <div className="text-lg font-bold text-orange-500">{message}</div>
      </div>
    </div>
  );
}
