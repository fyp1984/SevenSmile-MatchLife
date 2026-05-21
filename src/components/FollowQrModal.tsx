import { X } from 'lucide-react';

type FollowQrModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footerText?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function FollowQrModal({
  open,
  onClose,
  title = '关注服务号',
  description = '微信扫码关注“七笑果-文体中心”，后续消息和入口都会在这里。',
  footerText = '扫码后即可在公众号内继续查看。',
  actionLabel,
  onAction,
}: FollowQrModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[28px] border border-orange-100 bg-white p-5 shadow-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-brand-brown">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-brand-gray">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-brand-brown transition-colors hover:bg-orange-100"
            aria-label="关闭关注提示"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-3xl border border-orange-100 bg-gradient-to-b from-orange-50 to-white p-4">
          <img
            src={`${import.meta.env.BASE_URL}sevensmile-wechat-qrcode.jpg`}
            alt="七笑果-文体中心公众号二维码"
            className="mx-auto w-full max-w-[280px] rounded-2xl bg-white"
          />
        </div>

        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-4 w-full rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:from-orange-400 hover:to-red-400 hover:shadow-lg"
          >
            {actionLabel}
          </button>
        ) : null}

        <p className="mt-4 text-center text-xs leading-5 text-brand-gray">{footerText}</p>
      </div>
    </div>
  );
}
