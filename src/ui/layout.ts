export const UI_TOP_HEIGHT = 80;
export const UI_BOTTOM_HEIGHT = 160;
export function uiHeights(H: number) {
  const top = Math.max(84, Math.floor(H * 0.14));     // 最低84px、基本は14%
  const bottom = Math.max(110, Math.floor(H * 0.18)); // 最低110px、基本は18%
  return { top, bottom };
}
