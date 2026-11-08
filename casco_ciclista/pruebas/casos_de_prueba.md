# Pruebas manuales y de integración (completar con resultados reales)

Registra para cada prueba: navegador o placa, dispositivo, fecha, resultado **obtenido** y evidencia (captura o video). Un fallo se anota como *Fallido*; no se oculta ni se inventa.

## A. Casos CP-01 a CP-05 (contraste visible en la interfaz)

| ID | Func. | Requisito | Precondiciones | Pasos | Resultado esperado | Obtenido | Estado | Evidencia |
|---|---|---|---|---|---|---|---|---|
| CP-01 | F1 | Aceptar una grabación válida | Pestaña «Archivo CSV» | Cargar `evidencias/ejemplo_sesion_prueba_p13_s0.csv` | Se procesa y dibuja la línea de tiempo | | | |
| CP-02 | F1 | Rechazar entradas inválidas sin invocar el modelo | Modelo listo | Cargar un CSV con una celda `NaN`; otro sin columna `gz`; un `.txt` renombrado `.csv` | Mensaje de rechazo en cada caso; ninguna luz cambia | | | |
| CP-03 | F2 | Inclinación izquierda sostenida enciende solo la izquierda | Demostración | Pulsar «Inclinar a la izquierda» | Luz izquierda parpadea; la derecha no | | | |
| CP-04 | F2 | Bache con la cabeza recta no enciende nada | Demostración | Pulsar «Bache» tres veces | Ninguna direccional se enciende | | | |
| CP-05 | F2 | Determinismo | CSV con una ventana fija | Cargar el mismo CSV dos veces | Mismo estado de luces y mismos tramos | | | |

## B. Integración del simulador

| Prueba | Esperado | Obtenido | Estado |
|---|---|---|---|
| Modelo ausente (renombrar `dist/model`) | Mensaje de error, botón «Reintentar», motor de umbrales disponible | | |
| Sensor del teléfono: permiso concedido | Aparece la inclinación en vivo | | |
| Sensor del teléfono: permiso denegado | Mensaje claro; la demostración sigue funcionando | | |
| Calibrar y luego inclinar a la derecha | Se enciende la luz derecha | | |
| Salir de la pestaña con el sensor activo | El sensor se detiene y vuelve a la demostración | | |
| Gestos «no deben encender»: hombro izq./der., frenada, mirar al suelo, espejo, leve | Ninguna luz | | |
| Slider +30° mantenido ~1 s | Luz derecha; al volver a 0° se apaga | | |
| Mantener +30° más de 10 s | Se apaga a los 10 s y no se reenciende hasta 1 s de neutro | | |
| CSV > 5 MiB | Rechazado por tamaño | | |
| Pantalla de 360 px de ancho | Sin desbordes horizontales | | |

## C. Casco real (solo en banco de pruebas, nunca en tráfico)

| Prueba | Esperado | Obtenido | Estado |
|---|---|---|---|
| Prueba de ejes (erguido `az ≈ +1`; derecha `ay > 0`) | Coincide con la convención | | |
| Inclinar a la derecha 20° durante 1 s | LED derechos ámbar parpadeando | | |
| Mirar sobre el hombro 5 veces | Nada se enciende | | |
| Golpear el casco / caminar con él | Nada se enciende | | |
| Desconectar el IMU | Direccionales apagadas, luz roja parpadeando rápido | | |
| Latencia (línea serie «inferencia media») | < 300 ms | | |
| Autonomía de la batería | Registrar horas | | |
| 10 personas distintas, 20 gestos cada una | Registrar aciertos y falsas activaciones | | |

## D. Visión trasera (nueva)

| Prueba | Esperado | Obtenido | Estado |
|---|---|---|---|
| `node pruebas/test_vision.js` | Todas las pruebas pasan | | |
| Escena «Auto se acerca rápido» | Niveles 1 → 2 → 3 con tiempo estimado decreciente | | |
| Escenas «convoy» y «se aleja» | Nunca nivel ≥ 2 | | |
| «Falso positivo de un cuadro» | Sin alerta | | |
| Direccional encendida (Demostración) con vehículo acercándose | Aparece la advertencia de giro | | |
| Activar cámara sin permiso / sin HTTPS | Mensaje claro; la escena simulada sigue funcionando | | |
| Activar cámara con permiso (Chrome Android o escritorio) | Imagen en el panel; cajas sobre vehículos reales | | |
| Tapar la cámara durante >1 s | «Visión sin datos», nivel 0 | | |
| Salir de la pestaña con la cámara activa | La cámara se apaga | | |
| Banco: casco conectado + «Enviar alerta» + escena rápida | Zumbador: 1 pitido/s (nivel 2) y 4 Hz (nivel 3) | | |
| Banco: cerrar la página con alerta activa | El zumbador calla en ≤ 1,5 s | | |
| Calle real (peatón/acompañante, no en tráfico): vehículo detenido y otro acercándose | Medir tau real vs. mostrado y anotar | | |
