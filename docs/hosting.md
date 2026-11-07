# Hosting DEAD AIR

Nothing is deployed yet. A person sets this up. The app is a static site: `npm ci`, then
`npm run build`, then serve `dist/` from any static host.

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

1. No camera prompt on load. Switch Reflection on: one prompt, `REFL` lit, a faint grey
   mirror image with the set off.
2. A film plays, and seeking works after a reload, so byte ranges are on.
3. `/?demo=1` reaches the sign-off inside three and a half minutes.
