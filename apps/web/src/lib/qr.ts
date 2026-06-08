// QR code generation for printed worksheets — encodes an in-app deep link
// (listening playback / speaking recording) as a data-URL PNG.
import QRCode from 'qrcode';

export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 160,
    color: { dark: '#1A1A1A', light: '#FFFFFF' },
  });
}
