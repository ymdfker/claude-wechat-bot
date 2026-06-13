# 🤖 Claude-WeChat Bot

Connect Claude (via DeepSeek API) directly to your personal WeChat account. A TypeScript bot that brings AI-powered conversations, file operations, shell commands, and web search capabilities right into your WeChat messages.

## ✨ Features

- **Claude AI via WeChat** — Chat with Claude directly from your WeChat messages
- **Tool Integration** — Read/write files, execute shell commands, and search the web
- **Session Management** — Persistent conversation context with configurable history length
- **Streaming Responses** — Real-time streaming AI responses
- **Slash Commands** — Built-in commands for bot control (`/help`, `/clear`, etc.)
- **Cron Scheduler** — Schedule recurring messages or tasks
- **Permission System** — Configurable permission modes (`yolo`, `ask`, `deny`)
- **Thinking Mode** — Support for Claude's extended thinking capability

## 📋 Prerequisites

- macOS 13+ (for the desktop app)
- [Node.js](https://nodejs.org/) >= 22
- A WeChat account (personal)
- A [DeepSeek API](https://platform.deepseek.com/) key (or Anthropic API key)

## 🚀 Quick Start

### Option A: One-click (macOS)

1. Download **Claude-WeChat-Bot.dmg** from [GitHub Releases](https://github.com/ymdfker/claude-wechat-bot/releases/latest)
2. Mount the DMG and drag the app to **Applications**
3. Set your API token:
   ```bash
   echo 'export ANTHROPIC_AUTH_TOKEN="sk-your-deepsek-key"' >> ~/.zshrc
   echo 'export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"' >> ~/.zshrc
   ```
4. Double-click **Claude-WeChat-Bot** in Applications to start!

The app opens a Terminal window that auto-installs dependencies and starts the bot.

### Option B: Command Line

```bash
# Clone the repository
git clone git@github.com:ymdfker/claude-wechat-bot.git
cd claude-wechat-bot

# Install dependencies
npm install

# Set up your API token
export ANTHROPIC_AUTH_TOKEN="sk-your-deepseek-api-key"
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"

# Start the bot
npm run dev
```

Or use the launcher script:
```bash
bash scripts/start.sh
```

### Option C: Build the app yourself

```bash
bash scripts/build-installer.sh
# Outputs dist-app/Claude-WeChat-Bot.app and dist-app/Claude-WeChat-Bot.dmg
```

On first run, a QR code will appear in the terminal. Scan it with your WeChat app to log in.

## ⚙️ Configuration

The bot reads configuration from multiple sources (in priority order):

1. **Environment variables**
   - `ANTHROPIC_BASE_URL` — API base URL (default: `https://api.deepseek.com/anthropic`)
   - `ANTHROPIC_AUTH_TOKEN` — Your API authentication token
   - `ANTHROPIC_MODEL` — Model name (default: `deepseek-v4-pro[1m]`)
   - `ANTHROPIC_FAST_MODEL` — Fast model for simple queries
   - `WORK_DIR` — Working directory for file/shell operations

2. **`~/.claude/settings.json`** — Claude Code config (auto-detected)

3. **`data/config.json`** — Local bot configuration file

### Permission Modes

| Mode | Behavior |
|------|----------|
| `yolo` | Auto-approve all tool calls |
| `ask` | Prompt for confirmation before each action |
| `deny` | Reject all file and shell operations |

## 📁 Project Structure

```
claude-wechat-bot/
├── src/
│   ├── index.ts          # Entry point
│   ├── bot.ts            # Main bot class
│   ├── config.ts         # Configuration loader
│   ├── claude/
│   │   └── client.ts     # Claude API client (streaming + tools)
│   ├── commands/
│   │   ├── parser.ts     # Slash command parser
│   │   └── handlers.ts   # Command handlers
│   ├── cron/
│   │   └── scheduler.ts  # Cron job scheduler
│   ├── permissions/
│   │   └── guard.ts      # Permission guard
│   ├── session/
│   │   ├── manager.ts    # Session manager
│   │   └── store.ts      # SQLite-based session store
│   └── tools/            # Tool definitions
├── scripts/
│   ├── start.sh          # Terminal launcher script
│   └── build-installer.sh # macOS .app + .dmg builder
├── data/                 # Runtime data (gitignored)
├── package.json
└── tsconfig.json
```

## 🛠️ Development

```bash
npm run dev       # Start in development mode (hot reload)
npm run build     # Compile TypeScript
npm start         # Start compiled JS
npm run typecheck # Type-check only
```

## 📄 License

MIT License

## ⚠️ Disclaimer

This project is for educational and personal use. Use responsibly and comply with WeChat's Terms of Service. The developers are not responsible for any account restrictions or bans resulting from the use of this bot.
