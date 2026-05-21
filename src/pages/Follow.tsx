import React from 'react';
import { useLocation } from 'react-router-dom';
import { sanitizeNextPath } from '../lib/wechatAccess';

export default function Follow() {
  const location = useLocation();
  const next = sanitizeNextPath(new URLSearchParams(location.search).get('next'));
  const oauthStartUrl = `${import.meta.env.BASE_URL}api/wechat/oauth-start?next=${encodeURIComponent(next)}`;

  return (
    <div className="max-w-lg mx-auto pt-10">
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-orange-50 p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-extrabold text-brand-brown mb-2">请先关注服务号</h1>
        <p className="mb-5 text-sm text-brand-gray">
          先关注“七笑果-文体中心”，再回来完成进入。
        </p>

        <div className="rounded-3xl border border-orange-100 bg-orange-50 p-5 text-left">
          <div className="mb-2 font-bold text-brand-brown">进入方式</div>
          <div className="space-y-1 text-sm text-brand-gray">
            <div>1. 在微信里关注“七笑果-文体中心”</div>
            <div>2. 关注后点击下方按钮继续进入</div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <a
            href={oauthStartUrl}
            className="block w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all text-center"
          >
            我已关注，继续进入
          </a>
        </div>
      </div>
    </div>
  );
}
