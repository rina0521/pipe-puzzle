import type { StageConfig } from "../game/boardModel";

export function createStage001(): StageConfig {
  return {
    version: 1 as any,
    id: "stage_001",
    name: "Tutorial 1",
    board: { width: 5, height: 7 },
    goal: { waterFlowsToClear: 3 },
    rules: {
      clearMode: "A_REACHABLE",
      branchSealRequired: false,
      spawns: { pipeSetSize: 1, allowRotateBeforeDrop: true },
    },
    faucets: {
      mode: "ANY_EDGE",
      left: { enabledRows: "ALL" },
      right: { enabledRows: "ALL" },
    },
    deck: {
      enabledPieces: { I2: true, L2: true, T3: true, X4: false, STOP1: false, ARROW: false },
      weights: { I2: 45, L2: 45, T3: 10, X4: 0, STOP1: 0, ARROW: 0 },
      rng: { seed: null },
    },
    initialFill: {
      mode: "RANDOM_ROWS",
      rowsFromBottom: 999,
      useInitialWeights: true,
    },
  };
}
