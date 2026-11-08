/*
  Casco de ciclista con direccionales según la inclinación de la cabeza.
  Placa: Arduino Nano 33 BLE Sense (ver config.h). Bibliotecas: Adafruit NeoPixel, ArduinoBLE,
  Arduino_LSM9DS1 (o Arduino_BMI270_BMM150 en Rev2) y, solo para MODO_MOTOR 2, TensorFlow Lite Micro.

  PROTOTIPO EDUCATIVO, NO CERTIFICADO. Escrito para esta práctica; no se ha compilado ni probado en hardware.
  Mantenga una luz de posición fija independiente de este programa.
*/
#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"
#if IMU_REV2
  #include <Arduino_BMI270_BMM150.h>
#else
  #include <Arduino_LSM9DS1.h>
#endif
#if USAR_BLE
  #include <ArduinoBLE.h>
#endif
#if MODO_MOTOR == 1
  #include "motor_cnn.h"
  static MotorCNN motor;
#elif MODO_MOTOR == 2
  #include "pesos_cnn.h"          // solo para NORM_MEAN / NORM_STD
  #include "cuantizacion.h"
  #include "model_data.h"
  #include <TensorFlowLite.h>
  #include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
  #include "tensorflow/lite/micro/micro_interpreter.h"
  #include "tensorflow/lite/schema/schema_generated.h"
  alignas(16) static uint8_t arena[24 * 1024];
  static tflite::MicroMutableOpResolver<7> resolvedor;
  static tflite::MicroInterpreter* interprete = nullptr;
  static TfLiteTensor *t_ent = nullptr, *t_sal = nullptr;
#endif

// ---------- Estado ----------
static float ventana[VENTANA * 6];
static int   n_muestras = 0, desde_inferencia = 0;
static Adafruit_NeoPixel tira(N_LEDS, PIN_LEDS, NEO_GRB + NEO_KHZ800);
static unsigned long t_ultima_muestra = 0, t_ultimo_dato_imu = 0, t_ultimo_log = 0;
static float acc_sum[3], gyr_sum[3]; static int acc_n = 0, gyr_n = 0;
static bool falla = false;
#if USAR_VISION && USAR_BLE
static int nivel_vision = 0; static unsigned long t_alerta_ms = 0;   // 0..3, escrito por la página web
#endif
static unsigned long suma_us = 0; static int n_inf = 0;

// ---------- Señalizador: MISMA máquina de estados que el cuaderno (Python) y giro-core.js ----------
struct Senalizador {
  int estado = 0, pend = 0, n_pend = 0, n_off = 0, n_rearme = 0; unsigned long t_on_ms = 0; bool bloqueado = false;
  int paso(const float* p, unsigned long dt_ms) {
    int k = (p[1] > p[0]) ? ((p[2] > p[1]) ? 2 : 1) : ((p[2] > p[0]) ? 2 : 0);
    int cand = (k != 0 && p[k] >= UMBRAL_CONF) ? k : 0;
    if (bloqueado) { n_rearme = (cand == 0) ? n_rearme + 1 : 0; if (n_rearme >= REARME_N) { bloqueado = false; n_rearme = 0; } return 0; }
    if (cand != 0) {
      n_off = 0;
      if (cand != estado) {
        if (cand == pend) n_pend++; else { pend = cand; n_pend = 1; }
        if (n_pend >= ON_N) { estado = cand; t_on_ms = 0; pend = 0; n_pend = 0; }
      }
    } else {
      pend = 0; n_pend = 0;
      if (estado != 0) { n_off++; if (n_off >= OFF_N) { estado = 0; n_off = 0; } }
    }
    if (estado != 0) { t_on_ms += dt_ms; if (t_on_ms >= MAX_SENAL_MS) { estado = 0; bloqueado = true; n_rearme = 0; } }
    return estado;
  }
};
static Senalizador senalizador;

// ---------- Validación F1 de la ventana (no se invoca el modelo si falla) ----------
static bool ventana_valida() {
  float mn[6], mx[6]; for (int c = 0; c < 6; c++) { mn[c] = 1e9f; mx[c] = -1e9f; }
  for (int i = 0; i < VENTANA; i++) for (int c = 0; c < 6; c++) {
    float v = ventana[i * 6 + c];
    if (isnan(v) || isinf(v)) return false;
    if (c < 3 && fabsf(v) > 16.0f) return false;
    if (c >= 3 && fabsf(v) > 2000.0f) return false;
    if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v;
  }
  for (int c = 0; c < 6; c++) if (mx[c] - mn[c] > 1e-6f) return true;
  return false;                                    // señal constante: sensor desconectado
}

// ---------- Motores ----------
static void motor_umbral(float* p) {               // línea base: filtro complementario, promedio de los últimos 0,5 s
  float r = atan2f(ventana[1], ventana[2]) * 57.29578f, suma = 0;
  for (int k = 0; k < VENTANA; k++) {
    float ra = atan2f(ventana[k * 6 + 1], ventana[k * 6 + 2]) * 57.29578f;
    r = 0.98f * (r + ventana[k * 6 + 3] / FS_HZ) + 0.02f * ra; if (k >= VENTANA - 25) suma += r;
  }
  float m = suma / 25.0f; p[0] = p[1] = p[2] = 0; p[m <= -UMBRAL_GRADOS ? 1 : (m >= UMBRAL_GRADOS ? 2 : 0)] = 1;
}
static bool inferir(float* p) {
#if MODO_MOTOR == 0
  motor_umbral(p); return true;
#elif MODO_MOTOR == 1
  motor.inferir(ventana, p); return true;
#else
  int8_t* q = t_ent->data.int8;
  for (int i = 0; i < VENTANA; i++) for (int c = 0; c < 6; c++) {
    float z = (ventana[i * 6 + c] - NORM_MEAN[c]) / NORM_STD[c];
    int v = (int)roundf(z / Q_IN_SCALE) + Q_IN_ZERO; q[i * 6 + c] = (int8_t)(v < -128 ? -128 : (v > 127 ? 127 : v));
  }
  if (interprete->Invoke() != kTfLiteOk) return false;
  for (int o = 0; o < 3; o++) p[o] = (t_sal->data.int8[o] - Q_OUT_ZERO) * Q_OUT_SCALE;
  return true;
#endif
}

// ---------- LEDs ----------
static void pintar(int ini, int fin, uint32_t c) { for (int i = ini; i <= fin; i++) tira.setPixelColor(i, c); }
static void luces(int estado, bool falla_activa) {
  bool on = ((millis() / (falla_activa ? 120 : PARPADEO_MS)) % 2) == 0;
  tira.clear();
  pintar(LEDS_POS_INI, LEDS_POS_FIN, tira.Color(falla_activa ? (on ? 255 : 0) : 120, 0, 0));   // posición roja; parpadeo rápido si hay falla
  if (!falla_activa && on) {
    if (estado == 1) pintar(LEDS_IZQ_INI, LEDS_IZQ_FIN, tira.Color(255, 140, 0));
    if (estado == 2) pintar(LEDS_DER_INI, LEDS_DER_FIN, tira.Color(255, 140, 0));
  }
  tira.show();
}

// ---------- Zumbador de visión (aviso al ciclista; independiente de las luces) ----------
#if USAR_VISION && USAR_BLE
static void zumbador(int nivel) {                  // 2 = pitido corto cada 1 s; 3 = pitidos rápidos (4 Hz); otro = silencio
  unsigned long m = millis(); bool on = false;
  if (nivel == 3) on = (m % 250) < 120; else if (nivel == 2) on = (m % 1000) < 100;
  digitalWrite(PIN_ZUMBADOR, on ? HIGH : LOW);
}
#endif

// ---------- BLE (opcional) ----------
#if USAR_BLE
static BLEService srv("19b10010-e8f2-537e-4f6c-d104768a1214");
static BLECharacteristic c_imu("19b10011-e8f2-537e-4f6c-d104768a1214", BLERead | BLENotify, 12);
static BLEByteCharacteristic c_est("19b10012-e8f2-537e-4f6c-d104768a1214", BLERead | BLENotify);
#if USAR_VISION
static BLEByteCharacteristic c_alerta("19b10013-e8f2-537e-4f6c-d104768a1214", BLEWrite | BLEWriteWithoutResponse);
#endif
static void ble_imu(const float* s) {
  int16_t v[6] = { (int16_t)(s[0] * 1000), (int16_t)(s[1] * 1000), (int16_t)(s[2] * 1000), (int16_t)(s[3] * 10), (int16_t)(s[4] * 10), (int16_t)(s[5] * 10) };
  c_imu.writeValue((uint8_t*)v, 12);
}
#endif

void setup() {
  Serial.begin(115200);
  tira.begin(); tira.setBrightness(BRILLO); luces(0, false);
  if (!IMU.begin()) { falla = true; Serial.println("ERROR: no se pudo iniciar el IMU"); }
#if MODO_MOTOR == 2
  const tflite::Model* m = tflite::GetModel(model_data);
  resolvedor.AddConv2D(); resolvedor.AddExpandDims(); resolvedor.AddFullyConnected(); resolvedor.AddMaxPool2D();
  resolvedor.AddMean(); resolvedor.AddReshape(); resolvedor.AddSoftmax();
  static tflite::MicroInterpreter interp(m, resolvedor, arena, sizeof(arena)); interprete = &interp;
  if (interprete->AllocateTensors() != kTfLiteOk) { falla = true; Serial.println("ERROR: AllocateTensors"); }
  else { t_ent = interprete->input(0); t_sal = interprete->output(0); }
#endif
#if USAR_BLE
  if (BLE.begin()) { BLE.setLocalName("Casco-Giro"); BLE.setAdvertisedService(srv); srv.addCharacteristic(c_imu); srv.addCharacteristic(c_est);
#if USAR_VISION
    srv.addCharacteristic(c_alerta); pinMode(PIN_ZUMBADOR, OUTPUT); digitalWrite(PIN_ZUMBADOR, LOW);
#endif
    BLE.addService(srv); BLE.advertise(); }
  else Serial.println("AVISO: BLE no disponible");
#endif
  t_ultima_muestra = micros(); t_ultimo_dato_imu = millis();
}

void loop() {
#if USAR_BLE
  BLE.poll();
#endif
#if USAR_VISION && USAR_BLE
  if (c_alerta.written()) { int v = c_alerta.value(); nivel_vision = v < 0 ? 0 : (v > 3 ? 3 : v); t_alerta_ms = millis(); }
  if (millis() - t_alerta_ms > ALERTA_CADUCA_MS || !BLE.connected()) nivel_vision = 0;   // sin latido o sin conexión: silencio
  zumbador(nivel_vision);
#endif
  float x, y, z;
  while (IMU.accelerationAvailable()) { IMU.readAcceleration(x, y, z); acc_sum[0] += x; acc_sum[1] += y; acc_sum[2] += z; acc_n++; t_ultimo_dato_imu = millis(); }
  while (IMU.gyroscopeAvailable())    { IMU.readGyroscope(x, y, z);    gyr_sum[0] += x; gyr_sum[1] += y; gyr_sum[2] += z; gyr_n++; }

  if (micros() - t_ultima_muestra >= 1000000UL / FS_HZ) {     // tic de 50 Hz: promedio de lo leído (filtro simple)
    t_ultima_muestra += 1000000UL / FS_HZ;
    if (acc_n && gyr_n) {
      float a[3] = { acc_sum[0] / acc_n, acc_sum[1] / acc_n, acc_sum[2] / acc_n }, g[3] = { gyr_sum[0] / gyr_n, gyr_sum[1] / gyr_n, gyr_sum[2] / gyr_n };
      memmove(ventana, ventana + 6, sizeof(float) * 6 * (VENTANA - 1));
      float* s = ventana + 6 * (VENTANA - 1);
      s[0] = AX_H(a[0], a[1], a[2]); s[1] = AY_H(a[0], a[1], a[2]); s[2] = AZ_H(a[0], a[1], a[2]);
      s[3] = GX_H(g[0], g[1], g[2]); s[4] = GY_H(g[0], g[1], g[2]); s[5] = GZ_H(g[0], g[1], g[2]);
      if (n_muestras < VENTANA) n_muestras++; desde_inferencia++;
#if USAR_BLE
      if (BLE.connected()) ble_imu(s);
#endif
    }
    acc_sum[0] = acc_sum[1] = acc_sum[2] = gyr_sum[0] = gyr_sum[1] = gyr_sum[2] = 0; acc_n = gyr_n = 0;

    if (n_muestras >= VENTANA && desde_inferencia >= PASO) {
      desde_inferencia = 0; float p[3] = { 1, 0, 0 };
      if (!ventana_valida()) { falla = true; }
      else {
        unsigned long t0 = micros(); bool ok = inferir(p); suma_us += micros() - t0; n_inf++;
        bool finito = ok && !isnan(p[0] + p[1] + p[2]);
        if (finito) { falla = false; senalizador.paso(p, 1000UL * PASO / FS_HZ); } else { falla = true; senalizador.estado = 0; }
#if USAR_BLE
        if (BLE.connected()) c_est.writeValue((uint8_t)senalizador.estado);
#endif
      }
    }
  }
  if (millis() - t_ultimo_dato_imu > 300) falla = true;       // el sensor dejó de responder
  if (falla) senalizador.estado = 0;                          // ante la duda, direccionales apagadas y luz de posición fija
  luces(senalizador.estado, falla);

  if (millis() - t_ultimo_log > 5000 && n_inf) {              // latencia medida EN la placa
    Serial.print("inferencia media (us): "); Serial.println(suma_us / n_inf); suma_us = 0; n_inf = 0; t_ultimo_log = millis();
  }
}
