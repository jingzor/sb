const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
const axios = require('axios');
const selfsigned = require('selfsigned');

const NPM_DIR = path.join(__dirname, '.npm');
if (!fs.existsSync(NPM_DIR)) fs.mkdirSync(NPM_DIR, { recursive: true });

const STATE_FILE = path.join(NPM_DIR, 'state.json');
const CONFIG_FILE = path.join(NPM_DIR, 'config.json');
const ARGO_LOG = path.join(NPM_DIR, 'argo.log');
const LINKS_FILE = path.join(NPM_DIR, 'links.txt');

// 状态管理（持久化密码、UUID、WS_PATH）
let state = {};
if (fs.existsSync(STATE_FILE)) {
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
}
state.password = process.env.PASSWORD || state.password || crypto.randomBytes(8).toString('hex');
state.uuid = state.uuid || crypto.randomUUID();
state.wsPath = state.wsPath || '/' + crypto.randomBytes(4).toString('hex');
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// 下载二进制文件
async function downloadBinaries() {
    const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';
    const singBoxBin = path.join(NPM_DIR, 'sing-box');
    
    if (!fs.existsSync(singBoxBin)) {
        console.log(`Downloading sing-box for Linux ${arch}...`);
        const url = `https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-linux-${arch}-musl.tar.gz`;
        const tarPath = path.join(NPM_DIR, 'sing-box.tar.gz');
        
        const res = await axios({ method: 'get', url, responseType: 'stream' });
        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(tarPath);
            res.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        await new Promise((resolve, reject) => {
            const tar = spawn('tar', ['-xzf', tarPath, '-C', NPM_DIR, '--strip-components=1', `sing-box-1.14.4-linux-${arch}-musl/sing-box`]);
            tar.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Tar failed code ${code}`)));
        });
        
        fs.unlinkSync(tarPath);
        fs.chmodSync(singBoxBin, '755');
    }

    const argoBin = path.join(NPM_DIR, 'cloudflared');
    if (!fs.existsSync(argoBin)) {
        console.log(`Downloading cloudflared for Linux ${arch}...`);
        const argoUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
        const res = await axios({ method: 'get', url: argoUrl, responseType: 'stream' });
        const writer = fs.createWriteStream(argoBin);
        await new Promise((resolve, reject) => {
            res.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        fs.chmodSync(argoBin, '755');
    }
}

// 自签证书与 SHA-256 指纹计算
function setupCertificate() {
    const certPath = path.join(NPM_DIR, 'cert.pem');
    const keyPath = path.join(NPM_DIR, 'key.pem');

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        console.log('Generating self-signed certificate...');
        const pems = selfsigned.generate([{ name: 'commonName', value: 'bing.com' }], { days: 365 });
        fs.writeFileSync(certPath, pems.cert);
        fs.writeFileSync(keyPath, pems.private);
    }

    const pemCert = fs.readFileSync(certPath, 'utf8');
    const base64Cert = pemCert.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\r?\n/g, '');
    const derCert = Buffer.from(base64Cert, 'base64');
    const hash = crypto.createHash('sha256').update(derCert).digest('hex');
    return hash.match(/.{2}/g).join(':').toUpperCase();
}

// 保存并打印链接
function saveAndPrintLinks(links) {
    fs.writeFileSync(LINKS_FILE, links.join('\n') + '\n', 'utf8');
    console.log('\n================= 节点协议链接 =================');
    links.forEach(link => console.log(link));
    console.log('==============================================');
    console.log(`所有链接已保存至: ${LINKS_FILE}\n`);
}

async function main() {
    if (os.platform() !== 'linux' || (os.arch() !== 'x64' && os.arch() !== 'arm64')) {
        console.error('Error: Only Linux amd64 and arm64 systems are supported.');
        process.exit(1);
    }

    await downloadBinaries();
    const sha256Fingerprint = setupCertificate();

    // 获取公网 IP 用于生成直连节点链接
    let publicIp = process.env.SERVER_IP || process.env.DOMAIN;
    if (!publicIp) {
        try {
            const res = await axios.get('https://api.ipify.org', { timeout: 3000 });
            publicIp = res.data.trim();
        } catch (e) {
            publicIp = '127.0.0.1';
        }
    }

    const hy2Port = process.env.HY2_PORT ? parseInt(process.env.HY2_PORT) : 0;
    const tuicPort = process.env.TUIC_PORT ? parseInt(process.env.TUIC_PORT) : 0;
    const anytlsPort = process.env.ANYTLS_PORT ? parseInt(process.env.ANYTLS_PORT) : 8443;
    const argoPort = process.env.ARGO_PORT ? parseInt(process.env.ARGO_PORT) : 8080;

    if (hy2Port > 0 && tuicPort > 0 && hy2Port === tuicPort) {
        console.error('Error: HY2_PORT and TUIC_PORT cannot use the same port.');
        process.exit(1);
    }

    const inbounds = [];
    const links = [];

    // 启用 Hysteria2
    if (hy2Port > 0) {
        inbounds.push({
            type: "hysteria2",
            tag: "hy2-in",
            listen: "::",
            listen_port: hy2Port,
            users: [{ password: state.password }],
            tls: { enabled: true, certificate_path: path.join(NPM_DIR, 'cert.pem'), key_path: path.join(NPM_DIR, 'key.pem') }
        });
        links.push(`hysteria2://${state.password}@${publicIp}:${hy2Port}?insecure=1&sni=bing.com&pinSHA256=${sha256Fingerprint}#Hysteria2`);
    }

    // 启用 TUIC
    if (tuicPort > 0) {
        inbounds.push({
            type: "tuic",
            tag: "tuic-in",
            listen: "::",
            listen_port: tuicPort,
            users: [{ uuid: state.uuid, password: state.password }],
            tls: { enabled: true, certificate_path: path.join(NPM_DIR, 'cert.pem'), key_path: path.join(NPM_DIR, 'key.pem'), alpn: ["h3"] }
        });
        links.push(`tuic://${state.uuid}:${state.password}@${publicIp}:${tuicPort}?congestion_control=bbr&alpn=h3&insecure=1&sni=bing.com&pinSHA256=${sha256Fingerprint}#TUIC`);
    }

    // 启用 AnyTLS（共用密码与证书）
    inbounds.push({
        type: "anytls",
        tag: "anytls-in",
        listen: "::",
        listen_port: anytlsPort,
        users: [{ name: "default", password: state.password }],
        tls: { enabled: true, certificate_path: path.join(NPM_DIR, 'cert.pem'), key_path: path.join(NPM_DIR, 'key.pem') }
    });
    links.push(`anytls://${state.password}@${publicIp}:${anytlsPort}?insecure=1&sni=bing.com&pinSHA256=${sha256Fingerprint}#AnyTLS`);

    // 启用 VLESS + WS（供 Cloudflare Tunnel 转发）
    inbounds.push({
        type: "vless",
        tag: "vless-ws-in",
        listen: "127.0.0.1",
        listen_port: argoPort,
        users: [{ uuid: state.uuid }],
        transport: { type: "ws", path: state.wsPath }
    });

    const config = { log: { level: "info" }, inbounds };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    // 启动 sing-box
    const sbProcess = spawn(path.join(NPM_DIR, 'sing-box'), ['run', '-c', CONFIG_FILE], { stdio: 'inherit' });
    sbProcess.on('error', (err) => console.error('sing-box error:', err));

    // 启动 cloudflared
    if (fs.existsSync(ARGO_LOG)) fs.writeFileSync(ARGO_LOG, '');
    const argoToken = process.env.ARGO_TOKEN;
    const argoDomain = process.env.ARGO_DOMAIN;
    const argoArgs = argoToken ? ['tunnel', '--no-autoupdate', 'run', '--token', argoToken] : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${argoPort}`];

    const argoOutFd = fs.openSync(ARGO_LOG, 'a');
    const argoProcess = spawn(path.join(NPM_DIR, 'cloudflared'), argoArgs, { stdio: ['ignore', argoOutFd, argoOutFd] });
    argoProcess.on('error', (err) => console.error('cloudflared error:', err));

    // 初始写入已有直连链接
    saveAndPrintLinks(links);

    // 解析隧道域名并追加 VLESS 链接
    if (argoToken && argoDomain) {
        const vlessLink = `vless://${state.uuid}@${argoDomain}:443?encryption=none&security=tls&type=ws&host=${argoDomain}&path=${encodeURIComponent(state.wsPath)}#VLESS-WS-Argo`;
        links.push(vlessLink);
        saveAndPrintLinks(links);
    } else if (!argoToken) {
        console.log('Waiting for Cloudflare temporary tunnel URL...');
        const timer = setInterval(() => {
            if (fs.existsSync(ARGO_LOG)) {
                const logs = fs.readFileSync(ARGO_LOG, 'utf8');
                const match = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match) {
                    clearInterval(timer);
                    const host = new URL(match[0]).hostname;
                    console.log(`[Temporary Tunnel URL]: ${match[0]}`);
                    const vlessLink = `vless://${state.uuid}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=${encodeURIComponent(state.wsPath)}#VLESS-WS-Argo`;
                    links.push(vlessLink);
                    saveAndPrintLinks(links);
                }
            }
        }, 2000);
    }
}

main().catch(console.error);
