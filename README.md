# LhiMedia / BotLink

Website dan bot Telegram berbasis Node.js untuk mengunduh **media publik yang pengguna berhak simpan** dari Facebook, Instagram, TikTok, YouTube, dan X, serta membuat video AI melalui 9Router/Veo. BotLink tidak mendukung DRM, konten privat, cookie login, atau bypass akses.

## Fitur

- Download media publik dari website atau bot Telegram.
- Dashboard admin dengan autentikasi, session SQLite, rate limit, dan CSRF protection.
- Pembuatan dan pemeriksaan job video AI 9Router/Veo.
- Mode Telegram `polling` atau `webhook` dengan secret token.
- Perintah Veo Telegram berbasis allowlist ID pengguna, kepemilikan job, kuota, dan throttle.
- Queue download bersama serta service systemd dengan resource hardening.

## Kebutuhan Produksi

- Ubuntu/Debian modern dengan akses `sudo`/root dan koneksi internet.
- Domain/subdomain publik dengan DNS mengarah ke server.
- Reverse proxy HTTPS, misalnya Nginx atau Caddy, bila memakai domain publik atau Telegram webhook.
- Token bot dari [@BotFather](https://t.me/BotFather) bila fitur Telegram digunakan.
- Akun/API key 9Router dengan akses model video bila memakai AI Video/Veo.

Installer memasang Node.js 22+, FFmpeg, dependensi Node.js, dan `yt-dlp` yang dipin serta diverifikasi SHA-256. Database SQLite dibuat otomatis di `data/botlink.db`.

## Instalasi Cepat di Ubuntu

> Jalankan installer hanya dari root source project. Jangan memasukkan secret ke command history atau repository.

1. Masuk ke server lalu clone repository:

   ```bash
   sudo apt-get update
   sudo apt-get install -y git
   git clone https://github.com/devlhi/lhimedia.git botlink
   cd botlink
   ```

2. Jalankan installer interaktif:

   ```bash
   sudo bash install-ubuntu.sh
   ```

3. Isi pertanyaan installer:
   - Nama aplikasi.
   - Username dan password admin (minimal 12 karakter).
   - Base URL API, API key, dan endpoint video 9Router.
   - Port internal aplikasi dan URL publik HTTPS.
   - Token bot Telegram (opsional).
   - Mode Telegram: `webhook` atau `polling`.
   - Daftar numeric Telegram user ID yang diizinkan memakai Veo (opsional).

Installer membuat `.env` dengan permission `root:botlink` mode `0640`, membuat user service `botlink`, memasang binary `yt-dlp` terverifikasi, dan membuat/memulai service systemd `botlink`.

4. Periksa service dan log:

   ```bash
   sudo systemctl status botlink
   sudo journalctl -u botlink -f
   ```

5. Buka URL publik lalu login pada `/admin/login`.

## Konfigurasi Reverse Proxy dan HTTPS

Aplikasi hanya mendengarkan port internal yang dipilih installer (default `3100`). Untuk deployment publik, letakkan Nginx/Caddy di depan aplikasi, aktifkan HTTPS, lalu blok akses publik langsung ke port aplikasi menggunakan firewall/provider firewall.

Contoh Nginx ringkas (`/etc/nginx/sites-available/botlink`):

```nginx
server {
    listen 80;
    server_name bot.example.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ganti `bot.example.com`, uji konfigurasi, aktifkan site, lalu terbitkan sertifikat TLS:

```bash
sudo ln -s /etc/nginx/sites-available/botlink /etc/nginx/sites-enabled/botlink
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d bot.example.com
```

Setelah HTTPS aktif, pastikan `APP_URL` memakai URL `https://` yang sama. Bila memilih Telegram webhook, buka menu **Telegram** di dashboard dan pilih **Set Webhook**. Jangan mengekspos `.env`, `data/`, atau port Node.js langsung ke internet.

## Pengelolaan Layanan

```bash
sudo systemctl restart botlink
sudo systemctl status botlink
sudo journalctl -u botlink -n 100 --no-pager
sudo journalctl -u botlink -f
```

Untuk menjalankan ulang installer, jalankan `sudo bash install-ubuntu.sh`. Jika `.env` sudah ada, installer meminta konfirmasi dan membuat backup `.env.backup-YYYYMMDD-HHMMSS` sebelum mengganti konfigurasi.

## Development Lokal

1. Gunakan Node.js 22.5+ dan FFmpeg.
2. Salin konfigurasi contoh:

   ```bash
   cp .env.example .env
   ```

3. Buat hash password admin dan isi `.env`:

   ```bash
   node scripts/hash-password.js "password-minimal-12-karakter"
   ```

4. Instal dan jalankan:

   ```bash
   npm ci
   npm run dev
   ```

5. Jalankan validasi:

   ```bash
   npm test
   npm audit --omit=dev
   ```

## Dashboard dan video AI

Buka `/admin/login`, kemudian masukkan username/password yang dibuat saat instalasi. Login menggunakan session SQLite, cookie HttpOnly/SameSite, regenerasi session ID, CSRF token, serta rate limit.

Menu **AI Video** menggunakan endpoint model `${NINE_ROUTER_API_URL}/models`, endpoint video `${NINE_ROUTER_API_URL}/${NINE_ROUTER_VIDEO_ENDPOINT}`, dan URL polling yang dikembalikan provider. API key hanya berada di `.env` dan tidak dapat diubah melalui browser. Isi endpoint video persis sesuai dokumentasi paket 9Router; kompatibilitas chat completion saja tidak cukup.

Gunakan nilai acak panjang yang berbeda untuk `SESSION_SECRET` dan `SETTINGS_ENCRYPTION_KEY`. Penggunaan model video dapat berbayar sesuai tarif dan kuota akun 9Router.

## Telegram dan webhook

Menu **Telegram** di dashboard dapat membaca status webhook, menjalankan `setWebhook`, dan menghapus webhook. Admin tidak dapat mengirim URL callback arbitrary: URL selalu dibentuk dari `APP_URL` dan `TELEGRAM_WEBHOOK_PATH`. Request masuk diverifikasi menggunakan header `X-Telegram-Bot-Api-Secret-Token`. Token dan secret tetap berada di `.env` dan tidak ditampilkan di browser.

- `TELEGRAM_MODE=polling`: service menghapus webhook lama lalu memakai `getUpdates`.
- `TELEGRAM_MODE=webhook`: service menyediakan callback Express; klik **Set Webhook** di dashboard setelah reverse proxy HTTPS aktif.
- Set/delete memakai autentikasi admin, CSRF, rate limit, dan `POST`.
- Menghapus webhook pada mode webhook menghentikan penerimaan update sampai webhook disetel lagi. Untuk pindah ke polling, ubah mode melalui installer lalu restart service.

Handler Telegram tetap mengubah link Facebook, Instagram, TikTok, YouTube, atau X menjadi file video/dokumen. Web dan Telegram berbagi antrean download dengan batas concurrency agar FFmpeg/yt-dlp tidak mudah menghabiskan resource.

### Menggunakan Veo melalui Telegram

Isi `TELEGRAM_VEO_ALLOWED_USER_IDS` dengan ID pengguna Telegram numerik yang dipercaya, misalnya `123456789,987654321`, lalu restart service. Nilai kosong menonaktifkan perintah Veo. Perintah hanya diterima melalui chat privat dan job hanya dapat diperiksa oleh pembuatnya.

- `/veo <prompt minimal 10 karakter>` — membuat job dengan default Veo, 8 detik, 1080p, rasio 16:9, tanpa audio.
- `/veo --model=google/veo-3.1-lite --duration=8 --resolution=1080p --ratio=16:9 --audio=false <prompt>` — membuat job dengan opsi eksplisit.
- `/veostatus <nomor-job>` — melakukan tepat satu pemeriksaan status provider. Ulangi secara manual setelah sedikitnya 15 detik bila masih diproses.

Durasi yang diterima: `4`, `6`, `8`; resolusi: `720p`, `1080p`; rasio: `16:9`, `9:16`. Default pengendalian biaya adalah satu job aktif dan tiga job baru per hari untuk setiap pengguna Telegram, dapat disesuaikan dengan `TELEGRAM_VEO_MAX_ACTIVE_PER_USER` dan `TELEGRAM_VEO_DAILY_LIMIT`. Batas global provider tetap dua job aktif. `TELEGRAM_VEO_STATUS_COOLDOWN_SECONDS` membatasi pemeriksaan status setiap job (default 15 detik). Generasi video dapat berbayar. Bot tidak melakukan polling otomatis. Saat selesai, bot meminta Telegram mengambil URL HTTPS provider sebagai video, lalu dokumen, dan terakhir memberikan URL hasil bila kedua metode gagal.

Untuk deployment publik, gunakan HTTPS/reverse proxy, firewall port aplikasi supaya hanya proxy yang bisa mengaksesnya, simpan secret hanya di `.env`, dan batasi dashboard berdasarkan IP/VPN bila memungkinkan. SSRF dari DNS rebinding/redirect yt-dlp tidak bisa diselesaikan penuh hanya dengan validasi URL; jalankan service/container dengan firewall egress yang memblokir loopback, RFC1918, link-local, dan metadata cloud.

## Konfigurasi Penting

| Variabel | Fungsi |
|---|---|
| `APP_URL` | URL publik HTTPS tanpa query/credential. |
| `PORT` | Port internal aplikasi, default `3100`. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | Kredensial dashboard admin. |
| `SESSION_SECRET` | Secret session; dibuat acak oleh installer. |
| `NINE_ROUTER_API_URL` / `NINE_ROUTER_API_KEY` | Akses API 9Router. |
| `NINE_ROUTER_VIDEO_ENDPOINT` | Endpoint video relatif terhadap base URL. |
| `TELEGRAM_BOT_TOKEN` | Token bot dari BotFather. |
| `TELEGRAM_MODE` | `disabled`, `polling`, atau `webhook`. |
| `TELEGRAM_VEO_ALLOWED_USER_IDS` | Allowlist numeric user ID Telegram, dipisahkan koma. |
| `TELEGRAM_VEO_MAX_ACTIVE_PER_USER` | Maksimal job Veo aktif per pengguna. |
| `TELEGRAM_VEO_DAILY_LIMIT` | Maksimal job Veo baru per pengguna per hari (UTC). |
| `TELEGRAM_VEO_STATUS_COOLDOWN_SECONDS` | Jeda minimum pemeriksaan status job. |
| `MAX_FILE_SIZE_MB` | Batas hasil download, default 45 MB. |
| `DOWNLOAD_TIMEOUT_SECONDS` | Batas proses download, default 180 detik. |
| `CLEANUP_AFTER_MINUTES` | Penghapusan file temporary, default 30 menit. |
| `YTDLP_BINARY` | Lokasi binary `yt-dlp`; diisi installer produksi. |

## Update Aplikasi

Backup `.env` dan database sebelum update. Setelah menarik perubahan, pasang dependensi terkunci, jalankan validasi, lalu restart service:

```bash
sudo cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
sudo cp data/botlink.db "data/botlink.db.backup.$(date +%Y%m%d-%H%M%S)"
git pull --ff-only origin main
sudo npm ci --omit=dev
npm test
sudo systemctl restart botlink
sudo systemctl status botlink
```

## Troubleshooting

- Service gagal aktif: `sudo journalctl -u botlink -n 100 --no-pager`.
- Webhook tidak menerima update: pastikan `APP_URL` HTTPS, sertifikat valid, DNS benar, dan klik **Set Webhook** dari dashboard.
- Telegram `401 Unauthorized`: token BotFather salah atau sudah dicabut.
- AI Video gagal: periksa URL/key/endpoint 9Router dan ketersediaan model video pada akun.
- Download gagal: periksa FFmpeg, konektivitas server, ukuran file, dan kebijakan platform sumber.
- Port digunakan proses lain: ubah `PORT` dalam `.env` atau hentikan proses pemakai port, kemudian restart service.

## Catatan Keamanan dan Penggunaan

- `.env`, database, token, API key, dan file hasil tidak boleh di-commit; semuanya sudah dicakup `.gitignore`.
- Batasi dashboard melalui VPN/IP allowlist bila memungkinkan.
- Jangan membuka port Node.js langsung ke internet; gunakan reverse proxy HTTPS.
- Pertahankan log ketika terjadi insiden dan jangan menghapus bukti sebelum dianalisis.
- Generasi Veo dapat menimbulkan biaya sesuai paket 9Router.

Dukungan platform mengikuti kemampuan `yt-dlp` dan dapat berubah sewaktu-waktu. Hormati hak cipta serta ketentuan layanan platform.
