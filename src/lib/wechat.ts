import wx from 'weixin-js-sdk';

interface WechatShareConfig {
  title: string;
  desc: string;
  link: string;
  imgUrl: string;
}

interface WechatConfigParams {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
}

let isWechatReady = false;
let isWechatBrowser = false;

export function checkIsWechatBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  isWechatBrowser = /micromessenger/.test(ua);
  return isWechatBrowser;
}

export function getIsWechatBrowser(): boolean {
  return isWechatBrowser;
}

export async function initWechatSDK(config: WechatConfigParams): Promise<boolean> {
  if (!checkIsWechatBrowser()) {
    console.warn('Not in WeChat browser, skipping SDK initialization');
    return false;
  }

  return new Promise((resolve) => {
    wx.config({
      debug: false,
      appId: config.appId,
      timestamp: config.timestamp,
      nonceStr: config.nonceStr,
      signature: config.signature,
      jsApiList: [
        'updateAppMessageShareData',
        'updateTimelineShareData',
        'onMenuShareTimeline',
        'onMenuShareAppMessage',
      ],
    });

    wx.ready(() => {
      isWechatReady = true;
      console.log('WeChat SDK initialized successfully');
      resolve(true);
    });

    wx.error((err: { errMsg: string }) => {
      console.error('WeChat SDK initialization failed:', err);
      isWechatReady = false;
      resolve(false);
    });
  });
}

export function shareToFriend(config: WechatShareConfig): void {
  if (!isWechatReady) {
    console.warn('WeChat SDK not ready');
    return;
  }

  wx.updateAppMessageShareData({
    title: config.title,
    desc: config.desc,
    link: config.link,
    imgUrl: config.imgUrl,
    success: () => {
      console.log('Share to friend config updated');
    },
    fail: (err: { errMsg: string }) => {
      console.error('Share to friend failed:', err);
    },
  });

  wx.onMenuShareAppMessage({
    title: config.title,
    desc: config.desc,
    link: config.link,
    imgUrl: config.imgUrl,
    success: () => {
      console.log('Share to friend success');
    },
    cancel: () => {
      console.log('Share to friend cancelled');
    },
  });
}

export function shareToTimeline(config: WechatShareConfig): void {
  if (!isWechatReady) {
    console.warn('WeChat SDK not ready');
    return;
  }

  wx.updateTimelineShareData({
    title: config.title,
    link: config.link,
    imgUrl: config.imgUrl,
    success: () => {
      console.log('Share to timeline config updated');
    },
    fail: (err: { errMsg: string }) => {
      console.error('Share to timeline failed:', err);
    },
  });

  wx.onMenuShareTimeline({
    title: config.title,
    link: config.link,
    imgUrl: config.imgUrl,
    success: () => {
      console.log('Share to timeline success');
    },
    cancel: () => {
      console.log('Share to timeline cancelled');
    },
  });
}

export function configWechatShare(config: WechatShareConfig): void {
  if (!isWechatReady) {
    console.warn('WeChat SDK not ready, cannot configure share');
    return;
  }

  shareToFriend(config);
  shareToTimeline(config);
}
