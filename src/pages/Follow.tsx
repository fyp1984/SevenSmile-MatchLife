import React from 'react';

export default function Follow() {
  return (
    <div className="max-w-lg mx-auto pt-10">
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-sm border border-orange-50">
        <h1 className="text-2xl font-extrabold text-brand-brown mb-2">请先关注并获取访问码</h1>
        <p className="text-sm text-brand-gray mb-6">
          该系统仅限关注“七笑果-文体有料”公众号的用户访问。关注后请回复关键词“比赛生涯”获取访问码，再返回系统验证进入。
        </p>

        <div className="bg-orange-50 border border-orange-100 rounded-3xl p-6 text-center">
          <div className="text-brand-brown font-bold mb-2">操作步骤</div>
          <div className="text-sm text-brand-gray">
            1. 在微信中搜索并关注公众号：七笑果-文体有料
            <br />
            2. 在公众号对话框回复：比赛生涯
            <br />
            3. 获取访问码后，返回验证页输入即可进入
          </div>
        </div>
      </div>
    </div>
  );
}
