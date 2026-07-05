import { useEffect, useRef } from "react";
import SignaturePad from "signature_pad";

/**
 * Touch/mouse signature capture. Emits a PNG data URL on every stroke end
 * (empty string when cleared) so the parent can gate submission on presence.
 */
export default function SignatureField({
  label,
  onChange,
}: {
  label: string;
  onChange: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Scale the backing store for the device pixel ratio so strokes stay crisp.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      padRef.current?.clear();
    };
    resize();

    const pad = new SignaturePad(canvas, { backgroundColor: "rgba(255,255,255,1)" });
    padRef.current = pad;
    pad.addEventListener("endStroke", () => onChange(pad.isEmpty() ? "" : pad.toDataURL("image/png")));

    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      pad.off();
    };
  }, [onChange]);

  const clear = () => {
    padRef.current?.clear();
    onChange("");
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <button type="button" onClick={clear} className="text-xs text-blue-600 hover:text-blue-800">
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-lg border border-slate-300 bg-white"
        style={{ touchAction: "none" }}
      />
    </div>
  );
}

/** Converts a PNG data URL (from SignaturePad.toDataURL) to a Blob for multipart upload. */
export function dataUrlToPngBlob(dataUrl: string): Blob {
  const [, base64] = dataUrl.split(",");
  const bytes = atob(base64 ?? "");
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: "image/png" });
}
