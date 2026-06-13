#!/bin/bash
# ============================================================================
# Claude-WeChat Bot — Start Script
# Usage: bash start.sh   (run from project directory)
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🤖 Claude-WeChat Bot"
echo "===================="

# Pull latest if it's a git repo
if [ -d .git ]; then
  echo "📥 Pulling latest..."
  git pull 2>/dev/null && echo "✓ Up to date" || echo "⚠ git pull failed (offline?)"
fi

# Install deps if missing
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install --production
fi

echo "🚀 Starting..."
exec npm run dev
