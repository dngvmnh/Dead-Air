# Hosting DEAD AIR

Live at https://dngvmnh.github.io/Dead-Air/ (GitHub Pages, deployed 2026-11-07 at the
owner's request; the repo was renamed from `Kiroween` to `Dead-Air` on 2026-11-08). Every push to `main` runs `.github/workflows/pages.yml`: it installs
ffmpeg, fetches and cuts the films, runs the catalogue check and unit tests, and builds
with `DEADAIR_BASE=/Dead-Air/`. Film URLs resolve against that base.

GitHub Pages cannot set response headers, so `Permissions-Policy` below is not sent
there. Browsers default the camera to the page's own origin anyway, and the app never asks
for the microphone or location. `Referrer-Policy` is set by a meta tag in `index.html`.
Pages does serve byte ranges.

The app is a static site anywhere else too: `npm ci`, then `npm run build`, then serve
`dist/`.

## Before the build

- The films are not in git. `npm run fetch:media` downloads and transcodes them into
  `public/`, and needs `ffmpeg` on the path. Without them the channels fall back to the
  drawn programmes, which is much less frightening. Run it before `npm run build`, or put
  the media on object storage.

## What the host must do

- Serve HTTPS. Browsers refuse the camera on a plain HTTP page that is not localhost.
- Honour HTTP byte ranges on the film files, or seeking to the broadcast clock breaks.
- Send these headers on the page:

```
Permissions-Policy: camera=(self), microphone=(), geolocation=()
Referrer-Policy: strict-origin-when-cross-origin
```

`camera=(self)` is what lets the optional reflection ask for the camera at all. It stays
off until the viewer clicks the rear panel.

## Check after deploying

1. No camera prompt on load. Switch "Let it see you" on: one prompt, `CAM` lit, a faint grey
   mirror image with the set off.
2. A film plays, and seeking works after a reload, so byte ranges are on.
3. `/?demo=1` reaches the sign-off inside three and a half minutes.
