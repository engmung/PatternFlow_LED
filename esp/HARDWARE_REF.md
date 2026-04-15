# PatternFlow ESP32 — 하드웨어 종합 참고자료

## 보드 스펙

| 항목 | 스펙 |
|------|------|
| 모듈 | ESP32-S3-WROOM-1 |
| 변형 | **N16R8** (Flash 16MB + PSRAM 8MB) |
| BLE | 내장 (BLE 5.0) |
| WiFi | 내장 (2.4GHz) |
| 코어 | 듀얼 코어 Xtensa LX7 |

> N16R8은 최상위 모델. HUB75E DMA (~150KB) + NimBLE (~70KB) 동시 구동해도 PSRAM 여유 7MB 이상.

---

## 물리 노브 배치 (정면 기준)

```
┌───────────────────┐
│  Knob4(⚡)  Knob3(🎲) │
│  Q2/Speed   Q1/Pattern │
│                       │
│  Knob1(🎨)  Knob2(🔀) │
│  Q3/Hue     Q4/Mode   │
└───────────────────┘
```

---

## HUB75E → ESP32-S3

| HUB75 핀 | 신호 | ESP32 GPIO |
|----------|------|-----------|
| 1  | R1  | 42  |
| 2  | G1  | 41  |
| 3  | B1  | 40  |
| 4  | GND | GND |
| 5  | R2  | 38  |
| 6  | G2  | 39  |
| 7  | B2  | 13  |
| 8  | E   | 21  |
| 9  | A   | 45  |
| 10 | B   | 11  |
| 11 | C   | 48  |
| 12 | D   | 12  |
| 13 | CLK | 2   |
| 14 | LAT | 47  |
| 15 | OE  | 14  |
| 16 | GND | GND |

## 노브 (포텐셔미터 4개)

| 노브 | 기능 | 가운데 → GPIO | 양쪽 다리 |
|------|------|-------------|----------|
| Knob1 (Q3-좌하) | Hue 🎨 | GPIO 4 | 3V3 + GND |
| Knob2 (Q4-우하) | Mode 🔀 | GPIO 5 | 3V3 + GND |
| Knob3 (Q1-우상) | Pattern 🎲 | GPIO 6 | 3V3 + GND |
| Knob4 (Q2-좌상) | Speed ⚡ | GPIO 7 | 3V3 + GND |

## 전원

```
[5V 외부 전원] ──┬──▶ LED 매트릭스 (5V, 최대 ~4A)
                 └──▶ ESP32-S3 (5V, Vin)
```

ESP32 + 매트릭스가 같은 5V 라인에 묶여 있음. BLE 운영 시 USB 불필요 → 이중 공급 문제 없음.
