// ═══════════════════════════════════════════════════════════
// PatternFlow Light — ESP32-S3 + HUB75E, Dual Core, 4 Knobs
// ═══════════════════════════════════════════════════════════
//
//  물리 노브 배치 (정면 기준):
//   ┌───────────────────┐
//   │  Knob4(⚡)  Knob3(🎲) │
//   │  Q2/Speed   Q1/Pattern │
//   │                       │
//   │  Knob1(🎨)  Knob2(🔀) │
//   │  Q3/Hue     Q4/Mode   │
//   └───────────────────┘
//
// Knob 1 (GPIO4, Q3-좌하): Hue       🎨  (continuous)
// Knob 2 (GPIO5, Q4-우하): Mode      🔀  (6 presets, snap)
// Knob 3 (GPIO6, Q1-우상): Pattern   🎲  (8-step: 0=uniform, 1-7=random)
// Knob 4 (GPIO7, Q2-좌상): Speed     ⚡  (continuous, 0~8)
// Brightness: 255 고정
// ADC: 경량화 — 4x 평균 + 단일 EMA (납땜 수정 후)
// ═══════════════════════════════════════════════════════════

#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <math.h>
#include <esp_random.h>

// ─── Panel Config ───
#define PANEL_W     128
#define PANEL_H     64
#define PANEL_CHAIN 1

// ─── HUB75E Pin Mapping ───
#define R1_PIN  42
#define G1_PIN  41
#define B1_PIN  40
#define R2_PIN  38
#define G2_PIN  39
#define B2_PIN  13
#define A_PIN   45
#define B_PIN   11
#define C_PIN   48
#define D_PIN   12
#define E_PIN   21
#define LAT_PIN 47
#define OE_PIN  14
#define CLK_PIN 2

MatrixPanel_I2S_DMA *dma_display = nullptr;

// ─── Knob Pins (물리 위치 → GPIO 매핑) ───
#define PIN_KNOB_HUE     4   // Knob1, Q3(좌하) 🎨
#define PIN_KNOB_MODE    5   // Knob2, Q4(우하) 🔀
#define PIN_KNOB_PATTERN 6   // Knob3, Q1(우상) 🎲
#define PIN_KNOB_SPEED   7   // Knob4, Q2(좌상) ⚡

// ─── ADC (경량화) ───
#define ADC_ALPHA     0.1f
#define PATTERN_STEPS 8

float readSmooth(int pin, float *ema) {
  int sum = 0;
  for (int i = 0; i < 4; i++) sum += analogRead(pin);
  float raw = (sum / 4) / 4095.0f;
  *ema += ADC_ALPHA * (raw - *ema);
  return *ema;
}

// ═══════════════════════════════════════════════════════════
// Mode Presets (6개)
// ═══════════════════════════════════════════════════════════
struct ModePreset {
  int rows, cols, gap, tileSize, gridStep, gridCells;
};

#define NUM_MODES 6
const ModePreset modes[NUM_MODES] = {
  { 1,  2, 2, 63, 7, 9 },   // 0: 가장 큰 타일 (63px, 2개)
  { 3,  6, 0, 21, 7, 3 },   // 1: 중대형 타일 (21px)
  { 4,  8, 0, 16, 4, 4 },   // 2: 중간 타일 (16px, 세밀)
  { 4,  8, 0, 16, 8, 2 },   // 3: 중간 타일 (16px, 굵은)
  { 4,  8, 0, 16, 8, 2 },   // 4: 중간 타일 (16px, 굵은)
  { 6, 12, 0, 10, 2, 5 },   // 5: 가장 작은 타일 (10px, 72개)
};

// ─── Core 간 공유 변수 ───
volatile float   knobHue      = 0.0f;
volatile int     knobMode     = 0;
volatile float   knobFreqBase = 15.0f;
volatile float   knobFreqVar  = 1.01f;
volatile float   knobSpeed    = 4.0f;

// ─── 현재 모드 상태 ───
int curMode = -1;
int totalW, totalH, offsetX, offsetY;

// ─── Distance LUT ───
#define MAX_GRID_CELLS 9
float distLUT[MAX_GRID_CELLS][MAX_GRID_CELLS];

void applyMode(int idx) {
  const ModePreset &m = modes[idx];
  totalW = m.cols * m.tileSize + (m.cols > 1 ? m.cols - 1 : 0) * m.gap;
  totalH = m.rows * m.tileSize + (m.rows > 1 ? m.rows - 1 : 0) * m.gap;
  offsetX = (PANEL_W - totalW) / 2;
  offsetY = (PANEL_H - totalH) / 2;

  float cx = m.tileSize / 2.0f;
  for (int gy = 0; gy < m.gridCells; gy++) {
    for (int gx = 0; gx < m.gridCells; gx++) {
      float sx = gx * m.gridStep + m.gridStep / 2.0f;
      float sy = gy * m.gridStep + m.gridStep / 2.0f;
      float dx = sx - cx;
      float dy = sy - cx;
      distLUT[gy][gx] = sqrtf(dx * dx + dy * dy);
    }
  }
  curMode = idx;
}

// ─── Sin LUT ───
#define SIN_LUT_SIZE 256
float sinLUT[SIN_LUT_SIZE];

void buildSinLUT() {
  for (int i = 0; i < SIN_LUT_SIZE; i++)
    sinLUT[i] = sinf((float)i / SIN_LUT_SIZE * 2.0f * PI);
}

inline float fastSin(float x) {
  float norm = x / (2.0f * PI);
  norm -= floorf(norm);
  if (norm < 0) norm += 1.0f;
  return sinLUT[(int)(norm * SIN_LUT_SIZE) & (SIN_LUT_SIZE - 1)];
}

// ─── HSV → RGB ───
void hsvToRgb(float h, float s, float v, uint8_t &r, uint8_t &g, uint8_t &b) {
  float c = v * s;
  float x = c * (1.0f - fabsf(fmodf(h * 6.0f, 2.0f) - 1.0f));
  float m = v - c;
  float rf, gf, bf;
  switch ((int)(h * 6.0f) % 6) {
    case 0: rf=c; gf=x; bf=0; break;
    case 1: rf=x; gf=c; bf=0; break;
    case 2: rf=0; gf=c; bf=x; break;
    case 3: rf=0; gf=x; bf=c; break;
    case 4: rf=x; gf=0; bf=c; break;
    default: rf=c; gf=0; bf=x; break;
  }
  r = (uint8_t)((rf + m) * 255.0f);
  g = (uint8_t)((gf + m) * 255.0f);
  b = (uint8_t)((bf + m) * 255.0f);
}

// ─── Color Ramp ───
struct ColorStop { float position; uint8_t r, g, b; };
#define NUM_STOPS 5
ColorStop colorRamp[NUM_STOPS];

void updateColorRamp(float hue) {
  uint8_t hr, hg, hb;
  hsvToRgb(hue, 1.0f, 1.0f, hr, hg, hb);
  colorRamp[0] = {0.000f,   0,   0,   0};
  colorRamp[1] = {0.154f,  40,  40,  40};
  colorRamp[2] = {0.556f,  hr,  hg,  hb};
  colorRamp[3] = {0.816f, 255, 255, 255};
  colorRamp[4] = {1.000f, 255, 255, 255};
}

void sampleColorRamp(float val, uint8_t &r, uint8_t &g, uint8_t &b) {
  float t = (val + 1.0f) * 0.5f;
  t = constrain(t, 0.0f, 1.0f);
  r = colorRamp[0].r; g = colorRamp[0].g; b = colorRamp[0].b;
  for (int i = 0; i < NUM_STOPS; i++) {
    if (t >= colorRamp[i].position) {
      r = colorRamp[i].r; g = colorRamp[i].g; b = colorRamp[i].b;
    }
  }
}

// ─── 랜덤 헬퍼 ───
float randomFloat(float minVal, float maxVal) {
  return minVal + ((float)(esp_random() % 10001) / 10000.0f) * (maxVal - minVal);
}

// ═══════════════════════════════════════════════════════════
// ADC Task — Core 0
// ═══════════════════════════════════════════════════════════
TaskHandle_t adcTaskHandle = NULL;

void adcTask(void *pvParameters) {
  float emaHue     = 0.5f;
  float emaMode    = 0.0f;
  float emaPattern = 0.0f;
  float emaSpeed   = 0.5f;

  int lastPatternStep = -1;

  for (;;) {
    // ── Hue: 연속 ──
    readSmooth(PIN_KNOB_HUE, &emaHue);
    knobHue = emaHue;

    // ── Mode: 6단계 스냅 ──
    readSmooth(PIN_KNOB_MODE, &emaMode);
    {
      int mode = (int)(emaMode * NUM_MODES);
      if (mode >= NUM_MODES) mode = NUM_MODES - 1;
      knobMode = mode;
    }

    // ── Pattern: 8-step ──
    //   step 0 = freqVar 1.01 고정 (타일 균일)
    //   step 1~7 = 스텝 바뀔 때마다 랜덤 freqBase + freqVar
    readSmooth(PIN_KNOB_PATTERN, &emaPattern);
    {
      int step = (int)(emaPattern * PATTERN_STEPS);
      if (step >= PATTERN_STEPS) step = PATTERN_STEPS - 1;

      if (step != lastPatternStep) {
        if (step == 0) {
          knobFreqBase = 15.0f;
          knobFreqVar  = 1.01f;
        } else {
          knobFreqBase = randomFloat(5.0f, 30.0f);
          knobFreqVar  = randomFloat(1.01f, 50.0f);
        }
        lastPatternStep = step;
      }
    }

    // ── Speed: 연속 (0~8) ──
    readSmooth(PIN_KNOB_SPEED, &emaSpeed);
    knobSpeed = emaSpeed * 8.0f;

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ═══════════════════════════════════════════════════════════
// Render Pattern — Core 1
// ═══════════════════════════════════════════════════════════
void renderPattern(float phase) {
  const ModePreset &m = modes[curMode];
  updateColorRamp(knobHue);

  int cellW = m.tileSize + m.gap;
  int cellH = m.tileSize + m.gap;
  float curFreqBase = knobFreqBase;
  float curFreqVar  = knobFreqVar;

  for (int y = 0; y < PANEL_H; y++) {
    for (int x = 0; x < PANEL_W; x++) {
      int lx = x - offsetX;
      int ly = y - offsetY;
      int ti = lx / cellW;
      int tj = ly / cellH;

      if (ti < 0 || ti >= m.cols || tj < 0 || tj >= m.rows) {
        dma_display->drawPixelRGB888(x, y, 0, 0, 0);
        continue;
      }

      int localX = lx - ti * cellW;
      int localY = ly - tj * cellH;

      if (localX < 0 || localX >= m.tileSize || localY < 0 || localY >= m.tileSize) {
        dma_display->drawPixelRGB888(x, y, 0, 0, 0);
        continue;
      }

      int gx = localX / m.gridStep;
      int gy = localY / m.gridStep;
      if (gx >= m.gridCells) gx = m.gridCells - 1;
      if (gy >= m.gridCells) gy = m.gridCells - 1;

      float dist = distLUT[gy][gx];
      int tileIndex = tj * m.cols + ti;
      float tileFreq = curFreqBase + tileIndex * curFreqVar * 0.15f;
      float wave = fastSin(dist * tileFreq * 0.5f + phase);

      uint8_t r, g, b;
      sampleColorRamp(wave, r, g, b);
      dma_display->drawPixelRGB888(x, y, r, g, b);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(1000);

  HUB75_I2S_CFG::i2s_pins _pins = {
    R1_PIN, G1_PIN, B1_PIN, R2_PIN, G2_PIN, B2_PIN,
    A_PIN, B_PIN, C_PIN, D_PIN, E_PIN, LAT_PIN, OE_PIN, CLK_PIN
  };
  HUB75_I2S_CFG mxconfig(PANEL_W, PANEL_H, PANEL_CHAIN, _pins);
  mxconfig.clkphase    = false;
  mxconfig.double_buff = true;

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  if (!dma_display->begin()) { while(1); }
  dma_display->setBrightness8(255);
  dma_display->clearScreen();

  buildSinLUT();
  applyMode(0);
  updateColorRamp(0.0f);

  analogReadResolution(12);
  pinMode(PIN_KNOB_HUE,     INPUT);
  pinMode(PIN_KNOB_MODE,    INPUT);
  pinMode(PIN_KNOB_PATTERN, INPUT);
  pinMode(PIN_KNOB_SPEED,   INPUT);

  xTaskCreatePinnedToCore(adcTask, "ADC", 4096, NULL, 2, &adcTaskHandle, 0);
}

// ═══════════════════════════════════════════════════════════
// Loop — Core 1 (렌더링)
// ═══════════════════════════════════════════════════════════
void loop() {
  static float phase = 0.0f;
  static unsigned long lastMs = millis();

  unsigned long now = millis();
  float dt = (now - lastMs) / 1000.0f;
  lastMs = now;

  phase += dt * knobSpeed * 2.0f;

  int mode = knobMode;
  if (mode != curMode) {
    applyMode(mode);
  }

  renderPattern(phase);
  dma_display->flipDMABuffer();
  delay(1);
}
