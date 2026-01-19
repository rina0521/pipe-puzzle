// src/scenes/GameScene.ts

import Phaser from "phaser";
import { BoardModel } from "../game/boardModel";
import type { StageConfig, Pos } from "../game/boardModel";
import { BoardView } from "../view/BoardView";
import { createStage001 } from "../stages/stage_001";
import { UI_BOTTOM_HEIGHT, UI_TOP_HEIGHT } from "../ui/layout";

type PlayState = "IDLE" | "DRAGGING" | "RESOLVING" | "CLEAR" | "GAMEOVER";

export class GameScene extends Phaser.Scene {
  private model!: BoardModel;
  private view!: BoardView;

  private state: PlayState = "IDLE";

  // Board area (must match BoardView construction)
  private boardArea!: { x: number; y: number; width: number; height: number };
  private cellSize!: number;
  private offsetX!: number;
  private offsetY!: number;

  // input state
  private pointerDown = false;
  private dragMoved = false;
  private lastCell: Pos | null = null;
  private path: Pos[] = [];

  // UI refs
  private titleText?: Phaser.GameObjects.Text;
  private goalText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;

  constructor() {
    super("GameScene");
  }

  preload() {
    // pipes
    this.load.image("pipe_blank", "assets/pipe/blank.png");
    this.load.image("pipe_i", "assets/pipe/pipe_i.png");
    this.load.image("pipe_l", "assets/pipe/pipe_l.png");
    this.load.image("pipe_t", "assets/pipe/pipe_t.png");
    this.load.image("pipe_x", "assets/pipe/pipe_x.png");
    this.load.image("pipe_stop", "assets/pipe/pipe_stop.png");
  }

  create() {
    const stage: StageConfig = createStage001();
    this.model = new BoardModel(stage);

    const W = this.scale.width;
    const H = this.scale.height;

    this.boardArea = {
      x: 0,
      y: UI_TOP_HEIGHT,
      width: W,
      height: H - UI_TOP_HEIGHT - UI_BOTTOM_HEIGHT,
    };

    // View
    this.view = new BoardView(this, this.model, this.boardArea);
    this.view.syncAll();

    // ---- Compute same layout numbers as BoardView for screen->cell mapping
    // (Keep this in sync with BoardView constructor math)
    const cs = Math.floor(
      Math.min(this.boardArea.width / this.model.width, this.boardArea.height / this.model.height)
    );
    this.cellSize = cs;
    this.offsetX = this.boardArea.x + Math.floor((this.boardArea.width - cs * this.model.width) / 2);
    this.offsetY = this.boardArea.y + Math.floor((this.boardArea.height - cs * this.model.height) / 2);

    // Top UI
    this.titleText = this.add.text(12, 10, "Pipe Flow (prototype)", {
      fontSize: "18px",
      color: "#ffffff",
    });

    this.goalText = this.add.text(12, 34, this.goalLabel(), {
      fontSize: "14px",
      color: "#cccccc",
    });

    this.statusText = this.add.text(12, 58, "", { fontSize: "22px", color: "#00ff99" });

    // Input
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);

    // Restart
    this.input.keyboard?.on("keydown-R", () => this.scene.restart());

    const res = this.model.resolveAll();
    this.view.playSteps(res.steps).then(() => this.view.syncAll());

  }

  // -----------------------------
  // Input handlers
  // -----------------------------
  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.state !== "IDLE") return;

    const cell = this.screenToCell(pointer.x, pointer.y);
    if (!cell) return;

    this.pointerDown = true;
    this.dragMoved = false;
    this.lastCell = cell;
    this.path = [cell];
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (this.state !== "IDLE") return;
    if (!this.pointerDown) return;
    if (!this.lastCell) return;

    const cell = this.screenToCell(pointer.x, pointer.y);
    if (!cell) return;

    // same cell -> ignore
    if (cell.x === this.lastCell.x && cell.y === this.lastCell.y) return;

    // Accept movement if it stays on grid lines (same row or same col),
    // then "step" through intermediate cells so fast drags don't skip.
    const dx = cell.x - this.lastCell.x;
    const dy = cell.y - this.lastCell.y;

    if (dx !== 0 && dy !== 0) {
      // diagonal jump: ignore (or you can choose a rule to resolve it)
      return;
    }

    const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
    const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;

    let cx = this.lastCell.x;
    let cy = this.lastCell.y;

    while (cx !== cell.x || cy !== cell.y) {
      cx += stepX;
      cy += stepY;

      const next = { x: cx, y: cy };

      // extend path and apply shift
      this.path.push(next);

      // This rotates tiles along the entire visited path -> "carry" feeling.
      // Requires BoardModel.shiftAlongPath(path).
      this.model.shiftAlongPath(this.path);

      // Update only the cells in path (cheap enough at this grid size)
      for (const p of this.path) this.view.placeFromModel(p.x, p.y);

      this.lastCell = next;
      this.dragMoved = true;
    }
  }

  private async onPointerUp(pointer: Phaser.Input.Pointer) {
  if (this.state !== "IDLE") {
    this.resetDragState();
    return;
  }
  if (!this.pointerDown) return;

  const releasedCell = this.lastCell ?? this.screenToCell(pointer.x, pointer.y);
  this.pointerDown = false;

  // TAP: rotate cell
  if (!this.dragMoved && releasedCell) {
    // 1) model更新
    this.model.rotateCellCW(releasedCell.x, releasedCell.y);

    // 2) view更新
    this.view.placeFromModel(releasedCell.x, releasedCell.y);

    // 3) ★ログ（モデルと見た目が一致してるか）
    this.view.logCell(releasedCell.x, releasedCell.y);
  }

  // Always resolve after interaction (tap or drag)
  this.resetDragState();
  await this.resolveAfterInput();
}


  
  private resetDragState() {
    this.pointerDown = false;
    this.dragMoved = false;
    this.lastCell = null;
    this.path = [];
  }

  // -----------------------------
  // Resolve / UI
  // -----------------------------
  private async resolveAfterInput() {
    if (this.state !== "IDLE") return;

    this.state = "RESOLVING";

    const dbg = this.model.debugWhyNotClearing();
    console.log("[FLOW DEBUG]", dbg);

    const res = this.model.resolveAll();
    await this.view.playSteps(res.steps);

    // update goal text
    if (this.goalText) this.goalText.setText(this.goalLabel());

    // clear check
    if (this.model.waterFlows >= this.model.stage.goal.waterFlowsToClear) {
      this.state = "CLEAR";
      if (this.statusText) {
        this.statusText.setText("CLEAR!");
        this.statusText.setColor("#00ff99");
      }
      return;
    }

    // (GAMEOVER not defined for this mode yet)
    this.state = "IDLE";
  }

  private goalLabel(): string {
    const need = this.model.stage.goal.waterFlowsToClear;
    const cur = this.model.waterFlows;
    return `Goal: flow ${need} times   (${cur}/${need})   [R] restart`;
  }

  // -----------------------------
  // screen -> cell
  // -----------------------------
  private screenToCell(px: number, py: number): Pos | null {
    // inside board rect (with offsets)
    const x = Math.floor((px - this.offsetX) / this.cellSize);
    const y = Math.floor((py - this.offsetY) / this.cellSize);

    if (x < 0 || x >= this.model.width || y < 0 || y >= this.model.height) return null;

    // Also ignore pointer if it's in the padding area around the fitted grid
    const left = this.offsetX;
    const top = this.offsetY;
    const right = this.offsetX + this.cellSize * this.model.width;
    const bottom = this.offsetY + this.cellSize * this.model.height;

    if (px < left || px >= right || py < top || py >= bottom) return null;

    return { x, y };
  }
}
