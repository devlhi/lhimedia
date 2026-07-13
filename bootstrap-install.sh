#!/usr/bin/env bash
# Bootstrap installer LhiMedia/BotLink dari repository GitHub.
# Unduh, tinjau, lalu jalankan file ini dari terminal interaktif.
set -Eeuo pipefail
IFS=$'\n\t'

REPOSITORY_URL="https://github.com/devlhi/lhimedia.git"
INSTALL_DIR="${BOTLINK_INSTALL_DIR:-/opt/botlink}"
COMMIT="${BOTLINK_COMMIT:-}"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail "Jalankan file yang telah ditinjau dengan: sudo bash bootstrap-install.sh"
[[ -t 0 && -t 1 ]] || fail "Jangan pipe script ke shell. Unduh, tinjau, lalu jalankan dari terminal interaktif."
[[ "$INSTALL_DIR" =~ ^/opt/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ && "$INSTALL_DIR" != *"/../"* ]] || fail "BOTLINK_INSTALL_DIR harus berupa path kanonis di bawah /opt (default /opt/botlink)."
[[ "$COMMIT" =~ ^[a-fA-F0-9]{40}$ ]] || fail "Set BOTLINK_COMMIT ke full commit SHA 40 karakter yang sudah ditinjau."

export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates git
fi

if [[ -e "$INSTALL_DIR" ]]; then
  [[ -d "$INSTALL_DIR/.git" ]] || fail "$INSTALL_DIR sudah ada dan bukan checkout Git BotLink. Pindahkan atau hapus secara manual."
  [[ "$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)" == "$REPOSITORY_URL" ]] || fail "Remote Git di $INSTALL_DIR bukan repository resmi BotLink."
  [[ -z "$(git -C "$INSTALL_DIR" status --porcelain)" ]] || fail "Repository di $INSTALL_DIR memiliki perubahan lokal. Commit atau backup terlebih dahulu."
  git -C "$INSTALL_DIR" fetch --no-tags origin "$COMMIT"
else
  install -d -m 0755 "$(dirname "$INSTALL_DIR")"
  git clone --no-checkout --filter=blob:none "$REPOSITORY_URL" "$INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --no-tags origin "$COMMIT"
fi

git -C "$INSTALL_DIR" checkout --detach --force "$COMMIT"
[[ "$(git -C "$INSTALL_DIR" rev-parse HEAD)" == "$COMMIT" ]] || fail "Checkout commit yang diminta gagal diverifikasi."
[[ -f "$INSTALL_DIR/install-ubuntu.sh" ]] || fail "install-ubuntu.sh tidak ditemukan setelah checkout."
cd "$INSTALL_DIR"
exec bash ./install-ubuntu.sh
