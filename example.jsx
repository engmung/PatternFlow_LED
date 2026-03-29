import { useState, useEffect, useRef, useCallback } from "react";

const COLS = 128;
const ROWS = 64;
const LED_SIZE = 5;
const LED_GAP = 1;
const PIXEL_SIZE = LED_SIZE + LED_GAP;

const PRESETS = [
  {
    name: "Wave Interference",
    fn: (x, y, t, p) => {
      const nx = x / COLS;
      const ny = y / ROWS;
      const v1 = Math.sin((nx * p.freq1 + t * p.speed) * Math.PI * 2);
      const v2 = Math.cos((ny * p.freq2 + t * p.speed * 0.7) * Math.PI * 2);
      const v3 = Math.sin(((nx + ny) * p.freq1 * 0.5 + t * p.speed * 1.3) * Math.PI * 2);
      return (v1 + v2 + v3) / 3;
    },
  },
  {
    name: "Moiré Pattern",
    fn: (x, y, t, p) => {
      const cx = COLS / 2;
      const cy = ROWS / 2;
      const d1 = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const d2 = Math.sqrt((x - cx * 0.3) ** 2 + (y - cy * 0.3) ** 2);
      const v1 = Math.sin(d1 * p.freq1 * 0.3 + t * p.speed * 2);
      const v2 = Math.sin(d2 * p.freq2 * 0.3 - t * p.speed * 1.5);
      return (v1 + v2) / 2;
    },
  },
  {
    name: "Noise Flow",
    fn: (x, y, t, p) => {
      const nx = x / COLS * p.freq1;
      const ny = y / ROWS * p.freq2;
      const v = Math.sin(nx * 3.1 + t * p.speed)
        * Math.cos(ny * 2.7 - t * p.speed * 0.8)
        + Math.sin((nx * ny) * 1.5 + t * p.speed * 0.5)
        * 0.5;
      return Math.tanh(v * p.density);
    },
  },
  {
    name: "Grid Sampling",
    fn: (x, y, t, p) => {
      const nx = x / COLS;
      const ny = y / ROWS;
      const wave = Math.sin(nx * p.freq1 * 10 + t * p.speed)
        * Math.sin(ny * p.freq2 * 10 + t * p.speed * 0.6);
      const grid = Math.sin(nx * p.density * 30) * Math.sin(ny * p.density * 30);
      return wave * (0.5 + 0.5 * grid);
    },
  },
  {
    name: "Plasma",
    fn: (x, y, t, p) => {
      const nx = x / COLS;
      const ny = y / ROWS;
      let v = 0;
      v += Math.sin((nx * p.freq1 * 10 + t * p.speed));
      v += Math.sin((ny * p.freq2 * 10 + t * p.speed * 1.2));
      v += Math.sin((nx * p.freq1 * 10 + ny * p.freq2 * 10 + t * p.speed * 0.7));
      const cx = nx + 0.5 * Math.sin(t * p.speed * 0.3);
      const cy = ny + 0.5 * Math.cos(t * p.speed * 0.4);
      v += Math.sin(Math.sqrt((cx * cx + cy * cy) * 100 * p.density) + t * p.speed);
      return v / 4;
    },
  },
  {
    name: "Diamond Waves",
    fn: (x, y, t, p) => {
      const nx = (x - COLS / 2) / COLS;
      const ny = (y - ROWS / 2) / ROWS;
      const d = Math.abs(nx) + Math.abs(ny);
      return Math.sin(d * p.freq1 * 20 + t * p.speed * 3) *
        Math.cos(Math.atan2(ny, nx) * p.freq2 + t * p.speed);
    },
  },
];

const COLOR_MAPS = {
  "Cyan Fire": (v, shift) => {
    const t = (v + 1) / 2;
    const h = (180 + t * 60 + shift) % 360;
    const s = 80 + t * 20;
    const l = 5 + t * 55;
    return `hsl(${h},${s}%,${l}%)`;
  },
  "Magenta Dream": (v, shift) => {
    const t = (v + 1) / 2;
    const h = (280 + t * 80 + shift) % 360;
    const s = 70 + t * 30;
    const l = 5 + t * 50;
    return `hsl(${h},${s}%,${l}%)`;
  },
  "Forest": (v, shift) => {
    const t = (v + 1) / 2;
    const h = (90 + t * 70 + shift) % 360;
    const s = 60 + t * 40;
    const l = 3 + t * 45;
    return `hsl(${h},${s}%,${l}%)`;
  },
  "Ember": (v, shift) => {
    const t = (v + 1) / 2;
    const h = (0 + t * 45 + shift) % 360;
    const s = 90 + t * 10;
    const l = 3 + t * 55;
    return `hsl(${h},${s}%,${l}%)`;
  },
  "Mono": (v, shift) => {
    const t = (v + 1) / 2;
    const l = 3 + t * 60;
    const h = shift % 360;
    return `hsl(${h},5%,${l}%)`;
  },
  "Rainbow": (v, shift) => {
    const t = (v + 1) / 2;
    const h = (t * 360 + shift) % 360;
    const s = 80;
    const l = 5 + t * 50;
    return `hsl(${h},${s}%,${l}%)`;
  },
};

function Slider({ label, value, min, max, step, onChange, unit = "" }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 5,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
        letterSpacing: "0.05em",
      }}>
        <span style={{ color: "#8a8a9a", textTransform: "uppercase" }}>{label}</span>
        <span style={{ color: "#e0e0e8" }}>{typeof value === 'number' ? value.toFixed(step < 1 ? 2 : 0) : value}{unit}</span>
      </div>
      <div style={{ position: "relative", height: 20, display: "flex", alignItems: "center" }}>
        <div style={{
          position: "absolute",
          width: "100%",
          height: 3,
          background: "#1a1a2e",
          borderRadius: 2,
        }} />
        <div style={{
          position: "absolute",
          width: `${pct}%`,
          height: 3,
          background: "linear-gradient(90deg, #00d4ff, #7b61ff)",
          borderRadius: 2,
        }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            position: "absolute",
            width: "100%",
            height: 20,
            opacity: 0,
            cursor: "pointer",
            margin: 0,
          }}
        />
        <div style={{
          position: "absolute",
          left: `calc(${pct}% - 7px)`,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#e0e0e8",
          boxShadow: "0 0 8px rgba(0,212,255,0.4)",
          pointerEvents: "none",
          transition: "box-shadow 0.15s",
        }} />
      </div>
    </div>
  );
}

export default function PatternFlowSimulator() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const [playing, setPlaying] = useState(true);
  const [presetIdx, setPresetIdx] = useState(0);
  const [colorMapName, setColorMapName] = useState("Cyan Fire");
  const [brightness, setBrightness] = useState(80);
  const [params, setParams] = useState({
    freq1: 3.0,
    freq2: 2.5,
    speed: 0.5,
    density: 1.5,
    colorShift: 0,
  });
  const [simDistance, setSimDistance] = useState(100);
  const [showCode, setShowCode] = useState(false);

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const presetRef = useRef(presetIdx);
  presetRef.current = presetIdx;
  const colorMapRef = useRef(colorMapName);
  colorMapRef.current = colorMapName;
  const brightnessRef = useRef(brightness);
  brightnessRef.current = brightness;
  const simDistRef = useRef(simDistance);
  simDistRef.current = simDistance;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const t = (Date.now() - startTimeRef.current) / 1000;
    const preset = PRESETS[presetRef.current];
    const colorMap = COLOR_MAPS[colorMapRef.current];
    const p = paramsRef.current;
    const br = brightnessRef.current / 100;
    const dist = simDistRef.current / 100;

    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let val = preset.fn(x, y, t, p);
        val = Math.max(-1, Math.min(1, val));

        // Distance simulation affects brightness
        const distFactor = 0.3 + dist * 0.7;
        const color = colorMap(val * br * distFactor, p.colorShift);

        const px = x * PIXEL_SIZE + LED_GAP;
        const py = y * PIXEL_SIZE + LED_GAP;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px + LED_SIZE / 2, py + LED_SIZE / 2, LED_SIZE / 2 - 0.3, 0, Math.PI * 2);
        ctx.fill();

        // LED glow
        if (br > 0.3) {
          const t2 = (val + 1) / 2;
          ctx.fillStyle = color.replace(')', `,${t2 * 0.15 * br})`).replace('hsl', 'hsla');
          ctx.beginPath();
          ctx.arc(px + LED_SIZE / 2, py + LED_SIZE / 2, LED_SIZE / 2 + 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (playingRef.current) {
      animRef.current = requestAnimationFrame(render);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = COLS * PIXEL_SIZE + LED_GAP;
      canvas.height = ROWS * PIXEL_SIZE + LED_GAP;
    }
    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [render]);

  useEffect(() => {
    if (playing) {
      animRef.current = requestAnimationFrame(render);
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    }
  }, [playing, render]);

  const espCode = `// PatternFlow LED Matrix - ESP32-S3 + HUB75
// Generated from simulator preset: ${PRESETS[presetIdx].name}

#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

#define PANEL_W 128
#define PANEL_H 64
#define PIN_E 32

MatrixPanel_I2S_DMA *matrix = nullptr;

// Parameters (map from potentiometer ADC)
float freq1 = ${params.freq1.toFixed(2)};
float freq2 = ${params.freq2.toFixed(2)};
float speed = ${params.speed.toFixed(2)};
float density = ${params.density.toFixed(2)};
float colorShift = ${params.colorShift.toFixed(1)};

void setup() {
  HUB75_I2S_CFG cfg(PANEL_W, PANEL_H, 1);
  cfg.gpio.e = PIN_E;  // HUB75E
  cfg.clkphase = false;
  cfg.driver = HUB75_I2S_CFG::FM6124;

  matrix = new MatrixPanel_I2S_DMA(cfg);
  matrix->begin();
  matrix->setBrightness8(${Math.round(brightness * 2.55)});
}

void hsv2rgb(float h, float s, float v,
             uint8_t &r, uint8_t &g, uint8_t &b) {
  int i = (int)(h / 60.0) % 6;
  float f = h / 60.0 - (int)(h / 60.0);
  float p = v * (1 - s);
  float q = v * (1 - f * s);
  float t2 = v * (1 - (1 - f) * s);
  switch(i) {
    case 0: r=v*255; g=t2*255; b=p*255; break;
    case 1: r=q*255; g=v*255; b=p*255; break;
    case 2: r=p*255; g=v*255; b=t2*255; break;
    case 3: r=p*255; g=q*255; b=v*255; break;
    case 4: r=t2*255; g=p*255; b=v*255; break;
    case 5: r=v*255; g=p*255; b=q*255; break;
  }
}

void loop() {
  float t = millis() / 1000.0;

  // Read potentiometers (optional)
  // freq1 = analogRead(GPIO_1) / 4095.0 * 10.0;
  // speed = analogRead(GPIO_2) / 4095.0 * 3.0;

  for (int y = 0; y < PANEL_H; y++) {
    for (int x = 0; x < PANEL_W; x++) {
      float nx = (float)x / PANEL_W;
      float ny = (float)y / PANEL_H;

      // --- Pattern Math (portable) ---
      float val = sin((nx * freq1 + t * speed) * PI * 2)
                * cos((ny * freq2 + t * speed * 0.7) * PI * 2);
      val = constrain(val, -1.0, 1.0);

      // Color mapping
      float norm = (val + 1.0) / 2.0;
      float hue = fmod(180.0 + norm * 60.0 + colorShift, 360.0);
      float sat = 0.8 + norm * 0.2;
      float bri = 0.05 + norm * 0.55;

      uint8_t r, g, b;
      hsv2rgb(hue, sat, bri, r, g, b);
      matrix->drawPixelRGB888(x, y, r, g, b);
    }
  }
}`;

  return (
    <div style={{
      background: "#08080e",
      minHeight: "100vh",
      color: "#e0e0e8",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid #151525",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8,
            borderRadius: "50%",
            background: playing ? "#00d4ff" : "#555",
            boxShadow: playing ? "0 0 10px #00d4ff" : "none",
          }} />
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            background: "linear-gradient(90deg, #00d4ff, #7b61ff)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            PatternFlow Matrix
          </span>
          <span style={{ fontSize: 10, color: "#555", marginLeft: 4 }}>128×64 P2.5</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setPlaying(!playing)}
            style={{
              background: playing ? "#1a1a2e" : "#00d4ff",
              color: playing ? "#8a8a9a" : "#000",
              border: "1px solid #252540",
              borderRadius: 6,
              padding: "5px 14px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.05em",
            }}
          >
            {playing ? "PAUSE" : "PLAY"}
          </button>
          <button
            onClick={() => setShowCode(!showCode)}
            style={{
              background: showCode ? "#7b61ff" : "#1a1a2e",
              color: showCode ? "#fff" : "#8a8a9a",
              border: "1px solid #252540",
              borderRadius: 6,
              padding: "5px 14px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.05em",
            }}
          >
            ESP32 CODE
          </button>
        </div>
      </div>

      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 12px",
        gap: 16,
      }}>
        {/* LED Matrix Display */}
        <div style={{
          background: "#020204",
          borderRadius: 8,
          padding: 8,
          border: "1px solid #151525",
          boxShadow: "0 0 40px rgba(0,212,255,0.03), inset 0 0 30px rgba(0,0,0,0.8)",
          overflow: "hidden",
          maxWidth: "100%",
          overflowX: "auto",
        }}>
          <canvas
            ref={canvasRef}
            style={{
              display: "block",
              imageRendering: "pixelated",
              maxWidth: "100%",
              height: "auto",
            }}
          />
        </div>

        {/* Controls */}
        <div style={{
          width: "100%",
          maxWidth: 780,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          {/* Preset & Color Selectors */}
          <div style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{
                fontSize: 10,
                color: "#555",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}>Pattern</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setPresetIdx(i)}
                    style={{
                      background: i === presetIdx ? "linear-gradient(135deg, #00d4ff, #7b61ff)" : "#0d0d18",
                      color: i === presetIdx ? "#000" : "#6a6a7a",
                      border: `1px solid ${i === presetIdx ? "transparent" : "#1a1a2e"}`,
                      borderRadius: 5,
                      padding: "4px 10px",
                      fontSize: 10,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontWeight: i === presetIdx ? 700 : 400,
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{
                fontSize: 10,
                color: "#555",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}>Color Map</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {Object.keys(COLOR_MAPS).map((name) => (
                  <button
                    key={name}
                    onClick={() => setColorMapName(name)}
                    style={{
                      background: name === colorMapName ? "linear-gradient(135deg, #7b61ff, #ff61c6)" : "#0d0d18",
                      color: name === colorMapName ? "#fff" : "#6a6a7a",
                      border: `1px solid ${name === colorMapName ? "transparent" : "#1a1a2e"}`,
                      borderRadius: 5,
                      padding: "4px 10px",
                      fontSize: 10,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontWeight: name === colorMapName ? 700 : 400,
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sliders */}
          <div style={{
            background: "#0a0a14",
            borderRadius: 8,
            padding: "16px 18px",
            border: "1px solid #151525",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "4px 24px",
          }}>
            <Slider
              label="Frequency 1"
              value={params.freq1}
              min={0.1} max={15} step={0.1}
              onChange={(v) => setParams({ ...params, freq1: v })}
            />
            <Slider
              label="Frequency 2"
              value={params.freq2}
              min={0.1} max={15} step={0.1}
              onChange={(v) => setParams({ ...params, freq2: v })}
            />
            <Slider
              label="Speed"
              value={params.speed}
              min={0} max={3} step={0.05}
              onChange={(v) => setParams({ ...params, speed: v })}
            />
            <Slider
              label="Density"
              value={params.density}
              min={0.1} max={5} step={0.1}
              onChange={(v) => setParams({ ...params, density: v })}
            />
            <Slider
              label="Color Shift"
              value={params.colorShift}
              min={0} max={360} step={1}
              onChange={(v) => setParams({ ...params, colorShift: v })}
              unit="°"
            />
            <Slider
              label="Brightness"
              value={brightness}
              min={5} max={100} step={1}
              onChange={setBrightness}
              unit="%"
            />
            <div style={{ gridColumn: "1 / -1" }}>
              <Slider
                label="↕ Sensor Sim (distance)"
                value={simDistance}
                min={5} max={100} step={1}
                onChange={setSimDistance}
                unit="%"
              />
            </div>
          </div>

          {/* ESP32 Code Output */}
          {showCode && (
            <div style={{
              background: "#0a0a14",
              borderRadius: 8,
              border: "1px solid #252540",
              overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 16px",
                borderBottom: "1px solid #1a1a2e",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <span style={{ fontSize: 11, color: "#7b61ff", fontWeight: 700, letterSpacing: "0.05em" }}>
                  ESP32-S3 / Arduino IDE
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(espCode);
                  }}
                  style={{
                    background: "#1a1a2e",
                    color: "#8a8a9a",
                    border: "1px solid #252540",
                    borderRadius: 5,
                    padding: "3px 10px",
                    fontSize: 10,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  COPY
                </button>
              </div>
              <pre style={{
                margin: 0,
                padding: 16,
                fontSize: 11,
                lineHeight: 1.5,
                color: "#b0b0c0",
                overflowX: "auto",
                maxHeight: 400,
                overflowY: "auto",
              }}>
                {espCode}
              </pre>
            </div>
          )}

          {/* Info */}
          <div style={{
            fontSize: 10,
            color: "#333",
            textAlign: "center",
            padding: "8px 0",
            letterSpacing: "0.05em",
          }}>
            PATTERNFLOW MATRIX SIM — 128×64 P2.5 HUB75E — SHADER PREVIEW FOR ESP32-S3
          </div>
        </div>
      </div>
    </div>
  );
}