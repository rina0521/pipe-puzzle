// src/game/GameStateManager.ts
// ゲーム全体の状態（PLAYING / RESOLVING / CLEAR）を一元管理

export type GamePlayState = "PLAYING" | "RESOLVING" | "CLEAR";

/**
 * ゲームの実行状態と統計を管理
 * - PLAYING: 通常プレイ中、入力を受け付ける
 * - RESOLVING: ロジック処理中（落下・消去など）、入力ロック
 * - CLEAR: ステージクリア状態
 */
export class GameStateManager {
  private state: GamePlayState = "PLAYING";
  private waterFlows = 0;

  /**
   * 現在の状態を取得
   */
  getState(): GamePlayState {
    return this.state;
  }

  /**
   * 入力操作が可能か
   */
  canInteract(): boolean {
    return this.state === "PLAYING";
  }

  /**
   * 状態をPLAYINGにセット
   */
  startPlaying() {
    this.state = "PLAYING";
  }

  /**
   * 状態をRESOLVINGにセット（ロジック処理中）
   */
  startResolving() {
    this.state = "RESOLVING";
  }

  /**
   * RESOLVINGから復帰（クリアでなければPLAYINGへ）
   */
  finishResolving() {
    if (this.state === "CLEAR") return;
    this.state = "PLAYING";
  }

  /**
   * 状態をCLEARにセット
   */
  setClear() {
    this.state = "CLEAR";
  }

  /**
   * 水流カウントを増加
   */
  addWaterFlow(count: number = 1) {
    this.waterFlows += Math.max(0, count);
  }

  /**
   * 現在の水流カウントを取得
   */
  getWaterFlows(): number {
    return this.waterFlows;
  }

  /**
   * 状態と統計をリセット（ステージ再開時など）
   */
  reset() {
    this.state = "PLAYING";
    this.waterFlows = 0;
  }

  /**
   * 水流カウントのみリセット（状態は保持）
   */
  resetWaterFlows() {
    this.waterFlows = 0;
  }

  /**
   * デバッグ用：状態を文字列で取得
   */
  toString(): string {
    return `GameState(${this.state}, flows=${this.waterFlows})`;
  }
}
