/**
 * 地图像素生成只使用整数 RGBA 缓冲区，避免 Canvas、抗锯齿和运行时随机数。
 */
export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export function createPixelSurface(width: number, height: number): PixelSurface {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("PIXEL_SURFACE_SIZE_INVALID");
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function pixelOffset(surface: PixelSurface, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= surface.width || y < 0 || y >= surface.height) return -1;
  return (y * surface.width + x) * 4;
}

export function setPixel(surface: PixelSurface, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  const offset = pixelOffset(surface, x, y);
  if (offset < 0) return;
  surface.data[offset] = rgba[0];
  surface.data[offset + 1] = rgba[1];
  surface.data[offset + 2] = rgba[2];
  surface.data[offset + 3] = rgba[3];
}

export function getPixel(surface: PixelSurface, x: number, y: number): readonly [number, number, number, number] {
  const offset = pixelOffset(surface, x, y);
  if (offset < 0) return [0, 0, 0, 0];
  return [surface.data[offset]!, surface.data[offset + 1]!, surface.data[offset + 2]!, surface.data[offset + 3]!];
}

export function fillRect(surface: PixelSurface, x: number, y: number, width: number, height: number, rgba: readonly [number, number, number, number]): void {
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) setPixel(surface, x + column, y + row, rgba);
}

export function drawRect(surface: PixelSurface, x: number, y: number, width: number, height: number, rgba: readonly [number, number, number, number], thickness = 1): void {
  for (let pass = 0; pass < thickness; pass += 1) {
    for (let column = x + pass; column < x + width - pass; column += 1) {
      setPixel(surface, column, y + pass, rgba);
      setPixel(surface, column, y + height - 1 - pass, rgba);
    }
    for (let row = y + pass; row < y + height - pass; row += 1) {
      setPixel(surface, x + pass, row, rgba);
      setPixel(surface, x + width - 1 - pass, row, rgba);
    }
  }
}

export function drawLine(surface: PixelSurface, x1: number, y1: number, x2: number, y2: number, rgba: readonly [number, number, number, number]): void {
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  let x = x1;
  let y = y1;
  while (true) {
    setPixel(surface, x, y, rgba);
    if (x === x2 && y === y2) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

export function copySurface(source: PixelSurface): PixelSurface {
  return { width: source.width, height: source.height, data: new Uint8Array(source.data) };
}
