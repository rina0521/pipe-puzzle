// src/view/FrameRenderer.ts
// ゲームフィールドの枠を9-スライス方式で描画

import Phaser from "phaser";
import type { BoardLayout } from "./BoardLayout";

/**
 * 可変サイズのゲームフィールド枠を Nine-Slice で描画
 * - コーナーは固定サイズで常に正方形
 * - エッジは拡大・縮小で任意のサイズに対応
 */
export class FrameRenderer {
  private scene: Phaser.Scene;
  private layout: BoardLayout;
  private frame: Phaser.GameObjects.NineSlice | null = null;

  // フレーム画像の仕様（field_frame_base.png を 3x3 に分割）
  private readonly FRAME_PART_SIZE = 24;  // 1パーツのサイズ（24px）

  constructor(scene: Phaser.Scene, layout: BoardLayout) {
    this.scene = scene;
    this.layout = layout;
  }

  /**
   * フィールド枠を描画
   */
  draw() {
    const { offsetX, offsetY, cellSize, boardW, boardH } = this.layout;

    // フィールドの外側にフチをつける（余裕のサイズ）
    const frameWidth = cellSize * boardW + this.FRAME_PART_SIZE * 2;
    const frameHeight = cellSize * boardH + this.FRAME_PART_SIZE * 2;

    // 枠の位置（フィールドより手前に配置）
    const frameX = offsetX - this.FRAME_PART_SIZE;
    const frameY = offsetY - this.FRAME_PART_SIZE;

    // Nine-Slice で枠を描画
    this.frame = this.scene.make.nineslice({
      x: frameX + frameWidth / 2,
      y: frameY + frameHeight / 2,
      width: frameWidth,
      height: frameHeight,
      key: "field_frame_base",
      leftWidth: this.FRAME_PART_SIZE,
      rightWidth: this.FRAME_PART_SIZE,
      topHeight: this.FRAME_PART_SIZE,
      bottomHeight: this.FRAME_PART_SIZE,
    });

    // 枠はフィールドより奥に配置（水や落下アニメーションより手前）
    this.frame.setDepth(0.5);
  }

  /**
   * レイアウト変更時に枠を再描画（画面リサイズ時など）
   */
  relayout() {
    if (this.frame) {
      this.frame.destroy();
    }
    this.draw();
  }

  /**
   * 枠を破棄
   */
  destroy() {
    if (this.frame) {
      this.frame.destroy();
      this.frame = null;
    }
  }
}
