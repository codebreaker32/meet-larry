import type { QRCodeToDataURLOptions } from "qrcode";
import { QR_COLORS } from "@/lib/tokens";

// The qrcode library draws to a canvas, so it needs literal colours: QR_COLORS mirrors --ink and
// --paper from globals.css. Level L keeps the code at the lowest version a phone camera reads easily.
export const QR_OPTIONS: QRCodeToDataURLOptions = {
  margin: 1,
  errorCorrectionLevel: "L",
  color: { ...QR_COLORS },
};
