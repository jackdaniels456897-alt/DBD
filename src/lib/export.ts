import type { Rect } from './geometry';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

function buildStandaloneSvg(svg: SVGSVGElement, bounds: Rect, background: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(Math.round(bounds.w)));
  clone.setAttribute('height', String(Math.round(bounds.h)));
  clone.setAttribute('viewBox', `0 0 ${Math.round(bounds.w)} ${Math.round(bounds.h)}`);
  clone.removeAttribute('class');
  clone.removeAttribute('style');

  const viewport = clone.querySelector('#dbd-viewport');
  if (viewport) viewport.setAttribute('transform', `translate(${-bounds.x} ${-bounds.y})`);

  const bg = clone.querySelector('#dbd-bg');
  if (bg) {
    bg.setAttribute('fill', background);
    bg.setAttribute('width', String(Math.round(bounds.w)));
    bg.setAttribute('height', String(Math.round(bounds.h)));
  }

  // remove the interactive-only transparent hit areas
  clone.querySelectorAll('path[stroke="transparent"]').forEach((n) => n.remove());

  return new XMLSerializer().serializeToString(clone);
}

export function exportSvg(svg: SVGSVGElement, bounds: Rect, filename: string, background = '#0b1220') {
  const source = buildStandaloneSvg(svg, bounds, background);
  downloadText(source, filename, 'image/svg+xml');
}

export function exportPng(
  svg: SVGSVGElement,
  bounds: Rect,
  filename: string,
  scale = 2,
  background = '#0b1220',
): Promise<void> {
  const source = buildStandaloneSvg(svg, bounds, background);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bounds.w * scale);
      canvas.height = Math.round(bounds.h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas indisponível'));
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('falha ao renderizar o SVG'));
    img.src = url;
  });
}
