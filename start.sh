#!/bin/bash
# Avvia il backend FastAPI (scraping + API)

cd "$(dirname "$0")"

# Porta del backend: 8000, oppure API_PORT se un altro progetto la occupa
# (API_PORT=8001 ./start.sh e API_PORT=8001 npm run dev: il proxy di Vite la segue).
PORT="${API_PORT:-8000}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "❌ La porta $PORT è già occupata da un altro programma:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  echo "   Fermalo, oppure avvia su un'altra porta: API_PORT=8001 ./start.sh" >&2
  echo "   (e il frontend con: API_PORT=8001 npm run dev)" >&2
  exit 1
fi

echo "🚀 Avvio backend Case all'Asta su http://localhost:$PORT"
echo "   Docs API: http://localhost:$PORT/docs"
echo "   Status:   http://localhost:$PORT/api/status"
echo ""
echo "Premi Ctrl+C per fermare"
echo ""

# Su macOS "python" non esiste: esiste solo "python3". Usiamo il primo disponibile.
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "❌ Python non trovato nel PATH" >&2
  exit 1
fi

exec "$PY" -m uvicorn api.main:app --host 0.0.0.0 --port "$PORT" --reload
