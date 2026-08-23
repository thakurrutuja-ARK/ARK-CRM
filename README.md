# ARK Internal CRM

An internal tool for ARK People Solutions: manage your clients and keep
every document (PPT, PDF, JPEG, PNG, Word) organized in one place per
client.

Built with Next.js and Supabase (database, file storage, and login).

**👉 Start with [SETUP.md](./SETUP.md)** for step-by-step instructions to
get this running and deployed for your team — no coding required.

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase keys
npm run dev
```

## Tech stack

- [Next.js](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com)
- [Supabase](https://supabase.com) — Postgres database, file storage,
  and authentication
- [lucide-react](https://lucide.dev) — icons
