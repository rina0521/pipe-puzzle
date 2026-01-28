import Phaser from "phaser";
import type { BoardModel, Pos, ResolveStep } from "../game/boardModel";
import type { PieceId } from "../game/pieces";
import { pieceMask, hasBit, DirBit } from "../game/pieces";

import { BoardLayout } from "./BoardLayout";
import { PiecePickupState } from "./PiecePickupState";
import type { AnimationConfig } from "./AnimationConfig";


type Rect = { x: number; y: number; width: number; height: number };

type CellSprite = {
  blank?: Phaser.GameObjects.Image;
  base?: Phaser.GameObjects.Image;
  plate?: Phaser.GameObjects.Rectangle;
  water?: Phaser.GameObjects.Rectangle;
};


export class BoardView {
  private scene: Phaser.Scene;
  private model: BoardModel;
  private layout: BoardLayout;

  private cells: CellSprite[][];
  private ghost: Phaser.GameObjects.Image;
  private pickedState: PiecePickupState;

  private tileVariant: number[][];
  private flanges: Map<string, Phaser.GameObjects.Image>;


  constructor(
    scene: Phaser.Scene,
    model: BoardModel,
    _area: Rect,
    layout: BoardLayout,
    _animConfig: AnimationConfig
  ) {
    this.scene = scene;
    this.model = model;
    this.layout = layout;
    this.pickedState = new PiecePickupState();

    this.cells = Array.from({ length: model.height }, () =>
      Array.from({ length: model.width }, () => ({}))
    );

    // background grid + water layer
    for (let y = 0; y < model.height; y++) {
      for (let x = 0; x < model.width; x++) {
        const { px, py } = this.layout.cellCenter(x, y);

        const water = scene.add
          .rectangle(px, py, this.layout.cellSize - 6, this.layout.cellSize - 6, 0x1e90ff, 1)
          .setAlpha(0)
          .setDepth(0);


        const blank = scene.add
          .image(px, py, "pipe_blank")
          .setDisplaySize(this.layout.cellSize, this.layout.cellSize)
          .setAlpha(0.35)
          .setDepth(1);

        const plate = scene.add
          .rectangle(px, py, this.layout.cellSize - 6, this.layout.cellSize - 6, 0xffffff, 1)
          .setDepth(1.2);

        // blankは“見せない入力面”にする（白背景と二重に見えないように）
        blank.setAlpha(0.01);

        this.cells[y][x].plate = plate;


        this.cells[y][x].water = water;
        this.cells[y][x].blank = blank;

      }
    }

    // ghost piece preview
    this.ghost = scene.add.image(0, 0, "pipe_i").setDepth(10).setAlpha(0.6);
    this.ghost.setVisible(false);

    // --- grid lines ---
    const g = scene.add.graphics().setDepth(1.5);
    g.lineStyle(1, 0xaaaaaa, 0.25);

    const left = this.layout.offsetX;
    const top = this.layout.offsetY;
    const right = this.layout.offsetX + this.layout.cellSize * model.width;
    const bottom = this.layout.offsetY + this.layout.cellSize * model.height;

    // vertical lines
    for (let x = 0; x <= model.width; x++) {
      const px = left + x * this.layout.cellSize;
      g.lineBetween(px, top, px, bottom);
    }
    // horizontal lines
    for (let y = 0; y <= model.height; y++) {
      const py = top + y * this.layout.cellSize;
      g.lineBetween(left, py, right, py);
    }

    this.tileVariant = Array.from({ length: model.height }, () =>
    Array.from({ length: model.width }, () => Phaser.Math.Between(0, 3))
);

    this.flanges = new Map();

  }

  // ---------- Public ----------
  syncAll() {
    this.pickedState.destroyVisuals();
    this.pickedState.sprite = null;
    this.pickedState.cell = null;

    for (let y = 0; y < this.model.height; y++) {
      for (let x = 0; x < this.model.width; x++) {
        this.placeFromModel(x, y);
      }
    }

    this.updateAllFlanges();
  }

  syncCells(cells: { x: number; y: number }[]) {
    for (const c of cells) this.placeFromModel(c.x, c.y);
  }

  rotateCellAnim(x: number, y: number) {
    const cell = this.cells[y][x];
    if (!cell.base) return;

    this.scene.tweens.add({
      targets: cell.base,
      angle: cell.base.angle + 90,
      duration: 80,
      ease: "Sine.easeInOut",
      onComplete: () => {
        this.updateAllFlanges();
      }
    });
  }

placeFromModel(x: number, y: number) {
  const tile = this.model.getCell(x, y);
  const cell = this.cells[y][x];
  const { px, py } = this.cellCenter(x, y);

  if (!tile) {
    cell.base?.destroy();
    cell.base = undefined;
    return;
  }

  const v = this.tileVariant[y][x]; 
  const baseTex = textureForPiece(tile.pieceId as PieceId);

  const cmp = compositeKeyFromBaseTex(v, baseTex, tile.rot ?? 0);
  const tex =
    cmp && this.scene.textures.exists(cmp)
      ? cmp
      : baseTex;

  if (!cell.base) {
    cell.base = this.scene.add.image(px, py, tex).setDepth(2);
    cell.base.setDisplaySize(this.layout.cellSize, this.layout.cellSize);
  } else {
    cell.base.setTexture(tex);
    cell.base.setPosition(px, py);
  }

  cell.base.setRotation(cmp ? 0 : (Math.PI / 2) * (tile.rot ?? 0));
}


  

  showGhost(model: BoardModel) {
    const p = model.currentPiece;
    if (!p) {
      this.ghost.setVisible(false);
      return;
    }

    const x = model.aimColumn;
    const y = 0;
    const { px, py } = this.layout.cellCenter(x, y);

    this.ghost.setVisible(true);
    this.ghost.setTexture(textureForPiece(p.pieceId));
    this.ghost.setPosition(px, py);
    this.ghost.setDisplaySize(this.layout.cellSize, this.layout.cellSize);
    const v = 0;
    this.ghost.setTexture(compositeTextureKey(v, p.pieceId as PieceId, p.rot ?? 0));
    this.ghost.setRotation(0);
  }

async playSteps(
  steps: ResolveStep[],
  opt: {
    stepDelayMs?: number;
    waterStepMs?: number;
    waterTailMs?: number;
    enableWaterParticle?: boolean;
    waterHopMs?: number;
    enableWaterNotes?: boolean;
  } = {}
) {
  const stepDelayMs = opt.stepDelayMs ?? 0;

  for (const step of steps) {
    switch (step.type) {
      case "WATER": {
        await this.playWaterHighlight(step.cells, opt);
        break;
      }
      case "CLEAR": {
        this.applyClear(step.cells);
        break;
      }
      case "DROP": {
        await this.playDrops(step.moves);
        break;
      }
      case "SHIFT": {
        await this.playShifts(step.moves);
        break;
      }
      case "FLOW_COUNT": {
        break;
      }
    }

    if (stepDelayMs > 0) {
      await wait(this.scene, stepDelayMs);
    }
  }
}

  private async playShifts(
    moves: { from: Pos; to: Pos; tile: any }[]
  ) {
    if (moves.length === 0) return;

    const temps: Phaser.GameObjects.Image[] = [];

    for (const m of moves) {
      const from = this.cellCenter(m.from.x, m.from.y);
      const to = this.cellCenter(m.to.x, m.to.y);

      const v = this.tileVariant[m.to.y][m.to.x];
      const baseTex = textureForPiece(m.tile.pieceId as PieceId);
      const cmp = compositeKeyFromBaseTex(v, baseTex, m.tile.rot ?? 0);
      const tex = (cmp && this.scene.textures.exists(cmp)) ? cmp : baseTex;

      const img = this.scene.add.image(from.px, from.py, tex).setDepth(5);
      img.setDisplaySize(this.layout.cellSize, this.layout.cellSize);
      img.setRotation(cmp ? 0 : (Math.PI / 2) * (m.tile.rot ?? 0));


      temps.push(img);

      this.scene.tweens.add({
        targets: img,
        x: to.px,
        y: to.py,
        duration: 80,
        ease: "Sine.easeInOut",
      });
    }

    await wait(this.scene, 90);

    for (const t of temps) t.destroy();
    this.syncAll();
  }

  // ---------- Effects ----------
private async playWaterHighlight(
  cells: { x: number; y: number; dist: number }[],
  opt: {
    waterStepMs?: number;
    waterTailMs?: number;
    enableWaterParticle?: boolean;
    waterHopMs?: number;
    enableWaterNotes?: boolean;
    waterFadeOutMs?: number;
    waterAlpha?: number;
    waterEndHoldMs?: number;

  } = {}
) {
  const waterStepMs = opt.waterStepMs ?? 140;
  const hopMs = opt.waterHopMs ?? 220;

  const waterAlpha = opt.waterAlpha ?? 0.65;
  const fadeOutMs = opt.waterFadeOutMs ?? 420;

  // 1) distでグルーピング
  const grouped = new Map<number, { x: number; y: number }[]>();
  for (const c of cells) {
    const arr = grouped.get(c.dist) ?? [];
    arr.push({ x: c.x, y: c.y });
    grouped.set(c.dist, arr);
  }

  // distが全部0だと波にならないので、順序用に「擬似dist」を作る保険
  // （本当は BoardModel 側で dist をちゃんと出すのが理想）
  const hasMultipleDist = grouped.size > 1;
  let dists: number[];

  if (hasMultipleDist) {
    dists = Array.from(grouped.keys()).sort((a, b) => a - b);
  } else {
    // 擬似dist：左→右（同じxなら上→下）で進める
    const sorted = [...cells].sort((a, b) => (a.x - b.x) || (a.y - b.y));
    grouped.clear();
    sorted.forEach((c, i) => {
      grouped.set(i, [{ x: c.x, y: c.y }]);
    });
    dists = Array.from(grouped.keys()); // 0..n-1
  }

  // 2) 白点（任意）
  let dot: Phaser.GameObjects.Arc | null = null;
  if (opt.enableWaterParticle && dists.length > 0) {
    const p0 = grouped.get(dists[0])![0];
    const c0 = this.cellCenter(p0.x, p0.y);
    dot = this.scene.add
      .circle(c0.px, c0.py, Math.max(2, Math.floor(this.layout.cellSize * 0.12)), 0xffffff, 1)
      .setDepth(6);
  }

  // 3) 波：distごとに “追加で” 点灯していく（右まで一瞬にならない）
  const lit: { x: number; y: number }[] = [];
  let sfxStep = 0;

  for (const d of dists) {
    const arr = grouped.get(d)!;

    for (const p of arr) {
      this.setWater(p.x, p.y, waterAlpha);
      this.applyWaterEffectToPipe(p.x, p.y);
      lit.push(p);

      this.playFillSfx(sfxStep);
      sfxStep++;
    }

    if (dot) {
      const target = arr[0];
      const to = this.cellCenter(target.x, target.y);
      await this.tweenPromise(dot, { x: to.px, y: to.py, duration: hopMs, ease: "Linear" });

      if (opt.enableWaterNotes) this.playWaterNote(d);
    }

    await wait(this.scene, waterStepMs);
  }


const endHold = opt.waterEndHoldMs ?? 250;
await wait(this.scene, endHold);

await this.fadeOutWater(lit, fadeOutMs);

  dot?.destroy();
}

private applyClear(cells: { x: number; y: number }[]) {
  this.cleanupPickedArtifacts();
  this.pickedState.sprite = null;
  this.pickedState.cell = null;

  for (const c of cells) {
    const cell = this.cells[c.y][c.x];
    if (cell.base) {
      // ティント状態をクリアしてから削除
      cell.base.clearTint();
      cell.base.setAlpha(1);
      cell.base.destroy();
      cell.base = undefined;
    }
    this.setWater(c.x, c.y, 0);
  }

  this.updateAllFlanges();
}


  private playFillSfx(stepIndex: number) {
    const baseRate = 0.95;
    const rateStep = 0.02;
    const rate = Math.min(1.35, baseRate + stepIndex * rateStep);

    this.scene.sound.play("water", {
      volume: 0.35,
      rate,
  });
}

private pickup(sprite: Phaser.GameObjects.Image, cell: { x: number; y: number }) {
  if (this.pickedState.isActive() && this.pickedState.sprite === sprite) return;

  this.pickedState.destroyVisuals();

  this.pickedState.setSpriteInfo(sprite, cell);

  const HOLD_SCALE = 1.06;
  const LIFT_Y = 3;
  const ORIGIN_PLATE_COLOR = 0x5f5f5f;

  (sprite as any).clearTint?.();

  // 元マスのプレート色を変更
  const originPlate = this.cells[cell.y]?.[cell.x]?.plate ?? null;
  if (originPlate) {
    this.pickedState.setOriginPlateInfo(originPlate);
    originPlate.fillColor = ORIGIN_PLATE_COLOR as any;
    originPlate.setAlpha(1);
  }

  // スプライトを前面に
  sprite.setDepth(999);
  sprite.setAlpha(1);

  // 白背景プレート
  this.pickedState.bg = this.scene.add
    .rectangle(sprite.x, sprite.y, sprite.displayWidth * 0.94, sprite.displayHeight * 0.94, 0xffffff, 1)
    .setDepth(sprite.depth - 1);

  // 影
  this.pickedState.shadowRect = this.scene.add
    .rectangle(sprite.x + 8, sprite.y + 12, sprite.displayWidth * 0.98, sprite.displayHeight * 0.98, 0x000000, 0.14)
    .setDepth(sprite.depth - 2);

  (this.pickedState.shadowRect as any).setRadius?.(12);

  // 持ち上げアニメーション
  this.scene.tweens.add({
    targets: sprite,
    scale: this.pickedState.baseScale * HOLD_SCALE,
    y: this.pickedState.baseY - LIFT_Y,
    duration: 80,
    ease: "Cubic.Out",
  });
}




private cleanupPickedArtifacts() {
  // ピックアップされていたスプライトのティント状態をクリア
  if (this.pickedState.sprite && this.pickedState.sprite.active) {
    this.pickedState.sprite.clearTint();
    this.pickedState.sprite.setAlpha(1);
  }
  this.pickedState.destroyVisuals();
}

public relayout(area: Rect) {
  this.layout = new BoardLayout(area, this.model.width, this.model.height);

  // 全セルの座標とサイズを更新
  for (let y = 0; y < this.model.height; y++) {
    for (let x = 0; x < this.model.width; x++) {
      const { px, py } = this.layout.cellCenter(x, y);
      const cell = this.cells[y][x];

      cell.water?.setPosition(px, py).setSize(this.layout.cellSize - 6, this.layout.cellSize - 6);
      cell.blank?.setPosition(px, py).setDisplaySize(this.layout.cellSize, this.layout.cellSize);
      cell.plate?.setPosition(px, py).setSize(this.layout.cellSize - 6, this.layout.cellSize - 6);
      cell.base?.setPosition(px, py).setDisplaySize(this.layout.cellSize, this.layout.cellSize);
    }
  }
}


public forceDropPicked() {
  this.dropPicked();
}

private dropPicked() {
  if (!this.pickedState.sprite) {
    this.pickedState.destroyVisuals();
    return;
  }

  const sprite = this.pickedState.sprite;
  const baseDepth = this.pickedState.baseDepth;
  const baseScale = this.pickedState.baseScale;
  const baseX = this.pickedState.baseX;
  const baseY = this.pickedState.baseY;

  this.pickedState.destroyVisuals();

  this.scene.tweens.add({
    targets: sprite,
    scale: baseScale,
    x: baseX,
    y: baseY,
    duration: 80,
    ease: "Quad.Out",
    onComplete: () => {
      sprite.setDepth(baseDepth);
      sprite.setAlpha(1);
      (sprite as any).clearTint?.();
    },
  });

  this.pickedState.sprite = null;
  this.pickedState.cell = null;
}

public pickUpAt(cx: number, cy: number) {
  const s = this.cells[cy]?.[cx]?.base;
  if (!s) return;
  this.pickup(s, { x: cx, y: cy });
}

public movePickedTo(worldX: number, worldY: number) {
  this.updatePickedPosition(worldX, worldY);
}

private updatePickedPosition(px: number, py: number) {
  const s = this.pickedState.sprite;
  if (!s) return;

  // 盤面から消えてたら即終了＋掃除
  if (!s.active) { 
    this.cleanupPickedArtifacts();
    this.pickedState.sprite = null;
    this.pickedState.cell = null;
    return;
  }
  if (!this.pickedState.sprite) return;

  const FOLLOW = 0.35; // 0.25〜0.45 好み。小さいほど“ぬるっ”と遅れる

  // 指で隠れるので少し上へ（必要なければ 0）
  const OFFSET_Y = -10;

  const tx = px;
  const ty = py + OFFSET_Y;

  this.pickedState.sprite.x = Phaser.Math.Linear(this.pickedState.sprite.x, tx, FOLLOW);
  this.pickedState.sprite.y = Phaser.Math.Linear(this.pickedState.sprite.y, ty, FOLLOW);

  if (this.pickedState.shadowRect) {
    this.pickedState.shadowRect.x = Phaser.Math.Linear(this.pickedState.shadowRect.x, this.pickedState.sprite.x + 8, FOLLOW);
    this.pickedState.shadowRect.y = Phaser.Math.Linear(this.pickedState.shadowRect.y, this.pickedState.sprite.y + 12, FOLLOW);
  }

  if (this.pickedState.bg) {
    this.pickedState.bg.x = Phaser.Math.Linear(this.pickedState.bg.x, this.pickedState.sprite.x, FOLLOW);
    this.pickedState.bg.y = Phaser.Math.Linear(this.pickedState.bg.y, this.pickedState.sprite.y, FOLLOW);
  }

  if (this.pickedState.sprite) {
    const d = this.pickedState.sprite.depth;
    this.pickedState.bg?.setDepth(d - 1);
    this.pickedState.shadowRect?.setDepth(d - 2);
  }
}

  private async playDrops(moves: { from: Pos; to: Pos; tile: any }[]) {
    if (moves.length === 0) return;

    const temps: Phaser.GameObjects.Image[] = [];

    for (const m of moves) {
      if (m.to.x < 0 || m.to.x >= this.model.width || m.to.y < 0 || m.to.y >= this.model.height) {
        continue;
      }
      const from = this.layout.cellCenter(m.from.x, m.from.y);
      const to = this.layout.cellCenter(m.to.x, m.to.y);

      const fy = m.from.y;
      const fx = m.from.x;
      if (fy >= 0 && fy < this.model.height && fx >= 0 && fx < this.model.width) {
        const fromCell = this.cells[fy][fx];
        if (fromCell.base) {
          fromCell.base.destroy();
          fromCell.base = undefined;
        }
      }

      const v = this.tileVariant[m.to.y][m.to.x]; 
      const baseTex = textureForPiece(m.tile.pieceId as PieceId);
      const cmp = compositeKeyFromBaseTex(v, baseTex, m.tile.rot ?? 0);
      const tex = (cmp && this.scene.textures.exists(cmp)) ? cmp : baseTex;

      const img = this.scene.add.image(from.px, from.py, tex).setDepth(5);
      img.setDisplaySize(this.layout.cellSize, this.layout.cellSize);
      img.setRotation(cmp ? 0 : (Math.PI / 2) * (m.tile.rot ?? 0));

      temps.push(img);

      this.scene.tweens.add({
        targets: img,
        x: to.px,
        y: to.py,
        duration: 140,
        ease: "Sine.easeInOut",
      });
    }

    await wait(this.scene, 150);

    for (const t of temps) t.destroy();
    this.syncAll();
  }

  

  private cellCenter(x: number, y: number) {
    return this.layout.cellCenter(x, y);
  }

  private setWater(x: number, y: number, alpha: number) {
    const w = this.cells[y][x].water;
    if (!w) return;
    w.setAlpha(alpha);
  }
  
  private tweenPromise(
    targets: any,
    cfg: Omit<Phaser.Types.Tweens.TweenBuilderConfig, "targets">
  ): Promise<void> {
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets,
        ...cfg,
        onComplete: () => resolve(),
      });
    });
  }

  private async fadeOutWater(cells: { x: number; y: number }[], durationMs: number) {
  if (cells.length === 0) return;

  // 左→右に引いていく（x優先）
  const sorted = [...cells].sort((a, b) => (a.x - b.x) || (a.y - b.y));

  // グループ数を少し粗くして負荷を下げる（5x5なら何でもOK）
  const groups = 6;
  const chunkSize = Math.max(1, Math.ceil(sorted.length / groups));
  const stepMs = Math.max(16, Math.floor(durationMs / groups));

  let chunkIndex = 0;
  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize);
    for (const p of chunk) this.setWater(p.x, p.y, 0);
    
    // 最後のチャンクが消える時にsteam.mp3を再生
    chunkIndex++;
    const isLastChunk = i + chunkSize >= sorted.length;
    if (isLastChunk) {
      this.scene.sound.play("steam", { volume: 0.5 });
    }
    
    await wait(this.scene, stepMs);
  }
}


  private playWaterNote(stepIndex: number) {
    // detune: 100 = 半音。上がりすぎ防止。
    const detune = Math.min(stepIndex, 24) * 80;

    this.scene.sound.play("water", {
      volume: 0.35,
      detune,
    } as any);
  }



public logCell() {
}

public getCellSpritesFlat(): Phaser.GameObjects.Image[] {
  const out: Phaser.GameObjects.Image[] = [];

  for (let y = 0; y < this.model.height; y++) {
    for (let x = 0; x < this.model.width; x++) {
      const img = this.cells[y][x].base;
      if (img) out.push(img);
    }
  }

  return out;
}

public getInputSpritesFlat(): Phaser.GameObjects.Image[] {
  const out: Phaser.GameObjects.Image[] = [];

  for (let y = 0; y < this.model.height; y++) {
    for (let x = 0; x < this.model.width; x++) {
      const img = this.cells[y][x].blank;
      if (img) out.push(img);
    }
  }

  return out;
}

  // パイプに水流演出を適用（ティント、グロー、脈動）
  private applyWaterEffectToPipe(x: number, y: number) {
    const sprite = this.cells[y]?.[x]?.base;
    if (!sprite) return;

    // ティント：明るい水色
    sprite.setTint(0x87CEEB);

    // グロー効果：スケール脈動
    this.scene.tweens.add({
      targets: sprite,
      scale: (sprite.scaleX ?? 1) * 1.08,
      duration: 150,
      ease: "Sine.easeInOut",
      yoyo: true,
    });

    // アルファ変動で発光感を演出
    const originalAlpha = sprite.alpha ?? 1;
    sprite.setAlpha(0.95);
    this.scene.time.delayedCall(250, () => {
      if (sprite.active) {
        sprite.setAlpha(originalAlpha);
      }
    });
  }

public getBaseSpriteAt(x: number, y: number): Phaser.GameObjects.Image | null {
  return this.cells[y]?.[x]?.base ?? null;
}

  // フランジの配置と更新
  private updateAllFlanges() {
    // 既存のすべてのフランジを破棄
    for (const flange of this.flanges.values()) {
      flange.destroy();
    }
    this.flanges.clear();

    // 盤面のすべてのセルをスキャン
    for (let y = 0; y < this.model.height; y++) {
      for (let x = 0; x < this.model.width; x++) {
        const tile = this.model.getCell(x, y);
        if (!tile) continue;

        // 右方向の接続をチェック
        if (x < this.model.width - 1 && this.isConnected(x, y, x + 1, y)) {
          this.placeFlangeHorizontal(x, y);
        }

        // 下方向の接続をチェック
        if (y < this.model.height - 1 && this.isConnected(x, y, x, y + 1)) {
          this.placeFlangeVertical(x, y);
        }
      }
    }
  }

  // 2つのセルが正しく接続されているか判定
  private isConnected(x1: number, y1: number, x2: number, y2: number): boolean {
    const tile1 = this.model.getCell(x1, y1);
    const tile2 = this.model.getCell(x2, y2);
    if (!tile1 || !tile2) return false;

    const mask1 = pieceMask(tile1.pieceId, tile1.rot);
    const mask2 = pieceMask(tile2.pieceId, tile2.rot);

    // 方向を判定
    if (x2 === x1 + 1) { // x2が右
      return hasBit(mask1, DirBit.R) && hasBit(mask2, DirBit.L);
    } else if (x2 === x1 - 1) { // x2が左
      return hasBit(mask1, DirBit.L) && hasBit(mask2, DirBit.R);
    } else if (y2 === y1 + 1) { // y2が下
      return hasBit(mask1, DirBit.D) && hasBit(mask2, DirBit.U);
    } else if (y2 === y1 - 1) { // y2が上
      return hasBit(mask1, DirBit.U) && hasBit(mask2, DirBit.D);
    }
    return false;
  }

  // 右方向のフランジを配置
  private placeFlangeHorizontal(x: number, y: number) {
    const cell1 = this.cellCenter(x, y);
    const cell2 = this.cellCenter(x + 1, y);
    const flangePx = (cell1.px + cell2.px) / 2;
    const flangePy = (cell1.py + cell2.py) / 2;

    const flange = this.scene.add.image(flangePx, flangePy, "flange")
      .setDisplaySize(32, 64)
      .setRotation(0)
      .setDepth(3);

    const key = `flange_${x}_${y}_R`;
    this.flanges.set(key, flange);
  }

  // 下方向のフランジを配置
  private placeFlangeVertical(x: number, y: number) {
    const cell1 = this.cellCenter(x, y);
    const cell2 = this.cellCenter(x, y + 1);
    const flangePx = (cell1.px + cell2.px) / 2;
    const flangePy = (cell1.py + cell2.py) / 2;

    const flange = this.scene.add.image(flangePx, flangePy, "flange")
      .setDisplaySize(32, 64)
      .setRotation(Math.PI / 2)
      .setDepth(3);

    const key = `flange_${x}_${y}_D`;
    this.flanges.set(key, flange);
  }

}



function textureForPiece(pieceId: PieceId): string {
  switch (pieceId) {
    case "I2": return "pipe_i";
    case "L2": return "pipe_l";
    case "T3": return "pipe_t";
    case "X4": return "pipe_x";
    case "STOP1": return "pipe_stop";
    case "ARROW": return "pipe_i"; // 使うなら後で専用画像
    default: return "pipe_i";
  }
}

function compositeTextureKey(
  tileVar: number,            // 0..3
  pieceId: PieceId,
  rot: number                 // 0..3
): string {
  // tile_base_01..04 を前提
  const tileKey = `tile_base_0${tileVar + 1}`;

  const pipeKey = pipeTextureKey(pieceId);
  if (!pipeKey) return textureForPiece(pieceId);

  const deg = (rot % 4) * 90;
  return `cmp_${tileKey}_${pipeKey}_r${deg}`;
}

function pipeTextureKey(pieceId: PieceId): string | null {
  const s = String(pieceId);

  if (s.startsWith("I")) return "pipe_i";
  if (s.startsWith("L")) return "pipe_l";
  if (s.startsWith("T")) return "pipe_t";
  if (s.startsWith("X")) return "pipe_x";
  
  return null;
}


function wait(scene: Phaser.Scene, ms: number) {
  return new Promise<void>((resolve) => scene.time.delayedCall(ms, () => resolve()));
}

function compositeKeyFromBaseTex(tileVar: number, baseTex: string, rot: number): string | null {
  // baseTex が pipe_i/l/t/x のときだけ合成
  if (baseTex !== "pipe_i" && baseTex !== "pipe_l" && baseTex !== "pipe_t" && baseTex !== "pipe_x") {
    return null;
  }
  const tileKey = `tile_base_0${tileVar + 1}`;
  const deg = (rot % 4) * 90;
  return `cmp_${tileKey}_${baseTex}_r${deg}`;
}
