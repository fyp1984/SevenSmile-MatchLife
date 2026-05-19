import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildWechatOauthStartUrl, hasWechatAccess, isWechatUA } from '../lib/wechatAccess';
import Layout from './Layout';

export default function WechatProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const whitelist = useMemo(
    () => new Set(['/gate', '/gate/wechat', '/wechat/complete', '/follow']),
    []
  );

  const shouldGuard = useMemo(() => {
    if (whitelist.has(location.pathname)) return false;
    if (hasWechatAccess(import.meta.env.VITE_WECHAT_ACCESS_VERSION, import.meta.env.MODE)) return false;
    return true;
  }, [location.pathname, whitelist]);

  useEffect(() => {
    if (!shouldGuard) return;
    const next = `${location.pathname}${location.search || ''}`;
    if (isWechatUA()) {
      window.location.href = buildWechatOauthStartUrl(import.meta.env.BASE_URL, next);
      return;
    }
    navigate(`/gate/wechat?next=${encodeURIComponent(next)}`, { replace: true });
  }, [location.pathname, location.search, navigate, shouldGuard]);

  if (shouldGuard) {
    return <div className="p-20 text-center text-orange-500 font-bold">正在校验公众号访问权限...</div>;
  }
  return <Layout />;
}
