# Setup tab AI (OmniRoute di VPS)

Alurnya: **CS Tracker (Vercel) → https://ai.domainmu.com/v1 (Caddy di VPS) → OmniRoute (Docker) → provider AI**.
Dashboard OmniRoute TIDAK dibuka ke internet — hanya bisa diakses lewat SSH tunnel.

## 1. Install Docker di VPS (Ubuntu/Debian)

```bash
ssh root@IP_VPS
curl -fsSL https://get.docker.com | sh
```

## 2. Jalankan OmniRoute

```bash
mkdir -p ~/omniroute && cd ~/omniroute
curl -fsSLO https://raw.githubusercontent.com/cheaper-inference/OmniRoute/release/v3.8.53/docker-compose.selfhost.yml
curl -fsSL -o .env https://raw.githubusercontent.com/cheaper-inference/OmniRoute/release/v3.8.53/.env.selfhost.example
nano .env
```

Di `.env` ubah / tambahkan:

```
APP_BIND_HOST=127.0.0.1        # biarkan — hanya bisa diakses dari dalam VPS
REQUIRE_API_KEY=true           # WAJIB true
INITIAL_PASSWORD=password-dashboard-yang-kuat
OMNIROUTE_MEMORY_MB=1024       # cukup buat chat; naikkan kalau RAM VPS besar
```

```bash
mkdir -p data && chown -R 1000:1000 data
docker compose -f docker-compose.selfhost.yml up -d
docker compose -f docker-compose.selfhost.yml logs -f omniroute   # Ctrl+C untuk keluar
```

## 3. Buka dashboard lewat SSH tunnel (dari laptop)

```bash
ssh -L 20128:127.0.0.1:20128 root@IP_VPS
```

Biarkan terminal itu terbuka, lalu buka **http://localhost:20128** di browser laptop.
Login pakai `INITIAL_PASSWORD` (kalau wizard minta token sekali pakai: `docker logs omniroute 2>&1 | grep -i token`).

1. **Providers** → sambungkan minimal 1 provider (pakai akun / API key milikmu sendiri, mis. Groq, Google AI Studio/Gemini, OpenRouter, Mistral).
2. **Endpoints** → buat / salin **API key OmniRoute** (ini yang nanti dipasang di Vercel).

Tes dari VPS:

```bash
curl http://127.0.0.1:20128/v1/chat/completions \
  -H "Authorization: Bearer API_KEY_OMNIROUTE" -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Halo!"}]}'
```

## 4. HTTPS dengan Caddy (supaya Vercel bisa menghubungi VPS)

Siapkan subdomain, mis. `ai.domainmu.com` → buat **A record** ke IP VPS.
(Kalau belum punya domain bisa coba `ai.IP-PAKAI-STRIP.sslip.io`, mis. `ai.103-12-34-56.sslip.io`.)

```bash
apt install -y caddy
nano /etc/caddy/Caddyfile
```

Isi Caddyfile (ganti domainnya):

```
ai.domainmu.com {
	# hanya API /v1 yang dibuka; dashboard tetap tertutup
	@api path /v1/*
	handle @api {
		reverse_proxy 127.0.0.1:20128 {
			flush_interval -1
		}
	}
	handle {
		respond "Not found" 404
	}
}
```

```bash
systemctl reload caddy
ufw allow 22 && ufw allow 80 && ufw allow 443   # kalau pakai ufw
```

Tes dari laptop:

```bash
curl https://ai.domainmu.com/v1/models -H "Authorization: Bearer API_KEY_OMNIROUTE"
```

## 5. Sambungkan ke CS Tracker

1. Supabase → SQL Editor → jalankan `supabase/migration-13-ai-chat.sql`.
2. Vercel → Settings → Environment Variables:

| Nama | Isi |
|---|---|
| `OMNIROUTE_BASE_URL` | `https://ai.domainmu.com` |
| `OMNIROUTE_API_KEY` | API key dari Dashboard → Endpoints |
| `AI_DEFAULT_MODEL` | (opsional) default `auto` |
| `AI_SYSTEM_PROMPT` | (opsional) instruksi tambahan untuk AI |

3. **Redeploy**. Tab **✨ AI** muncul di menu untuk semua role.

## Catatan

- Percakapan tiap orang privat (admin pun tidak bisa melihat).
- Vercel Hobby membatasi satu jawaban maksimal ±60 detik — jawaban yang sangat panjang bisa terpotong.
- Kuota & aturan pemakaian mengikuti provider yang kamu sambungkan di OmniRoute.
- Update OmniRoute: `cd ~/omniroute && docker compose -f docker-compose.selfhost.yml pull && docker compose -f docker-compose.selfhost.yml up -d`.
