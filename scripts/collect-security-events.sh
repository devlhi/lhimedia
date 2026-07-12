#!/usr/bin/env bash
# Mengumpulkan sinyal keamanan VPS secara read-only dan menulis ringkasan teredaksi.
set -Eeuo pipefail
IFS=$'\n\t'

OUTPUT_FILE="${1:-/var/lib/botlink-monitor/events.log}"
STATE_DIR="$(dirname "$OUTPUT_FILE")"
SINCE="10 minutes ago"
TMP_FILE="$(mktemp /tmp/botlink-security-events.XXXXXX)"
trap 'rm -f "$TMP_FILE"' EXIT

install -d -o root -g botlink -m 0750 "$STATE_DIR"

emit() {
  local source="$1" severity="$2" category="$3" summary="$4"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$source" "$severity" "$category" "$(printf '%s' "$summary" | tr '\r\n\t' ' ' | cut -c1-220)" >> "$TMP_FILE"
}

if command -v journalctl >/dev/null 2>&1; then
  SSH_FAILURES="$(journalctl --since "$SINCE" -u ssh -u sshd --no-pager -o cat 2>/dev/null | grep -Eci 'Failed password|Invalid user|authentication failure' || true)"
  if (( SSH_FAILURES > 0 )); then emit ssh high auth_failure "$SSH_FAILURES kegagalan autentikasi SSH dalam 10 menit terakhir"; fi
fi

if command -v fail2ban-client >/dev/null 2>&1; then
  JAILS="$(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' ' ' || true)"
  for jail in $JAILS; do
    jail="$(printf '%s' "$jail" | xargs)"
    [[ -n "$jail" ]] || continue
    BANNED="$(fail2ban-client status "$jail" 2>/dev/null | sed -n 's/.*Currently banned:[[:space:]]*//p' | tail -n1 || true)"
    [[ "$BANNED" =~ ^[0-9]+$ ]] && (( BANNED > 0 )) && emit fail2ban high banned "$BANNED alamat sedang diblokir pada jail $jail"
  done
fi

for log_file in /var/log/nginx/access.log /var/log/nginx/access.log.1; do
  [[ -r "$log_file" ]] || continue
  SCANS="$(tail -n 3000 "$log_file" 2>/dev/null | grep -Eci '(/\.env|/\.git|/wp-admin|/wp-login\.php|/xmlrpc\.php|/phpmyadmin|/adminer|/vendor/phpunit|/cgi-bin|etc/passwd)' || true)"
  ERRORS="$(tail -n 3000 "$log_file" 2>/dev/null | awk '$9 ~ /^(499|502|503|504)$/ {count++} END {print count+0}')"
  (( SCANS > 0 )) && emit nginx high scanner_path "$SCANS request path pemindaian terdeteksi pada sampel log Nginx"
  (( ERRORS >= 10 )) && emit nginx medium upstream_errors "$ERRORS response 499/502/503/504 terdeteksi pada sampel log Nginx"
  break
done

if [[ -s "$TMP_FILE" ]]; then
  touch "$OUTPUT_FILE"
  cat "$TMP_FILE" >> "$OUTPUT_FILE"
  tail -n 1000 "$OUTPUT_FILE" > "${OUTPUT_FILE}.tmp"
  mv -f "${OUTPUT_FILE}.tmp" "$OUTPUT_FILE"
fi
touch "$OUTPUT_FILE"
chown root:botlink "$OUTPUT_FILE"
chmod 0640 "$OUTPUT_FILE"
