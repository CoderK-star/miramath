"use client";

import React, { useRef, useEffect, useState } from "react";

interface HandwritingCanvasProps {
  onCapture?: (imageBase64: string) => void;
  width?: number;
  height?: number;
}

const CAPTURE_PADDING = 16;
const JPEG_QUALITY = 0.82;

type InkBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const HandwritingCanvas: React.FC<HandwritingCanvasProps> = ({
  onCapture,
  width = 800,
  height = 400,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [lineWidth, setLineWidth] = useState(2);        // ペンの基本太さ
  const [eraserSize, setEraserSize] = useState(32);     // 消しゴムの基本サイズ
  const [lineColor, setLineColor] = useState("#000000");
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [isPointerInside, setIsPointerInside] = useState(false);

  function findInkBounds(canvas: HTMLCanvasElement): InkBounds | null {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        // 透明またはほぼ白は背景とみなし、筆跡だけを抽出する。
        const isInk = a > 16 && (r < 245 || g < 245 || b < 245);
        if (!isInk) continue;

        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }

    if (right < left || bottom < top) {
      return null;
    }

    return { left, top, right, bottom };
  }

  function createCroppedCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const bounds = findInkBounds(canvas);

    const sx = bounds ? Math.max(0, bounds.left - CAPTURE_PADDING) : 0;
    const sy = bounds ? Math.max(0, bounds.top - CAPTURE_PADDING) : 0;
    const ex = bounds
      ? Math.min(canvas.width, bounds.right + CAPTURE_PADDING + 1)
      : canvas.width;
    const ey = bounds
      ? Math.min(canvas.height, bounds.bottom + CAPTURE_PADDING + 1)
      : canvas.height;

    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);

    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const outCtx = out.getContext("2d");
    if (!outCtx) {
      return canvas;
    }

    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, sw, sh);
    outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  }

  // キャンバス初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // デバイスピクセル比対応
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // 背景を白に設定
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, [width, height]);

  function getRelativePoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function endDrawing() {
    isDrawingRef.current = false;
    activePointerIdRef.current = null;
  }

  // Pointer Events を使ってマウス・タッチ・ペンを統一処理
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = getRelativePoint(e);
    if (!point) return;

    e.preventDefault();
    setPointerPos(point);
    canvas.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    isDrawingRef.current = true;
    draw(point.x, point.y, true, e.pressure);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getRelativePoint(e);
    if (!point) return;
    setPointerPos(point);

    if (!isDrawingRef.current) return;
    if (activePointerIdRef.current !== e.pointerId) return;

    e.preventDefault();
    draw(point.x, point.y, false, e.pressure);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && activePointerIdRef.current === e.pointerId) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // 既に解放されている場合があるため無視
      }
      endDrawing();
    }
  };

  const handlePointerEnter = () => {
    setIsPointerInside(true);
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handlePointerUp(e);
    setIsPointerInside(false);
    setPointerPos(null);
  };

  // 描画処理
  const draw = (x: number, y: number, isStart: boolean, pressure = 0.5) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (tool === "eraser") {
      // 消しゴムモード: 透明化せず白で上書きして、背景は常に白を維持する
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, eraserSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // ペンモード
      const effectivePressure = pressure > 0 ? pressure : 0.5;
      const currentWidth = lineWidth * (0.6 + effectivePressure * 0.8);
      if (isStart) {
        ctx.beginPath();
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = currentWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    }
  };

  // クリア処理
  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  // キャプチャ処理
  const handleCapture = () => {
    const canvas = canvasRef.current;
    if (!canvas || !onCapture) return;

    const croppedCanvas = createCroppedCanvas(canvas);

    if (!croppedCanvas.toBlob) {
      onCapture(croppedCanvas.toDataURL("image/jpeg", JPEG_QUALITY));
      return;
    }

    croppedCanvas.toBlob(
      (blob) => {
        if (!blob) {
          onCapture(croppedCanvas.toDataURL("image/jpeg", JPEG_QUALITY));
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          onCapture(result || croppedCanvas.toDataURL("image/jpeg", JPEG_QUALITY));
        };
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ツールバー */}
      <div className="flex flex-wrap gap-2 items-center bg-background border border-card-border p-3 rounded-lg">
        {/* ツール選択 */}
        <div className="flex gap-2">
          <button
            onClick={() => setTool("pen")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              tool === "pen"
                ? "bg-blue-500 text-white"
                : "bg-card border border-card-border text-text-secondary hover:bg-hover"
            }`}
          >
            🖊️ ペン
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              tool === "eraser"
                ? "bg-blue-500 text-white"
                : "bg-card border border-card-border text-text-secondary hover:bg-hover"
            }`}
          >
            🧹 消しゴム
          </button>
        </div>

        {/* ペンオプション（ペンモード時のみ） */}
        {tool === "pen" && (
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-2">
              <label htmlFor="lineWidth" className="text-sm font-medium">
                太さ:
              </label>
              <input
                id="lineWidth"
                type="range"
                min="1"
                max="10"
                value={lineWidth}
                onChange={(e) => setLineWidth(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-text-muted">{lineWidth}px</span>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="lineColor" className="text-sm font-medium">
                色:
              </label>
              <input
                id="lineColor"
                type="color"
                value={lineColor}
                onChange={(e) => setLineColor(e.target.value)}
                className="w-10 h-10 cursor-pointer rounded border border-card-border"
              />
            </div>
          </div>
        )}

        {/* 消しゴムオプション（消しゴムモード時のみ） */}
        {tool === "eraser" && (
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-2">
              <label htmlFor="eraserSize" className="text-sm font-medium">
                消しゴム:
              </label>
              <input
                id="eraserSize"
                type="range"
                min="4"
                max="40"
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-text-muted">{eraserSize}px</span>
            </div>
          </div>
        )}

        {/* アクション */}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={handleClear}
            className="px-4 py-2 rounded font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            🗑️ クリア
          </button>
          <button
            onClick={handleCapture}
            className="px-4 py-2 rounded font-medium bg-green-500 text-white hover:bg-green-600 transition-colors"
          >
            ✓ 確定
          </button>
        </div>
      </div>

      {/* キャンバス */}
      <div className="relative border-2 border-card-border rounded-lg bg-card overflow-hidden">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={`w-full block touch-none select-none ${
            tool === "eraser" ? "cursor-none" : "cursor-crosshair"
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onContextMenu={(e) => e.preventDefault()}
        />
        {tool === "eraser" && isPointerInside && pointerPos && (
          <div
            className="pointer-events-none absolute rounded-full border border-black/70 bg-white/20"
            style={{
              width: `${eraserSize}px`,
              height: `${eraserSize}px`,
              left: `${pointerPos.x - eraserSize / 2}px`,
              top: `${pointerPos.y - eraserSize / 2}px`,
            }}
          />
        )}
      </div>

      {/* 操作ガイド */}
      <p className="text-sm text-text-muted">
        💡 マウスまたはタッチペンで描画してください。完了したら「確定」ボタンを押してください。
      </p>
    </div>
  );
};
