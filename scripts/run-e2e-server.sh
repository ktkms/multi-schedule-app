#!/usr/bin/env bash

set -euo pipefail

suite="${1:-}"

case "$suite" in
  public)
    port="${E2E_PUBLIC_PORT:-3200}"
    config_args=(--project=chromium --grep-invert @auth-required)
    ;;
  auth)
    export E2E_REQUIRE_AUTH=true
    port="${E2E_AUTH_PORT:-3201}"
    export ENABLE_DEV_LOGIN="${ENABLE_DEV_LOGIN:-true}"
    export NEXT_PUBLIC_ENABLE_DEV_LOGIN="${NEXT_PUBLIC_ENABLE_DEV_LOGIN:-true}"
    export ALLOW_DEV_LOGIN_IN_PRODUCTION="${ALLOW_DEV_LOGIN_IN_PRODUCTION:-true}"
    export NEXT_PUBLIC_ALLOW_DEV_LOGIN_IN_PRODUCTION="${NEXT_PUBLIC_ALLOW_DEV_LOGIN_IN_PRODUCTION:-true}"
    export DEV_LOGIN_ID="${DEV_LOGIN_ID:-e2e-dev}"
    export DEV_LOGIN_PASSWORD="${DEV_LOGIN_PASSWORD:-e2e-devpass}"
    export NEXTAUTH_URL="http://localhost:${port}"
    export E2E_DEV_LOGIN_ID="${E2E_DEV_LOGIN_ID:-e2e-dev}"
    export E2E_DEV_LOGIN_PASSWORD="${E2E_DEV_LOGIN_PASSWORD:-e2e-devpass}"
    if [[ "$ENABLE_DEV_LOGIN" != true || "$NEXT_PUBLIC_ENABLE_DEV_LOGIN" != true ||
          "$ALLOW_DEV_LOGIN_IN_PRODUCTION" != true || "$NEXT_PUBLIC_ALLOW_DEV_LOGIN_IN_PRODUCTION" != true ]]; then
      echo "必須の認証E2Eにはサーバー側・画面側の開発用ログインと本番モードでの利用許可をすべて有効にしてください。" >&2
      exit 1
    fi
    config_args=(--config playwright.auth.config.ts --project=chromium e2e/account-management.spec.ts)
    ;;
  *)
    echo "使用方法: $0 <public|auth>" >&2
    exit 2
    ;;
esac

if fuser -s "${port}/tcp"; then
  echo "E2E専用ポート ${port} は使用中です。既存プロセスを停止せず終了します。" >&2
  exit 1
fi

export E2E_BASE_URL="http://localhost:${port}"
server_log="/tmp/multi-schedule-app-e2e-${suite}-${port}.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[${suite}] build"
npm run build

echo "[${suite}] start server :${port}"
: > "$server_log"
npm run start -- --port "$port" > "$server_log" 2>&1 &
server_pid=$!

if ! npx wait-on --timeout 120000 "$E2E_BASE_URL"; then
  echo "E2Eサーバーを起動できませんでした。" >&2
  tail -n 200 "$server_log" >&2
  exit 1
fi

echo "[${suite}] run playwright"
if ! npx playwright test "${config_args[@]}"; then
  echo "E2E失敗時のサーバーログ:" >&2
  tail -n 200 "$server_log" >&2
  exit 1
fi
