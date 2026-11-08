// motor_cnn.h — inferencia float de la 1D-CNN del casco, sin bibliotecas externas.
// Copia exacta de las capas Keras: Normalization -> Conv1D(same)+ReLU -> MaxPool(2) -> Conv1D+ReLU -> MaxPool(2)
// -> Conv1D+ReLU -> GlobalAveragePooling -> Dense -> Softmax.
#pragma once
#include <math.h>
#include "pesos_cnn.h"

class MotorCNN {
 public:
  // x: CASCO_WIN * CASCO_N_CH valores (fila = muestra; columnas ax, ay, az, gx, gy, gz) en g y grados/s.
  // probs: 3 valores (neutro, izquierda, derecha).
  void inferir(const float* x, float* probs) {
    for (int t = 0; t < CASCO_WIN; t++)
      for (int c = 0; c < CASCO_N_CH; c++)
        xn_[t * CASCO_N_CH + c] = (x[t * CASCO_N_CH + c] - NORM_MEAN[c]) / NORM_STD[c];
    conv1d(xn_, CASCO_WIN, CASCO_N_CH, W1, B1, CASCO_K1, CASCO_C1, a1_);
    pool2(a1_, CASCO_WIN, CASCO_C1, p1_);
    conv1d(p1_, CASCO_L1, CASCO_C1, W2, B2, CASCO_K2, CASCO_C2, a2_);
    pool2(a2_, CASCO_L1, CASCO_C2, p2_);
    conv1d(p2_, CASCO_L2, CASCO_C2, W3, B3, CASCO_K3, CASCO_C3, a3_);
    float g[CASCO_C3];
    for (int c = 0; c < CASCO_C3; c++) {
      float s = 0; for (int t = 0; t < CASCO_L2; t++) s += a3_[t * CASCO_C3 + c];
      g[c] = s / CASCO_L2;
    }
    float logit[CASCO_N_CLASES], m = -1e30f;
    for (int o = 0; o < CASCO_N_CLASES; o++) {
      float s = BD[o]; for (int c = 0; c < CASCO_C3; c++) s += g[c] * WD[c * CASCO_N_CLASES + o];
      logit[o] = s; if (s > m) m = s;
    }
    float z = 0; for (int o = 0; o < CASCO_N_CLASES; o++) { probs[o] = expf(logit[o] - m); z += probs[o]; }
    for (int o = 0; o < CASCO_N_CLASES; o++) probs[o] /= z;
  }

 private:
  float xn_[CASCO_WIN * CASCO_N_CH];
  float a1_[CASCO_WIN * CASCO_C1], p1_[CASCO_L1 * CASCO_C1];
  float a2_[CASCO_L1 * CASCO_C2], p2_[CASCO_L2 * CASCO_C2];
  float a3_[CASCO_L2 * CASCO_C3];

  static void conv1d(const float* in, int L, int cin, const float* W, const float* B, int K, int cout, float* out) {
    const int pad = (K - 1) / 2;                       // 'same' con núcleo impar
    for (int t = 0; t < L; t++)
      for (int co = 0; co < cout; co++) {
        float s = B[co];
        for (int k = 0; k < K; k++) {
          int ti = t + k - pad; if (ti < 0 || ti >= L) continue;
          const float* xi = in + ti * cin; const float* w = W + (k * cin) * cout + co;
          for (int ci = 0; ci < cin; ci++) s += xi[ci] * w[ci * cout];
        }
        out[t * cout + co] = s > 0 ? s : 0;            // ReLU
      }
  }
  static void pool2(const float* in, int L, int c, float* out) {
    for (int t = 0; t < L / 2; t++)
      for (int k = 0; k < c; k++) {
        float a = in[(2 * t) * c + k], b = in[(2 * t + 1) * c + k]; out[t * c + k] = a > b ? a : b;
      }
  }
};
