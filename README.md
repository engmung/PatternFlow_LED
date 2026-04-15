# PatternFlow — LED Matrix Pattern Generator

**128×64 P2.5 HUB75E LED 매트릭스용 패턴 디자인 툴 + ESP32-S3 펌웨어**

> "반복과 변주" — 작은 타일들이 모여 거대한 하나의 그래픽을 만들어내는 순간의 쾌감.

---

## 프로젝트 개요

PatternFlow는 LED 매트릭스 패널에 수학적 파동 패턴을 생성하는 시스템.
웹 시뮬레이터에서 패턴을 디자인하고, ESP32-S3 보드로 실제 하드웨어를 구동한다.

### 핵심 콘셉트: 타일 그리드 + 위상 간섭

- 128×64 패널을 **N×M 정사각 타일 그리드**로 분할 (항상 가로:세로 = 2:1)
- 각 타일 내부에 **원형 파동(Circular Wave)**을 생성
- 타일마다 주파수를 미세하게 다르게 설정 (`tileFreq = base + index × variation`)
- **Freq Variation을 조절하면** 타일 간 위상이 딱 맞아떨어지는 순간이 오고, 그때 타일 경계가 사라지면서 전체 패널이 하나의 거대한 패턴으로 합체됨
- 사람들이 열광하는 포인트가 바로 이 "아구가 맞는 순간"

---

## 현재 구조

```
패턴생성기/
├── src/
│   ├── App.jsx          ← 웹 시뮬레이터 (React + Vite)
│   └── main.jsx
├── esp/
│   ├── PatternFlow.ino  ← ESP32 펌웨어 (경량화 ver.)
│   └── WIRING.md        ← 보드 배선표
├── example.jsx          ← 이전 버전 (참고용)
└── README.md
```

### 웹 시뮬레이터 (`localhost:3000`)

- Canvas로 128×64 LED 매트릭스 실시간 렌더링 (LED 형태 + glow 효과)
- 3개 패턴 프리셋: Circular Wave Grid, Woven Links, Fluid Metaballs
- Color Ramp 에디터 (Smooth/Stepped, 드래그, localStorage 저장)
- ESP32 코드 자동 생성 (COPY 버튼)
- 파라미터: Grid 크기, Tile Gap, Sample Grid, Wave Freq, Freq Variation(8-step), Speed

### ESP32 하드웨어

- **ESP32-S3** + 128×64 P2.5 HUB75E 패널
- **듀얼 코어**: Core 0 = ADC(노브 읽기), Core 1 = 렌더링
- **4개 포텐셔미터 노브**: Hue / Mode / Pattern / Speed
- 더블 버퍼링, Sin LUT, Distance LUT 최적화
- ADC 경량화: 4x 평균 + 단일 EMA (`α=0.1`)

---

## 현재 병목 (해결 대상)

### 웹 → 하드웨어 전송이 너무 번거로움

1. 웹에서 패턴 파라미터를 조절
2. "ESP32 CODE" 버튼으로 C 코드 생성
3. Arduino IDE에 붙여넣기
4. USB로 업로드
5. 예상대로 안 나오면 1번부터 다시...

**이 사이클이 너무 느림.** 특히 Color Ramp이나 Freq 값이 실제 LED에서는 다르게 보이는 경우가 많아서 반복 횟수가 늘어남.

---

## 로드맵

### Phase 1: BLE 실시간 파라미터 전송 ← **최우선**

ESP32-S3의 내장 BLE를 활용해, **웹 시뮬레이터에서 파라미터를 바꾸면 즉시 하드웨어에 반영**되는 구조.

```
[Web Browser] ──BLE──▶ [ESP32-S3] ──DMA──▶ [LED Panel]
   │                      │
   │  freq, speed,        │  renderPattern()
   │  colorRamp, mode     │
   └──────────────────────┘
```

- **Web Bluetooth API** (Chrome/Edge 지원)로 브라우저에서 직접 BLE 연결
- ESP32 측: BLE GATT Server로 파라미터 수신 → volatile 변수에 반영
- 노브 입력과 BLE 입력을 병합 (BLE 우선, 노브 fallback)
- 노브 GPIO 매핑도 웹에서 변경 가능하게

### Phase 2: 프리셋 저장/불러오기

- 웹에서 만든 프리셋을 ESP32 Flash(SPIFFS/LittleFS)에 저장
- BLE로 프리셋 업로드/다운로드
- 전원 꺼져도 마지막 프리셋 유지

### Phase 3: 제품화

- BLE 연결 앱 (또는 PWA)
- 노브 + BLE 하이브리드 컨트롤
- 다양한 패널 크기 지원 (64×32, 64×64, 128×128 등)

---

## ⚡ 전원 공급

### 배선 구조

```
[5V 외부 전원] ──┬──▶ LED 매트릭스 (5V, 최대 ~4A)
                 └──▶ ESP32-S3 (5V, Vin)
```

ESP32와 매트릭스가 **같은 5V 라인에 묶여 있음**.
외부 전원 하나로 전체 시스템을 구동하는 구조.

### BLE 덕분에 이중 공급 문제 없음

USB-C는 **최초 펌웨어 플래시 1회**에만 필요. 이후 모든 파라미터 전송은 BLE로 이루어지므로:

- **일상 개발**: 외부 5V 전원 하나만 연결 → BLE로 파라미터 실시간 전송 → USB 불필요
- **펌웨어 업데이트 시**: 외부 5V 끈 상태에서 USB-C 연결 → 플래시 → USB 분리 → 외부 5V 연결

USB와 외부 5V가 **동시에 연결될 일이 없는 운영 구조**이므로 역전류, 전압 충돌 이슈가 원천 차단됨.

> 향후 OTA(Over-The-Air) 업데이트를 넣으면 USB 연결 자체가 완전히 불필요해지고, 전원 포트만 남는 가장 깔끔한 제품 형태가 됨.

---

## 개발 환경

```bash
# 웹 시뮬레이터
npm install
npm run dev          # → localhost:3000

# ESP32 펌웨어
# Arduino IDE 또는 PlatformIO
# lib_deps: mrfaptastic/ESP32 HUB75 LED Matrix Panel DMA Display
```

## 라이선스

TBD
