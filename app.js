#!/usr/bin/env -S gjs -m

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Gdk from 'gi://Gdk';

const APP_ID = 'com.example.LanDrop';
const PORT = 8977;
const SAVE_DIR = GLib.build_filenamev([GLib.get_home_dir(), 'LanDropUploads']);
const APP_DIR = GLib.get_current_dir();
const TOKEN_BYTES = 18;

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

function generateAccessToken() {
    const bytes = GLib.random_bytes_new(TOKEN_BYTES).unref_to_array();
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

class LanDropWindow extends Gtk.ApplicationWindow {
    constructor(app) {
        super({ application: app, title: 'LanDrop', default_width: 760, default_height: 500 });

        ensureDir(SAVE_DIR);
        this.server = null;
        this.baseServerUrl = `http://${getLanIP()}:${PORT}`;
        this.accessToken = generateAccessToken();
        this.baseUrl = `${this.baseServerUrl}/?token=${this.accessToken}`;
        this.devices = new Map();

        const builder = Gtk.Builder.new_from_file('./ui.ble');
        const root = builder.get_object('root_box');
        this.set_child(root);

        this.statusLabel = builder.get_object('status_label');
        this.urlEntry = builder.get_object('url_entry');
        this.urlEntry.set_text(this.baseUrl);
        this.logBuffer = builder.get_object('log_buffer');
        this.qrPicture = builder.get_object('qr_picture');
        this.devicesCombo = builder.get_object('devices_combo');
        this.pairingSwitch = builder.get_object('pairing_switch');

        builder.get_object('start_btn').connect('clicked', () => this.startServer());
        builder.get_object('stop_btn').connect('clicked', () => this.stopServer());
        builder.get_object('copy_btn').connect('clicked', () => this.copyUrl());
        builder.get_object('rotate_token_btn').connect('clicked', () => this.rotateToken());
        builder.get_object('revoke_device_btn').connect('clicked', () => this.revokeSelectedDevice());
        builder.get_object('revoke_all_btn').connect('clicked', () => this.revokeAllDevices());
        this.pairingSwitch.connect('state-set', (_sw, state) => {
            this.appendLog(state ? 'Pairing enabled' : 'Pairing disabled');
            return false;
        });

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

    readAsset(filename) {
        const path = GLib.build_filenamev([APP_DIR, filename]);
        try {
            const [ok, contents] = GLib.file_get_contents(path);
            if (!ok) return null;
            return new TextDecoder('utf-8').decode(contents);
        } catch (e) {
            this.appendLog(`Failed reading ${filename}: ${e.message}`);
            return null;
        }
    }

    html() {
        return this.readAsset('frontend.html') || this.readAsset('index.html') || '<h1>Frontend missing</h1>';
    }

    parseQuery(rawQuery = '') {
        const values = {};
        for (const pair of rawQuery.split('&')) {
            if (!pair) continue;
            const [k, v] = pair.split('=', 2);
            values[decodeURIComponent(k || '')] = decodeURIComponent(v || '');
        }
        return values;
    }

    isAuthorized(msg) {
        const query = this.parseQuery(msg.get_uri().get_query() || '');
        const pairToken = query.token || '';
        const deviceToken = msg.get_request_headers().get_one('X-LanDrop-Token') || '';
        if (pairToken && pairToken === this.accessToken) return true;
        for (const d of this.devices.values()) {
            if (d.token === deviceToken && !d.revoked) return true;
        }
        return false;
    }

    requireAuthorized(msg) {
        if (this.isAuthorized(msg)) return true;
        msg.set_status(403, null);
        msg.get_response_headers().set_content_type('text/plain', { charset: 'utf-8' });
        msg.get_response_body().append(new TextEncoder().encode('Forbidden: invalid or revoked token\n'));
        return false;
    }

    rotateToken() {
        this.accessToken = generateAccessToken();
        this.baseUrl = `${this.baseServerUrl}/?token=${this.accessToken}`;
        this.urlEntry.set_text(this.baseUrl);
        this.statusLabel.set_label(`Running on ${this.baseUrl}`);
        this.appendLog('Access revoked: token rotated');
        this.renderQr();
    }

    refreshDevicesUi() {
        this.devicesCombo.remove_all();
        let activeCount = 0;
        for (const [deviceId, d] of this.devices.entries()) {
            if (d.revoked) continue;
            activeCount++;
            this.devicesCombo.append(deviceId, `${d.label}`);
        }
        this.devicesCombo.set_active(activeCount > 0 ? 0 : -1);
    }

    registerDevice(msg) {
        if (!this.pairingSwitch.get_active()) {
            msg.set_status(403, null);
            msg.get_response_headers().set_content_type('text/plain', { charset: 'utf-8' });
            msg.get_response_body().append(new TextEncoder().encode('Pairing disabled by server\n'));
            return;
        }
        const body = msg.get_request_body().flatten().get_data();
        const input = JSON.parse(new TextDecoder().decode(body) || '{}');
        if (!input.deviceId) {
            msg.set_status(400, null);
            return;
        }
        const existing = this.devices.get(input.deviceId);
        const token = existing?.token || generateAccessToken();
        const label = input.deviceName || input.deviceId;
        this.devices.set(input.deviceId, { token, label, revoked: false, lastSeen: new Date().toISOString() });
        this.refreshDevicesUi();
        this.appendLog(`Device connected: ${label}`);
        msg.set_status(200, null);
        msg.get_response_headers().set_content_type('application/json', { charset: 'utf-8' });
        msg.get_response_body().append(new TextEncoder().encode(JSON.stringify({ deviceToken: token })));
    }

    revokeSelectedDevice() {
        const deviceId = this.devicesCombo.get_active_id();
        if (!deviceId) return;
        const d = this.devices.get(deviceId);
        if (!d) return;
        d.revoked = true;
        this.devices.set(deviceId, d);
        this.refreshDevicesUi();
        this.appendLog(`Revoked device: ${d.label}`);
    }

    revokeAllDevices() {
        for (const [deviceId, d] of this.devices.entries()) {
            d.revoked = true;
            this.devices.set(deviceId, d);
        }
        this.rotateToken();
        this.refreshDevicesUi();
        this.appendLog('Revoked all devices');
    }

    touchDeviceByToken(msg) {
        const deviceToken = msg.get_request_headers().get_one('X-LanDrop-Token') || '';
        for (const [deviceId, d] of this.devices.entries()) {
            if (d.token === deviceToken && !d.revoked) {
                d.lastSeen = new Date().toISOString();
                this.devices.set(deviceId, d);
                return;
            }
        }
    }

    listUploadedFiles() {
        const files = [];
        try {
            const dir = Gio.File.new_for_path(SAVE_DIR);
            const enumerator = dir.enumerate_children('standard::name,standard::size,time::modified', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                files.push({
                    name: info.get_name(),
                    size: info.get_size(),
                    modified: info.get_modification_date_time()?.format_iso8601() || '',
                });
            }
            files.sort((a, b) => b.modified.localeCompare(a.modified));
        } catch (e) {
            this.appendLog(`Failed to list uploads: ${e.message}`);
        }
        return files;
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

        this.server.add_handler('/frontend.css', (_srv, msg) => {
            const css = this.readAsset('frontend.css');
            if (!css) {
                msg.set_status(404, null);
                return;
            }
            msg.set_status(200, null);
            msg.get_response_headers().set_content_type('text/css', { charset: 'utf-8' });
            msg.get_response_body().append(new TextEncoder().encode(css));
        });

        this.server.add_handler('/frontend.js', (_srv, msg) => {
            const js = this.readAsset('frontend.js');
            if (!js) {
                msg.set_status(404, null);
                return;
            }
            msg.set_status(200, null);
            msg.get_response_headers().set_content_type('application/javascript', { charset: 'utf-8' });
            msg.get_response_body().append(new TextEncoder().encode(js));
        });

        this.server.add_handler('/upload', (_srv, msg) => {
            if (!this.requireAuthorized(msg)) return;
            this.touchDeviceByToken(msg);
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

        this.server.add_handler('/files', (_srv, msg) => {
            if (!this.requireAuthorized(msg)) return;
            this.touchDeviceByToken(msg);
            if (msg.get_method() !== 'GET') {
                msg.set_status(405, null);
                return;
            }
            msg.set_status(200, null);
            msg.get_response_headers().set_content_type('application/json', { charset: 'utf-8' });
            msg.get_response_body().append(new TextEncoder().encode(JSON.stringify({ files: this.listUploadedFiles() })));
        });

        this.server.add_handler('/register-device', (_srv, msg) => {
            const queryToken = this.parseQuery(msg.get_uri().get_query() || '').token || '';
            if (queryToken !== this.accessToken) {
                msg.set_status(403, null);
                return;
            }
            if (msg.get_method() !== 'POST') {
                msg.set_status(405, null);
                return;
            }
            this.registerDevice(msg);
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
