#!/bin/bash
# ┌─────────────────────────────────────────────────┐
# │  🤖 Claude-WeChat Bot Launcher                   │
# │  Double-click or run from terminal to start      │
# └─────────────────────────────────────────────────┘

# Resolve the project directory (works even from symlinks)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ── Check Node.js ──────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "❌ Node.js not found!"
    echo "   Please install Node.js >= 22: https://nodejs.org"
    echo ""
    echo "   Or via nvm/n:"
    echo "     nvm install 22 && nvm use 22"
    read -p "Press Enter to close..."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "⚠️  Node.js version $(node -v) detected. Version >= 22 recommended."
    echo ""
fi

# ── Check node_modules ─────────────────────────────
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# ── Build if dist is missing ───────────────────────
if [ ! -f "dist/index.js" ]; then
    echo "🔨 Building TypeScript..."
    npm run build
fi

# ── Start the bot ──────────────────────────────────
echo ""
echo "🚀 Starting Claude-WeChat Bot..."
echo "   Press Ctrl+C to stop."
echo ""

npm start

# ── Keep window open on error ──────────────────────
if [ $? -ne 0 ]; then
    echo ""
    echo "⚠️  Bot exited with an error."
    read -p "Press Enter to close..."
fi
