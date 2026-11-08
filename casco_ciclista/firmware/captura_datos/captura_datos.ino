/*
  Captura de datos etiquetados para entrenar el casco (Nano 33 BLE Sense).
  Envía por USB una línea CSV a 50 Hz:  t_ms,ax,ay,az,gx,gy,gz,label
  Etiquetas por teclado (monitor serie o herramientas/captura_serial.py):  n = neutro · l = izquierda · r = derecha
  PRUEBA DE EJES: abra el monitor serie, ponga la cabeza erguida (az ≈ +1) e incline a la DERECHA (ay debe ser > 0).
  Si no coincide, cambie los signos en las macros de abajo y haga lo mismo en casco_direccionales/config.h.
*/
#define IMU_REV2 0
#if IMU_REV2
  #include <Arduino_BMI270_BMM150.h>
#else
  #include <Arduino_LSM9DS1.h>
#endif
#define FS_HZ 50
#define AX_H(x,y,z) ( (x) )
#define AY_H(x,y,z) ( (y) )
#define AZ_H(x,y,z) ( (z) )
#define GX_H(x,y,z) ( (x) )
#define GY_H(x,y,z) ( (y) )
#define GZ_H(x,y,z) ( (z) )

static float as[3], gs[3]; static int an = 0, gn = 0; static unsigned long t_prox; static const char* etiqueta = "neutro";

void setup() {
  Serial.begin(115200); while (!Serial && millis() < 3000) {}
  if (!IMU.begin()) { Serial.println("ERROR: IMU"); while (true) {} }
  Serial.println("t_ms,ax,ay,az,gx,gy,gz,label"); t_prox = micros();
}
void loop() {
  float x, y, z;
  while (IMU.accelerationAvailable()) { IMU.readAcceleration(x, y, z); as[0] += x; as[1] += y; as[2] += z; an++; }
  while (IMU.gyroscopeAvailable())    { IMU.readGyroscope(x, y, z);    gs[0] += x; gs[1] += y; gs[2] += z; gn++; }
  while (Serial.available()) { char c = Serial.read(); if (c == 'n') etiqueta = "neutro"; else if (c == 'l') etiqueta = "izquierda"; else if (c == 'r') etiqueta = "derecha"; }
  if (micros() - t_prox >= 1000000UL / FS_HZ) {
    t_prox += 1000000UL / FS_HZ;
    if (an && gn) {
      float a0 = as[0] / an, a1 = as[1] / an, a2 = as[2] / an, g0 = gs[0] / gn, g1 = gs[1] / gn, g2 = gs[2] / gn;
      Serial.print(millis()); Serial.print(','); Serial.print(AX_H(a0, a1, a2), 4); Serial.print(','); Serial.print(AY_H(a0, a1, a2), 4); Serial.print(',');
      Serial.print(AZ_H(a0, a1, a2), 4); Serial.print(','); Serial.print(GX_H(g0, g1, g2), 3); Serial.print(','); Serial.print(GY_H(g0, g1, g2), 3); Serial.print(',');
      Serial.print(GZ_H(g0, g1, g2), 3); Serial.print(','); Serial.println(etiqueta);
    }
    as[0] = as[1] = as[2] = gs[0] = gs[1] = gs[2] = 0; an = gn = 0;
  }
}
