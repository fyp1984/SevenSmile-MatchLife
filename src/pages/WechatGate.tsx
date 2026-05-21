import React, { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { sanitizeNextPath } from '../lib/wechatAccess';
import FollowQrModal from '../components/FollowQrModal';

function isWeChat() {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('micromessenger');
}

export default function WechatGate() {
  const loc = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [followModalOpen, setFollowModalOpen] = useState(false);
  const oauthStartUrl = `${import.meta.env.BASE_URL}api/wechat/oauth-start`;

  const next = useMemo(() => {
    const params = new URLSearchParams(loc.search);
    return sanitizeNextPath(params.get('next'));
  }, [loc.search]);

  return (
    <div className="max-w-lg mx-auto pt-10">
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-orange-50 p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-extrabold text-brand-brown mb-2">关注验证</h1>
        <p className="mb-5 text-sm text-brand-gray">请先关注服务号，再进入系统使用完整功能。</p>

        {!isWeChat() && (
          <div className="mb-4 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-medium text-yellow-800">
            当前不在微信内，请先扫码关注，再使用微信进入系统。
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-left text-sm text-brand-gray">
            <div className="font-bold text-brand-brown">推荐先关注服务号</div>
            <div className="mt-1 leading-6">扫码关注后，使用微信访问即可完成验证。</div>
            <div className="text-xs text-brand-gray/90">首页检索和使用文档可直接查看，其他页面需先完成关注验证。</div>
          </div>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setFollowModalOpen(true);
            }}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all"
          >
            关注服务号后访问系统
          </button>
        </div>
      </div>

      <FollowQrModal
        open={followModalOpen}
        onClose={() => setFollowModalOpen(false)}
        description="先扫码关注“七笑果-文体中心”，后续消息和入口都会更方便。"
        footerText={isWeChat() ? '已关注后，点击下方按钮完成进入。' : '请先在微信中扫码关注，再回到这里继续。'}
        actionLabel={isWeChat() ? '我已关注，继续进入' : undefined}
        onAction={
          isWeChat()
            ? () => {
                setFollowModalOpen(false);
                window.location.href = `${oauthStartUrl}?next=${encodeURIComponent(next)}`;
              }
            : undefined
        }
      />
    </div>
  );
}
