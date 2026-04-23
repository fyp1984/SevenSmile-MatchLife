import { useEffect, useState } from 'react';
import { X, Download, Share2 } from 'lucide-react';
import { generateShareCard, downloadImage, type ShareCardData } from '../lib/shareCard';
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
  const isWechat = getIsWechatBrowser();

  useEffect(() => {
    if (isOpen && !cardImage) {
      generateCard();
    }
  }, [isOpen]);

  const generateCard = async () => {
    setIsGenerating(true);
    setError('');
    
    try {
      const imageUrl = await generateShareCard(data);
      setCardImage(imageUrl);

      if (isWechat) {
        configWechatShare({
          title: shareTitle,
          desc: shareDesc,
          link: shareUrl,
          imgUrl: imageUrl,
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
    
    const filename = `matchlife-share-${Date.now()}.png`;
    downloadImage(cardImage, filename);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-orange-100 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <h2 className="text-2xl font-bold text-brand-brown flex items-center gap-2">
            <Share2 className="w-6 h-6 text-orange-500" />
            分享到社交平台
          </h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-orange-50 hover:bg-orange-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-brand-brown" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin"></div>
              <p className="text-brand-gray">正在生成分享卡片...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600">
              {error}
            </div>
          )}

          {cardImage && !isGenerating && (
            <>
              <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-2xl p-4">
                <img
                  src={cardImage}
                  alt="分享卡片预览"
                  className="w-full rounded-xl shadow-lg"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                >
                  <Download className="w-5 h-5" />
                  保存图片
                </button>

                {isWechat && (
                  <button
                    onClick={() => {
                      alert('请点击右上角菜单，选择"分享到朋友圈"或"发送给朋友"');
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                  >
                    <Share2 className="w-5 h-5" />
                    微信分享
                  </button>
                )}
              </div>

              <div className="bg-orange-50 rounded-2xl p-4 space-y-3">
                <h3 className="font-bold text-brand-brown">扫码查看详情</h3>
                <div className="flex items-center justify-center">
                  <QRCode value={shareUrl} size={160} />
                </div>
                <p className="text-sm text-brand-gray text-center">
                  使用微信扫描二维码查看完整内容
                </p>
              </div>

              {!isWechat && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-700">
                  <p className="font-bold mb-1">提示</p>
                  <p>在微信中打开可使用微信分享功能，当前环境仅支持保存图片。</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
