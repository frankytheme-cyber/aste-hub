#!/bin/bash
# Avvia il backend FastAPI (scraping + API)

cd "$(dirname "$0")"

echo "🚀 Avvio backend Case all'Asta su http://localhost:8000"
echo "   Docs API: http://localhost:8000/docs"
echo "   Status:   http://localhost:8000/api/status"
echo ""
echo "Premi Ctrl+C per fermare"
echo ""

# Su macOS "python" non esiste: esiste solo "python3". Usiamo il primo disponibile.
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "❌ Python non trovato nel PATH" >&2
  exit 1
fi

exec "$PY" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
