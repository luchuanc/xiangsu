/** Resolve public resources under the deployment directory, preserving external URLs. */
export function assetUrl(src: string): string {
  return src.startsWith("/") && !src.startsWith("//") ? (import.meta.env?.BASE_URL || "/") + src.slice(1) : src;
}
