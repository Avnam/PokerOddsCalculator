# Poker Odds Calculator

Client-side poker odds calculator supporting 6 variants:
- Texas Hold'em
- Omaha 4-card / 5-card
- Omaha 4/5 Hi-Lo (8-or-better)
- Omaha 2-Line

All computation runs in the browser — zero API calls, zero server.

## Development

```bash
npm install
npm run dev
```

## Deploy

Push to `main` → GitHub Actions builds an obfuscated bundle → deploys to GitHub Pages.

### Setup GitHub Pages
1. Go to repo **Settings → Pages**
2. Set Source to **GitHub Actions**
3. Push to `main` — done

The deployed JS is minified + obfuscated (control flow flattening, string encoding, dead code injection). Source code stays clean in the repo.
