/**
 * 遺伝的アルゴリズムを用いた障害物レース進化シミュレーション
 * 教育用途を意識して、アルゴリズムの流れや物理更新に関するコメントを多めに入れている。
 */

// シミュレーション全体で共有する設定値。ユーザー操作に応じて動的に更新する。
const config = {
  populationSize: 50,
  genomeLength: 80, // 1個体あたりの遺伝子数（時間的な意思決定の数）
  geneDuration: 10, // 1遺伝子が保持されるフレーム数
  mutationRate: 0.05,
  maxGenerations: 200,
  courseLength: 1000,
  baseSpeed: 4.2,
  gravity: 0.6,
  jumpVelocityMin: 6.4,
  jumpVelocityMax: 12.5,
  jumpThreshold: 0.52,
  jumpCooldownFrames: 18,
  runnerRadius: 8,
  groundMargin: 36,
  hurdleMode: 'random',
  manualHurdlesText: '150:1.2, 320:1.8, 520:1.5, 740:2.0',
  runnerColor: '#2563eb',
  runnerCrashColor: '#ef4444',
  hurdleColor: '#ff6347',
  hurdleHitColor: '#fb923c',
  hurdleMinGapFactor: 1.6,
  hurdleMinGapFactorBase: 1.6,
  maxHurdleHeightMultiplier: 5
};

const BASE_RANDOM_HURDLE_DIVISOR = 160;
const BASE_MANUAL_MIN_MULTIPLIER = 1;

// シミュレーションの状態を保持する。UI ボタンによる操作もここを参照する。
const simulationState = {
  running: true,
  halted: false,
  speedMultiplier: 1,
  viewOffset: 0,
  finalModalShown: false,
  level: 1,
  levelBestDistance: 0
};

// DOM 参照をまとめて保持。イベントリスナー設定時に使う。
const dom = {};

let population = null;
let obstacles = [];
let scoreChart = null;
let canvasHeight = 360;

/**
 * DOM が利用可能になったタイミングで UI を初期化する。
 */
window.addEventListener('DOMContentLoaded', () => {
  cacheDomElements();
  initControls();
  initScoreChart();
  updateManualHurdleVisibility();
  updateMutationLabel(config.mutationRate);
  if (dom.runnerColor) dom.runnerColor.value = config.runnerColor;
  if (dom.runnerCrashColor) dom.runnerCrashColor.value = config.runnerCrashColor;
  if (dom.hurdleColor) dom.hurdleColor.value = config.hurdleColor;
  if (dom.hurdleHitColor) dom.hurdleHitColor.value = config.hurdleHitColor;
  if (dom.manualHurdles) dom.manualHurdles.value = config.manualHurdlesText;
  updateButtonStates();
  updateLevelDisplay();
});

/**
 * p5.js によって最初に呼ばれるセットアップ関数。
 * キャンバス生成と初期化処理をまとめる。
 */
function setup() {
  const wrapper = document.getElementById('canvas-wrapper');
  const width = wrapper.clientWidth;
  const height = wrapper.clientHeight;
  canvasHeight = height;
  const canvas = createCanvas(width, height);
  canvas.parent('canvas-wrapper');
  frameRate(60);
  resetSimulation();
}

/**
 * リサイズ時にキャンバスの大きさを追従させる。
 */
function windowResized() {
  const wrapper = document.getElementById('canvas-wrapper');
  const width = wrapper.clientWidth;
  const height = wrapper.clientHeight;
  canvasHeight = height;
  resizeCanvas(width, height);
}

/**
 * 毎フレーム呼ばれる描画処理。p5.js の draw ループ。
 */
function draw() {
  background(232, 240, 255);

  if (!population) {
    return;
  }

  // カメラのオフセットを、先頭付近の個体を追尾するように滑らかに更新する。
  const leader = population.getLeader();
  const targetOffset = leader
    ? constrain(leader.x - width * 0.3, 0, config.courseLength - width + 120)
    : 0;
  simulationState.viewOffset = lerp(simulationState.viewOffset, targetOffset, 0.08);

  drawCourse();

  if (simulationState.running && !simulationState.halted) {
    const steps = Math.max(1, Math.round(simulationState.speedMultiplier));
    for (let i = 0; i < steps; i++) {
      population.update(obstacles);
    }
  }

  population.render(simulationState.viewOffset);

  updateDashboard(
    population.stats.averageDistance,
    population.stats.bestDistance,
    population.stats.dropouts
  );

  drawOverlayText();
}

/**
 * 道路とハードルなどのコース描画。
 */
function drawCourse() {
  const groundY = height - config.groundMargin;
  const offset = simulationState.viewOffset;

  // 地面
  stroke(120, 144, 156);
  strokeWeight(2);
  line(-offset, groundY, config.courseLength - offset + 80, groundY);

  // 距離の目盛り
  strokeWeight(1);
  for (let marker = 0; marker <= config.courseLength; marker += 100) {
    const screenX = marker - offset;
    if (screenX < -20 || screenX > width + 20) continue;
    stroke(167, 199, 231, 140);
    line(screenX, groundY, screenX, groundY + 12);
    noStroke();
    fill(100, 121, 152);
    textSize(10);
    textAlign(CENTER, TOP);
    text(`${marker}`, screenX, groundY + 14);
  }

  // ハードル
  noStroke();
  obstacles.forEach(obstacle => {
    const left = obstacle.x - offset;
    if (left + obstacle.width < -40 || left > width + 40) return;
    fill(obstacle.hit ? config.hurdleHitColor : config.hurdleColor);
    rect(left, groundY - obstacle.height, obstacle.width, obstacle.height, 3);
  });

  // ゴールライン
  const goalX = config.courseLength - offset;
  stroke(34, 197, 94);
  strokeWeight(6);
  line(goalX, groundY - 120, goalX, groundY);
  noStroke();
  fill(34, 197, 94);
  textSize(12);
  textAlign(CENTER, BOTTOM);
  text('FINISH', goalX, groundY - 126);
}

/**
 * 画面左上に簡単なヘルプを表示する。
 */
function drawOverlayText() {
  fill(30, 41, 59, 180);
  noStroke();
  textSize(13);
  textAlign(LEFT, TOP);
  const status = simulationState.running && !simulationState.halted ? '実行中' : '一時停止中';
  text(
    `ステータス: ${status}\nシミュレーション速度: ${simulationState.speedMultiplier.toFixed(1)}x\nレベル: ${simulationState.level}`,
    12,
    12
  );
}

/**
 * すべての UI の DOM 要素をキャッシュしておく。
 */
function cacheDomElements() {
  dom.populationSize = document.getElementById('population-size');
  dom.maxGenerations = document.getElementById('max-generations');
  dom.mutationRate = document.getElementById('mutation-rate');
  dom.mutationLabel = document.getElementById('mutation-rate-label');
  dom.courseLength = document.getElementById('course-length');
  dom.hurdleMode = document.getElementById('hurdle-mode');
  dom.manualHurdleGroup = document.getElementById('manual-hurdle-group');
  dom.manualHurdles = document.getElementById('manual-hurdles');
  dom.simulationSpeed = document.getElementById('simulation-speed');
  dom.togglePlay = document.getElementById('toggle-play');
  dom.nextGeneration = document.getElementById('next-generation');
  dom.stopSimulation = document.getElementById('stop-simulation');
  dom.resetSimulation = document.getElementById('reset-simulation');
  dom.runnerColor = document.getElementById('runner-color');
  dom.runnerCrashColor = document.getElementById('runner-crash-color');
  dom.hurdleColor = document.getElementById('hurdle-color');
  dom.hurdleHitColor = document.getElementById('hurdle-hit-color');
  dom.currentLevel = document.getElementById('current-level');

  dom.currentGeneration = document.getElementById('current-generation');
  dom.averageDistance = document.getElementById('average-distance');
  dom.bestDistance = document.getElementById('best-distance');
  dom.dropoutCount = document.getElementById('dropout-count');
  dom.resultModal = document.getElementById('result-modal');
  dom.resultMessage = document.getElementById('result-message');
  dom.closeModal = document.getElementById('close-modal');
}

/**
 * UI とシミュレーションの橋渡しを行うイベントリスナーの設定。
 */
function initControls() {
  // 入力値の変更が遺伝的アルゴリズムに即座に反映されるようにする。
  dom.populationSize.addEventListener('change', () => {
    const value = clamp(parseInt(dom.populationSize.value, 10) || config.populationSize, 10, 200);
    dom.populationSize.value = value;
    config.populationSize = value;
    resetSimulation();
  });

  dom.maxGenerations.addEventListener('change', () => {
    const value = clamp(parseInt(dom.maxGenerations.value, 10) || config.maxGenerations, 10, 1000);
    dom.maxGenerations.value = value;
    config.maxGenerations = value;
  });

  dom.mutationRate.addEventListener('input', () => {
    const value = parseFloat(dom.mutationRate.value);
    config.mutationRate = value;
    updateMutationLabel(value);
  });

  dom.courseLength.addEventListener('change', () => {
    const value = clamp(parseInt(dom.courseLength.value, 10) || config.courseLength, 400, 3000);
    dom.courseLength.value = value;
    config.courseLength = value;
    resetSimulation();
  });

  dom.hurdleMode.addEventListener('change', () => {
    config.hurdleMode = dom.hurdleMode.value;
    updateManualHurdleVisibility();
    if (config.hurdleMode === 'manual') {
      config.manualHurdlesText = dom.manualHurdles.value.trim();
    }
    resetObstacles();
    resetSimulation();
  });

  dom.manualHurdles.addEventListener('blur', () => {
    if (config.hurdleMode !== 'manual') return;
    config.manualHurdlesText = dom.manualHurdles.value.trim();
    resetObstacles();
    resetSimulation();
  });

  dom.simulationSpeed.addEventListener('change', () => {
    simulationState.speedMultiplier = parseFloat(dom.simulationSpeed.value);
  });

  dom.togglePlay.addEventListener('click', () => {
    if (simulationState.halted) {
      simulationState.halted = false;
    }
    simulationState.running = !simulationState.running;
    updateButtonStates();
  });

  dom.nextGeneration.addEventListener('click', () => {
    if (!population) return;
    population.forceAdvance();
    updateDashboard(population.stats.averageDistance, population.stats.bestDistance, population.stats.dropouts);
  });

  dom.stopSimulation.addEventListener('click', () => {
    simulationState.running = false;
    simulationState.halted = true;
    updateButtonStates();
  });

  dom.resetSimulation.addEventListener('click', () => {
    resetSimulation();
  });

  if (dom.runnerColor) {
    dom.runnerColor.addEventListener('input', () => {
      config.runnerColor = dom.runnerColor.value;
    });
  }

  if (dom.runnerCrashColor) {
    dom.runnerCrashColor.addEventListener('input', () => {
      config.runnerCrashColor = dom.runnerCrashColor.value;
    });
  }

  if (dom.hurdleColor) {
    dom.hurdleColor.addEventListener('input', () => {
      config.hurdleColor = dom.hurdleColor.value;
    });
  }

  if (dom.hurdleHitColor) {
    dom.hurdleHitColor.addEventListener('input', () => {
      config.hurdleHitColor = dom.hurdleHitColor.value;
    });
  }

  if (dom.closeModal) {
    dom.closeModal.addEventListener('click', hideResultModal);
  }

  if (dom.resultModal) {
    dom.resultModal.addEventListener('click', event => {
      if (event.target === dom.resultModal) {
        hideResultModal();
      }
    });
  }
}

/**
 * Chart.js を用いたスコア推移の初期化。
 */
function initScoreChart() {
  const ctx = document.getElementById('score-chart').getContext('2d');
  scoreChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: '最長到達距離',
          data: [],
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.15)',
          tension: 0.25,
          fill: true,
          pointRadius: 3
        },
        {
          label: '平均到達距離',
          data: [],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          tension: 0.25,
          fill: true,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: {
            display: true,
            text: '世代'
          }
        },
        y: {
          title: {
            display: true,
            text: '到達距離'
          },
          suggestedMin: 0,
          suggestedMax: config.courseLength
        }
      },
      plugins: {
        legend: {
          labels: {
            font: {
              family: '"Segoe UI", "Meiryo", sans-serif'
            }
          }
        }
      }
    }
  });
}

/**
 * Chart.js のデータをリセットする。
 */
function resetChart() {
  if (!scoreChart) return;
  scoreChart.data.labels = [];
  scoreChart.data.datasets.forEach(dataset => {
    dataset.data = [];
  });
  scoreChart.options.scales.y.suggestedMax = config.courseLength;
  scoreChart.update('none');
}

/**
 * シミュレーションを初期状態に戻す。
 */
function resetSimulation() {
  hideResultModal();
  simulationState.finalModalShown = false;
  simulationState.level = 1;
  simulationState.levelBestDistance = 0;
  applyDifficultySettings();
  updateLevelDisplay();
  resetObstacles();
  population = new Population(config);
  simulationState.running = true;
  simulationState.halted = false;
  simulationState.viewOffset = 0;
  resetChart();
  updateDashboard(0, 0, 0);
  updateButtonStates();
}

/**
 * 現在の設定に基づきハードルを生成し直す。
 */
function resetObstacles() {
  applyDifficultySettings();
  if (config.hurdleMode === 'manual') {
    obstacles = parseManualHurdles(config.manualHurdlesText);
  } else {
    obstacles = generateRandomHurdles(config.courseLength);
  }
  clearObstacleHits();
}

/**
 * ハードルの手動配置入力を解析する。
 */
function parseManualHurdles(text) {
  if (!text) return [];
  const runnerDiameter = config.runnerRadius * 2;
  const level = simulationState.level || 1;
  const difficulty = getLevelDifficulty(level);
  const heightBoost = 1 + (level - 1) * 0.15;
  const entries = text
    .split(',')
    .map(str => str.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const [posStr, heightStr] = entry.split(':').map(part => part.trim());
      const position = parseFloat(posStr);
      if (Number.isNaN(position) || position <= 50 || position >= config.courseLength - 40) {
        return null;
      }
      let multiplier = heightStr !== undefined ? parseFloat(heightStr) : 1.5;
      if (Number.isNaN(multiplier)) {
        multiplier = 1.5;
      }
      multiplier = clamp(
        multiplier * heightBoost,
        BASE_MANUAL_MIN_MULTIPLIER,
        config.maxHurdleHeightMultiplier
      );
      if (multiplier < difficulty.minMultiplier) {
        multiplier = difficulty.minMultiplier;
      }
      return {
        id: `manual-${idx}`,
        x: position,
        width: 14,
        height: runnerDiameter * multiplier,
        hit: false
      };
    })
    .filter(Boolean);
  let combined = entries;

  if (combined.length === 0) {
    return generateRandomHurdles(config.courseLength);
  }

  if (level > 1) {
    const extraPool = generateRandomHurdles(config.courseLength);
    const extraCount = Math.min(extraPool.length, level + Math.ceil(combined.length / 2));
    combined = combined.concat(extraPool.slice(0, extraCount));
  }

  return enforceObstacleSpacing(combined);
}

/**
 * ランダムなハードル配置を生成。
 */
function generateRandomHurdles(length) {
  const runnerDiameter = config.runnerRadius * 2;
  const level = simulationState.level || 1;
  const difficulty = config.currentDifficulty || getLevelDifficulty(level);
  const divisor = BASE_RANDOM_HURDLE_DIVISOR / difficulty.countBoost;
  const hurdleCount = Math.max(6 + (level - 1), Math.round(length / divisor));
  const segmentLength = Math.max((length - 240) / hurdleCount, runnerDiameter * 1.8);
  const hurdles = [];
  let segmentStart = 120;

  for (let i = 0; i < hurdleCount; i++) {
    const widthRange = Math.max(difficulty.widthMax - difficulty.widthMin, 0.0001);
    const rawWidth = difficulty.widthMin + Math.random() * widthRange;
    const width = clamp(rawWidth, difficulty.widthMin, difficulty.widthMax);
    const multiplierRange = Math.max(difficulty.maxMultiplier - difficulty.minMultiplier, 0.0001);
    const rawMultiplier = difficulty.minMultiplier + Math.random() * multiplierRange;
    const multiplier = clamp(rawMultiplier, difficulty.minMultiplier, difficulty.maxMultiplier);
    const height = runnerDiameter * multiplier;
    const segmentEnd = segmentStart + segmentLength;
    let maxPosition = Math.min(length - 140 - width, segmentEnd - width);
    let minPosition = Math.max(segmentStart, 80 + i * 20);
    if (maxPosition <= minPosition) {
      maxPosition = minPosition + config.runnerRadius * 4;
    }
    const positionRange = Math.max(maxPosition - minPosition, config.runnerRadius);
    const position = clamp(minPosition + Math.random() * positionRange, minPosition, maxPosition);
    hurdles.push({
      id: `rand-${i}`,
      x: position,
      width,
      height,
      hit: false
    });
    const spacingModifier = 0.5 + Math.random() * 0.6;
    segmentStart += segmentLength * spacingModifier;
    segmentStart = Math.min(segmentStart, length - 180);
  }

  return enforceObstacleSpacing(hurdles);
}

/**
 * ハードル間の最小間隔を強制する。
 */
function enforceObstacleSpacing(hurdles) {
  if (!hurdles || hurdles.length === 0) return [];
  const sorted = [...hurdles].sort((a, b) => a.x - b.x);
  const filtered = [];
  sorted.forEach(current => {
    const candidate = { ...current, hit: false };
    if (filtered.length === 0) {
      candidate.x = Math.max(candidate.x, 80);
      filtered.push(candidate);
      return;
    }
    const prev = filtered[filtered.length - 1];
    const prevRight = prev.x + prev.width;
    const gap = candidate.x - prevRight;
    const minGap = config.hurdleMinGapFactor * Math.max(prev.width, candidate.width);
    let adjustedX = candidate.x;
    if (gap < minGap) {
      adjustedX = prevRight + minGap;
    }
    const maxAllowed = config.courseLength - 80 - candidate.width;
    adjustedX = clamp(adjustedX, prevRight + minGap, maxAllowed);
    if (adjustedX > prevRight) {
      candidate.x = adjustedX;
      filtered.push(candidate);
    }
  });
  return filtered;
}

/**
 * ハードルの当たり判定フラグをリセットする。
 */
function clearObstacleHits() {
  if (!Array.isArray(obstacles)) return;
  obstacles.forEach(obstacle => {
    obstacle.hit = false;
  });
}

/**
 * ダッシュボードの UI 更新。
 */
function updateDashboard(avgDistance, bestDistance, dropoutCount) {
  if (!dom.currentGeneration) return;

  dom.currentGeneration.textContent = population ? population.generation.toString() : '1';
  dom.averageDistance.textContent = avgDistance ? avgDistance.toFixed(1) : '0.0';
  const levelBest = simulationState.levelBestDistance || bestDistance || 0;
  dom.bestDistance.textContent = levelBest ? levelBest.toFixed(1) : '0.0';
  if (dom.dropoutCount) {
    dom.dropoutCount.textContent = dropoutCount != null ? String(dropoutCount) : '0';
  }
}

/**
 * Chart.js に新しいデータを追加する。
 */
function appendChartData(generation, avgDistance, bestDistance) {
  if (!scoreChart) return;
  scoreChart.data.labels.push(`第${generation}世代`);
  scoreChart.data.datasets[0].data.push(bestDistance);
  scoreChart.data.datasets[1].data.push(avgDistance);
  scoreChart.options.scales.y.suggestedMax = Math.max(config.courseLength, bestDistance * 1.1);
  scoreChart.update('none');
}

/**
 * 突然変異率を表記するラベルの更新。
 */
function updateMutationLabel(value) {
  if (dom.mutationLabel) {
    const percent = (value * 100).toFixed(value < 0.01 ? 2 : 1);
    dom.mutationLabel.textContent = `${percent}%`;
  }
}

/**
 * 手動配置テキストエリアの表示制御。
 */
function updateManualHurdleVisibility() {
  if (!dom.manualHurdleGroup) return;
  dom.manualHurdleGroup.style.display = config.hurdleMode === 'manual' ? 'flex' : 'none';
}

/**
 * 再生・停止ボタンの表示や有効状態を更新する。
 */
function updateButtonStates() {
  if (!dom.togglePlay) return;
  dom.togglePlay.textContent = simulationState.running && !simulationState.halted ? '一時停止' : '再生';
  if (dom.stopSimulation) {
    dom.stopSimulation.disabled = simulationState.halted;
  }
}

/**
 * 現在のレベルに応じたパラメータを算出する。
 */
function getLevelDifficulty(level) {
  const effectiveLevel = Math.max(1, level || 1);
  const growth = 1 + (effectiveLevel - 1) * 0.2;
  const gapFactor = Math.max(0.85, config.hurdleMinGapFactorBase / growth);
  const countBoost = 1 + (effectiveLevel - 1) * 0.25;
  const maxMultiplierLimit = config.maxHurdleHeightMultiplier || 5;
  const minMultiplier = Math.min(maxMultiplierLimit, 1.6 + (effectiveLevel - 1) * 0.2);
  const maxMultiplier = Math.min(maxMultiplierLimit, 2.5 + (effectiveLevel - 1) * 0.35);
  const widthMin = Math.max(8, 12 - (effectiveLevel - 1) * 0.7);
  const widthMax = Math.max(widthMin + 2, 18 - (effectiveLevel - 1) * 0.4);
  return { gapFactor, countBoost, minMultiplier, maxMultiplier, widthMin, widthMax };
}

/**
 * レベルに応じた難易度設定を反映する。
 */
function applyDifficultySettings() {
  const difficulty = getLevelDifficulty(simulationState.level);
  config.hurdleMinGapFactor = difficulty.gapFactor;
  config.currentDifficulty = difficulty;
}

/**
 * レベル表示を更新する。
 */
function updateLevelDisplay() {
  if (!dom.currentLevel) return;
  dom.currentLevel.textContent = simulationState.level.toString();
}

/**
 * レベルを上げ、ハードルを再配置する。
 */
function increaseLevel() {
  simulationState.level += 1;
  simulationState.levelBestDistance = 0;
  applyDifficultySettings();
  updateLevelDisplay();
  simulationState.viewOffset = 0;
  resetObstacles();
}

/**
 * 最終結果モーダルを表示する。
 */
function showResultModal(bestDistance) {
  if (!dom.resultModal || !dom.resultMessage) return;
  dom.resultMessage.innerHTML = `最終レベル：レベル${simulationState.level}<br>最終到達距離：${bestDistance.toFixed(1)} m`;
  dom.resultModal.classList.remove('hidden');
  simulationState.finalModalShown = true;
}

/**
 * モーダルを非表示にする。
 */
function hideResultModal() {
  if (!dom.resultModal) return;
  dom.resultModal.classList.add('hidden');
}

/**
 * 数値を範囲内に抑える便利関数。
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 疑似ランダム値を生成する（手動ハードルの高さ用）。入力値に基づいて決定的にする。
 */
function randomInRange(min, max, seedIndex) {
  const seed = Math.sin(seedIndex * 78.233) * 43758.5453;
  const normalized = seed - Math.floor(seed);
  return min + normalized * (max - min);
}

/**
 * 遺伝子表現：時間軸に沿ってジャンプ命令の強さを並べた配列。
 * 個体はジャンプ命令が一定閾値を超えるとジャンプを試みる。
 */
class Individual {
  constructor(genome, settings) {
    this.genome = genome.slice();
    this.settings = settings;
    this.radius = settings.runnerRadius;
    this.resetState();
    this.distance = 0;
    this.finished = false;
    this.crashed = false;
    this.success = false;
    this.currentGeneIndex = -1;
    this.jumpCooldown = 0;
    this.canTriggerJump = true;
  }

  /**
   * シミュレーション開始時の位置や速度をリセットする。
   */
  resetState() {
    this.x = 40;
    const groundCenterY = height - this.settings.groundMargin - this.radius;
    this.y = groundCenterY;
    this.vx = this.settings.baseSpeed;
    this.vy = 0;
    this.elapsedFrames = 0;
    this.finished = false;
    this.crashed = false;
    this.success = false;
    this.distance = 0;
    this.currentGeneIndex = -1;
    this.jumpCooldown = 0;
    this.canTriggerJump = true;
  }

  /**
   * 遺伝子情報に基づいて 1 フレーム分の物理更新を行う。
   */
  update(obstacles, settings) {
    if (this.finished) return;

    this.elapsedFrames += 1;

    // 遺伝子の選択：経過フレーム数を geneDuration で割ったインデックスを参照。
    const geneIndex = Math.min(
      Math.floor(this.elapsedFrames / settings.geneDuration),
      this.genome.length - 1
    );

    if (geneIndex !== this.currentGeneIndex) {
      this.currentGeneIndex = geneIndex;
      this.canTriggerJump = true;
    }

    const geneValue = this.genome[geneIndex];

    // ジャンプ判定：現在の遺伝子値が閾値を超え、かつジャンプ可能であればジャンプ。
    const onGround = this.isOnGround();
    if (onGround && this.jumpCooldown <= 0 && this.canTriggerJump && geneValue > settings.jumpThreshold) {
      const power = mapValue(geneValue, settings.jumpThreshold, 1, settings.jumpVelocityMin, settings.jumpVelocityMax);
      this.vy = -power;
      this.canTriggerJump = false;
      this.jumpCooldown = settings.jumpCooldownFrames;
    } else if (geneValue < settings.jumpThreshold * 0.6) {
      // 十分低い値に戻ったら次のジャンプを許可する。
      this.canTriggerJump = true;
    }

    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= 1;
    }

    // 遺伝子により僅かに前進速度を変化させる（バリエーション付与）。
    const strideBoost = (geneValue - 0.5) * 0.6;
    const forwardVelocity = this.vx + strideBoost;

    // 水平移動と重力による垂直移動。
    this.x += forwardVelocity;
    this.vy += settings.gravity;
    this.y += this.vy;

    // 地面との衝突判定。
    const groundCenterY = height - settings.groundMargin - this.radius;
    if (this.y > groundCenterY) {
      this.y = groundCenterY;
      this.vy = 0;
    }

    this.distance = Math.max(this.distance, this.x);

    // コースを完走した場合は成功フラグを立てる。
    if (this.x >= settings.courseLength) {
      this.distance = settings.courseLength;
      this.success = true;
      this.finished = true;
      return;
    }

    // ハードルと衝突したら失敗。
    if (this.collidesWith(obstacles, settings)) {
      this.crashed = true;
      this.finished = true;
      return;
    }

    // 遺伝子長に応じて最大シミュレーション時間を超えたら終了。
    const maxFrames = settings.genomeLength * settings.geneDuration;
    if (this.elapsedFrames >= maxFrames) {
      this.finished = true;
    }
  }

  /**
   * 地面に接地しているかを判定。
   */
  isOnGround() {
    const groundCenterY = height - this.settings.groundMargin - this.radius;
    return Math.abs(this.y - groundCenterY) < 0.01;
  }

  /**
   * 円と矩形の距離チェックによる衝突判定。
   */
  collidesWith(obstacles, settings) {
    for (const obstacle of obstacles) {
      const rectLeft = obstacle.x;
      const rectRight = obstacle.x + obstacle.width;
      const rectTop = height - settings.groundMargin - obstacle.height;
      const rectBottom = height - settings.groundMargin;

      // 浮動小数を扱うため矩形と円の最短距離で判定する。
      const closestX = clamp(this.x, rectLeft, rectRight);
      const closestY = clamp(this.y, rectTop, rectBottom);
      const dx = this.x - closestX;
      const dy = this.y - closestY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= this.radius * this.radius) {
        obstacle.hit = true;
        return true;
      }
    }
    return false;
  }

  /**
   * p5.js を用いて個体を描画する。
   */
  render(offset) {
    const screenX = this.x - offset;
    if (screenX < -40 || screenX > width + 40) return;

    push();
    noStroke();
    if (this.crashed) {
      fill(config.runnerCrashColor);
    } else {
      fill(config.runnerColor);
    }
    circle(screenX, this.y, this.radius * 2);
    pop();
  }

  /**
   * 子個体を生成する際に利用するコピー関数。
   */
  clone() {
    return new Individual(this.genome, this.settings);
  }
}

/**
 * 個体群を管理し、評価→選択→交叉→突然変異の流れを担う。
 */
class Population {
  constructor(settings) {
    this.settings = settings;
    this.individuals = [];
    this.generation = 1;
    this.stats = {
      averageDistance: 0,
      bestDistance: 0,
      dropouts: 0
    };
    this.bestIndividual = null;
    this._breeding = false;
    this.overallBest = {
      distance: 0,
      generation: 1
    };
    this.createInitialPopulation();
  }

  createInitialPopulation() {
    this.individuals = [];
    for (let i = 0; i < this.settings.populationSize; i++) {
      this.individuals.push(new Individual(this.randomGenome(), this.settings));
    }
    this.generation = 1;
    this.bestIndividual = null;
    this.stats = { averageDistance: 0, bestDistance: 0, dropouts: 0 };
    this.overallBest = { distance: 0, generation: 1 };
  }

  /**
   * 初期遺伝子は 0〜1 の一様乱数で生成する。
   */
  randomGenome() {
    const genome = [];
    for (let i = 0; i < this.settings.genomeLength; i++) {
      genome.push(Math.random());
    }
    return genome;
  }

  /**
   * 各フレームで全個体の状態を更新し、世代終了を検知したら次世代を生成する。
   */
  update(obstacles) {
    if (this._breeding) return;
    let activeCount = 0;
    for (const individual of this.individuals) {
      if (!individual.finished) {
        individual.update(obstacles, this.settings);
      }
      if (!individual.finished) {
        activeCount += 1;
      }
    }
    this.updateStats();

    if (activeCount === 0) {
      this._breeding = true;
      this.evaluateAndBreed();
      this._breeding = false;
    }
  }

  /**
   * 世代ごとの統計値を算出する。
   */
  updateStats() {
    let sum = 0;
    let best = 0;
    let bestIndividual = null;
    let dropouts = 0;
    let completed = 0;
    for (const individual of this.individuals) {
      sum += individual.distance;
      if (individual.distance > best) {
        best = individual.distance;
        bestIndividual = individual;
      }
      if (individual.crashed) {
        dropouts += 1;
      }
      if (individual.success) {
        completed += 1;
      }
    }
    this.stats.averageDistance = this.individuals.length ? sum / this.individuals.length : 0;
    this.stats.bestDistance = best;
    this.stats.dropouts = dropouts;
    this.stats.completedCount = completed;
    this.bestIndividual = bestIndividual;
    simulationState.levelBestDistance = Math.max(
      simulationState.levelBestDistance || 0,
      best
    );

    if (bestIndividual && bestIndividual.distance > (this.overallBest?.distance || 0)) {
      this.overallBest = {
        distance: bestIndividual.distance,
        generation: this.generation
      };
    }
  }

  /**
   * 世代評価後に選択・交叉・突然変異を実行して次世代を生み出す。
   */
  evaluateAndBreed() {
    this.updateStats();
    const completedThisGeneration = this.stats.completedCount || 0;
    if (completedThisGeneration > 0) {
      increaseLevel();
    }
    if (this.bestIndividual) {
      appendChartData(this.generation, this.stats.averageDistance, this.stats.bestDistance);
    }

    if (this.generation >= this.settings.maxGenerations) {
      simulationState.running = false;
      simulationState.halted = true;
      updateButtonStates();
      if (!simulationState.finalModalShown) {
        const bestDistance = Math.max(
          simulationState.levelBestDistance || 0,
          this.stats.bestDistance || 0
        );
        showResultModal(bestDistance);
      }
      return;
    }

    const matingPool = [...this.individuals].sort((a, b) => b.distance - a.distance);
    const eliteCount = Math.max(2, Math.round(this.settings.populationSize * 0.1));
    const elites = matingPool.slice(0, eliteCount).map(ind => ind.clone());
    const nextGeneration = [];

    // エリート保存戦略：優秀な個体をそのまま次世代へ送る。
    elites.forEach(elite => {
      elite.resetState();
      nextGeneration.push(elite);
    });

    while (nextGeneration.length < this.settings.populationSize) {
      const parentA = this.weightedSelection(matingPool);
      const parentB = this.weightedSelection(matingPool);
      const childGenome = this.crossover(parentA.genome, parentB.genome);
      this.mutate(childGenome);
      const child = new Individual(childGenome, this.settings);
      nextGeneration.push(child);
    }

    this.individuals = nextGeneration;
    this.generation += 1;
    clearObstacleHits();
  }

  /**
   * ルーレット（重み付き）選択。距離が長いほど選ばれやすくなる。
   */
  weightedSelection(pool) {
    const total = pool.reduce((acc, ind) => acc + ind.distance + 1, 0);
    let threshold = Math.random() * total;
    for (const individual of pool) {
      threshold -= individual.distance + 1;
      if (threshold <= 0) {
        return individual;
      }
    }
    return pool[0];
  }

  /**
   * 単一点交叉：ある時点で親を切り替える。
   */
  crossover(genomeA, genomeB) {
    const cutPoint = Math.floor(Math.random() * genomeA.length);
    const child = [];
    for (let i = 0; i < genomeA.length; i++) {
      const gene = i < cutPoint ? genomeA[i] : genomeB[i];
      child.push(gene);
    }
    return child;
  }

  /**
   * 突然変異：確率的に遺伝子値へノイズを加える。
   */
  mutate(genome) {
    for (let i = 0; i < genome.length; i++) {
      if (Math.random() < this.settings.mutationRate) {
        const delta = (Math.random() - 0.5) * 0.6;
        genome[i] = clamp(genome[i] + delta, 0, 1);
      }
    }
  }

  /**
   * 個体群を描画する。
   */
  render(offset) {
    this.individuals.forEach(individual => individual.render(offset));
  }

  /**
   * 表示用に先頭の個体を取得。
   */
  getLeader() {
    let leader = null;
    let best = -Infinity;
    for (const individual of this.individuals) {
      if (individual.x > best) {
        best = individual.x;
        leader = individual;
      }
    }
    return leader;
  }

  /**
   * ボタン操作で強制的に次世代へ移行する。
   */
  forceAdvance() {
    this.individuals.forEach(ind => {
      ind.finished = true;
    });
    this.evaluateAndBreed();
  }
}

/**
 * 値を別の範囲に写像するユーティリティ。
 */
function mapValue(value, inMin, inMax, outMin, outMax) {
  const clamped = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + clamped * (outMax - outMin);
}
