// config.h — AJUSTES DEL CASCO. Revise cada valor antes de cargar el firmware.
#pragma once

// ---- Placa ----
#define IMU_REV2        0      // 0 = Nano 33 BLE Sense (LSM9DS1) · 1 = Nano 33 BLE Sense Rev2 (BMI270/BMM150)

// ---- Motor de decisión ----
// 0 = umbrales de inclinación (simple, la reversión segura)
// 1 = 1D-CNN en C++ propio (motor_cnn.h; verificado contra Keras en el cuaderno)  <- recomendado
// 2 = TensorFlow Lite Micro con model_data.h (int8). Requiere la biblioteca de TFLite Micro compatible.
#define MODO_MOTOR      1
#define USAR_BLE        1      // 1 = transmite datos y decisión al simulador web

// ---- Parámetros de decisión (deben coincidir con salida/modelo/web_model/metadata.json) ----
#define UMBRAL_CONF     0.90f  // confianza mínima de una dirección
#define ON_N            2      // lecturas seguidas para encender
#define OFF_N           3      // lecturas sin gesto para apagar
#define MAX_SENAL_MS    10000UL
#define REARME_N        5      // lecturas neutras necesarias tras el límite de tiempo
#define UMBRAL_GRADOS   14.0f  // solo MODO_MOTOR 0: inclinación (roll) que dispara la luz

// ---- Muestreo (no cambiar sin reentrenar) ----
#define FS_HZ           50
#define VENTANA         75
#define PASO            10     // una inferencia cada 10 muestras (200 ms)

// ---- LEDs (tira WS2812B). 3,3 V de la placa: use un adaptador de nivel a 5 V para la línea de datos ----
#define PIN_LEDS        6
#define N_LEDS          16
#define LEDS_IZQ_INI    0      // 0..4 izquierda (vista del ciclista), 5..10 posición roja, 11..15 derecha
#define LEDS_IZQ_FIN    4
#define LEDS_POS_INI    5
#define LEDS_POS_FIN    10
#define LEDS_DER_INI    11
#define LEDS_DER_FIN    15
#define BRILLO          90     // 0-255; limita corriente y calor
#define PARPADEO_MS     330

// ---- Visión trasera (opcional): la alerta llega por BLE desde la página web (teléfono con cámara) ----
// Es SOLO un aviso al ciclista: no modifica direccionales ni la luz roja fija. Requiere USAR_BLE 1.
#define USAR_VISION     1      // 1 = acepta alertas de visión por BLE y activa el zumbador
#define PIN_ZUMBADOR    5      // zumbador ACTIVO (con oscilador propio) con transistor; no conectar directo al pin si consume >10 mA
#define ALERTA_CADUCA_MS 1500UL // si no llega un latido en este tiempo, la alerta vuelve a 0 (ante la duda, en silencio)

// ---- Ejes: conviertan los de la placa a los del casco ----
// Convención: x adelante, y a la IZQUIERDA, z arriba. Inclinar la cabeza a la DERECHA debe dar ay > 0 y az ≈ +1 g erguido.
// Con captura_datos.ino compruebe cada eje y cambie signos/orden aquí (y en captura_datos.ino) hasta que coincida.
#define AX_H(x,y,z)  ( (x) )
#define AY_H(x,y,z)  ( (y) )
#define AZ_H(x,y,z)  ( (z) )
#define GX_H(x,y,z)  ( (x) )
#define GY_H(x,y,z)  ( (y) )
#define GZ_H(x,y,z)  ( (z) )
