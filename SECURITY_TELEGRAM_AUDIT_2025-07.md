# Audit Keamanan BotLink dan Telegram Webhook

Tanggal: 2025-07

## Verdict

Implementasi telah diperketat dan layak untuk pengujian staging. Tidak ada aplikasi yang dapat dijamin sepenuhnya kebal dari peretasan. Deployment publik tetap memerlukan HTTPS/reverse proxy, pembatasan akses dashboard, pembaruan dependency, backup, monitoring, dan firewall egress.

## Perbaikan yang diterapkan

- Admin Telegram sekarang menyediakan status webhook serta aksi set/delete melalui autentikasi, CSRF, POST, dan rate limit.
- Callback URL hanya berasal dari `APP_URL` dan path acak konfigurasi; browser tidak dapat memasukkan URL webhook arbitrary.
- Callback memverifikasi `X-Telegram-Bot-Api-Secret-Token` secara timing-safe melalui Telegraf.
- Mode polling dan webhook dipisahkan agar `getUpdates` tidak berbenturan dengan webhook.
- Handler Telegram tetap menerima URL sosial media dan mengirim hasil sebagai dokumen.
- Download web dan Telegram memakai antrean global dengan batas concurrency, panjang antrean, dan satu job per pengguna/IP.
- yt-dlp tidak lagi diunduh saat request. Installer memakai versi pin, checksum SHA-256 resmi, binary root-owned, dan direktori binary read-only bagi service.
- Output yt-dlp diperiksa agar tetap di direktori temporary, berupa regular file, bukan symlink, dan tidak melebihi batas ukuran.
- Timeout, cleanup file parsial, sanitasi log, retention database, SQLite busy timeout, serta batas resource systemd ditambahkan.
- CSRF berlaku untuk seluruh HTTP method yang tidak aman.
- Parser konfigurasi menolak angka, enum, APP_URL, path webhook, dan secret yang tidak valid.
- Payload webhook dibatasi 256 KB dan payload terlalu besar menghasilkan HTTP 413.

## Bukti validasi lokal

- Seluruh JavaScript di `src/`, `scripts/`, dan `tests/` lolos `node --check`.
- `npm test`: 3 test lulus (parser angka konfigurasi, konfigurasi webhook tidak aman, dan batas antrean/per-pengguna).
- `install-ubuntu.sh` lolos `bash -n`.
- Release pin yt-dlp `2025.06.30` dan entry checksum `yt-dlp` tersedia pada release resmi GitHub.
- `npm audit --omit=dev`: 0 vulnerability.
- Diagnostik workspace: tidak ada error.
- Smoke test lokal memverifikasi login, cookie HttpOnly/SameSite=Strict, no-store admin, autentikasi halaman Telegram, CSRF, penolakan webhook secret salah (403), dan batas payload 413.

Smoke test menggunakan token dummy sehingga panggilan API Telegram nyata menghasilkan 401 yang diharapkan. Operasi nyata `getWebhookInfo`, `setWebhook`, `deleteWebhook`, pengiriman update, yt-dlp/FFmpeg, installer Ubuntu, systemd, dan reverse proxy belum dapat divalidasi tanpa token BotFather, domain HTTPS publik, dan host Ubuntu.

## Risiko residual dan tindakan wajib produksi

1. Validasi DNS aplikasi tidak dapat sepenuhnya mencegah DNS rebinding atau redirect internal yang dilakukan extractor yt-dlp. Terapkan firewall egress/container policy yang memblokir loopback, RFC1918, link-local, multicast, dan metadata cloud.
2. Batasi port Node agar hanya reverse proxy yang dapat mengaksesnya. Aktifkan TLS valid dan jangan meneruskan header proxy dari sumber tidak tepercaya.
3. Batasi `/admin` melalui VPN, Cloudflare Access, allowlist IP, atau autentikasi tambahan.
4. Lindungi `.env`, database, dan backup dengan permission ketat; rotasi token jika pernah bocor.
5. Pantau antrean, disk, CPU, memory, HTTP 4xx/5xx, error Telegram, dan kegagalan yt-dlp.
6. Uji installer pada Ubuntu staging sebelum produksi dan pastikan permission `bin/yt-dlp` tetap `root:botlink` mode `0550`.
7. Jalankan uji Telegram nyata setelah DNS/TLS/reverse proxy aktif, lalu periksa URL, pending updates, allowed updates, dan last error melalui menu admin.
