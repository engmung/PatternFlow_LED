import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const COLS = 128;
const ROWS = 64;
const LED_SIZE = 5;
const LED_GAP = 1;
const PIXEL_SIZE = LED_SIZE + LED_GAP;

// 타일 사이즈 계산 헬퍼
function computeTileSize(tileCols, tileRows, gap) {
  const availW = COLS - (tileCols + 1) * gap;
  const availH = ROWS - (tileRows + 1) * gap;
  return Math.floor(Math.min(availW / tileCols, availH / tileRows));
}

// 약수 구하기 (1 포함)
function getDivisors(n) {
  if (n <= 0) return [1];
  const divs = [];
  for (let i = 1; i <= n; i++) {
    if (n % i === 0) divs.push(i);
  }
  return divs.length > 0 ? divs : [1];
}

// 최대 gap 계산 (tileSize >= 2 보장)
function computeMaxGap(tileCols, tileRows) {
  // tileSize = floor(min((COLS - (tileCols+1)*gap)/tileCols, (ROWS - (tileRows+1)*gap)/tileRows)) >= 2
  const maxFromW = Math.floor((COLS - tileCols * 2) / (tileCols + 1));
  const maxFromH = Math.floor((ROWS - tileRows * 2) / (tileRows + 1));
  return Math.max(0, Math.min(maxFromW, maxFromH, 10));
}

// === Color Ramp 기본값 ===
const DEFAULT_COLOR_RAMP = [
  { position: 0.0, color: "#0a0a1a" },
  { position: 0.35, color: "#00d4ff" },
  { position: 0.65, color: "#7b61ff" },
  { position: 1.0, color: "#ffffff" },
];

// === Color Ramp 보간 함수 ===
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToStr(r, g, b) {
  return `rgb(${r},${g},${b})`;
}

function sampleColorRamp(val, stops, stepped) {
  // val: -1 ~ 1 → normalize to 0 ~ 1
  const t = (val + 1) / 2;
  const sorted = stops; // 이미 정렬되어 있다고 가정

  if (sorted.length === 0) return "rgb(0,0,0)";
  if (sorted.length === 1) return sorted[0].color;

  if (stepped) {
    // 뚝뚝 끊기는 모드: 값이 해당 stop position 이상이면 그 색상
    // 가장 높은 position을 만족하는 stop의 색상 반환
    let result = sorted[0].color;
    for (let i = 0; i < sorted.length; i++) {
      if (t >= sorted[i].position) {
        result = sorted[i].color;
      }
    }
    return result;
  } else {
    // 부드러운 보간 모드
    if (t <= sorted[0].position) return sorted[0].color;
    if (t >= sorted[sorted.length - 1].position)
      return sorted[sorted.length - 1].color;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].position && t <= sorted[i + 1].position) {
        const localT =
          (t - sorted[i].position) /
          (sorted[i + 1].position - sorted[i].position);
        const [r1, g1, b1] = hexToRgb(sorted[i].color);
        const [r2, g2, b2] = hexToRgb(sorted[i + 1].color);
        return rgbToStr(
          Math.round(r1 + (r2 - r1) * localT),
          Math.round(g1 + (g2 - g1) * localT),
          Math.round(b1 + (b2 - b1) * localT)
        );
      }
    }
    return sorted[sorted.length - 1].color;
  }
}

// 패턴 프리셋
const PRESETS = [
  {
    name: "Circular Wave Grid",
    fn: (x, y, t, p) => {
      const gap = p.tileGap;
      const tr = p.tileRows;
      const tc = tr * 2;
      const tileSize = computeTileSize(tc, tr, gap);
      if (tileSize <= 0) return -1;

      const totalW = tc * tileSize + (tc + 1) * gap;
      const totalH = tr * tileSize + (tr + 1) * gap;
      const offsetX = Math.floor((COLS - totalW) / 2);
      const offsetY = Math.floor((ROWS - totalH) / 2);

      const lx = x - offsetX;
      const ly = y - offsetY;

      const cellW = tileSize + gap;
      const cellH = tileSize + gap;
      const ti = Math.floor((lx - gap) / cellW);
      const tj = Math.floor((ly - gap) / cellH);

      if (ti < 0 || ti >= tc || tj < 0 || tj >= tr) return -1;

      const tileStartX = gap + ti * cellW;
      const tileStartY = gap + tj * cellH;
      const localX = lx - tileStartX;
      const localY = ly - tileStartY;

      if (localX < 0 || localX >= tileSize || localY < 0 || localY >= tileSize)
        return -1;

      const gridStep = Math.max(1, Math.round(p.density));
      const sampledX =
        Math.floor(localX / gridStep) * gridStep + gridStep / 2;
      const sampledY =
        Math.floor(localY / gridStep) * gridStep + gridStep / 2;

      const cx = tileSize / 2;
      const cy = tileSize / 2;
      const dx = sampledX - cx;
      const dy = sampledY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const tileIndex = tj * tc + ti;
      const freqBase = p.freq1;
      const freqStep = p.freq2 * 0.15;
      const tileFreq = freqBase + tileIndex * freqStep;

      const wave = Math.sin(dist * tileFreq * 0.5 + t * p.speed * 2);
      return wave;
    },
  },
];

// === Slider 컴포넌트 ===
function Slider({ label, value, min, max, step, onChange, unit = "" }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 5,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 11,
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ color: "#8a8a9a", textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ color: "#e0e0e8" }}>
          {typeof value === "number"
            ? value.toFixed(step < 1 ? 2 : 0)
            : value}
          {unit}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 20,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: 3,
            background: "#1a1a2e",
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: `${pct}%`,
            height: 3,
            background: "linear-gradient(90deg, #00d4ff, #7b61ff)",
            borderRadius: 2,
          }}
        />
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
        <div
          style={{
            position: "absolute",
            left: `calc(${pct}% - 7px)`,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#e0e0e8",
            boxShadow: "0 0 8px rgba(0,212,255,0.4)",
            pointerEvents: "none",
            transition: "box-shadow 0.15s",
          }}
        />
      </div>
    </div>
  );
}

// === Color Ramp UI 컴포넌트 (체험존 스타일) ===
function ColorRampEditor({ stops, setStops, stepped, setStepped }) {
  const [activeIdx, setActiveIdx] = useState(null);
  const [dragging, setDragging] = useState(null);
  const barRef = useRef(null);
  const colorInputRef = useRef(null);
  const editingIdxRef = useRef(null);

  const sortedStops = useMemo(
    () => [...stops].sort((a, b) => a.position - b.position),
    [stops]
  );

  // 그래디언트 스타일
  const gradientStyle = useMemo(() => {
    if (stepped) {
      const parts = [];
      sortedStops.forEach((stop, i) => {
        const pos = stop.position * 100;
        const nextPos =
          i < sortedStops.length - 1
            ? sortedStops[i + 1].position * 100
            : 100;
        parts.push(`${stop.color} ${pos}%`, `${stop.color} ${nextPos}%`);
      });
      return `linear-gradient(to right, ${parts.join(", ")})`;
    } else {
      const parts = sortedStops.map(
        (s) => `${s.color} ${s.position * 100}%`
      );
      return `linear-gradient(to right, ${parts.join(", ")})`;
    }
  }, [sortedStops, stepped]);

  // 바 빈 공간 클릭 → 새 스톱 추가
  const handleBarClick = useCallback(
    (e) => {
      if (stops.length >= 8) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (stops.some((s) => Math.abs(s.position - pos) < 0.05)) return;

      let color = "#808080";
      const sorted = [...stops].sort((a, b) => a.position - b.position);
      for (let i = 0; i < sorted.length - 1; i++) {
        if (pos >= sorted[i].position && pos <= sorted[i + 1].position) {
          const t =
            (pos - sorted[i].position) /
            (sorted[i + 1].position - sorted[i].position);
          const [r1, g1, b1] = hexToRgb(sorted[i].color);
          const [r2, g2, b2] = hexToRgb(sorted[i + 1].color);
          const r = Math.round(r1 + (r2 - r1) * t);
          const g = Math.round(g1 + (g2 - g1) * t);
          const b = Math.round(b1 + (b2 - b1) * t);
          color = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
          break;
        }
      }
      setStops([...stops, { position: pos, color }]);
    },
    [stops, setStops]
  );

  // 드래그
  useEffect(() => {
    if (dragging === null) return;
    const handleMove = (e) => {
      if (!barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const pos = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      const newStops = [...stops];
      newStops[dragging] = { ...newStops[dragging], position: pos };
      setStops(newStops);
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, stops, setStops]);

  // 바깥 클릭 시 context menu 닫기
  useEffect(() => {
    if (activeIdx === null) return;
    const handleClickOutside = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) {
        setActiveIdx(null);
      }
    };
    // 약간의 딜레이로 현재 클릭 이벤트 무시
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [activeIdx]);

  // 히든 컬러 피커 onChange
  const handleColorChange = useCallback(
    (e) => {
      const idx = editingIdxRef.current;
      if (idx === null) return;
      const ns = [...stops];
      if (ns[idx]) {
        ns[idx] = { ...ns[idx], color: e.target.value };
        setStops(ns);
      }
    },
    [stops, setStops]
  );

  // 컬러 스와치 클릭 → 히든 컬러 피커 트리거
  const triggerColorPicker = useCallback(
    (idx) => {
      editingIdxRef.current = idx;
      if (colorInputRef.current) {
        colorInputRef.current.value = stops[idx].color;
        colorInputRef.current.click();
      }
    },
    [stops]
  );

  return (
    <div
      style={{
        background: "#0a0a14",
        borderRadius: 8,
        padding: "14px 16px",
        border: "1px solid #151525",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "#555",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Color Ramp
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => setStepped(!stepped)}
            style={{
              background: stepped
                ? "linear-gradient(135deg, #7b61ff, #ff61c6)"
                : "#1a1a2e",
              color: stepped ? "#fff" : "#6a6a7a",
              border: "1px solid #252540",
              borderRadius: 5,
              padding: "3px 10px",
              fontSize: 10,
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: stepped ? 700 : 400,
            }}
          >
            {stepped ? "STEPPED" : "SMOOTH"}
          </button>
          <button
            onClick={() => { setStops([...DEFAULT_COLOR_RAMP]); setActiveIdx(null); }}
            style={{
              background: "#1a1a2e",
              color: "#6a6a7a",
              border: "1px solid #252540",
              borderRadius: 5,
              padding: "3px 8px",
              fontSize: 10,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* Hidden Color Picker */}
      <input
        type="color"
        ref={colorInputRef}
        onChange={handleColorChange}
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 0,
          height: 0,
        }}
      />

      {/* Gradient Bar with Line Handles */}
      <div
        ref={barRef}
        onClick={handleBarClick}
        style={{
          height: 28,
          borderRadius: 3,
          background: gradientStyle,
          cursor: "crosshair",
          position: "relative",
          border: "1px solid #252540",
        }}
      >
        {stops.map((stop, idx) => (
          <div
            key={idx}
            style={{
              position: "absolute",
              left: `${stop.position * 100}%`,
              top: 0,
              bottom: 0,
              width: 16,
              marginLeft: -8,
              cursor: "ew-resize",
              display: "flex",
              justifyContent: "center",
              zIndex: activeIdx === idx ? 30 : 10,
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDragging(idx);
            }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveIdx(activeIdx === idx ? null : idx);
            }}
          >
            {/* Vertical Line Handle */}
            <div
              style={{
                width: activeIdx === idx ? 2 : 1,
                height: "100%",
                background:
                  activeIdx === idx
                    ? "#00d4ff"
                    : "rgba(255,255,255,0.5)",
                boxShadow: "0 0 2px rgba(0,0,0,0.8)",
                transition: "background 0.15s",
              }}
            />

            {/* Context Menu Popup (위에 뜨는 메뉴) */}
            {activeIdx === idx && (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  marginBottom: 8,
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  borderRadius: 6,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
                  display: "flex",
                  padding: 4,
                  gap: 4,
                  zIndex: 50,
                  cursor: "default",
                  minWidth: 80,
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Color Swatch Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerColorPicker(idx);
                  }}
                  title="Change Color"
                  style={{
                    flex: 1,
                    height: 32,
                    background: "#222",
                    border: "1px solid #444",
                    borderRadius: 4,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: stop.color,
                      border: "1px solid rgba(0,0,0,0.3)",
                      boxShadow: "0 0 4px rgba(0,0,0,0.2)",
                    }}
                  />
                </button>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (stops.length > 2) {
                      setStops(stops.filter((_, i) => i !== idx));
                      setActiveIdx(null);
                    }
                  }}
                  title={
                    stops.length > 2
                      ? "Delete Layer"
                      : "Cannot delete (min 2)"
                  }
                  disabled={stops.length <= 2}
                  style={{
                    width: 32,
                    height: 32,
                    background: "#111",
                    border: "1px solid #333",
                    borderRadius: 4,
                    cursor:
                      stops.length > 2 ? "pointer" : "not-allowed",
                    color:
                      stops.length > 2 ? "#ff5555" : "#333",
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: stops.length <= 2 ? 0.3 : 1,
                    fontFamily: "inherit",
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Position labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "#333",
          marginTop: 4,
          fontFamily: "monospace",
        }}
      >
        <span>0.00</span>
        <span>0.50</span>
        <span>1.00</span>
      </div>
    </div>
  );
}

// === 메인 컴포넌트 ===
export default function PatternFlowSimulator() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const [playing, setPlaying] = useState(true);
  const [presetIdx, setPresetIdx] = useState(0);
  const [brightness, setBrightness] = useState(80);
  const [params, setParams] = useState({
    freq1: 3.0,
    freq2: 2.5,
    speed: 0.5,
    density: 3,
    tileGap: 2,
    tileRows: 3,
  });

  // 가로 = 세로 × 2 고정
  const tileCols = params.tileRows * 2;
  const tileRows = params.tileRows;

  // 동적으로 tileSize, safe 값 계산
  const tileSize = useMemo(
    () => computeTileSize(tileCols, tileRows, params.tileGap),
    [tileCols, tileRows, params.tileGap]
  );
  const validGridSteps = useMemo(() => getDivisors(tileSize), [tileSize]);
  const maxGap = useMemo(
    () => computeMaxGap(tileCols, tileRows),
    [tileCols, tileRows]
  );

  // density가 유효하지 않으면 가장 가까운 유효 값으로 보정
  useEffect(() => {
    if (!validGridSteps.includes(params.density)) {
      const closest = validGridSteps.reduce((a, b) =>
        Math.abs(b - params.density) < Math.abs(a - params.density) ? b : a
      );
      setParams((p) => ({ ...p, density: closest }));
    }
  }, [validGridSteps, params.density]);

  // gap이 max 초과하면 보정
  useEffect(() => {
    if (params.tileGap > maxGap) {
      setParams((p) => ({ ...p, tileGap: maxGap }));
    }
  }, [maxGap, params.tileGap]);
  const [showCode, setShowCode] = useState(false);

  // Color Ramp state
  const [colorStops, setColorStops] = useState([...DEFAULT_COLOR_RAMP]);
  const [stepped, setStepped] = useState(true);

  const sortedStops = useMemo(
    () => [...colorStops].sort((a, b) => a.position - b.position),
    [colorStops]
  );

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const presetRef = useRef(presetIdx);
  presetRef.current = presetIdx;
  const brightnessRef = useRef(brightness);
  brightnessRef.current = brightness;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const sortedStopsRef = useRef(sortedStops);
  sortedStopsRef.current = sortedStops;
  const steppedRef = useRef(stepped);
  steppedRef.current = stepped;

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const t = (Date.now() - startTimeRef.current) / 1000;
    const preset = PRESETS[presetRef.current];
    const p = paramsRef.current;
    const br = brightnessRef.current / 100;
    const stops = sortedStopsRef.current;
    const isStepped = steppedRef.current;

    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!preset) {
      ctx.fillStyle = "#1a1a2e";
      ctx.font = "14px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("No patterns yet", canvas.width / 2, canvas.height / 2);
      if (playingRef.current) {
        animRef.current = requestAnimationFrame(render);
      }
      return;
    }

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let val = preset.fn(x, y, t, p);
        val = Math.max(-1, Math.min(1, val));

        // gap 영역은 어두운 배경
        if (val <= -1) continue;

        // Color Ramp로 색상 결정
        const color = sampleColorRamp(val * br, stops, isStepped);

        const px = x * PIXEL_SIZE + LED_GAP;
        const py = y * PIXEL_SIZE + LED_GAP;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(
          px + LED_SIZE / 2,
          py + LED_SIZE / 2,
          LED_SIZE / 2 - 0.3,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // LED glow
        if (br > 0.3 && val > -0.5) {
          const t2 = (val + 1) / 2;
          ctx.globalAlpha = t2 * 0.12 * br;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(
            px + LED_SIZE / 2,
            py + LED_SIZE / 2,
            LED_SIZE / 2 + 1.5,
            0,
            Math.PI * 2
          );
          ctx.fill();
          ctx.globalAlpha = 1;
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

  // === ESP32 코드 자동 생성 ===
  const espCode = useMemo(() => {
    const tr = params.tileRows;
    const tc = tr * 2;
    const ts = computeTileSize(tc, tr, params.tileGap);
    const gap = params.tileGap;
    const gridStep = params.density;
    const br = brightness;
    const gridCells = Math.floor(ts / gridStep);

    // Color ramp stops → C array
    const ss = [...colorStops].sort((a, b) => a.position - b.position);
    const stopsDef = ss
      .map((s) => {
        const [r, g, b] = hexToRgb(s.color);
        return `  {${s.position.toFixed(3)}f, ${r}, ${g}, ${b}}`;
      })
      .join(",\n");

    return `// ═══════════════════════════════════════════════════════════
// PatternFlow LED Matrix — ESP32-S3 + HUB75E
// Auto-generated from simulator settings
// ═══════════════════════════════════════════════════════════
//
// Board: ESP32-S3 DevKit (N16R8 recommended)
// Library: ESP32-HUB75-MatrixPanel-DMA
// Panel: 128x64 P2.5 HUB75E
//
// Install: PlatformIO or Arduino IDE
//   lib_deps = mrfaptastic/ESP32 HUB75 LED Matrix Panel DMA Display
// ═══════════════════════════════════════════════════════════

#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <math.h>

// ─── Panel Config ───
#define PANEL_W 128
#define PANEL_H 64
#define PANEL_CHAIN 1

MatrixPanel_I2S_DMA *dma_display = nullptr;

// ─── Pattern Config (from simulator) ───
#define TILE_ROWS ${tr}
#define TILE_COLS ${tc}
#define TILE_GAP  ${gap}
#define TILE_SIZE ${ts}
#define GRID_STEP ${gridStep}
#define GRID_CELLS ${gridCells}  // TILE_SIZE / GRID_STEP
#define BRIGHTNESS ${br}

// Wave parameters (default — override via ADC)
float waveFreqBase = ${params.freq1.toFixed(2)}f;
float freqVariation = ${params.freq2.toFixed(2)}f;
float speed = ${params.speed.toFixed(2)}f;

// ─── ADC Sensor Pins (connect knobs/sensors here) ───
#define PIN_FREQ_KNOB  1   // GPIO1 — Wave Frequency
#define PIN_SPEED_KNOB 2   // GPIO2 — Speed
// Add more as needed

// ─── ADC EMA Smoothing ───
// alpha: 0.05 = very smooth (slow), 0.1 = responsive, 0.2 = faster
#define ADC_EMA_ALPHA 0.08f
float emaFreq = ${params.freq1.toFixed(2)}f;
float emaSpeed = ${params.speed.toFixed(2)}f;

// ─── Sin Lookup Table (256 entries, -1.0 ~ 1.0) ───
#define SIN_LUT_SIZE 256
float sinLUT[SIN_LUT_SIZE];

void buildSinLUT() {
  for (int i = 0; i < SIN_LUT_SIZE; i++) {
    sinLUT[i] = sinf((float)i / SIN_LUT_SIZE * 2.0f * PI);
  }
}

inline float fastSin(float x) {
  float norm = x / (2.0f * PI);
  norm -= floorf(norm);
  if (norm < 0) norm += 1.0f;
  int idx = (int)(norm * SIN_LUT_SIZE) & (SIN_LUT_SIZE - 1);
  return sinLUT[idx];
}

// ─── Distance Lookup Table ───
// Pre-computed sqrt distances for quantized tile coordinates
// Size: GRID_CELLS × GRID_CELLS (${gridCells}×${gridCells} = ${gridCells * gridCells} entries)
float distLUT[GRID_CELLS][GRID_CELLS];

void buildDistLUT() {
  float cx = TILE_SIZE / 2.0f;
  float cy = TILE_SIZE / 2.0f;
  for (int gy = 0; gy < GRID_CELLS; gy++) {
    for (int gx = 0; gx < GRID_CELLS; gx++) {
      float sx = gx * GRID_STEP + GRID_STEP / 2.0f;
      float sy = gy * GRID_STEP + GRID_STEP / 2.0f;
      float dx = sx - cx;
      float dy = sy - cy;
      distLUT[gy][gx] = sqrtf(dx * dx + dy * dy);
    }
  }
}

// ─── Color Ramp ───
struct ColorStop {
  float position;  // 0.0 ~ 1.0
  uint8_t r, g, b;
};

#define NUM_STOPS ${ss.length}
const ColorStop colorRamp[NUM_STOPS] = {
${stopsDef}
};

${stepped ? `// STEPPED mode — flat color per threshold
void sampleColorRamp(float val, uint8_t &r, uint8_t &g, uint8_t &b) {
  float t = (val + 1.0f) * 0.5f;
  t = constrain(t, 0.0f, 1.0f);
  
  r = colorRamp[0].r;
  g = colorRamp[0].g;
  b = colorRamp[0].b;
  
  for (int i = 0; i < NUM_STOPS; i++) {
    if (t >= colorRamp[i].position) {
      r = colorRamp[i].r;
      g = colorRamp[i].g;
      b = colorRamp[i].b;
    }
  }
}` : `// SMOOTH mode — linear interpolation between stops
void sampleColorRamp(float val, uint8_t &r, uint8_t &g, uint8_t &b) {
  float t = (val + 1.0f) * 0.5f;
  t = constrain(t, 0.0f, 1.0f);
  
  if (t <= colorRamp[0].position) {
    r = colorRamp[0].r; g = colorRamp[0].g; b = colorRamp[0].b;
    return;
  }
  if (t >= colorRamp[NUM_STOPS - 1].position) {
    r = colorRamp[NUM_STOPS-1].r; g = colorRamp[NUM_STOPS-1].g; b = colorRamp[NUM_STOPS-1].b;
    return;
  }
  
  for (int i = 0; i < NUM_STOPS - 1; i++) {
    if (t >= colorRamp[i].position && t <= colorRamp[i+1].position) {
      float localT = (t - colorRamp[i].position) / (colorRamp[i+1].position - colorRamp[i].position);
      r = colorRamp[i].r + (colorRamp[i+1].r - colorRamp[i].r) * localT;
      g = colorRamp[i].g + (colorRamp[i+1].g - colorRamp[i].g) * localT;
      b = colorRamp[i].b + (colorRamp[i+1].b - colorRamp[i].b) * localT;
      return;
    }
  }
  r = colorRamp[NUM_STOPS-1].r; g = colorRamp[NUM_STOPS-1].g; b = colorRamp[NUM_STOPS-1].b;
}`}

// ─── Tile Layout (pre-computed) ───
int totalW, totalH, offsetX, offsetY;

void computeLayout() {
  totalW = TILE_COLS * TILE_SIZE + (TILE_COLS + 1) * TILE_GAP;
  totalH = TILE_ROWS * TILE_SIZE + (TILE_ROWS + 1) * TILE_GAP;
  offsetX = (PANEL_W - totalW) / 2;
  offsetY = (PANEL_H - totalH) / 2;
}

// ─── Read ADC Sensors with EMA Smoothing ───
void readSensors() {
  // Exponential Moving Average: smooth = α × raw + (1-α) × smooth
  // Eliminates potentiometer noise while staying responsive
  
  // int rawFreq = analogRead(PIN_FREQ_KNOB);
  // float targetFreq = map(rawFreq, 0, 4095, 1, 300) / 10.0f;
  // emaFreq += ADC_EMA_ALPHA * (targetFreq - emaFreq);
  // waveFreqBase = emaFreq;
  
  // int rawSpeed = analogRead(PIN_SPEED_KNOB);
  // float targetSpeed = map(rawSpeed, 0, 4095, 0, 300) / 100.0f;
  // emaSpeed += ADC_EMA_ALPHA * (targetSpeed - emaSpeed);
  // speed = emaSpeed;
}

// ─── Main Pattern Render ───
void renderPattern(float time) {
  float br = BRIGHTNESS / 100.0f;
  
  for (int y = 0; y < PANEL_H; y++) {
    for (int x = 0; x < PANEL_W; x++) {
      int lx = x - offsetX;
      int ly = y - offsetY;
      
      int cellW = TILE_SIZE + TILE_GAP;
      int cellH = TILE_SIZE + TILE_GAP;
      int ti = (lx - TILE_GAP) / cellW;
      int tj = (ly - TILE_GAP) / cellH;
      
      // Outside grid → LED off
      if (ti < 0 || ti >= TILE_COLS || tj < 0 || tj >= TILE_ROWS) {
        dma_display->drawPixelRGB888(x, y, 0, 0, 0);
        continue;
      }
      
      int tileStartX = TILE_GAP + ti * cellW;
      int tileStartY = TILE_GAP + tj * cellH;
      int localX = lx - tileStartX;
      int localY = ly - tileStartY;
      
      // Inside gap → LED off
      if (localX < 0 || localX >= TILE_SIZE || localY < 0 || localY >= TILE_SIZE) {
        dma_display->drawPixelRGB888(x, y, 0, 0, 0);
        continue;
      }
      
      // Grid-quantized lookup into distLUT (no sqrt per pixel!)
      int gx = localX / GRID_STEP;
      int gy = localY / GRID_STEP;
      if (gx >= GRID_CELLS) gx = GRID_CELLS - 1;
      if (gy >= GRID_CELLS) gy = GRID_CELLS - 1;
      float dist = distLUT[gy][gx];
      
      // Per-tile frequency
      int tileIndex = tj * TILE_COLS + ti;
      float tileFreq = waveFreqBase + tileIndex * freqVariation * 0.15f;
      
      // Circular wave (fastSin from LUT)
      float wave = fastSin(dist * tileFreq * 0.5f + time * speed * 2.0f);
      
      // Apply brightness and color ramp
      uint8_t r, g, b;
      sampleColorRamp(wave * br, r, g, b);
      
      dma_display->drawPixelRGB888(x, y, r, g, b);
    }
  }
}

// ─── Setup ───
void setup() {
  Serial.begin(115200);
  
  // Panel config with DOUBLE BUFFERING (prevents tearing)
  HUB75_I2S_CFG mxconfig(PANEL_W, PANEL_H, PANEL_CHAIN);
  mxconfig.gpio.e = 18;        // For 64-row panels — adjust pin as needed
  mxconfig.clkphase = false;
  mxconfig.driver = HUB75_I2S_CFG::FM6126A;  // Adjust for your panel IC
  mxconfig.double_buff = true;  // ← Double buffering ON (prevents tearing)
  
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(${Math.round(brightness * 2.55)});
  dma_display->clearScreen();
  
  // Build lookup tables
  buildSinLUT();
  buildDistLUT();
  computeLayout();
  
  // ADC setup (uncomment when hardware connected)
  // analogReadResolution(12);
  // pinMode(PIN_FREQ_KNOB, INPUT);
  // pinMode(PIN_SPEED_KNOB, INPUT);
  
  Serial.println("PatternFlow Matrix initialized!");
  Serial.printf("Grid: %dx%d, TileSize: %d, Gap: %d, GridCells: %d\\n",
                TILE_COLS, TILE_ROWS, TILE_SIZE, TILE_GAP, GRID_CELLS);
  Serial.printf("DistLUT: %d entries (no sqrt per frame!)\\n", GRID_CELLS * GRID_CELLS);
}

// ─── Loop ───
void loop() {
  static float time = 0.0f;
  static unsigned long lastMs = millis();
  
  unsigned long now = millis();
  float dt = (now - lastMs) / 1000.0f;
  lastMs = now;
  time += dt;
  
  // Read sensors with EMA smoothing (uncomment when hardware connected)
  // readSensors();
  
  // Render to back buffer
  renderPattern(time);
  
  // Flip double buffer → display (no tearing)
  dma_display->flipDMABuffer();
  
  delay(1);
}
`;
  }, [params, brightness, colorStops, stepped, tileSize]);

  return (
    <div
      style={{
        background: "#08080e",
        minHeight: "100vh",
        color: "#e0e0e8",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #151525",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: playing ? "#00d4ff" : "#555",
              boxShadow: playing ? "0 0 10px #00d4ff" : "none",
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              background: "linear-gradient(90deg, #00d4ff, #7b61ff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            PatternFlow Matrix
          </span>
          <span style={{ fontSize: 10, color: "#555", marginLeft: 4 }}>
            128×64 P2.5
          </span>
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

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "16px 12px",
          gap: 16,
        }}
      >
        {/* LED Matrix Display */}
        <div
          style={{
            background: "#020204",
            borderRadius: 8,
            padding: 8,
            border: "1px solid #151525",
            boxShadow:
              "0 0 40px rgba(0,212,255,0.03), inset 0 0 30px rgba(0,0,0,0.8)",
            overflow: "hidden",
            maxWidth: "100%",
            overflowX: "auto",
          }}
        >
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
        <div
          style={{
            width: "100%",
            maxWidth: 780,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Preset Selector */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <div
                style={{
                  fontSize: 10,
                  color: "#555",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 6,
                }}
              >
                Pattern
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setPresetIdx(i)}
                    style={{
                      background:
                        i === presetIdx
                          ? "linear-gradient(135deg, #00d4ff, #7b61ff)"
                          : "#0d0d18",
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
          </div>

          {/* Color Ramp Editor */}
          <ColorRampEditor
            stops={colorStops}
            setStops={setColorStops}
            stepped={stepped}
            setStepped={setStepped}
          />

          {/* Sliders */}
          <div
            style={{
              background: "#0a0a14",
              borderRadius: 8,
              padding: "16px 18px",
              border: "1px solid #151525",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "4px 24px",
            }}
          >
            {/* Grid Layout — 가로:세로 = 2:1 고정 */}
            <Slider
              label={`Grid (${tileCols}×${tileRows})`}
              value={params.tileRows}
              min={1}
              max={6}
              step={1}
              onChange={(v) => setParams({ ...params, tileRows: v })}
            />
            <Slider
              label="Tile Gap"
              value={params.tileGap}
              min={0}
              max={maxGap}
              step={1}
              onChange={(v) => setParams({ ...params, tileGap: v })}
            />

            {/* Sample Grid — 약수만 선택 가능 */}
            <div style={{ marginBottom: 14 }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 5,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 11,
                letterSpacing: "0.05em",
              }}>
                <span style={{ color: "#8a8a9a", textTransform: "uppercase" }}>Sample Grid</span>
                <span style={{ color: "#e0e0e8" }}>{params.density}px <span style={{ color: "#555", fontSize: 9 }}>({tileSize}÷{params.density}={tileSize / params.density})</span></span>
              </div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {validGridSteps.map((d) => (
                  <button
                    key={d}
                    onClick={() => setParams({ ...params, density: d })}
                    style={{
                      background: d === params.density
                        ? "linear-gradient(135deg, #00d4ff, #7b61ff)"
                        : "#0d0d18",
                      color: d === params.density ? "#000" : "#6a6a7a",
                      border: `1px solid ${d === params.density ? "transparent" : "#252540"}`,
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontSize: 10,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontWeight: d === params.density ? 700 : 400,
                      minWidth: 28,
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Wave */}
            <Slider
              label="Wave Freq (base)"
              value={params.freq1}
              min={0.1}
              max={30}
              step={0.1}
              onChange={(v) => setParams({ ...params, freq1: v })}
            />
            <Slider
              label="Freq Variation"
              value={params.freq2}
              min={0}
              max={15}
              step={0.1}
              onChange={(v) => setParams({ ...params, freq2: v })}
            />
            <Slider
              label="Speed"
              value={params.speed}
              min={0}
              max={3}
              step={0.05}
              onChange={(v) => setParams({ ...params, speed: v })}
            />
            <Slider
              label="Brightness"
              value={brightness}
              min={5}
              max={100}
              step={1}
              onChange={setBrightness}
              unit="%"
            />
          </div>

          {/* ESP32 Code Output */}
          {showCode && (
            <div
              style={{
                background: "#0a0a14",
                borderRadius: 8,
                border: "1px solid #252540",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid #1a1a2e",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: "#7b61ff",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}
                >
                  ESP32-S3 / Arduino IDE
                </span>
                <button
                  onClick={() => navigator.clipboard?.writeText(espCode)}
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
              <pre
                style={{
                  margin: 0,
                  padding: 16,
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: "#b0b0c0",
                  overflowX: "auto",
                  maxHeight: 400,
                  overflowY: "auto",
                }}
              >
                {espCode}
              </pre>
            </div>
          )}

          {/* Info */}
          <div
            style={{
              fontSize: 10,
              color: "#333",
              textAlign: "center",
              padding: "8px 0",
              letterSpacing: "0.05em",
            }}
          >
            PATTERNFLOW MATRIX SIM — 128×64 P2.5 HUB75E — {tileCols}×
            {tileRows} TILE GRID — TILE {tileSize}px
          </div>
        </div>
      </div>
    </div>
  );
}
