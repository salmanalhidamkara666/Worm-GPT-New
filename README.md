# Worm AI - OpenRouter Gemma Model (Vercel)

Ringkasan: Backend serverless yang menggunakan OpenRouter API dengan model Gemma gratis (`google/gemma-4-26b-a4b-it:free`). API key tidak terlihat di sisi client. Endpoint serverless sudah ditambahkan di `api/chat.js`.

## Model: Google Gemma 4 26B (Gratis via OpenRouter)

- **Model ID**: `google/gemma-4-26b-a4b-it:free`
- **Provider**: OpenRouter.ai
- **Cost**: Gratis
- **Persona**: Worm AI - asisten yang membantu dengan singkat, jelas, dan sopan

Langkah cepat untuk deploy di Vercel (GitHub):

1. Push repo ke GitHub dan hubungkan repository ke Vercel.
2. Di dashboard Vercel, buka project -> Settings -> Environment Variables.
3. Tambahkan variabel environment berikut (Production/Preview/Development sesuai kebutuhan):
   - `OPENROUTER_API_KEY`: API key dari OpenRouter (dapatkan di https://openrouter.ai/keys) — **wajib**.
   - `OPENROUTER_MODEL`: (opsional) model, default `google/gemma-4-26b-a4b-it:free`.
   - `PERSONA`: (opsional) persona untuk AI, default dari config.
   - `SITE_URL`: URL site untuk HTTP-Referer header.

4. Commit dan push perubahan. Vercel otomatis akan deploy dari branch yang terhubung.

Pengujian lokal:

1. Buat file `.env` di root dengan variabel:

```
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free
PERSONA=Worm AI, asisten yang membantu dengan singkat, jelas, dan sopan.
SITE_URL=http://127.0.0.1:3007
```

2. Jalankan dev-server:

```bash
node dev-server.js
```

3. Buka di browser:
   - Chat Interface: `http://127.0.0.1:3007/test-chat.html`
   - API Endpoint: `POST http://127.0.0.1:3007/api/chat`

4. Test API dengan curl:

```bash
curl -X POST http://127.0.0.1:3007/api/chat \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Halo, siapa nama kamu?"}]}]}'
```

Catatan keamanan:

- Jangan menyimpan API key di file klien (seperti `index.html`).
- Pastikan `OPENROUTER_API_KEY` hanya diset di environment Vercel, bukan di kode sumber.
- File `.env` sudah di-ignore oleh `.gitignore` untuk mencegah leak credential.
- OpenRouter gratis untuk model Gemma 4 26B - tidak ada biaya tambahan.

## Fitur Tambahan

### Chat Test Interface

- File: `test-chat.html`
- Interface testing sederhana tanpa perlu login
- Bisa di-akses di `http://127.0.0.1:3007/test-chat.html` saat development

### Dev Server

- File: `dev-server.js`
- Node.js server untuk development lokal
- Melayani static files (CSS, JS, HTML)
- Cascading port allocation (3006, 3007, 3008, dst)
- CORS support enabled
- Format conversion Gemini ↔ OpenRouter

### Frontend

- Login page: `login.html`
- Chat interface: `index.html`
- Database: PostgreSQL via Neon
- Authentication: Client-side (untuk demo)
