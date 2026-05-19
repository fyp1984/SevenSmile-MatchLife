import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  buildWechatNextPath,
  buildWechatOauthStartUrl,
  buildWechatSessionStatusUrl,
  clearWechatAccess,
  hasWechatAccess,
  isBypassWechatAccess,
  isWechatIntermediateRoute,
  isWechatUA,
  markWechatAccess,
} from '../lib/wechatAccess';
import Layout from './Layout';

export default function WechatProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [guardState, setGuardState] = useState<'checking' | 'allowed' | 'oauth' | 'gate' | 'follow'>('checking');
  const isWechatWhitelistRoute = useMemo(
    () => location.pathname === '/gate' || isWechatIntermediateRoute(location.pathname),
    [location.pathname]
  );

  const next = useMemo(
    () => buildWechatNextPath(location.pathname, location.search),
    [location.pathname, location.search]
  );

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (isWechatWhitelistRoute) {
        setGuardState('allowed');
        return;
      }

      if (isBypassWechatAccess(import.meta.env.MODE)) {
        setGuardState('allowed');
        return;
      }

      if (!hasWechatAccess(import.meta.env.VITE_WECHAT_ACCESS_VERSION, import.meta.env.MODE)) {
        clearWechatAccess();
        setGuardState(isWechatUA() ? 'oauth' : 'gate');
        return;
      }

      try {
        const resp = await fetch(buildWechatSessionStatusUrl(import.meta.env.BASE_URL), {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const data = (await resp.json().catch(() => ({}))) as {
          ok?: boolean;
          version?: string;
          redirectToFollow?: boolean;
        };
        if (cancelled) return;
        if (resp.ok && data?.ok) {
          markWechatAccess(
            data.version ||
              `${import.meta.env.VITE_WECHAT_ACCESS_VERSION || new Date().toISOString().slice(0, 10)}`
          );
          setGuardState('allowed');
          return;
        }
        clearWechatAccess();
        setGuardState(data?.redirectToFollow ? 'follow' : isWechatUA() ? 'oauth' : 'gate');
      } catch {
        if (cancelled) return;
        clearWechatAccess();
        setGuardState(isWechatUA() ? 'oauth' : 'gate');
      }
    }

    setGuardState('checking');
    void verify();
    return () => {
      cancelled = true;
    };
  }, [isWechatWhitelistRoute, location.pathname, next]);

  useEffect(() => {
    if (isWechatWhitelistRoute) return;
    if (guardState === 'allowed' || guardState === 'checking') return;
    if (guardState === 'oauth') {
      window.location.href = buildWechatOauthStartUrl(import.meta.env.BASE_URL, next);
      return;
    }
    if (guardState === 'follow') {
      navigate(`/follow?next=${encodeURIComponent(next)}`, { replace: true });
      return;
    }
    navigate(`/gate/wechat?next=${encodeURIComponent(next)}`, { replace: true });
  }, [guardState, isWechatWhitelistRoute, navigate, next]);

  if (guardState !== 'allowed') {
    return <div className="p-20 text-center text-orange-500 font-bold">正在校验公众号访问权限...</div>;
  }
  return <Layout />;
}
