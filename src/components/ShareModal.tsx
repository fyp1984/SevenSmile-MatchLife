import { useEffect, useMemo, useState } from 'react';
import { X, Download, Share2, Palette, Copy, Send, MessageCircleMore } from 'lucide-react';
import {
  generateShareCard,
  downloadImage,
  dataUrlToFile,
  type ShareCardData,
  type ShareCardTemplate,
} from '../lib/shareCard';
import { getIsWechatBrowser, configWechatShare } from '../lib/wechat';
import QRCode from './QRCode';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ShareCardData;
  shareUrl: string;
  shareTitle: string;
  shareDesc: string;
}

const TEMPLATES: Array<{ id: ShareCardTemplate; label: string; color: string }> = [
  { id: 'default', label: '活力橙', color: 'bg-orange-500' },
  { id: 'sports', label: '竞技蓝', color: 'bg-blue-600' },
  { id: 'minimal', label: '极简白', color: 'bg-gray-200 border border-gray-300' },
  { id: 'celebration', label: '荣耀金', color: 'bg-yellow-500' },
];

export default function ShareModal({
  isOpen,
  onClose,
  data,
  shareUrl,
  shareTitle,
  shareDesc,
}: ShareModalProps) {
  const [cardImage, setCardImage] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<ShareCardTemplate>('default');
  const [showWechatSaveGuide, setShowWechatSaveGuide] = useState(false);
  const [showWechatShareGuide, setShowWechatShareGuide] = useState<'friend' | 'timeline' | null>(null);
  const [notice, setNotice] = useState('');
  const isWechat = getIsWechatBrowser();
  const officialQrUrl =
    typeof window === 'undefined'
      ? `${import.meta.env.BASE_URL}sevensmile-wechat-qrcode.jpg`
      : `${window.location.origin}${import.meta.env.BASE_URL}sevensmile-wechat-qrcode.jpg`;
  const canShareImageFile = useMemo(() => {
    if (isWechat || !cardImage || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      return false;
    }

    try {
      const file = dataUrlToFile(cardImage, 'matchlife-share.png');
      return !navigator.canShare || navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  }, [cardImage, isWechat]);

  useEffect(() => {
    if (isOpen) {
      generateCard(selectedTemplate);
    }
  }, [isOpen, selectedTemplate]);

  const generateCard = async (template: ShareCardTemplate) => {
    setIsGenerating(true);
    setError('');
    
    try {
      const templateData = { ...data, template };
      const imageUrl = await generateShareCard(templateData);
      setCardImage(imageUrl);

      if (isWechat) {
        configWechatShare({
          title: shareTitle,
          desc: shareDesc,
          link: shareUrl,
          imgUrl: officialQrUrl,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成分享卡片失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!cardImage) return;

    if (isWechat) {
      setShowWechatSaveGuide(true);
      return;
    }

    const filename = `matchlife-share-${Date.now()}.png`;
    downloadImage(cardImage, filename);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice('链接已复制，可直接粘贴到微信、朋友圈或微博。');
    } catch {
      setNotice('复制失败，请长按或手动复制当前页面链接。');
    }
  };

  const handleNativeShare = async () => {
    const filename = `matchlife-share-${Date.now()}.png`;

    if (navigator.share && canShareImageFile) {
      try {
        const file = dataUrlToFile(cardImage, filename);
        await navigator.share({
          title: shareTitle,
          text: shareDesc,
          files: [file],
        });
        setNotice('已调起系统分享，当前分享图会优先随系统分享一起带出。');
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }

    setNotice('当前浏览器暂不支持直接分享图片，请先保存图片，再发到目标平台。');
  };

  const handleWeiboShare = () => {
    const weiboUrl = new URL('https://service.weibo.com/share/share.php');
    weiboUrl.searchParams.set('title', `${shareTitle} ${shareDesc}`);
    weiboUrl.searchParams.set('url', shareUrl);
    window.open(weiboUrl.toString(), '_blank', 'noopener,noreferrer');
    setNotice('已打开微博分享页；如需带图发布，可先保存这张已带公众号二维码的分享图。');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full my-auto flex flex-col relative" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-orange-100 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between rounded-t-3xl">
          <h2 className="text-2xl font-bold text-brand-brown flex items-center gap-2">
            <Share2 className="w-6 h-6 text-orange-500" />
            分享这条内容
          </h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-orange-50 hover:bg-orange-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-brand-brown" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto">
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin"></div>
              <p className="text-brand-gray">正在准备分享图...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600">
              {error}
            </div>
          )}

          {cardImage && !isGenerating && (
            <>
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-2 sm:p-4">
                <img
                  src={cardImage}
                  alt="分享卡片预览"
                  className="w-full h-auto rounded-xl shadow-lg transition-all"
                  style={{ maxHeight: '40vh', objectFit: 'contain' }}
                />
              </div>

              <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-brand-gray">
                这张分享图已附带公众号二维码。普通浏览器可优先分享当前图片；微信内建议先保存图片，再发送给朋友或发朋友圈。
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3 text-sm font-bold text-brand-brown">
                  <Palette className="w-4 h-4 text-orange-500" />
                  选择风格
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => setSelectedTemplate(tpl.id)}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${
                        selectedTemplate === tpl.id
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-transparent hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full shadow-sm ${tpl.color}`} />
                      <span className={`text-xs font-bold ${
                        selectedTemplate === tpl.id ? 'text-orange-700' : 'text-brand-gray'
                      }`}>
                        {tpl.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2 border-t border-gray-100">
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                >
                  <Download className="w-5 h-5" />
                  {isWechat ? '查看大图并长按保存' : '保存到手机'}
                </button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {!isWechat && canShareImageFile && (
                    <button
                      onClick={handleNativeShare}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-brand-brown text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                    >
                      <Share2 className="w-5 h-5" />
                      分享当前图片
                    </button>
                  )}
                  {isWechat ? (
                    <>
                      <button
                        onClick={() => setShowWechatShareGuide('friend')}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                      >
                        <MessageCircleMore className="w-5 h-5" />
                        通过菜单发给朋友
                      </button>
                      <button
                        onClick={() => setShowWechatShareGuide('timeline')}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-500 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                      >
                        <Send className="w-5 h-5" />
                        通过菜单发朋友圈
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleWeiboShare}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-rose-500 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                    >
                      <Share2 className="w-5 h-5" />
                      发微博
                    </button>
                  )}
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center justify-center gap-2 px-6 py-3 border border-orange-200 text-brand-brown font-bold rounded-full hover:bg-orange-50 transition-all"
                  >
                    <Copy className="w-5 h-5" />
                    复制链接
                  </button>
                </div>

                {isWechat && (
                  <button
                    onClick={handleWeiboShare}
                    className="flex items-center justify-center gap-2 px-6 py-3 border border-rose-200 text-rose-600 font-bold rounded-full hover:bg-rose-50 transition-all"
                  >
                    <Share2 className="w-5 h-5" />
                    发微博
                  </button>
                )}

                {notice && (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    {notice}
                  </div>
                )}
              </div>

              <div className="bg-orange-50 rounded-2xl p-4 space-y-2 sm:space-y-3">
                <h3 className="font-bold text-brand-brown text-center text-sm sm:text-base">扫码继续查看</h3>
                <div className="flex items-center justify-center">
                  <QRCode value={shareUrl} size={140} />
                </div>
                <p className="text-xs sm:text-sm text-brand-gray text-center">
                  用微信扫码可继续查看完整内容
                </p>
              </div>

              {!isWechat && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-700">
                  <p className="font-bold mb-1">小提示</p>
                  <p>支持直接调起系统分享；若目标平台不接收图片，可先保存这张分享图再发布。</p>
                </div>
              )}
            </>
          )}
        </div>

        {showWechatSaveGuide && cardImage && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-extrabold text-brand-brown">长按图片保存</h3>
                  <p className="mt-1 text-sm leading-6 text-brand-gray">
                    微信内不支持直接下载文件，请长按下方图片后选择“保存到手机”。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWechatSaveGuide(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-50 text-brand-brown transition hover:bg-orange-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 rounded-2xl bg-orange-50 p-3">
                <img
                  src={cardImage}
                  alt="长按保存分享图"
                  className="w-full rounded-2xl bg-white shadow-sm"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowWechatSaveGuide(false)}
                className="mt-4 w-full rounded-full border border-orange-200 px-5 py-3 text-sm font-bold text-brand-brown transition hover:bg-orange-50"
              >
                我知道了
              </button>
            </div>
          </div>
        )}

        {showWechatShareGuide && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-extrabold text-brand-brown">
                    {showWechatShareGuide === 'friend' ? '转发给朋友' : '分享到朋友圈'}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-brand-gray">
                    {showWechatShareGuide === 'friend'
                      ? '请点右上角“...”，选择“发送给朋友”。'
                      : '请点右上角“...”，选择“分享到朋友圈”。'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWechatShareGuide(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-50 text-brand-brown transition hover:bg-orange-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50 p-4 text-sm text-brand-gray space-y-2">
                <p>1. 微信菜单这里分享的是页面卡片，不是当前这张图片。</p>
                <p>2. 如果你想发图片，请先回到上一步，长按保存这张分享图。</p>
                <p>3. 若菜单里未出现目标项，请先关闭当前弹层，再点右上角“...”。</p>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowWechatShareGuide(null);
                    setShowWechatSaveGuide(true);
                  }}
                  className="w-full rounded-full bg-brand-brown px-5 py-3 text-sm font-bold text-white transition hover:opacity-90"
                >
                  先看分享图
                </button>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full rounded-full border border-orange-200 px-5 py-3 text-sm font-bold text-brand-brown transition hover:bg-orange-50"
                >
                  再复制链接
                </button>
                <button
                  type="button"
                  onClick={() => setShowWechatShareGuide(null)}
                  className="w-full rounded-full border border-orange-200 px-5 py-3 text-sm font-bold text-brand-brown transition hover:bg-orange-50"
                >
                  我知道了
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
