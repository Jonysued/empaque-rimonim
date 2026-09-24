import React, { useState, useRef, useEffect } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Keyboard, X } from "lucide-react";

/**
 * Escáner QR: usa el decodificador nativo si el navegador lo soporta,
 * y si no (iPhone/Safari/Chrome iOS) decodifica por software con jsQR.
 * Fallback a entrada manual si la cámara no está disponible.
 * Props: onScan(code), label
 */
export default function QRScanner({ onScan, label = "Escanear QR" }) {
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    async function start() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("camera_unavailable");
        }
        if ("BarcodeDetector" in window) {
          // @ts-ignore
          detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
        } else {
          canvasRef.current = document.createElement("canvas");
          ctxRef.current = canvasRef.current.getContext("2d", { willReadFrequently: true });
        }
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } }
        });
        if (cancelled) {
          streamRef.current.getTracks().forEach(t => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          await videoRef.current.play();
          tick();
        }
      } catch {
        if (cancelled) return;
        setScanning(false);
        setManual(true);
        setError("No se pudo acceder a la cámara. Verificá que el navegador tenga permiso de cámara. Podés ingresar el código manualmente.");
      }
    }

    async function tick() {
      if (cancelled || !videoRef.current) return;
      try {
        if (detectorRef.current) {
          const codes = await detectorRef.current.detect(videoRef.current);
          if (codes && codes.length > 0) {
            handleScan(codes[0].rawValue);
            return;
          }
        } else if (videoRef.current.readyState >= videoRef.current.HAVE_ENOUGH_DATA) {
          const vw = videoRef.current.videoWidth;
          const vh = videoRef.current.videoHeight;
          if (vw && vh) {
            const scale = Math.min(1, 480 / Math.max(vw, vh));
            canvasRef.current.width = Math.round(vw * scale);
            canvasRef.current.height = Math.round(vh * scale);
            ctxRef.current.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
            const img = ctxRef.current.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
            const res = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (res && res.data) {
              handleScan(res.data);
              return;
            }
          }
        }
      } catch { /* ignore frame errors */ }
      rafRef.current = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      detectorRef.current = null;
    };

  }, [scanning]);

  function handleScan(val) {
    setScanning(false);
    setManual(false);
    setError("");
    if (onScan) onScan(val);
  }

  function submitManual(e) {
    e.preventDefault();
    if (!code.trim()) return;
    handleScan(code.trim());
    setCode("");
  }

  if (!scanning && !manual) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" size="lg" className="h-14 text-base" onClick={() => setScanning(true)}>
          <ScanLine className="w-5 h-5 mr-2" /> {label}
        </Button>
        <Button type="button" variant="outline" onClick={() => { setManual(true); setError(""); }}>
          <Keyboard className="w-4 h-4 mr-2" /> Ingresar código manualmente
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{manual ? "Ingreso manual" : "Escaneando…"}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setScanning(false); setManual(false); setError(""); }}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      {scanning && (
        <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
          <div className="absolute inset-8 border-2 border-white/70 rounded-xl pointer-events-none" />
        </div>
      )}
      {manual && (
        <form onSubmit={submitManual} className="flex gap-2">
          <Input
            autoFocus
            placeholder="Ej: RIM-XXXXX o ROM-2026-00001"
            value={code}
            onChange={e => setCode(e.target.value)}
          />
          <Button type="submit">Confirmar</Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
