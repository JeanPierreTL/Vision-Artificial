#pragma once
// Cuantización del modelo int8. La entrada es la señal NORMALIZADA: z = (x - NORM_MEAN) / NORM_STD (ver pesos_cnn.h) y luego q = round(z / Q_IN_SCALE) + Q_IN_ZERO.
const float Q_IN_SCALE = 0.136921659f;
const int Q_IN_ZERO = 8;
const float Q_OUT_SCALE = 0.00390625f;
const int Q_OUT_ZERO = -128;
