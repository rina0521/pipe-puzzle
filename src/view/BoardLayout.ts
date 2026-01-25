// src/view/BoardLayout.ts
// 盤面のレイアウト計算を担当（座標変換の統一）

export type LayoutArea = { x: number; y: number; width: number; height: number };
export type CellCoord = { x: number; y: number };
export type WorldCoord = { px: number; py: number };

export class BoardLayout {
  readonly cellSize: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly boardW: number;
  readonly boardH: number;

  constructor(area: LayoutArea, boardW: number, boardH: number) {
    this.boardW = boardW;
    this.boardH = boardH;

    // セルサイズを計算（盤面がエリア内に収まるように）
    const cs = Math.floor(Math.min(area.width / boardW, area.height / boardH));
    this.cellSize = cs;

    // 盤面を中央配置
    this.offsetX = area.x + Math.floor((area.width - cs * boardW) / 2);
    this.offsetY = area.y + Math.floor((area.height - cs * boardH) / 2);
  }

  /**
   * グリッド座標 → ワールド座標（セルの中心）
   */
  cellCenter(x: number, y: number): WorldCoord {
    return {
      px: this.offsetX + x * this.cellSize + this.cellSize / 2,
      py: this.offsetY + y * this.cellSize + this.cellSize / 2,
    };
  }

  /**
   * ワールド座標 → グリッド座標（盤内のみ）
   */
  worldToCell(worldX: number, worldY: number): CellCoord | null {
    const x = Math.floor((worldX - this.offsetX) / this.cellSize);
    const y = Math.floor((worldY - this.offsetY) / this.cellSize);

    // 盤外チェック
    if (x < 0 || x >= this.boardW || y < 0 || y >= this.boardH) {
      return null;
    }

    return { x, y };
  }

  /**
   * グリッド座標が盤内か判定
   */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.boardW && y >= 0 && y < this.boardH;
  }

  /**
   * レイアウト情報をテキストで出力（デバッグ用）
   */
  toString(): string {
    return `BoardLayout(cellSize=${this.cellSize}, offset=(${this.offsetX},${this.offsetY}), board=${this.boardW}x${this.boardH})`;
  }
}
