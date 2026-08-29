#!/usr/bin/env bash
# Batch gate for the DCFLens frontend.
#   build → dev server → headless load → console must be clean → 3 screenshots
# Exits non-zero on the first failure. Artifacts land in web/.checks/<timestamp>/.
#
# CHECK_STRICT=1 turns a missing mock into a hard failure. Leave it unset while
# src/mocks/msft-live.json is still owed by batch 1A.2.

set -euo pipefail

cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT="${PORT:-5199}"
BASE="http://127.0.0.1:${PORT}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT=".checks/${STAMP}"
STRICT="${CHECK_STRICT:-0}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$GRN" "$OFF" "$1"; }
warn() { printf '%s!%s %s\n' "$YEL" "$OFF" "$1"; }
die()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

DEV_PID=""
TMP="$(mktemp -d)"
cleanup() {
  local code=$?
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    # npm forks vite; kill the whole process group or the server outlives us
    # and the next run silently passes against stale code.
    kill -TERM -"$DEV_PID" 2>/dev/null || kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
  exit $code
}
trap cleanup EXIT INT TERM

mkdir -p "$OUT"

# ── 1. build ────────────────────────────────────────────────────────────────
printf '\n── build ──\n'
if ! npm run build >"$TMP/build.log" 2>&1; then
  tail -40 "$TMP/build.log" >&2
  die "npm run build failed"
fi
ok "npm run build"

# ── 2. dev server ───────────────────────────────────────────────────────────
printf '\n── dev server ──\n'
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT is already in use — a stale dev server would make this gate pass against old code"
fi

set -m   # own process group for the dev server, so cleanup can kill the tree
npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort >"$TMP/dev.log" 2>&1 &
DEV_PID=$!
set +m

for _ in $(seq 1 60); do
  if curl -fsS -m 2 -o /dev/null "$BASE/" 2>/dev/null; then break; fi
  kill -0 "$DEV_PID" 2>/dev/null || { cat "$TMP/dev.log" >&2; die "dev server exited"; }
  sleep 0.5
done
curl -fsS -m 2 -o /dev/null "$BASE/" 2>/dev/null || { cat "$TMP/dev.log" >&2; die "dev server never became ready on $BASE"; }
ok "dev server ready on $BASE"

# ── shoot <name> <query> ────────────────────────────────────────────────────
# scripts/shoot.mjs drives headless Chrome over the DevTools Protocol: it loads
# the app screen, fails on any console error or uncaught exception, and writes
# the PNG. CDP rather than `--headless=new --screenshot` because this Chrome
# build logs console.error, console.warn and console.log all at INFO:CONSOLE
# severity on stderr — the picture works, but the clean-console assertion, which
# is the point of the gate, cannot be made from the log.
shoot() {
  local name="$1" query="$2"
  local png="$OUT/${name}.png"

  node scripts/shoot.mjs "${BASE}/?view=app&${query}" "$png" 4000 \
    || die "$name: console errors on the app screen"

  [ -s "$png" ] || die "$name: no screenshot written"
  ok "$name → ${png} ($(( $(wc -c <"$png") / 1024 )) kB)"
}

printf '\n── screenshots ──\n'

# 3. live MSFT envelope. Owned by 1A.2; until it lands this shoots the
#    payload-unavailable state instead of a fabricated response.
if [ -f src/mocks/msft-live.json ]; then
  shoot "1-msft-live" "mock=msft"
else
  if [ "$STRICT" = "1" ]; then
    die "src/mocks/msft-live.json missing (CHECK_STRICT=1)"
  fi
  warn "src/mocks/msft-live.json not committed yet (batch 1A.2) — run is PROVISIONAL"
  shoot "1-msft-live-MISSING" "mock=msft"
fi

# 4. the cannot-value path
shoot "2-cannot-value" "mock=novalue"

# 5. the AI-unavailable path — what a judge sees while Gemini is failing
shoot "3-deterministic-fallback" "mock=aapl&status=DETERMINISTIC_FALLBACK"

printf '\n%s\n' "$OUT"
