#!/bin/bash
# Setup iniziale — installa dipendenze Python e browser Playwright

set -e

echo "📦 Installo dipendenze Python..."
pip install -r requirements.txt

echo "🌐 Installo browser Chromium per Playwright..."
playwright install chromium

echo "📁 Creo cartella dati..."
mkdir -p data

echo ""
echo "✅ Setup completato!"
echo ""
echo "Per avviare il backend:"
echo "  python -m api.main"
echo ""
echo "Per eseguire lo scraping manuale da CLI:"
echo "  python -m scraper.main --regione Lombardia --prezzo-max 200000"
echo ""
echo "Il frontend React (case-asta.jsx) si connette automaticamente a http://localhost:8000"
