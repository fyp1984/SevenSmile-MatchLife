import { QRCodeSVG } from 'qrcode.react';

interface QRCodeProps {
  value: string;
  size?: number;
  level?: 'L' | 'M' | 'Q' | 'H';
  fgColor?: string;
  bgColor?: string;
}

export default function QRCode({
  value,
  size = 128,
  level = 'M',
  fgColor = '#4A2311',
  bgColor = '#FFFFFF',
}: QRCodeProps) {
  return (
    <div className="inline-block p-2 bg-white rounded-lg">
      <QRCodeSVG
        value={value}
        size={size}
        level={level}
        fgColor={fgColor}
        bgColor={bgColor}
      />
    </div>
  );
}
