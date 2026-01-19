import type { Tile } from "../game/boardModel";

export function isArrowPiece(tile: Tile): boolean {
  return tile.kind === "ARROW" || tile.pieceId === "ARROW";
}
