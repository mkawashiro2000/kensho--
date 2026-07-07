# KENSHO — Especificación Técnica y Plan de Desarrollo

## 🎯 Propósito General

**KENSHO** es una plataforma de evaluación neurocognitiva familiar diseñada para medir:
- Velocidad de procesamiento visomotor (MOT + Tarea Dual)
- Rotación espacial y flexibilidad estructural
- Fatiga metabólica mediante análisis ex-gaussiana
- Evolución cognitiva individual con scoring acumulativo adaptativo

**Usuarios:** Familia únicamente. Login simple (usuario/contraseña).

---

## 📐 Arquitectura General

### Stack Tecnológico

| Componente | Tecnología | Propósito |
|-----------|-----------|----------|
| **Infraestructura** | Docker Compose + Raspberry Pi | Despliegue local, baja latencia |
| **Proxy/Routing** | Traefik | Ya operativo en servidor |
| **Red Privada** | Tailscale | Ya operativo en servidor |
| **Seguridad** | CrowdSec | Ya operativo en servidor |
| **Backend** | FastAPI (Python) + WebSocket | API baja latencia + telemetría RT |
| **Caché** | Redis | Persistencia transaccional (write-behind) |
| **Base de Datos** | PostgreSQL | Almacenamiento permanente |
| **Frontend** | React + TypeScript | UI cliente, comunicación WebSocket |
| **Estilos** | CSS Puro | Sin Figma/design-system (MVP) |

### Flujo de Datos

```
Usuario (React) 
  → WebSocket /ws/telemetry/{session_id}
  → Backend (FastAPI)
  → Redis (caché RTT en vivo)
  → PostgreSQL (almacenamiento)
  → Script Python (análisis ex-gaussiana)
  → Tabla analytics + ratings (puntuación)
```

---

## 🔄 Fases de Implementación (MVP)

### **FASE 0: Setup**
- Inicializar Git + estructura de carpetas
- Crear docker-compose.yml con 3 servicios: PostgreSQL, Redis, Backend

### **FASE 1: Infraestructura + Auth**
- PostgreSQL + Redis en localhost (sin credenciales complejas)
- Tabla `users`: id, username, password_hash (bcrypt)
- Tabla `sessions`: id, user_id, mode, started_at, ended_at, final_score
- Tabla `telemetry`: id, session_id, event_type, rtt_ms, timestamp, payload
- Tabla `ratings`: id, user_id, session_id, points_earned, total_points, rating, rd, sigma

### **FASE 2: Backend (FastAPI)**
- Endpoints:
  - `POST /api/auth/login` → JWT token (7 días)
  - `POST /api/session/start` → crea sesión, retorna session_id
  - `POST /api/session/end` → cierra sesión, calcula puntos
  - `WS /ws/telemetry/{session_id}` → recibe eventos RTT
  - `GET /api/user/{user_id}/rating` → puntos totales + histórico
  - `GET /api/rankings` → top 5 usuarios (familia)
- Connection Manager: Heartbeat ping/pong cada 30s
- Sistema de scoring lineal simple (placeholder Glicko-2)

### **FASE 3: Frontend (React)**
- Single Page App con autenticación
- Rutas: `/login`, `/dashboard`, `/game/{exercise_id}`
- Conexión WebSocket con reconexión automática
- Selector de ejercicio

### **FASE 4: Ejercicios (2 tipos)**

#### **Ejercicio 1: MOT + Tarea Dual (Paridad)**
- Canvas 2D con 4-5 esferas moviéndose y colisionando
- Cada 2-3 segundos: número aparece en centro
- Usuario hace clic en esferas (MOT) + responde P (par) / I (impar)
- Dificultad 1-5: velocidad de esferas aumenta
- Eventos registrados:
  - `mot_click`: timestamp, rtt_ms
  - `semantic_response`: number, response, latency_ms
- Duración: 5-10 minutos (1 sesión = 1 ejercicio)

#### **Ejercicio 2: Spatial Rotation**
- Muestra figura geométrica, objetivo es rotarla a ángulo específico
- Usuario arrastra para rotar, detecta cuando ±5° del objetivo
- Dificultad 1-5: ángulos más aleatorios/difíciles
- Eventos registrados:
  - `rotation_attempt`: angle_attempted, angle_target, time_ms
- Duración: 5-10 minutos (1 sesión = 1 ejercicio)

### **FASE 5: Data Science (Análisis ex-gaussiana)**
- Script Python que consume telemetry desde PostgreSQL
- Calcula parámetros ex-gaussiana: **μ (mu), σ (sigma), τ (tau)**
- Detección de fatiga: si τ > threshold → alertas en tabla telemetry
- Guarda resultados en tabla `analytics`
- **SIN Notion API** (para Fase 6)

---

## 🎮 Sistema Adaptativo

### Selección de Ejercicio
- Cada nueva sesión: selecciona ejercicio diferente al anterior
- Máximo 3 instancias del mismo tipo seguidas, luego cambio obligatorio
- Dificultad inicial: basada en puntuación última sesión del usuario

### Ajuste de Dificultad en Tiempo Real
```python
if score_últimos_3_intentos > umbral_alto:
    dificultad += 1  (máx 5)
elif score_últimos_3_intentos < umbral_bajo:
    dificultad -= 1  (mín 1)
```

### Generación Procedimental de Estímulos
- **MOT**: Números 1-100 sin repetir en sesión, velocidades varían
- **Spatial**: Ángulos 0-360° aleatorios
- Nunca repetir parámetros exactos en sesión

---

## 📊 Fórmula de Scoring

**Puntos por sesión:**
```
base = 1000
puntos_mot = correct_mot_clicks × 10
puntos_semántica = correct_semantic_responses × 5
penalización_fatiga = fatigue_alerts_count × 50

total = max(0, base + puntos_mot + puntos_semántica - penalización_fatiga)
```

**Total acumulado:**
- Suma histórica de todas las sesiones
- Tabla `ratings.total_points` se actualiza
- Ranking familiar en `/api/rankings`

---

## 🗂️ Estructura de Directorios

```
kensho/
├── CLAUDE.md                          # Esta especificación
├── .gitignore
├── docker-compose.yml
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                        # FastAPI app
│   └── app/
│       ├── __init__.py
│       ├── api/
│       │   ├── __init__.py
│       │   ├── auth.py                # POST /login
│       │   ├── sessions.py            # POST /start, /end
│       │   └── ws.py                  # WebSocket /telemetry
│       ├── models/
│       │   ├── __init__.py
│       │   ├── user.py
│       │   ├── session.py
│       │   ├── telemetry.py
│       │   └── rating.py
│       ├── services/
│       │   ├── __init__.py
│       │   ├── auth_service.py        # JWT, login
│       │   ├── connection_manager.py  # Heartbeat ping/pong
│       │   ├── scoring_service.py     # Cálculo de puntos
│       │   └── exercise_service.py    # Selección ejercicio
│       ├── database.py                # SQLAlchemy + AsyncPG
│       └── config.py                  # Variables entorno
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── .gitignore
│   │
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── index.css                  # Estilos globales
│       │
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── DashboardPage.tsx
│       │   └── GamePage.tsx
│       │
│       ├── components/
│       │   ├── MOTGame.tsx            # Canvas MOT + Dual
│       │   ├── SpatialGame.tsx        # Canvas rotación espacial
│       │   └── Stats.tsx              # Mostrar RTT en vivo
│       │
│       └── services/
│           └── websocket.ts           # Cliente WebSocket + reconexión
│
├── scripts/
│   └── analytics.py                   # Ex-gaussiana + análisis
│
└── docs/
    └── ROADMAP.md                     # Fases 6+
```

---

## 🚀 Orden de Implementación (Estimado: 8-10 horas)

1. **FASE 0** (15 min): Git + docker-compose
2. **FASE 1** (50 min): PostgreSQL + Redis + schema
3. **FASE 2** (2 horas): FastAPI endpoints + auth + WS
4. **FASE 3** (1 hora): React app + login + dashboard
5. **FASE 4a** (1.5 horas): MOT + Tarea Dual (Canvas)
6. **FASE 4b** (1.5 horas): Spatial Rotation (Canvas)
7. **FASE 5** (1 hora): Script ex-gaussiana
8. **Testing E2E** (1 hora): Validar flujo completo

---

## 📝 Decisiones Confirmadas

✅ Infraestructura existente: Traefik, Tailscale, CrowdSec ya operativos
✅ MVP con 2 ejercicios (MOT + Spatial), no 5
✅ 1 sesión = 1 ejercicio largo (5-10 min)
✅ Sistema adaptativo en tiempo real (dificultad 1-5)
✅ 3 instancias diferentes antes de repetir tipo
✅ Auth familiar: login JWT simple
✅ Scoring acumulativo: suma/resta puntos
✅ Backend: FastAPI + WebSocket
✅ Frontend: React + CSS puro (sin Figma)
✅ SIN Notion API en MVP (Fase 6)
✅ SIN Glicko-2 full (placeholder lineal en MVP)
✅ SIN Framer Motion (CSS básico en MVP)

---

## 🔧 Configuración Base

### Docker Compose
- PostgreSQL 15-alpine
- Redis 7-alpine
- Backend (FastAPI) con labels Traefik

### Traefik (ya operativo)
- Backend expuesto en `kensho.local` (o dominio configurado)
- HTTPS mediante TLS existente

### Tailscale (ya operativo)
- Tráfico encriptado WireGuard
- Acceso solo desde red privada

### CrowdSec (ya operativo)
- Monitorea logs de Traefik
- Bloquea escaneos/ataques automáticamente

---

## 📚 Fase 6 (Después del MVP validado)

- Agregar 3 ejercicios más (Working Memory, Processing Speed, Executive)
- Implementar Glicko-2 completo (RD, σ)
- Agregar análisis Cosinor (ritmo circadiano)
- Integrar Notion API (sync diario)
- Framer Motion (physics-based micro-interacciones)
- Design system Figma + SVG pipeline

---

## 👨‍👩‍👧‍👦 Contexto Familiar

- Usuarios: Familia únicamente
- Objetivo: Medir evolución cognitiva individual
- Competencia amistosa: Rankings dentro de la familia
- Sin publicación externa, sin datos sensibles compartidos
- Almacenamiento local en Raspberry Pi

---

## 📞 Contacto / Notas

- Correo: drd5dfvrs6@privaterelay.appleid.com
- Plataforma: Raspberry Pi OS Lite + Docker
- Servidor: Ya configurado con Traefik + Tailscale + CrowdSec
