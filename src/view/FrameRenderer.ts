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
  private outPipeImage: Phaser.GameObjects.Image | null = null;
  private outToImages: Phaser.GameObjects.Image[] = [];

  // フレーム画像の仕様（field_frame_base.png を 3x3 に分割）
  private readonly FRAME_PART_SIZE = 48;  // 1パーツのサイズ（48px）

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

    // 右側の額縁の位置に out_pipe.png を配置
    this.drawOutPipeImage(frameY, frameHeight);
    
    // ゲームフィールドの各行に out_to.png を配置
    this.drawOutToImages();
  }

  /**
   * ゲームフィールドの各行に out_to.png を配置
   */
  private drawOutToImages() {
    const { offsetY, cellSize, boardH } = this.layout;
    const screenWidth = this.scene.scale.width;
    
    // 各行に対して out_to.png を配置
    for (let y = 0; y < boardH; y++) {
      const centerY = offsetY + y * cellSize + cellSize / 2;
      
      const outToImage = this.scene.add.image(screenWidth, centerY, "out_to");
      
      // 縦はセルサイズの0.75倍、横は0.5倍
      const scaleY = (cellSize * 0.75) / outToImage.height;
      const scaleX = 0.5;
      outToImage.setScale(scaleX, scaleY);
      outToImage.setOrigin(1, 0.5); // 右端を基準に配置
      outToImage.setDepth(1); // フレームより手前、パイプと同じレベル
      
      this.outToImages.push(outToImage);
    }
  }

  /**
   * 右側の額縁に out_pipe.png を配置
   */
  private drawOutPipeImage(frameY: number, frameHeight: number) {
    // 画面の右端を取得
    const screenWidth = this.scene.scale.width;
    
    // 額縁の中央のY座標を計算
    const frameCenterY = frameY + frameHeight / 2;

    // 画像を配置（画面右端にぴったり）
    this.outPipeImage = this.scene.add.image(screenWidth, frameCenterY, "out_pipe");
    
    // 横幅は0.25倍、縦は額縁全体の高さに合わせてスケール
    const imageHeight = this.outPipeImage.height;
    const scaleY = frameHeight / imageHeight;
    const scaleX = 0.25;
    
    this.outPipeImage.setScale(scaleX, scaleY);
    this.outPipeImage.setOrigin(1, 0.5); // 右端を基準に配置
    this.outPipeImage.setDepth(0.6); // フレームより少し手前
  }

  /**
   * レイアウト変更時に枠を再描画（画面リサイズ時など）
   */
  relayout() {
    if (this.frame) {
      this.frame.destroy();
    }
    if (this.outPipeImage) {
      this.outPipeImage.destroy();
    }
    this.outToImages.forEach(img => img.destroy());
    this.outToImages = [];
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
    if (this.outPipeImage) {
      this.outPipeImage.destroy();
      this.outPipeImage = null;
    }
    this.outToImages.forEach(img => img.destroy());
    this.outToImages = [];
  }
}
