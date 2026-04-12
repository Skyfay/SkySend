import { useEffect, useRef } from "react";

const SIZE = 32;
const FALLBACK_COLOR = "#7c3aed";

/** Resolve a CSS color value (oklch, hex, etc.) to an rgb() string canvas can always use. */
function resolvePrimaryColor(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-primary")
    .trim();
  if (!raw) return FALLBACK_COLOR;
  const el = document.createElement("div");
  el.style.color = raw;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  document.body.removeChild(el);
  return resolved || FALLBACK_COLOR;
}

function drawProgress(
  canvas: HTMLCanvasElement,
  progress: number,
  color: string,
): string {
  const ctx = canvas.getContext("2d")!;
  const center = SIZE / 2;
  const radius = 12;
  const lineWidth = 3.5;

  ctx.clearRect(0, 0, SIZE, SIZE);

  // Background track
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Progress arc
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (progress / 100) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(center, center, radius, startAngle, endAngle);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  // Percentage text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${progress}`, center, center + 1);

  return canvas.toDataURL("image/png");
}

function restoreFavicon(href: string) {
  if (!href) return;
  const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
  if (link) {
    link.href = href;
  }
}

export function useFaviconProgress(progress: number | null) {
  const originalHref = useRef<string>("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorRef = useRef<string>("");
  const wasActive = useRef(false);

  // Capture original favicon once
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    if (link) {
      originalHref.current = link.href;
    }
  }, []);

  useEffect(() => {
    if (progress !== null && progress >= 0) {
      // Active - draw progress favicon
      wasActive.current = true;

      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
        canvasRef.current.width = SIZE;
        canvasRef.current.height = SIZE;
      }

      // Resolve the primary color once per upload session
      if (!colorRef.current) {
        colorRef.current = resolvePrimaryColor();
      }

      const dataUrl = drawProgress(
        canvasRef.current,
        Math.round(progress),
        colorRef.current,
      );
      let link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = dataUrl;
    } else if (wasActive.current) {
      // Upload finished - restore original favicon
      wasActive.current = false;
      colorRef.current = "";
      restoreFavicon(originalHref.current);
    }
  }, [progress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wasActive.current) {
        restoreFavicon(originalHref.current);
      }
    };
  }, []);
}
