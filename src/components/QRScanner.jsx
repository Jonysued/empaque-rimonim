import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Keyboard, X, Camera } from "lucide-react";

/**
 * Escáner QR: usa BarcodeDetector nativo si está disponible, con fallback a entrada manual.
 * Props: onScan(code), label
 */
export default function QRScanner({ onScan, label = "Escanear QR" }) {
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    async function start() {
      try {
        if (!("BarcodeDetector" in window)) {
          setError("La cámara QR no está disponible en este navegador. Use entrada manual.");
          setManual(true);
          return;
        }
        // @ts-ignore
        detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }
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
      } catch (e) {
        setError("No se pudo acceder a la cámara. Use entrada manual.");
        setManual(true);
      }
    }

    async function tick() {
      if (!detectorRef.current || !videoRef.current || cancelled) return;
      try {
        const codes = await detectorRef.current.detect(videoRef.current);
        if (codes && codes.length > 0) {
          const val = codes[0].rawValue;
          handleScan(val);
          return;
        }
      } catch (e) { /* ignore frame errors */ }
      rafRef.current = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line
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
      {scanning && supported && (
        <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
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
      {!supported && scanning && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Camera className="w-4 h-4" /> Cámara no soportada en este navegador. Use entrada manual.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}