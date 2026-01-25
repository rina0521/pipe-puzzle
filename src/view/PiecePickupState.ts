// src/view/PiecePickupState.ts
// ドラッグ時のピック状態を管理（BoardView から分離）

import Phaser from "phaser";

export type PickedCellInfo = { x: number; y: number };

/**
 * ドラッグ操作でピックされたピースの状態を管理
 * - スプライト参照
 * - ピック時の元の値（ドロップ時に復元）
 * - 演出用のオブジェクト（背景、影など）
 */
export class PiecePickupState {
  sprite: Phaser.GameObjects.Image | null = null;
  cell: PickedCellInfo | null = null;

  // スプライトの元の値（ドロップ時に復元）
  baseDepth = 0;
  baseScale = 1;
  baseX = 0;
  baseY = 0;

  // 演出オブジェクト
  bg: Phaser.GameObjects.Rectangle | null = null;
  shadowRect: Phaser.GameObjects.Rectangle | null = null;

  // 元マスのプレート色を復元用に保存
  originPlate: Phaser.GameObjects.Rectangle | null = null;
  originPlateColor = 0xffffff;
  originPlateAlpha = 1;

  /**
   * ピック状態がアクティブか
   */
  isActive(): boolean {
    return this.sprite !== null;
  }

  /**
   * ピック状態を完全にクリア（演出オブジェクトも破棄）
   */
  destroy() {
    this.bg?.destroy();
    this.shadowRect?.destroy();
    this.bg = null;
    this.shadowRect = null;

    this.sprite = null;
    this.cell = null;
  }

  /**
   * スプライト情報を保存
   */
  setSpriteInfo(sprite: Phaser.GameObjects.Image, cell: PickedCellInfo) {
    this.sprite = sprite;
    this.cell = cell;
    this.baseDepth = sprite.depth ?? 0;
    this.baseScale = sprite.scaleX ?? 1;
    this.baseX = sprite.x;
    this.baseY = sprite.y;
  }

  /**
   * 元マスのプレート情報を保存
   */
  setOriginPlateInfo(plate: Phaser.GameObjects.Rectangle) {
    this.originPlate = plate;
    this.originPlateColor = plate.fillColor ?? 0xffffff;
    this.originPlateAlpha = plate.alpha ?? 1;
  }

  /**
   * 元マスのプレート色を復元
   */
  restorePlateColor() {
    if (this.originPlate) {
      (this.originPlate.fillColor as any) = this.originPlateColor;
      this.originPlate.setAlpha(this.originPlateAlpha);
    }
    this.originPlate = null;
  }

  /**
   * 演出オブジェクト（BG、影）を破棄
   */
  destroyVisuals() {
    this.bg?.destroy();
    this.shadowRect?.destroy();
    this.bg = null;
    this.shadowRect = null;
    this.restorePlateColor();
  }}