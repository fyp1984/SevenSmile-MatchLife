import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { sanitizeNextPath } from '../lib/wechatAccess';

export default function Follow() {
  const location = useLocation();
  const next = sanitizeNextPath(new URLSearchParams(location.search).get('next'));
  const oauthStartUrl = `${import.meta.env.BASE_URL}api/wechat/oauth-start?next=${encodeURIComponent(next)}`;

  return (
    <div className="max-w-lg mx-auto pt-10">
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-sm border border-orange-50">
        <h1 className="text-2xl font-extrabold text-brand-brown mb-2">请先关注服务号</h1>
        <p className="text-sm text-brand-gray mb-6">
          该系统仅限关注“七笑果-文体有料”服务号的用户访问。请先在微信内完成关注，再点击下方按钮重新验证；若自动验证异常，可后台留言获取访问码。
        </p>

        <div className="bg-orange-50 border border-orange-100 rounded-3xl p-6 text-left">
          <div className="text-brand-brown font-bold mb-2">操作步骤</div>
          <div className="text-sm text-brand-gray">
            1. 在微信中搜索并关注服务号：七笑果-文体有料
            <br />
            2. 关注完成后点击下方“重新验证进入”
            <br />
            3. 若授权异常，可后台留言，获取访问码
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <a
            href={oauthStartUrl}
            className="block w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all text-center"
          >
            重新验证进入
          </a>
          <Link
            to={`/gate/wechat?next=${encodeURIComponent(next)}`}
            className="block w-full border border-orange-200 text-brand-brown py-3 rounded-full font-bold text-center hover:bg-orange-50 transition-all"
          >
            使用直达链接/访问码兜底
          </Link>
        </div>
      </div>
    </div>
  );
}
