// src/scenes/GameScene.ts
import Phaser from "phaser";
import { BoardModel } from "../game/boardModel";
import type { StageConfig, Pos } from "../game/boardModel";
import { BoardView } from "../view/BoardView";
import { createStage001 } from "../stages/stage_001";
import { UI_BOTTOM_HEIGHT, uiHeights } from "../ui/layout";
import { BoardInputController } from "../ui/BoardInputController";
import { BoardLayout, type LayoutArea } from "../view/BoardLayout";
import { GameStateManager } from "../game/GameStateManager";
import { DEFAULT_ANIMATION_CONFIG } from "../view/AnimationConfig";
import { FrameRenderer } from "../view/FrameRenderer";

export class GameScene extends Phaser.Scene {
  private model!: BoardModel;
  private view!: BoardView;
  private gameState!: GameStateManager;
  private boardLayout!: BoardLayout;

  // Board area
  private boardArea!: LayoutArea;

  // UI refs
  private goalText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private restartBtn?: Phaser.GameObjects.Text;

  // Input controller
  private boardInput?: BoardInputController;

  // Frame renderer
  private frameRenderer?: FrameRenderer;

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

    this.load.image("tile_base_01", "assets/board/tiles/pipe_panel_tile_base_01.png");
    this.load.image("tile_base_02", "assets/board/tiles/pipe_panel_tile_base_02.png");
    this.load.image("tile_base_03", "assets/board/tiles/pipe_panel_tile_base_03.png");
    this.load.image("tile_base_04", "assets/board/tiles/pipe_panel_tile_base_04.png");

    // フレーム画像（9-スライス用）
    this.load.image("field_frame_base", "assets/board/frame/field_frame_base.png");

    // 出力パイプ画像
    this.load.image("out_pipe", "assets/board/frame/out_pipe.png");
    this.load.image("out_to", "assets/board/frame/out_to.png");

    // 背景画像
    this.load.image("bg_top", "assets/board/frame/background.png");

    // フランジ画像（パイプ接続部品）
    this.load.image("flange", "assets/pipe/flange.png");

    // 効果音
    this.load.audio("blip", "assets/sfx/blip.mp3");
    this.load.audio("rotate", "assets/sfx/rotate.mp3");
    this.load.audio("steam", "assets/sfx/steam.mp3");
    this.load.audio("water", "assets/sfx/water.mp3");

  }

  async create() {
    const stage: StageConfig = createStage001();
    this.model = new BoardModel(stage);
    this.gameState = new GameStateManager();

    const W = this.scale.width;
    const H = this.scale.height;

    const { top: dynamicTopHeight } = uiHeights(H);

    const GUTTER_X = Math.floor(W * 0.10); 
    const BOARD_SHIFT_Y = 0; 

    this.boardArea = {
      x: GUTTER_X,
      y: dynamicTopHeight + BOARD_SHIFT_Y,
      width: W - GUTTER_X * 2,
      height: H - (dynamicTopHeight + BOARD_SHIFT_Y) - UI_BOTTOM_HEIGHT,
    };

    // BoardLayout を作成（座標計算を統一）
    this.boardLayout = new BoardLayout(this.boardArea, this.model.width, this.model.height);

    this.buildCompositePipeTextures();

    // 上部背景（フレーム上端まで伸ばす）
    const frameTopY = this.boardLayout.offsetY - 48;  // FRAME_PART_SIZEと同じ値
    const bgTopHeight = frameTopY;
    const bgTop = this.add.image(W / 2, bgTopHeight / 2, "bg_top")
      .setOrigin(0.5, 0.5)
      .setDepth(0);
    bgTop.setDisplaySize(W, bgTopHeight);

    // フレーム描画
    this.frameRenderer = new FrameRenderer(this, this.boardLayout);
    this.frameRenderer.draw();

    // View（BoardLayout を渡す）
    this.view = new BoardView(this, this.model, this.boardArea, this.boardLayout, DEFAULT_ANIMATION_CONFIG);
    this.view.syncAll();

    this.add.text(W - 12, 10, "Pipe Flow", {
      fontSize: "14px",
      color: "#ffffff",
    }).setOrigin(1, 0);

    this.goalText = this.add.text(W - 12, 30, this.goalLabel(), {
      fontSize: "12px",
      color: "#cccccc",
    }).setOrigin(1, 0);

    this.statusText = this.add.text(12, 58, "", {
      fontSize: "22px",
      color: "#00ff99",
    });


    // Restart (keyboard)
    this.input.keyboard?.on("keydown-R", () => this.scene.restart());

    // Restart (button)
    this.createRestartButton();

    
    // Initial resolve
    await this.resolveAndAnimate();

    // Input controller
    this.setupBoardInput();
  }

  // 初期化時のヘルパー
  private createRestartButton() {
    this.restartBtn?.destroy();

    const x = this.scale.width - 12;
    const y = this.scale.height - 12;

    this.restartBtn = this.add
      .text(x, y, "RESTART", {
        fontSize: "16px",
        color: "#ffffff",
        backgroundColor: "#333333",
        padding: { left: 10, right: 10, top: 6, bottom: 6 },
      })
      .setOrigin(1, 1)
      .setInteractive({ useHandCursor: true })
      .setDepth(100000);

    this.restartBtn.on("pointerdown", () => this.scene.restart());
  }

  // 入力制御のセットアップ
  private setupBoardInput() {
    const cellSprites = this.view.getInputSpritesFlat();
    if (!cellSprites || cellSprites.length === 0) {
      return;
    }

    const worldToCell = (wx: number, wy: number): Pos | null => {
      return this.boardLayout.worldToCell(wx, wy);
    };

    const cellToWorldCenter = (cx: number, cy: number) => {
      const coord = this.boardLayout.cellCenter(cx, cy);
      return { x: coord.px, y: coord.py };
    };

    const canInteract = () => this.gameState.canInteract();
    const lockInteract = () => this.gameState.startResolving();
    const unlockInteract = () => this.gameState.finishResolving();

    const rotateCellClockwise = async (cx: number, cy: number) => {
      this.sound.play("rotate");
      this.model.rotateCellCW(cx, cy);
      this.view.placeFromModel(cx, cy);
    };

    const swapCells = (a: Pos, b: Pos) => {
      if (typeof this.model.swapCells === "function") {
        this.model.swapCells(a, b);
        this.view.forceDropPicked();
        this.view.placeFromModel(a.x, a.y);
        this.view.placeFromModel(b.x, b.y);
      }
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
        cellSprites: this.view.getInputSpritesFlat(),
        getTileSprite: (cx, cy) => this.view.getBaseSpriteAt(cx, cy),
        pickUp: (cx, cy) => this.view.pickUpAt(cx, cy),
        movePicked: (wx, wy) => this.view.movePickedTo(wx, wy),
        dropPicked: () => this.view.forceDropPicked(),
        rotateCellClockwise,
        swapCells,
        canInteract,
        lockInteract,
        unlockInteract,
        resolveAllWithAnimations,
      },
      {
        dragThresholdPx: 12,
        fingerOffsetY: -20,
        dragFollowLerp: 0.35,
        holdScale: 1.06,
        highlightAlpha: 0.22,
      }
    );
  }

  private buildCompositePipeTextures() {
    const TILE_KEYS = ["tile_base_01", "tile_base_02", "tile_base_03", "tile_base_04"] as const;
    const PIPE_KEYS = ["pipe_i", "pipe_l", "pipe_t", "pipe_x"] as const;

    const OUT = 143;          // 出力サイズ（タイルに合わせる）
    const PIPE_SRC = 600;     // 元パイプ画像サイズ
    const pipeScale = OUT / PIPE_SRC;

    // 既に作ってたら再生成しない（リスタート時の無駄を防ぐ）
    const exists = (key: string) => this.textures.exists(key);

    for (let tileIdx = 0; tileIdx < TILE_KEYS.length; tileIdx++) {
      const tileKey = TILE_KEYS[tileIdx];

      for (const pipeKey of PIPE_KEYS) {
        for (const rot of [0, 90, 180, 270] as const) {
          const outKey = `cmp_${tileKey}_${pipeKey}_r${rot}`;

          if (exists(outKey)) continue;

          // RenderTextureに「背景→パイプ」の順に描く
          const rt = this.make.renderTexture({ width: OUT, height: OUT }, false);

          // 背景タイル（ぴったり143想定）
          rt.draw(tileKey, 0, 0);

          // パイプ（600→143に縮小、回転して中央へ）
          // rt.draw は “その時点の transform” を見てくれないので、
          // 一旦 sprite を作って回転・スケールして rt.draw(sprite) する
          const spr = this.make.sprite(
            { key: pipeKey, x: OUT / 2, y: OUT / 2, add: false },
            false
          );
          spr.setScale(pipeScale);
          spr.setAngle(rot);

          rt.draw(spr);

          // テクスチャとして保存
          rt.saveTexture(outKey);

          // 後始末
          spr.destroy();
          rt.destroy();
        }
      }
    }
  }


  // -----------------------------
  // Resolve / UI
  // -----------------------------
  // ゲーム解決とアニメーション
  private async resolveAndAnimate() {
    if (this.gameState.getState() === "CLEAR") return;

    this.gameState.startResolving();

    const res = this.model.resolveAll();
    // モデルの水流カウントをゲーム状態に反映
    this.gameState.addWaterFlow(res.flowsGained);
    
    await this.view.playSteps(res.steps);
    this.view.syncAll();

    this.goalText.setText(this.goalLabel());

    // クリア判定
    if (this.gameState.getWaterFlows() >= this.model.stage.goal.waterFlowsToClear) {
      this.gameState.setClear();
      this.statusText.setText("CLEAR!");
      this.statusText.setColor("#00ff99");
      return;
    }

    this.gameState.finishResolving();
    this.statusText.setText("");
  }

  private goalLabel(): string {
    const need = this.model.stage.goal.waterFlowsToClear;
    const cur = this.gameState.getWaterFlows();
    return `Goal: flow ${need} times   (${cur}/${need})   [R] restart`;
  }
}
