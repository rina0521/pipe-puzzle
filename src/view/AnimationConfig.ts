// src/view/AnimationConfig.ts
// 演出関連の設定値を一元管理（ステージごとに異なる可能性有り）

/**
 * 水流演出の設定
 */
export type WaterAnimConfig = {
  stepDelayMs: number;        // ステップ間の遅延
  waterStepMs: number;        // 水が次のセルに進む時間
  waterTailMs: number;        // WATER演出終了後の余韻
  fadeOutMs: number;          // 水消失のフェード時間
  waterAlpha: number;         // 水の最大透明度
  enableParticle: boolean;    // 白点パーティクルの有効
  waterHopMs: number;         // パーティクルが1マス進む時間
  enableNotes: boolean;       // 水流音
};

/**
 * クリア演出の設定
 */
export type ClearAnimConfig = {
  flashMs: number;            // フラッシュ継続時間（将来用）
};

/**
 * ドロップ演出の設定
 */
export type DropAnimConfig = {
  durationMs: number;         // 落下時間
  easeFunction: string;       // Phaser easeキー
};

/**
 * 全体の演出設定
 */
export type AnimationConfig = {
  water: WaterAnimConfig;
  clear: ClearAnimConfig;
  drop: DropAnimConfig;
};

/**
 * デフォルト演出設定
 * （カジュアルで理解しやすい）
 */
export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  water: {
    stepDelayMs: 0,
    waterStepMs: 140,
    waterTailMs: 250,
    fadeOutMs: 420,
    waterAlpha: 0.65,
    enableParticle: true,
    waterHopMs: 220,
    enableNotes: true,
  },
  clear: {
    flashMs: 200,
  },
  drop: {
    durationMs: 140,
    easeFunction: "Sine.easeInOut",
  },
};

/**
 * より速い演出（カジュアル・ハイテンポ向け）
 */
export const FAST_ANIMATION_CONFIG: AnimationConfig = {
  water: {
    stepDelayMs: 0,
    waterStepMs: 80,
    waterTailMs: 150,
    fadeOutMs: 250,
    waterAlpha: 0.65,
    enableParticle: true,
    waterHopMs: 120,
    enableNotes: true,
  },
  clear: {
    flashMs: 150,
  },
  drop: {
    durationMs: 100,
    easeFunction: "Sine.easeInOut",
  },
};

/**
 * より遅い演出（シアトリカル・説明的向け）
 */
export const SLOW_ANIMATION_CONFIG: AnimationConfig = {
  water: {
    stepDelayMs: 20,
    waterStepMs: 220,
    waterTailMs: 400,
    fadeOutMs: 600,
    waterAlpha: 0.65,
    enableParticle: true,
    waterHopMs: 300,
    enableNotes: true,
  },
  clear: {
    flashMs: 300,
  },
  drop: {
    durationMs: 200,
    easeFunction: "Sine.easeInOut",
  },
};

/**
 * 演出設定をマージ（部分的な上書きを支援）
 */
export function mergeAnimationConfig(
  base: AnimationConfig,
  override?: Partial<AnimationConfig>
): AnimationConfig {
  if (!override) return base;

  return {
    water: { ...base.water, ...(override.water || {}) },
    clear: { ...base.clear, ...(override.clear || {}) },
    drop: { ...base.drop, ...(override.drop || {}) },
  };
}
