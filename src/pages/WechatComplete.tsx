import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function WechatComplete() {
  const nav = useNavigate();
  const loc = useLocation();
  const [message, setMessage] = useState('正在验证身份...');
  const magicLinkConsumeUrl = `${import.meta.env.BASE_URL}api/wechat/magic-link/consume`;

  const { ok, next, ticket } = useMemo(() => {
    const params = new URLSearchParams(loc.search);
    return {
      ok: params.get('ok'),
      next: params.get('next') || '/',
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
              setMessage(json?.error || '链接已失效，正在返回验证页...');
              window.setTimeout(() => {
                nav(`/gate/wechat?next=${encodeURIComponent(next)}`, { replace: true });
              }, 800);
            }
            return;
          }
          sessionStorage.setItem(
            'matchlife_wechat_ok',
            `${json?.version || import.meta.env.VITE_WECHAT_ACCESS_VERSION || new Date().toISOString().slice(0, 10)}`
          );
          if (!cancelled) nav(json?.next || next, { replace: true });
          return;
        } catch {
          if (!cancelled) {
            setMessage('验证失败，正在返回验证页...');
            window.setTimeout(() => {
              nav(`/gate/wechat?next=${encodeURIComponent(next)}`, { replace: true });
            }, 800);
          }
          return;
        }
      }

      if (ok === '1') {
        sessionStorage.setItem(
          'matchlife_wechat_ok',
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
    <div className="p-20 text-center text-orange-500 font-bold">{message}</div>
  );
}
