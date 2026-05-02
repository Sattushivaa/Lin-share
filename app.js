#!/usr/bin/env -S gjs -m

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Gdk from 'gi://Gdk';

const APP_ID = 'com.example.LanDrop';
const PORT = 8977;
const SAVE_DIR = GLib.build_filenamev([GLib.get_home_dir(), 'LanDropUploads']);

function ensureDir(path) {
    try {
        GLib.mkdir_with_parents(path, 0o755);
    } catch (e) {}
}

function getLanIP() {
    try {
        const [, out] = GLib.spawn_command_line_sync("hostname -I | awk '{print $1}'");
        return new TextDecoder().decode(out).trim() || '127.0.0.1';
    } catch (e) {
        return '127.0.0.1';
    }
}

class LanDropWindow extends Gtk.ApplicationWindow {
    constructor(app) {
        super({ application: app, title: 'LanDrop', default_width: 760, default_height: 500 });

        ensureDir(SAVE_DIR);
        this.server = null;
        this.baseUrl = `http://${getLanIP()}:${PORT}`;

        const builder = Gtk.Builder.new_from_file('./ui.ble');
        const root = builder.get_object('root_box');
        this.set_child(root);

        this.statusLabel = builder.get_object('status_label');
        this.urlEntry = builder.get_object('url_entry');
        this.urlEntry.set_text(this.baseUrl);
        this.logBuffer = builder.get_object('log_buffer');
        this.qrPicture = builder.get_object('qr_picture');

        builder.get_object('start_btn').connect('clicked', () => this.startServer());
        builder.get_object('stop_btn').connect('clicked', () => this.stopServer());
        builder.get_object('copy_btn').connect('clicked', () => this.copyUrl());

        this.renderQr();
    }

    appendLog(msg) {
        const end = this.logBuffer.get_end_iter();
        this.logBuffer.insert(end, `[${new Date().toLocaleTimeString()}] ${msg}\n`, -1);
    }

    copyUrl() {
        const display = Gdk.Display.get_default();
        const clipboard = display.get_clipboard();
        clipboard.set(this.baseUrl);
        this.appendLog('URL copied to clipboard');
    }

    renderQr() {
        const tmp = GLib.build_filenamev([GLib.get_tmp_dir(), 'landrop_qr.svg']);
        try {
            GLib.spawn_command_line_sync(`qrencode -o ${tmp} -t SVG '${this.baseUrl}'`);
            this.qrPicture.set_filename(tmp);
            this.appendLog('QR code rendered');
        } catch (e) {
            this.appendLog('Install qrencode to render QR code');
        }
    }

    html() {
        return `<!DOCTYPE html>
<html>
  <head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>LanDrop</title></head>
  <body style="font-family:sans-serif;max-width:600px;margin:2rem auto;padding:1rem;">
    <h2>Secure LAN upload</h2>
    <p>Select multiple files and upload in one batch.</p>
    <form method="POST" enctype="multipart/form-data" action="/upload">
      <input type="file" name="files" multiple required /><br/><br/>
      <button type="submit">Send files</button>
    </form>
  </body>
</html>`;
    }

    parseMultipart(bodyBytes, contentType) {
        const m = /boundary=([^;]+)/i.exec(contentType || '');
        if (!m) return [];
        const boundary = `--${m[1]}`;
        const text = new TextDecoder('utf-8').decode(bodyBytes);
        const parts = text.split(boundary).slice(1, -1);
        const files = [];

        for (const p of parts) {
            const [rawHeaders, ...rest] = p.split('\r\n\r\n');
            const content = rest.join('\r\n\r\n');
            const nameMatch = /filename="([^"]+)"/i.exec(rawHeaders);
            if (!nameMatch) continue;
            const filename = nameMatch[1].replace(/[\\/]/g, '_');
            const data = content.replace(/\r\n--$/, '').replace(/\r\n$/, '');
            files.push({ filename, bytes: new TextEncoder().encode(data) });
        }

        return files;
    }

    startServer() {
        if (this.server) return;

        this.server = new Soup.Server();
        this.server.add_handler('/', (_srv, msg) => {
            msg.set_status(200, null);
            msg.get_response_headers().set_content_type('text/html', { charset: 'utf-8' });
            const bytes = new TextEncoder().encode(this.html());
            msg.get_response_body().append(bytes);
        });

        this.server.add_handler('/upload', (_srv, msg) => {
            if (msg.get_method() !== 'POST') {
                msg.set_status(405, null);
                return;
            }

            const body = msg.get_request_body().flatten().get_data();
            const ct = msg.get_request_headers().get_content_type();
            const files = this.parseMultipart(body, ct || '');

            let saved = 0;
            for (const f of files) {
                const path = GLib.build_filenamev([SAVE_DIR, `${Date.now()}_${f.filename}`]);
                try {
                    GLib.file_set_contents(path, f.bytes);
                    saved++;
                    this.appendLog(`Received: ${f.filename}`);
                } catch (e) {
                    this.appendLog(`Failed: ${f.filename} (${e.message})`);
                }
            }

            msg.set_status(200, null);
            msg.get_response_headers().set_content_type('text/plain', { charset: 'utf-8' });
            const response = new TextEncoder().encode(`Uploaded ${saved} file(s)\n`);
            msg.get_response_body().append(response);
        });

        try {
            this.server.listen_all(PORT, 0);
            this.statusLabel.set_label(`Running on ${this.baseUrl}`);
            this.appendLog(`Server started on ${this.baseUrl}`);
        } catch (e) {
            this.statusLabel.set_label(`Failed to start: ${e.message}`);
            this.appendLog(`Server error: ${e.message}`);
            this.server = null;
        }
    }

    stopServer() {
        if (!this.server) return;
        this.server.disconnect();
        this.server = null;
        this.statusLabel.set_label('Server stopped');
        this.appendLog('Server stopped');
    }
}

class LanDropApp extends Gtk.Application {
    constructor() {
        super({ application_id: APP_ID, flags: Gio.ApplicationFlags.FLAGS_NONE });
    }

    vfunc_activate() {
        const win = new LanDropWindow(this);
        win.present();
    }
}

new LanDropApp().run([]);
