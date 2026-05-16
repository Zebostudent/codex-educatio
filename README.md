# Codex Education — Railway Deployment

## GitHub ga yuklash

1. github.com → New repository → "codex-education"
2. Barcha fayllarni yuklang (drag & drop)

## Railway ga deploy qilish

1. railway.app → Login with GitHub
2. New Project → Deploy from GitHub repo
3. "codex-education" ni tanlang

## Environment Variables (muhim!)

Railway → Variables tabiga qo'shing:

```
MARKAZ_NOMI      = Codex Education
MARKAZ_TEL       = +998 XX XXX XX XX
ADMIN_PAROL      = sizning_admin_parol
TEACHER_PAROL    = sizning_teacher_parol
ANTHROPIC_API_KEY = sk-ant-...
ESKIZ_EMAIL      = email@gmail.com
ESKIZ_PASSWORD   = parol
```

## Domain

Railway → Settings → Generate Domain
→ https://codex-education.up.railway.app

## Parollar (standart)
- Admin: admin123
- O'qituvchi: teacher123
