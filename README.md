# LanDrop GTK (GJS)

A Linux desktop app (GTK4 + JavaScript) that:
- starts a LAN HTTP server,
- renders a QR code for quick mobile connection,
- serves a shared web frontend (`frontend.html`, `frontend.css`, `frontend.js`),
- lets a phone upload multiple files in one request.
- requires a rotating access token in the QR URL/header for upload and file-list API calls.
- lets mobile users view current files in the drop folder.
- lets the Linux server register, view, and revoke connected mobile devices.

## Requirements
- `gjs`
- `gtk4`
- `libsoup-3.0` GIR bindings
- `qrencode` (for QR image generation)

## Run
```bash
chmod +x app.js
./app.js
```

Uploads are saved in `~/LanDropUploads`.
