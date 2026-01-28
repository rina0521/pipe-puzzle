// src/ui/BoardInputController.ts
import Phaser from "phaser";

export type GridPos = { x: number; y: number };

export type BoardInputDeps = {
  scene: Phaser.Scene;

  // 盤面サイズ（例: 6x6）
  cols: number;
  rows: number;

  // セル→座標変換
  worldToCell: (wx: number, wy: number) => GridPos | null;
  cellToWorldCenter: (cx: number, cy: number) => { x: number; y: number };

  // セルスプライト（セルごとに1つ、Interactive有効にする）
  // 例: sprites[y * cols + x]
  cellSprites: Phaser.GameObjects.Image[];
  getTileSprite?: (cx: number, cy: number) => Phaser.GameObjects.Image | null;


  // 操作（モデル更新はここでやる）
  rotateCellClockwise: (cx: number, cy: number) => Promise<void>;
  swapCells: (a: GridPos, b: GridPos) => void;

  // 演出・解決（ロック制御含む）
  canInteract: () => boolean; // state === PLAYING みたいな判定
  lockInteract: () => void;   // state = RESOLVING
  unlockInteract: () => void; // state = PLAYING
  resolveAllWithAnimations: () => Promise<void>; // DROP/CLEAR/WATER含む

  pickUp?: (cx: number, cy: number) => void;
  movePicked?: (worldX: number, worldY: number) => void;
  dropPicked?: () => void;

};

export type BoardInputOptions = {
  dragThresholdPx?: number;    // タップ/ドラッグ判定
  dragFollowLerp?: number;     // 指追従(0..1) 小さいほど遅れて気持ちいい
  holdScale?: number;          // 掴み拡大
  fingerOffsetY?: number;      // 指で隠れるので少し上へ
  highlightAlpha?: number;     // ドロップ候補ハイライトの濃さ
  invalidFlashMs?: number;     // 無効フラッシュ
};

export class BoardInputController {
  private deps: BoardInputDeps;
  private opt: Required<BoardInputOptions>;

  // state for gesture
  private pointerId: number | null = null;
  private downWorld?: { x: number; y: number };
  private downCell?: GridPos;
  private dragging = false;

  // drag visuals
  private ghost?: Phaser.GameObjects.Image;
  private ghostShadow?: Phaser.GameObjects.Image;
  private ghostBaseDepth = 10_000;

  private candidate?: GridPos;
  private candidateHL?: Phaser.GameObjects.Rectangle;

  private shadowRect?: Phaser.GameObjects.Rectangle;
  private originMarker?: Phaser.GameObjects.Rectangle; // 元位置の目印（任意）


  constructor(deps: BoardInputDeps, options: BoardInputOptions = {}) {
    this.deps = deps;
    this.opt = {
      dragThresholdPx: options.dragThresholdPx ?? 12,
      dragFollowLerp: options.dragFollowLerp ?? 0.35,
      holdScale: options.holdScale ?? 1.06,
      fingerOffsetY: options.fingerOffsetY ?? -14,
      highlightAlpha: options.highlightAlpha ?? 0.22,
      invalidFlashMs: options.invalidFlashMs ?? 160,
    };

    this.attach();
  }

  destroy() {
    // つけたリスナを外す
    this.deps.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.deps.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.deps.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.deps.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.cleanupDrag();
    this.candidateHL?.destroy();
    this.candidateHL = undefined;

  }

  private attach() {
    // 各セルを interactive に（すでにしてるなら不要）
    for (const s of this.deps.cellSprites) {
      if (!s.input) s.setInteractive({ useHandCursor: true });
    }

    const input = this.deps.scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
  }

  private onDown(pointer: Phaser.Input.Pointer) {
    if (!this.deps.canInteract()) return;
    if (this.pointerId !== null) return; // multi-touch簡易ガード

    const cell = this.deps.worldToCell(pointer.worldX, pointer.worldY);
    if (!cell) return;

    this.pointerId = pointer.id;
    this.downWorld = { x: pointer.worldX, y: pointer.worldY };
    this.downCell = cell;
    this.dragging = false;

    this.candidate = cell;
    this.ensureCandidateHighlight();
    this.updateCandidateHighlight(cell);
  }

  private onMove(pointer: Phaser.Input.Pointer) {
    if (this.pointerId !== pointer.id) return;
    if (!this.downWorld || !this.downCell) return;
    if (!this.deps.canInteract()) return; // RESOLVING中に変な残りが出ないように

    const dx = pointer.worldX - this.downWorld.x;
    const dy = pointer.worldY - this.downWorld.y;
    const dist = Math.hypot(dx, dy);

    if (!this.dragging && dist >= this.opt.dragThresholdPx) {
      // drag確定：回転（タップ）をキャンセルするために dragging=true
      this.dragging = true;
      this.startDragVisual(this.downCell);
      this.deps.pickUp?.(this.downCell.x, this.downCell.y);

    }

    if (this.dragging) {
      this.deps.movePicked?.(pointer.worldX, pointer.worldY);

      const cand = this.deps.worldToCell(pointer.worldX, pointer.worldY);
      if (cand) {
        this.candidate = cand;
        this.updateCandidateHighlight(cand);
      } else {
        this.candidate = undefined;
        this.hideCandidateHighlight();
      }
    }

  }

private async onUp(pointer: Phaser.Input.Pointer) {
  if (this.pointerId !== pointer.id) return;
  if (!this.downCell) return;

  const start = this.downCell;
  const end = this.candidate;

  const wasDragging = this.dragging;

  // 先に gesture state を解除
  this.pointerId = null;
  this.downWorld = undefined;
  this.downCell = undefined;
  this.dragging = false;

  try {
    if (!this.deps.canInteract()) {
      this.cleanupDrag();
      return;
    }

    if (!wasDragging) {
      this.cleanupDrag();
      this.deps.lockInteract();
      try {
        await this.deps.rotateCellClockwise(start.x, start.y);
        await this.deps.resolveAllWithAnimations();
      } finally {
        this.deps.unlockInteract();
      }
      return;
    }

    if (!end || (end.x === start.x && end.y === start.y)) {
      // 戻る演出なし。見た目は dropPicked が元に戻す
      this.cleanupDrag();
      return;
    }

   this.cleanupDrag();

    this.deps.lockInteract();
    this.deps.swapCells(start, end);
    await this.deps.resolveAllWithAnimations();
  } finally {
  this.deps.unlockInteract();
  }
}

  // --- visuals ---
private startDragVisual(cell: GridPos) {
  // ここでは “視覚演出” を一切しない
  // 視覚は deps.pickUp() / deps.movePicked() / deps.dropPicked() に集約する
  this.originMarker?.destroy();
  this.originMarker = undefined;
  this.shadowRect?.destroy();
  this.shadowRect = undefined;

  // もし「スナップバック演出」をController側でやりたいなら、
  // そのための情報だけ保持する（表示はしない）。
  const src =
    (this.deps.getTileSprite ? this.deps.getTileSprite(cell.x, cell.y) : null)
    ?? this.deps.cellSprites[cell.y * this.deps.cols + cell.x];

  if (!src) return;

  const b = src.getBounds();
  (src as any).setData("dragOriginWorldX", b.centerX);
  (src as any).setData("dragOriginWorldY", b.centerY);
}

  private ensureCandidateHighlight() {
    if (this.candidateHL) return;
    this.candidateHL = this.deps.scene.add
      .rectangle(0, 0, 1, 1, 0xffffff, this.opt.highlightAlpha)
      .setDepth(this.ghostBaseDepth - 1)
      .setVisible(false);
  }

  private updateCandidateHighlight(cell: GridPos) {
    if (!this.candidateHL) return;
    const { x, y } = this.deps.cellToWorldCenter(cell.x, cell.y);

    // サイズは「セルスプライトの実寸」に合わせる（最初のセルから推定）
    const any = this.deps.cellSprites[0];
    const w = any.displayWidth;
    const h = any.displayHeight;

    this.candidateHL.setSize(w, h);
    this.candidateHL.setPosition(x, y);
    this.candidateHL.setVisible(true);
  }

  private hideCandidateHighlight() {
    this.candidateHL?.setVisible(false);
  }

  private cleanupDrag() {
    // 元セルを戻す（alpha）
    // ghost作成時に薄くしたセルを戻すため、全セル戻しても軽いならそれが簡単で安全
    for (const s of this.deps.cellSprites) s.setAlpha(1);

    this.ghost?.destroy();
    this.ghost = undefined;

    this.ghostShadow?.destroy();
    this.ghostShadow = undefined;


    this.hideCandidateHighlight();

    // gesture state
    this.candidate = undefined;
  this.shadowRect?.destroy();
  this.shadowRect = undefined;

  this.originMarker?.destroy();
  this.originMarker = undefined;

  }

  // TODO: 将来使用予定のメソッド（現在は未使用）
  // private tweenPromise(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
  //   return new Promise((resolve) => {
  //     this.deps.scene.tweens.add({
  //       ...config,
  //       onComplete: () => resolve(),
  //     });
  //   });
  // }
}
