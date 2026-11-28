# GASTRO-SPECTRA — Contributing

## Code of conduct

This project adheres to a standard open-source code of conduct. Be respectful and constructive.

## Pull request process

### 1. Fork and clone

```bash
git clone https://github.com/kennedy-blip/gastro-spectra.git
cd gastro-spectra
npm install
```

### 2. Create a feature branch

```bash
git checkout -b feature/my-change
```

### 3. Run the local dev server

```bash
npm run dev
```

### 4. Make your changes

- Keep diffs atomic and small.
- Follow the existing code style (ES2024 JavaScript, Svelte, Python 3.12).
- No authored TypeScript.

### 5. Verify parity

If you change a clinical algorithm, mirror the change in both the Python solver and the JS engine,
then verify parity:

```bash
python3 api/gastro_physics.py
npm run build
```

### 6. Commit and push

```bash
git add .
git commit -m "feat: description of change"
git push origin feature/my-change
```

### 7. Open a PR

Open a pull request against `main` with a clear description of the change and the verification
performed.

## Branch boundaries

- **Never mix backend logic into frontend directories or vice versa.**
- **API handlers must remain stateless** — no background threads, persistent servers, or worker
  loops inside Vercel serverless functions.
- **Multi-model failover protocol** — if the active LLM provider hits a rate limit, rejects a
  request, or throws an error, immediately failover to the next model in the rotation sequence
  (OpenRouter → Groq → Gemini → NVIDIA NIM → Z.AI GLM) without interrupting conversation state.

## Change workflow

- **Clinical algorithm change** → mirror both Python and JS, verify parity.
- **New module** → add engine JS, Python mirror, module UI, 1-Tap simulator.
- **Documentation** → update README.md and wiki/ pages.

## Release process

1. Bump version in `package.json` and `api/gastro_physics.py`.
2. Run `npm run build:apk`.
3. Commit and push to `main` — CI builds the APK and publishes to `static/releases/`.
4. Tag release if desired.