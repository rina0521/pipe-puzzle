// src/scenes/GameScene.ts

import Phaser from "phaser";
import { BoardModel } from "../game/boardModel";
import type { StageConfig, Pos } from "../game/boardModel";
import { BoardView } from "../view/BoardView";
import { createStage001 } from "../stages/stage_001";
import { UI_BOTTOM_HEIGHT, UI_TOP_HEIGHT } from "../ui/layout";
import { BoardInputController } from "../ui/BoardInputController";

type PlayState = "PLAYING" | "RESOLVING" | "CLEAR";

export class GameScene extends Phaser.Scene {
  private model!: BoardModel;
  private view!: BoardView;

  private state: PlayState = "PLAYING";

  // Board area (must match BoardView construction)
  private boardArea!: { x: number; y: number; width: number; height: number };
  private cellSize!: number;
  private offsetX!: number;
  private offsetY!: number;

  // UI refs
  public titleText?: Phaser.GameObjects.Text;
  private goalText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;

  // New input controller
  private boardInput?: BoardInputController;

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
    this.load.audio("blip", "assets/sfx/blip.mp3")
  }

  async create() {

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
    const cs = Math.floor(
      Math.min(
        this.boardArea.width / this.model.width,
        this.boardArea.height / this.model.height
      )
    );
    this.cellSize = cs;
    this.offsetX =
      this.boardArea.x +
      Math.floor((this.boardArea.width - cs * this.model.width) / 2);
    this.offsetY =
      this.boardArea.y +
      Math.floor((this.boardArea.height - cs * this.model.height) / 2);

    // Top UI
    this.titleText = this.add.text(12, 10, "Pipe Flow (prototype)", {
      fontSize: "18px",
      color: "#ffffff",
    });

    this.goalText = this.add.text(12, 34, this.goalLabel(), {
      fontSize: "14px",
      color: "#cccccc",
    });

    this.statusText = this.add.text(12, 58, "", {
      fontSize: "22px",
      color: "#00ff99",
    });

    // Restart
    this.input.keyboard?.on("keydown-R", () => this.scene.restart());

    // --- Initial resolve (same as before)
    await this.resolveAndAnimate();

    // --- Replace legacy pointer handlers with drag&drop swap controller
    this.setupBoardInput();
  }

  // -----------------------------
  // New input controller setup
  // -----------------------------
  private setupBoardInput() {
    // Get cell sprites from BoardView
    const cellSprites = this.view.getInputSpritesFlat();
    if (!cellSprites || cellSprites.length === 0) {
      console.warn(
        "[GameScene] cellSprites not found. Expose them from BoardView (e.g. getCellSprites())."
      );
      return;
    }

    const worldToCell = (wx: number, wy: number): Pos | null => {
      return this.screenToCell(wx, wy);
    };

    const cellToWorldCenter = (cx: number, cy: number) => {
      return {
        x: this.offsetX + cx * this.cellSize + this.cellSize / 2,
        y: this.offsetY + cy * this.cellSize + this.cellSize / 2,
      };
    };

    const canInteract = () => this.state === "PLAYING";
    const lockInteract = () => (this.state = "RESOLVING");
    const unlockInteract = () => {
      // CLEAR中は解除しない
      if (this.state !== "CLEAR") this.state = "PLAYING";
    };

    const rotateCellClockwise = (cx: number, cy: number) => {
      this.model.rotateCellCW(cx, cy);
      this.view.placeFromModel(cx, cy);
      // デバッグが要るなら残す
      // this.view.logCell?.(cx, cy);
    };

    const swapCells = (a: Pos, b: Pos) => {
      // BoardModelに swap がある前提で呼ぶ（無ければ BoardModel に追加推奨）
      const m: any = this.model as any;

      if (typeof m.swapCells === "function") {
        m.swapCells(a, b);
      } else if (typeof m.swap === "function") {
        m.swap(a, b);
      } else {
        // ここが無いと「全セル自由スワップ」は成立しない
        console.error(
          "[GameScene] BoardModel has no swapCells(a,b). Please implement it in BoardModel."
        );
        return;
      }

      // スワップ後、2セルだけ更新（syncAllより軽い）
      this.view.placeFromModel(a.x, a.y);
      this.view.placeFromModel(b.x, b.y);
    };

    const resolveAllWithAnimations = async () => {
      await this.resolveAndAnimate();
    };

    this.boardInput?.destroy();
    this.boardInput = new BoardInputController(
      {
        scene: this,
        cols: this.model.width,
        rows: this.model.height,
        worldToCell,
        cellToWorldCenter,
        cellSprites,
        rotateCellClockwise,
        swapCells,
        canInteract,
        lockInteract,
        unlockInteract,
        resolveAllWithAnimations,
      },
      {
        dragThresholdPx: 12,
        fingerOffsetY: -16,
        dragFollowLerp: 0.35,
        holdScale: 1.06,
        highlightAlpha: 0.22,
      }
    );
  }



  // -----------------------------
  // Resolve / UI
  // -----------------------------
  private async resolveAndAnimate() {
    if (this.state === "CLEAR") return;

    this.state = "RESOLVING";

    // Optional debug
    const dbg = this.model.debugWhyNotClearing?.();
    if (dbg) console.log("[FLOW DEBUG]", dbg);

    const res = this.model.resolveAll();
    await this.view.playSteps(res.steps);
    this.view.syncAll();

    if (this.goalText) this.goalText.setText(this.goalLabel());

    // clear check
    if (this.model.waterFlows >= this.model.stage.goal.waterFlowsToClear) {
      this.state = "CLEAR";
      if (this.statusText) {
        this.statusText.setText("CLEAR!");
        this.statusText.setColor("#00ff99");
      }
      // クリア時はここで「Tap to next」などの案内を出すのが次タスク
      return;
    }

    this.state = "PLAYING";
    if (this.statusText) this.statusText.setText("");
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
    const x = Math.floor((px - this.offsetX) / this.cellSize);
    const y = Math.floor((py - this.offsetY) / this.cellSize);

    if (x < 0 || x >= this.model.width || y < 0 || y >= this.model.height) return null;

    const left = this.offsetX;
    const top = this.offsetY;
    const right = this.offsetX + this.cellSize * this.model.width;
    const bottom = this.offsetY + this.cellSize * this.model.height;

    if (px < left || px >= right || py < top || py >= bottom) return null;

    return { x, y };
  }
}
