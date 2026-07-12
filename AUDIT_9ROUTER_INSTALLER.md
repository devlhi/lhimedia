# Audit BotLink — 9Router dan Installer Ubuntu

Tanggal audit: 12 Juli 2026  
Lingkup: source code BotLink, migrasi provider AI ke 9Router, autentikasi dashboard, dan `install-ubuntu.sh`.

## Ringkasan

Status: **siap untuk validasi produksi terbatas**, dengan satu ketergantungan eksternal yang harus dikonfirmasi: kontrak endpoint video 9Router. Installer sekarang meminta endpoint relatif secara interaktif agar tidak mengasumsikan bahwa seluruh API OpenAI-compatible memiliki endpoint video yang sama.

## Perbaikan yang diterapkan

| Area | Temuan | Perbaikan |
|---|---|---|
| Login admin | Kunci admin lama tidak lagi sesuai dengan kebutuhan username/password. | Menggunakan `ADMIN_USERNAME` dan hash password scrypt; session diregenerasi saat login. |
| Secret instalasi | Password sebelumnya berisiko diteruskan lewat argumen proses. | Password diteruskan ke `scripts/hash-password.js --stdin`, bukan lewat daftar argumen proses. |
| Installer | Default input kosong, `openssl` belum dipasang, `.env` tidak dapat direinstall, dan ownership terlalu luas. | Default input berfungsi, `openssl` dipasang, `.env` dibackup interaktif, file secret `0600`, dan ownership dibatasi untuk direktori runtime. |
| Konfigurasi 9Router | UI masih memiliki form pengaturan API yang rutenya sudah tidak ada. | Form dihapus; konfigurasi menjadi installer-managed/read-only. |
| Endpoint video | Endpoint `/videos` tidak dapat diasumsikan dari label OpenAI-compatible. | Tambah `NINE_ROUTER_VIDEO_ENDPOINT`; installer meminta nilainya berdasarkan dokumentasi 9Router. |
| Job video | Tidak ada batas job aktif. | Batas dua job aktif dan satu request pembuatan serentak per proses. |
| Provider response | Bentuk respons/provider URL terlalu sempit. | Mendukung beberapa nama umum untuk ID, status, polling URL, dan output URL; polling tetap dibatasi ke origin/base-path 9Router. |
| Output video | Output CDN provider yang valid dapat ditolak. | Link hasil hanya menerima URL HTTPS tanpa credential dan dibuka dengan `noopener noreferrer`. |
| URL downloader | Cakupan IPv6 private/link-local belum lengkap. | Memblokir loopback, unspecified, ULA, link-local, multicast, dan IPv4-mapped private IPv6. |
| Log/error | Error yt-dlp dapat mengekspos detail provider ke pengguna. | Detail hanya dicatat server-side; pengguna menerima pesan generik. |
| Dependency/kode mati | SDK Gemini dan modul provider lama masih tersisa. | Menghapus `@google/genai`, `gemini-video.js`, `openrouter-video.js`, dan `utils.js`. |
| Session DB | Session kedaluwarsa tidak dibersihkan. | Pembersihan session per jam ditambahkan. |

## Validasi yang berhasil dijalankan

- Seluruh file JavaScript `src/` dan `scripts/`: syntax check berhasil.
- Password scrypt: hash benar diterima dan password salah ditolak.
- URL berbahaya: `127.0.0.1`, `::1`, dan protokol non-HTTP(S) ditolak.
- Smoke test HTTP: login username/password, cookie `HttpOnly` / `SameSite=Strict`, dashboard, dan header `Cache-Control: no-store` berhasil.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- `bash -n install-ubuntu.sh`: berhasil.
- VS Code diagnostics: tidak ada error.

## Batasan sebelum produksi penuh

1. **Wajib verifikasi dokumentasi 9Router**: gunakan base URL dan `NINE_ROUTER_VIDEO_ENDPOINT` yang tepat untuk akun/paket Anda. Endpoint model masih menggunakan `${NINE_ROUTER_API_URL}/models`; endpoint job menggunakan `${NINE_ROUTER_API_URL}/${NINE_ROUTER_VIDEO_ENDPOINT}`.
2. Jalankan installer pada Ubuntu/Debian nyata dan konfirmasi `systemctl status botlink` aktif. Audit ini tidak dapat memvalidasi apt, NodeSource, systemd, atau kredensial 9Router dari Windows.
3. Reverse proxy HTTPS (Nginx/Caddy) belum dibuat otomatis. `APP_URL` harus merupakan URL HTTPS final dan proxy perlu meneruskan `X-Forwarded-Proto` agar cookie production bekerja benar.
4. Tambahkan pembatasan firewall/reverse-proxy dan, bila memungkinkan, allowlist IP/VPN untuk `/admin`.
5. Kompatibilitas model dan parameter video (durasi, resolusi, audio, aspect ratio) tetap bergantung pada paket 9Router dan model Veo yang dipakai.

## Cara instalasi

Dari folder source BotLink di Ubuntu/Debian:

1. Jalankan `sudo bash install-ubuntu.sh`.
2. Masukkan username/password dashboard, base URL, API key, dan endpoint video dari dokumentasi 9Router.
3. Gunakan `systemctl status botlink` untuk memeriksa service.
4. Gunakan `journalctl -u botlink -f` bila service atau provider video bermasalah.

Installer membackup `.env` lama ke `.env.backup.<timestamp>` sebelum penggantian jika Anda menyetujui prompt.
