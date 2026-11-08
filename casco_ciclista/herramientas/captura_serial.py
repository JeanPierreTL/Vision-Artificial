#!/usr/bin/env python3
"""Graba una sesión etiquetada desde captura_datos.ino.
Uso:  python captura_serial.py --puerto /dev/ttyACM0 --persona 1 --sesion 0 --minutos 8
Teclas durante la grabación (Enter no hace falta en Linux/macOS/Windows con msvcrt): n = neutro, l = izquierda, r = derecha, q = terminar.
Guarda datos_reales/pXX_sY.csv, listo para el cuaderno (USAR_DATOS_REALES = True). Requiere: pip install pyserial"""
import argparse, os, sys, time
import serial

def tecla():
    if os.name == "nt":
        import msvcrt
        return msvcrt.getwch() if msvcrt.kbhit() else None
    import select, termios, tty
    if select.select([sys.stdin], [], [], 0)[0]: return sys.stdin.read(1)
    return None

ap = argparse.ArgumentParser(); ap.add_argument("--puerto", required=True); ap.add_argument("--persona", type=int, required=True)
ap.add_argument("--sesion", type=int, required=True); ap.add_argument("--minutos", type=float, default=8); ap.add_argument("--salida", default="datos_reales")
a = ap.parse_args(); os.makedirs(a.salida, exist_ok=True)
ruta = os.path.join(a.salida, f"p{a.persona:02d}_s{a.sesion}.csv")
ser = serial.Serial(a.puerto, 115200, timeout=0.2); time.sleep(1.5); ser.reset_input_buffer()
if os.name != "nt":
    import termios, tty; fd = sys.stdin.fileno(); viejo = termios.tcgetattr(fd); tty.setcbreak(fd)
print(f"Grabando en {ruta}. Teclas: n/l/r para etiquetar, q para terminar."); n = 0; fin = time.time() + a.minutos * 60; etiqueta = "neutro"
try:
    with open(ruta, "w") as f:
        f.write("t_ms,ax,ay,az,gx,gy,gz,label\n")
        while time.time() < fin:
            t = tecla()
            if t in ("n", "l", "r"): ser.write(t.encode()); etiqueta = {"n": "neutro", "l": "izquierda", "r": "derecha"}[t]; print(f"\retiqueta: {etiqueta:10s} muestras: {n}", end="")
            elif t == "q": break
            linea = ser.readline().decode(errors="ignore").strip(); p = linea.split(",")
            if len(p) == 8 and p[0].isdigit():
                try: [float(v) for v in p[1:7]]
                except ValueError: continue
                f.write(linea + "\n"); n += 1
finally:
    if os.name != "nt": termios.tcsetattr(fd, termios.TCSADRAIN, viejo)
print(f"\nListo: {n} muestras (~{n / 50:.0f} s) en {ruta}")
