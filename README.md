# YT Downloader

This repository now includes a Netlify-ready static front-end.

## What changed

- Added `index.html` at the repository root so Netlify can publish the frontend.
- Kept `static/` assets in place for CSS and JavaScript.
- Added `netlify.toml` to publish the root folder and proxy `/api/*` requests to a remote backend.

## Deployment

1. Deploy the frontend to Netlify.
2. Update `netlify.toml` and replace `https://your-backend.example.com` with your Flask backend URL.
3. Deploy the Flask backend separately on a Python-friendly host (Render, Railway, Fly, etc.).

## Local development

- Run the Flask backend locally with `python app.py`.
- Open `templates/index.html` via the Flask server at `http://127.0.0.1:5000/`.

`index.html` is intended for static Netlify hosting, while `templates/index.html` remains available for local Flask testing.
