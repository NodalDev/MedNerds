import { QRCodeSVG } from 'qrcode.react';

export default function SessionQrCode({ url, label }: { url: string; label: string }) {
  return <div className="osce-live__qr" role="img" aria-label={label}>
    <QRCodeSVG value={url} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" size={192} aria-hidden="true" />
  </div>;
}
