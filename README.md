# Giro: casco de ciclista con direccionales según la inclinación de la cabeza

Versión para sensores de la práctica *FrutaLens*. La entrada ya no es una imagen sino la señal de un IMU (acelerómetro + giroscopio); el modelo es una **1D-CNN pequeña entrenada desde cero** y se exporta a tres destinos: **TensorFlow.js** (simulador web), **C++** (placa) y **TFLite int8** (TensorFlow Lite Micro).

> **Prototipo educativo, no certificado.** Una luz que falla o se enciende por error es un riesgo real. Mantén una luz de posición fija independiente del programa, prueba en un lugar cerrado y no lo uses en tráfico sin revisión y pruebas independientes.
>
> **Los resultados de abajo vienen de datos simulados.** Validan el flujo y permiten comparar modelos, no demuestran que funcione con una persona real en bicicleta. Antes de usarlo en la calle hay que grabar datos reales (sección 6) y reevaluar.

## 1. Contenido

| Ruta | Qué es |
|---|---|
| `Casco_Ciclista_Direccionales.ipynb` | Cuaderno completo ya ejecutado (con salidas): datos, entrenamiento, evaluación, casos de prueba y exportación |
| `dist/` | Simulador web estático (HTML, CSS, JS, modelo TF.js, TensorFlow.js local) |
| `firmware/casco_direccionales/` | Programa principal de la placa (Arduino Nano 33 BLE Sense) con pesos, motor C++ y modelo TFLite |
| `firmware/captura_datos/` | Programa para grabar datos etiquetados |
| `herramientas/captura_serial.py` | Graba sesiones desde el puerto serie a `datos_reales/pXX_sY.csv` |
| `modelo/` | `.keras`, TFLite float32 e int8, `modelo_web.zip` |
| `evidencias/` | Métricas, matriz de confusión, curvas, manifiesto de datos, casos de prueba, configuración |
| `pruebas/` | Pruebas automáticas en Node (`test_nodo.js` sensores, `test_vision.js` visión) y plantilla de pruebas manuales |
| `dist/vision-core.js`, `dist/vision.js` | **Visión trasera (nueva, sección 12):** detección de vehículos, tiempo hasta el contacto y alerta |

## 2. Qué modelo se usa

**1D-CNN: Normalization → Conv1D(16,5) → MaxPool → Conv1D(32,5) → MaxPool → Conv1D(32,3) → promedio global → Dropout → Dense(3, softmax).** 6.291 parámetros, 15 KB en int8.

- **Entrada:** ventana de 75 muestras (1,5 s a 50 Hz) × 6 canales `ax, ay, az` (g) y `gx, gy, gz` (°/s). La normalización está dentro del modelo: no normalices fuera (salvo en el TFLite int8, ver abajo).
- **Salida:** 3 puntuaciones en el orden `neutro, izquierda, derecha`.
- **Por qué no MobileNetV2:** no hay modelo preentrenado para esta señal y una imagen no es la entrada. Con pocas decenas de miles de ventanas una red diminuta basta.
- **Línea base:** umbral sobre el ángulo de inclinación (filtro complementario, ±14°, elegido con validación). Se evalúa con el mismo protocolo para decidir con evidencia si hace falta la CNN.

**Convención de ejes (cuaderno, web y firmware):** x adelante, y a la **izquierda**, z arriba. Erguido el acelerómetro marca `(0, 0, +1 g)`. Inclinar la cabeza a la **derecha** da `ay > 0`.

**Decisión de luces (`Senalizador`):** se infiere cada 10 muestras (200 ms); una dirección cuenta si su puntaje es ≥ 0,90; se enciende tras 2 lecturas seguidas iguales, se apaga tras 3 sin gesto y nunca pasa de 10 s seguidos (luego exige 1 s de neutro). Los valores 0,90 y 2 se eligieron con **validación**, no con prueba. Python, JavaScript y C++ implementan la misma máquina de estados; la versión C++ coincidió con la de Python en 45.000 pasos aleatorios.

## 3. Resultados medidos

Datos sintéticos: 16 personas × 3 sesiones × 90 s; 10 personas para entrenar, 3 para validar, 3 para probar (**división por persona**).

| Prueba | 1D-CNN | Umbral ±14° |
|---|---|---|
| Exactitud por ventana (personas de prueba) | 0,995 | 0,970 |
| Ventanas neutras que encienden una luz | 0,6 % | 3,5 % |
| Señales detectadas en sesiones completas (61) | 61 | 61 |
| Retraso mediano hasta encender | 0,56 s | 0,54 s |
| Falsas activaciones en 13,5 min | **1** | **22** |

- La CNN gana por menos falsas activaciones, no por detectar más. Con 13,5 min de prueba, el «4,4 por hora» es una extrapolación con un intervalo muy ancho.
- Equivalencias de exportación: TFLite int8 0,996 de exactitud (coincide con Keras en 99,9 % de las ventanas); motor C++ vs Keras, diferencia máxima 1,2·10⁻⁷; TF.js vs Keras, 1,2·10⁻⁷.
- Latencia: Keras en un PC 6,8 ms de mediana. **La latencia en la placa no se midió**: el firmware la imprime por el puerto serie cada 5 s.
- Casos CP-01 a CP-05 (automáticos): 5 de 5 aprobados.
- Prueba en Node del simulador (`node pruebas/test_nodo.js`): 27 de 27 gestos simulados dan el resultado esperado. Es simulador contra simulador: valida el cableado, no el mundo real.

## 4. Probar el simulador web

```bash
python -m http.server 8000 --directory dist      # abre http://localhost:8000
```

No abras `index.html` con `file://` (el modelo no cargaría). Espera «Modelo listo».

- **Demostración:** slider de inclinación y 9 gestos. Los de inclinación deben encender la luz; mirar sobre el hombro, bache, frenada, mirar al suelo, inclinación breve y leve **no**.
- **Teléfono:** requiere HTTPS o localhost; sujétalo de pie, pantalla hacia atrás, en la nuca; pulsa *Calibrar* con la cabeza erguida. En iPhone concede el permiso de movimiento. El signo de las aceleraciones difiere entre iOS y Android y está tratado, pero compruébalo: al inclinar a la derecha debe encenderse la luz derecha.
- **Archivo CSV:** columnas `ax, ay, az, gx, gy, gz` (opcional `t_ms` y `label`); rechaza archivos de más de 5 MiB, sin columnas, con NaN o con frecuencia fuera de 20–200 Hz.
- **Casco real:** Web Bluetooth (Chrome/Edge). Muestra además la decisión del propio casco.
- **Motor:** cambia entre 1D-CNN y umbral para comparar.

## 5. Ejecutar el cuaderno

1. Abre `Casco_Ciclista_Direccionales.ipynb` en Colab o Jupyter (Python 3.10–3.12). La primera celda instala `tensorflow 2.18`, `tensorflowjs 4.22`, `numpy<2`. Si pide reiniciar, reinicia y ejecuta de nuevo.
2. Ejecuta en orden. Genera `salida/` con modelo, firmware, evidencias y `paquete_casco.zip`.
3. **Actualizar la web:** descomprime `modelo_web.zip` y reemplaza `dist/model` completo (conserva juntos `model.json`, los `.bin` y `metadata.json`); guarda el ZIP anterior para revertir. Copia también a `firmware/casco_direccionales/` los `.h` generados.

**Problemas conocidos:** en mi entorno `tensorflowjs` solo importó tras instalar con versiones fijas y poner módulos vacíos para `tensorflow_decision_forests` y `jax` (dependencias que no usa para esta conversión). Con una instalación limpia en Colab no lo probé. Si la conversión falla, el resto del cuaderno sigue siendo válido; el cuaderno lo informa y continúa.

## 6. Pasar a datos reales (imprescindible)

1. Carga `firmware/captura_datos/captura_datos.ino` y haz la **prueba de ejes**: erguido `az ≈ +1`; inclina a la derecha y `ay` debe ser positivo. Ajusta las macros `*_H` (en este archivo y en `config.h`) hasta que coincida.
2. `python herramientas/captura_serial.py --puerto /dev/ttyACM0 --persona 1 --sesion 0 --minutos 8`; etiqueta con `n`, `l`, `r`.
3. Graba **8 a 10 personas o más**, 3 sesiones cada una, en bicicleta (calle tranquila o rodillo), con baches, frenadas y mirar sobre el hombro. Registra persona, fecha, casco y condiciones.
4. Copia los CSV a `datos_reales/` y pon `USAR_DATOS_REALES = True` en la sección 5 del cuaderno. Todo se repite: división por persona, entrenamiento, evaluación en flujo, exportación.
5. Si el umbral basta con datos reales, despliega el umbral (`MODO_MOTOR 0`): es más simple y fácil de explicar.

## 7. Hardware y firmware

- **Placa:** Arduino Nano 33 BLE Sense (LSM9DS1) o Rev2 (BMI270; cambia `IMU_REV2`). Alternativa: ESP32 + MPU6050 requiere adaptar la lectura del IMU.
- **LEDs:** tira WS2812B de 16 LED en la parte trasera: 5 a la izquierda (vista del ciclista), 6 rojos centrales fijos, 5 a la derecha. La placa es de 3,3 V; usa un adaptador de nivel para la línea de datos. Limita el brillo y la corriente (`BRILLO`), usa batería con protección y fusible, y aísla el montaje de la lluvia.
- **Bibliotecas Arduino:** Adafruit NeoPixel, ArduinoBLE, Arduino_LSM9DS1 (o Arduino_BMI270_BMM150).
- **`MODO_MOTOR`** en `config.h`: `0` umbrales; `1` CNN en C++ (recomendado, sin dependencias); `2` TFLite Micro (requiere una versión de la biblioteca compatible con las operaciones del modelo: `CONV_2D, EXPAND_DIMS, FULLY_CONNECTED, MAX_POOL_2D, MEAN, RESHAPE, SOFTMAX`).
- **Seguridad en el programa:** si el IMU deja de responder 300 ms, la ventana es inválida o la salida no es finita, las direccionales se apagan y la luz roja parpadea rápido; el límite de 10 s evita una luz pegada.
- **Estado de verificación:** los programas `.ino` **no se compilaron ni probaron en hardware**. Sí se verificó fuera de la placa que el motor C++ y el señalizador dan los mismos resultados que Python. Espera ajustar pequeños detalles de compilación y de ejes.

## 8. Mapa de los 15 pasos de la actividad

| Paso original | Dónde se hace |
|---|---|
| 1 Alcance y criterios | Cuaderno, sección 1 |
| 2 Entorno y versiones | Sección 2 (se imprimen y guardan en `resultados.json`) |
| 3 Dataset y licencia | Sección 5: generador sintético con manifiesto y SHA-256; con datos propios, registra persona y condiciones |
| 4 Revisar y preparar datos | Secciones 6 y 7: inspección, validación F1, ventanas, duplicados, división por persona |
| 5 Modelo | Sección 8 (línea base y 1D-CNN) |
| 6 Evaluación | Sección 10 y 11: métricas por clase, matriz, falsos positivos, flujo continuo |
| 7 Usar el aplicativo | Simulador web, sección 4 |
| 8 Revisión y control de cambios | Sección 13 y los hallazgos de abajo |
| 9 Cinco casos de prueba | Sección 12 y `evidencias/casos_de_prueba.csv` |
| 10 Evidencias | `evidencias/` y `paquete_casco.zip` |
| 11 Exportar | Sección 14 (TF.js, TFLite, C++) |
| 12–14 Organizar y ejecutar la página | `dist/` y sección 4 |
| 15 Integración | `pruebas/casos_de_prueba.md` |

## 9. Casos de prueba

**Automáticos (cuaderno):** CP-01 / F1 ventana válida aceptada; CP-02 / F1 NaN o longitud incorrecta rechazadas sin invocar el modelo; CP-03 / F2 inclinación izquierda sostenida de 20° enciende solo la izquierda; CP-04 / F2 baches con la cabeza recta no encienden nada; CP-05 / F2 misma ventana, misma clase y diferencia ≤ 0,000001. Resultado en esta ejecución: 5 aprobados. **Manuales (completa tú):** `pruebas/casos_de_prueba.md`.

## 10. Hallazgos de esta ejecución

1. **Cuantización con unidades mezcladas.** El primer TFLite int8 cayó a 0,862 de exactitud (0,995 en float): un tensor int8 tiene una sola escala y aplastaba la aceleración (g) frente al giro (°/s). *Impacto:* un modelo en la placa mucho peor que el evaluado. *Mejora aplicada:* el TFLite recibe la señal ya normalizada y el firmware normaliza antes de cuantizar (0,996).
2. **Los umbrales simples disparan en falso.** 22 falsas activaciones contra 1 de la CNN en 13,5 min simulados (mirar al espejo, tirones, hombro). *Impacto:* luces encendidas sin motivo. *Mejora:* la CNN y la confirmación de lecturas; reevaluar con datos reales, donde el resultado puede cambiar.
3. **Evidencia insuficiente.** 61 señales y 13,5 min de prueba, todo simulado. *Impacto:* los porcentajes no sostienen una conclusión sobre el mundo real. *Mejora:* sección 6 y más personas.

## 11. Antes de un pase a producción

Revisión del código, pruebas aprobadas con grabaciones reales de personas que no entrenaron, pruebas en un circuito cerrado, una luz fija independiente y un procedimiento de reversión (volver a `MODO_MOTOR 0` o a la luz fija). Publicar el simulador educativo no acredita nada de esto.

## 12. Visión trasera (experimental)

Una cámara que mira hacia atrás detecta autos, motos, buses y camiones y avisa al ciclista cuando uno se acerca. **Es un aviso de apoyo: no cambia las direccionales ni la luz roja fija**, y que no detecte nada no significa que la vía esté libre.

```
cámara trasera ─► detector (COCO-SSD, en el navegador) ─► vision-core.js ─► nivel 0..3 ─► pantalla
 (teléfono)                                              (seguimiento + tau)        └─► BLE ─► casco ─► zumbador
```

La placa Nano 33 BLE no puede procesar video, por eso la cámara es el **teléfono** (en la mochila o el asiento, mirando atrás) con la página `dist/`. El casco recibe solo un número por BLE.

**Cómo estima el peligro.** Con velocidad constante, el tamaño aparente `s` de un vehículo crece como 1/distancia, así que `1/s` es una recta en el tiempo; su pendiente da el *tiempo hasta el contacto* `tau = (1/s) / (−d(1/s)/dt)` sin conocer la distancia real. (Ajustar una recta a `s` en vez de a `1/s` sobrestimaba `tau` casi al doble cerca del contacto: se detectó en las pruebas y se corrigió.)

| Nivel | Significado | Condición (valores en `V` de `vision-core.js`) |
|---|---|---|
| 0 | Sin vehículos / se aleja | sin pista confirmada, o `tau` negativo |
| 1 | Vehículo detrás | confirmado, sin acercamiento claro |
| 2 | Se acerca | `tau` < 6 s |
| 3 | Muy cerca | `tau` < 2,5 s o ocupa ≥ 50 % del cuadro |

Se confirma una pista tras 3 cuadros; se sube de nivel con 2 cuadros seguidos y se baja con 4 (histéresis). Detecciones con NaN, caja fuera de rango o puntaje < 0,5 se descartan y se cuentan. Si la cámara deja de entregar cuadros 1 s, el nivel pasa a 0 y la interfaz dice «Visión sin datos» (no «vía libre»). Si estás señalizando un giro y el nivel es ≥ 2, la página muestra una advertencia.

**Probar sin cámara:** `python -m http.server 8000 --directory dist`, sección «Visión trasera» → *Ver escena* (8 escenas: auto rápido/lento, moto, detector con fallos, convoy, auto que se aleja, falso positivo de un cuadro, calle vacía). Enciende una direccional en «Demostración» mientras se acerca el vehículo.

**Con cámara:** *Activar cámara* (HTTPS o localhost). Descarga COCO-SSD 2.2.3 desde jsDelivr (≈13 MB, solo la primera vez; la imagen no sale del dispositivo). Para evitar el CDN, copia `coco-ssd.min.js` a `dist/vendor/` y define antes de los scripts `window.GIRO_VISION = { cocoUrl: 'vendor/coco-ssd.min.js' }`. El modelo COCO-SSD sigue cargándose desde la red salvo que lo alojes tú.

**Alerta al casco:** conecta el casco en «Casco real», marca *Enviar la alerta al casco*. La página escribe el nivel (1 byte) en la característica `19b10013-…` al cambiar y como latido cada 0,5 s. En `config.h`: `USAR_VISION 1`, `PIN_ZUMBADOR` (zumbador **activo** con transistor). Nivel 2: pitido corto cada 1 s; nivel 3: pitidos a 4 Hz. Sin latido durante `ALERTA_CADUCA_MS` (1,5 s) o sin conexión, el zumbador calla. Con `USAR_VISION 0` el firmware es el de antes.

**Pruebas:** `node pruebas/test_vision.js` → 19 comprobaciones: validación, escena vacía, falso positivo de un cuadro, auto rápido (nivel 2 con tau real 3,7 s, nivel 3 ≥ 1 s antes del contacto en 50/50 semillas), error mediano de `tau` 8 %, 0 falsas alarmas en 10.000 cuadros de convoy/vehículo que se aleja, corte de cámara y advertencia de giro.

**Qué NO está demostrado (leer antes de confiar):**
1. **Todo lo de arriba son escenas simuladas** con ruido de caja del 3 %. Un detector real tiene más jitter, cajas que saltan, vehículos tapados y de noche o con lluvia rinde peor. Es el mismo caso que los datos simulados de los sensores: valida la lógica, no el mundo real.
2. **No se probó la cámara ni COCO-SSD** (el entorno donde se desarrolló no tiene cámara ni red). La compatibilidad de COCO-SSD 2.2.3 con el TensorFlow.js 4.22 incluido no está verificada; si falla, la página muestra el error y la escena simulada sigue funcionando.
3. `tau` supone velocidad constante y vehículo de frente. Uno que pasa en diagonal, que frena o acelera, o una cámara inclinada dan estimaciones erróneas.
4. Los umbrales (6 s, 2,5 s, 50 %) son razonables en simulación, no se calibraron con video real. Para hacerlo: grabar video desde una bicicleta, anotar el instante de paso de cada vehículo y comparar con `tau`.
5. El firmware de visión solo se verificó con **comprobación de sintaxis usando cabeceras simuladas**; no se compiló con la toolchain real ni se probó en la placa.
6. COCO-SSD es un detector genérico (no de ciclismo) y las clases `car/motorcycle/bus/truck` no distinguen tipos de vehículo ni intención.
