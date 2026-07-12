#!/usr/bin/env bash
# Bootstrap installer LhiMedia/BotLink dari repository GitHub.
# Penggunaan: curl -fsSL URL_RAW | sudo bash
set -Eeuo pipefail
IFS=$'\n\t'

REPOSITORY_URL="https://github.com/devlhi/lhimedia.git"
INSTALL_DIR="${BOTLINK_INSTALL_DIR:-/opt/botlink}"
BRANCH="${BOTLINK_BRANCH:-main}"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail "Jalankan sebagai root, contoh: curl -fsSL URL | sudo bash"
[[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != "/" ]] || fail "BOTLINK_INSTALL_DIR harus berupa path absolut yang aman."
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "BOTLINK_BRANCH tidak valid."

export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates git
fi

if [[ -e "$INSTALL_DIR" ]]; then
  [[ -d "$INSTALL_DIR/.git" ]] || fail "$INSTALL_DIR sudah ada dan bukan checkout Git BotLink. Pindahkan atau hapus secara manual."
  [[ "$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)" == "$REPOSITORY_URL" ]] || fail "Remote Git di $INSTALL_DIR bukan repository resmi BotLink."
  [[ -z "$(git -C "$INSTALL_DIR" status --porcelain)" ]] || fail "Repository di $INSTALL_DIR memiliki perubahan lokal. Commit atau backup terlebih dahulu."
  git -C "$INSTALL_DIR" fetch --prune origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  install -d -m 0755 "$(dirname "$INSTALL_DIR")"
  git clone --branch "$BRANCH" --single-branch "$REPOSITORY_URL" "$INSTALL_DIR"
fi

[[ -f "$INSTALL_DIR/install-ubuntu.sh" ]] || fail "install-ubuntu.sh tidak ditemukan setelah clone."
cd "$INSTALL_DIR"
exec bash ./install-ubuntu.sh
