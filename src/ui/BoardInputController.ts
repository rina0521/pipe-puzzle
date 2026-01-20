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

  // 操作（モデル更新はここでやる）
  rotateCellClockwise: (cx: number, cy: number) => void;
  swapCells: (a: GridPos, b: GridPos) => void;

  // 演出・解決（ロック制御含む）
  canInteract: () => boolean; // state === PLAYING みたいな判定
  lockInteract: () => void;   // state = RESOLVING
  unlockInteract: () => void; // state = PLAYING
  resolveAllWithAnimations: () => Promise<void>; // DROP/CLEAR/WATER含む
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
  private ghostBaseDepth = 10_000;

  private candidate?: GridPos;
  private candidateHL?: Phaser.GameObjects.Rectangle;

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
    }

    if (this.dragging) {
      this.updateGhost(pointer.worldX, pointer.worldY);

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

    // リセット（早めに）
    const wasDragging = this.dragging;
    this.pointerId = null;
    this.downWorld = undefined;
    this.downCell = undefined;
    this.dragging = false;

    if (!this.deps.canInteract()) {
      // 念のため
      this.cleanupDrag();
      return;
    }

    if (!wasDragging) {
      // タップ＝回転
      this.cleanupDrag();
      this.deps.lockInteract();
      try {
        this.deps.rotateCellClockwise(start.x, start.y);
        await this.deps.resolveAllWithAnimations();
      } finally {
        this.deps.unlockInteract();
      }
      return;
    }

    // ドラッグ＝スワップ（全セル自由）
    if (!end) {
      // 盤外で離した → スナップバック
      await this.snapBack();
      this.cleanupDrag();
      return;
    }

    if (end.x === start.x && end.y === start.y) {
      // 同セルに戻した → スナップバック（気持ちよさ優先）
      await this.snapBack();
      this.cleanupDrag();
      return;
    }

    // スワップ成立
    // 見た目：ゴーストをドロップ位置へスナップ → 盤面同期はswap後にあなたのsyncで合わせる
    await this.dropTo(end);

    this.cleanupDrag();

    this.deps.lockInteract();
    try {
      this.deps.swapCells(start, end);
      await this.deps.resolveAllWithAnimations();
    } finally {
      this.deps.unlockInteract();
    }
  }

  // --- visuals ---

  private startDragVisual(cell: GridPos) {
    const idx = cell.y * this.deps.cols + cell.x;
    const src = this.deps.cellSprites[idx];
    if (!src) return;

    // ゴースト（掴んだ見た目）
    this.ghost = this.deps.scene.add
      .image(src.x, src.y, src.texture.key, src.frame.name as any)
      .setDepth(this.ghostBaseDepth)
      .setScale(src.scaleX * this.opt.holdScale, src.scaleY * this.opt.holdScale)
      .setAlpha(1);

    // “掴んだ元”は少し薄くして存在を残す（完全非表示にすると位置感が消える）
    src.setAlpha(0.45);

    // 候補HLはこの時点で表示済みの想定

    this.ghost.setData("originX", src.x);
    this.ghost.setData("originY", src.y);

  }

  private updateGhost(worldX: number, worldY: number) {
    if (!this.ghost) return;

    // 指追従（少し遅れ）
    const targetX = worldX;
    const targetY = worldY + this.opt.fingerOffsetY;

    this.ghost.x = Phaser.Math.Linear(this.ghost.x, targetX, this.opt.dragFollowLerp);
    this.ghost.y = Phaser.Math.Linear(this.ghost.y, targetY, this.opt.dragFollowLerp);
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

  private async snapBack() {
    if (!this.ghost) return;
    const sx = this.ghost.getData("originX") ?? this.ghost.x;
    const sy = this.ghost.getData("originY") ?? this.ghost.y;

    await this.tweenPromise({
      targets: this.ghost,
      x: sx,
      y: sy,
      scaleX: this.ghost.scaleX * 0.985,
      scaleY: this.ghost.scaleY * 0.985,
      duration: 130,
      ease: "Back.easeOut",
    });
  }

  private async dropTo(cell: GridPos) {
    if (!this.ghost) return;
    const { x, y } = this.deps.cellToWorldCenter(cell.x, cell.y);

    await this.tweenPromise({
      targets: this.ghost,
      x,
      y,
      duration: 90,
      ease: "Sine.easeOut",
    });
  }

  private cleanupDrag() {
    // 元セルを戻す（alpha）
    // ghost作成時に薄くしたセルを戻すため、全セル戻しても軽いならそれが簡単で安全
    for (const s of this.deps.cellSprites) s.setAlpha(1);

    this.ghost?.destroy();
    this.ghost = undefined;

    this.hideCandidateHighlight();

    // gesture state
    this.candidate = undefined;
  }

  private tweenPromise(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.deps.scene.tweens.add({
        ...config,
        onComplete: () => resolve(),
      });
    });
  }
}
