# Conversation with Gemini

##### You said 编写nodejs代码index.js和package.json， axios下载https://github.com/SagerNet/sing-box/releases/download/v1.1…

编写nodejs代码index.js和package.json，

axios下载https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-linux-amd64-musl.tar.gz,

部署在nodejs主机上，只考虑linux系统amd64和arm64。

部署hysteria2或tuic节点，端口默认都是0，HY2_PORT填写了端口就启用hysteria2节点，TUIC_PORT填写了端口就启用tuic节点，两个都填写的话不能同一个端口，共用密码(用户填写或随机生成)，uuid随机生成

selfsigned库自签证书，计算证书sha-256，节点带上SHA-256，证书指纹格式要这种61:BC:FD:70:...，。

index.js同目录下创建.npm文件夹，二进制、节点链接等文件统一放进去，

增加部署anytls节点，端口号可以与hysteria2/tuic共存，密码和hysteria2共用，证书和hysteria2共用

增加部署vless+ws搭配cloudflared隧道节点，uuid和tuicUUID共用，ARGO_TOKEN有填写就固定隧道，没有就临时隧道，ARGO_DOMAIN可填可不填，ARGO_PORT默认8080，WS_PATH随机生成，cloudflared只把日志写到.npm/argo.log，临时隧道域名从.npm/argo.log获取

密码、uuid、WS_PATH存到.npm/state.json里面，重启可复用

以sing-box官方最新文档https://sing-box.sagernet.org/为主，编写代码配置

简洁代码

###### Gemini said

为你编写的 Node.js 部署脚本。代码满足所有需求：自动下载指定版本的 `sing-box` 与 `cloudflared`、支持 Linux amd64/arm64、通过 `.npm/state.json` 持久化状态、使用 `selfsigned` 生成自签证书并计算格式化的 SHA-256 指纹，同时配置 Hysteria2、TUIC、AnyTLS 以及 VLESS-WS-Cloudflared 隧道节点。

### 1. `package.json`

在同目录下创建 `package.json`：



```JSON
{
  "name": "sing-box-deploy",
  "version": "1.0.0",
  "description": "Auto deploy sing-box and cloudflared nodes",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "axios": "^1.7.9",
    "selfsigned": "^2.4.1"
  }
}
```

### 2. `index.js`

在同目录下创建 `index.js`：



```JavaScript
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

// 1. 状态管理（持久化密码、UUID、WS_PATH）
let state = {};
if (fs.existsSync(STATE_FILE)) {
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
}
state.password = process.env.PASSWORD || state.password || crypto.randomBytes(8).toString('hex');
state.uuid = state.uuid || crypto.randomUUID();
state.wsPath = state.wsPath || '/' + crypto.randomBytes(4).toString('hex');
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// 2. 下载二进制文件
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

// 3. 自签证书与 SHA-256 指纹计算
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

async function main() {
    if (os.platform() !== 'linux' || (os.arch() !== 'x64' && os.arch() !== 'arm64')) {
        console.error('Error: Only Linux amd64 and arm64 systems are supported.');
        process.exit(1);
    }

    await downloadBinaries();
    const sha256Fingerprint = setupCertificate();

    const hy2Port = process.env.HY2_PORT ? parseInt(process.env.HY2_PORT) : 0;
    const tuicPort = process.env.TUIC_PORT ? parseInt(process.env.TUIC_PORT) : 0;
    const anytlsPort = process.env.ANYTLS_PORT ? parseInt(process.env.ANYTLS_PORT) : 8443;
    const argoPort = process.env.ARGO_PORT ? parseInt(process.env.ARGO_PORT) : 8080;

    if (hy2Port > 0 && tuicPort > 0 && hy2Port === tuicPort) {
        console.error('Error: HY2_PORT and TUIC_PORT cannot use the same port.');
        process.exit(1);
    }

    const inbounds = [];

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

    const argoLogStream = fs.createWriteStream(ARGO_LOG, { flags: 'a' });
    const argoProcess = spawn(path.join(NPM_DIR, 'cloudflared'), argoArgs, { stdio: ['ignore', argoLogStream, argoLogStream] });
    argoProcess.on('error', (err) => console.error('cloudflared error:', err));

    // 输出节点配置信息
    console.log('========================================');
    console.log(`Password: ${state.password}`);
    console.log(`UUID: ${state.uuid}`);
    console.log(`Certificate SHA-256: ${sha256Fingerprint}`);
    if (hy2Port > 0) console.log(`Hysteria2 Port: ${hy2Port}`);
    if (tuicPort > 0) console.log(`TUIC Port: ${tuicPort}`);
    console.log(`AnyTLS Port: ${anytlsPort}`);
    console.log(`VLESS WS Path: ${state.wsPath}`);
    console.log('========================================');

    // 解析临时隧道域名
    if (!argoToken) {
        console.log('Waiting for Cloudflare temporary tunnel URL...');
        const timer = setInterval(() => {
            if (fs.existsSync(ARGO_LOG)) {
                const logs = fs.readFileSync(ARGO_LOG, 'utf8');
                const match = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match) {
                    clearInterval(timer);
                    const host = new URL(match[0]).hostname;
                    console.log(`[Temporary Tunnel URL]: ${match[0]}`);
                    console.log(`VLESS Link: vless://${state.uuid}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=${encodeURIComponent(state.wsPath)}#VLESS-WS-Argo`);
                    console.log('========================================');
                }
            }
        }, 2000);
    } else if (argoDomain) {
        console.log(`[Fixed Tunnel Domain]: ${argoDomain}`);
        console.log(`VLESS Link: vless://${state.uuid}@${argoDomain}:443?encryption=none&security=tls&type=ws&host=${argoDomain}&path=${encodeURIComponent(state.wsPath)}#VLESS-WS-Argo`);
        console.log('========================================');
    }
}

main().catch(console.error);
```

### 使用方法

1. 安装依赖：

   ```Bash
   npm install
   ```

2. 运行部署（可以通过环境变量控制端口和隧道）：

   ```Bash
   # 示例：同时启用 Hysteria2 (端口 30000) 和 TUIC (端口 30001)，AnyTLS 默认 8443
   HY2_PORT=30000 TUIC_PORT=30001 node index.js
   ```

##### You said 报错提示：Downloading sing-box for Linux amd64... (node:33) [DEP0180] DeprecationWarning: fs.Stats constr…

报错提示：Downloading sing-box for Linux amd64...

(node:33) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.

(Use \`node --trace-deprecation ...\` to show where the warning was created)

Downloading cloudflared for Linux amd64...

Generating self-signed certificate...

TypeError: The argument 'stdio' is invalid. Received WriteStream {

  fd: null,

  path: '/home/container/.npm/argo.log',

  flags: 'a',

  mode: 438,

  flush: false,

  start: undefined...

    at node:internal/child_process:1083:13

    at Array.reduce (\<anonymous>)

    at getValidStdio (node:internal/child_process:1010:11)

    at ChildProcess.spawn (node:internal/child_process:363:11)

    at spawn (node:child_process:796:9)

    at main (/home/container/index.js:166:25)

    at processTicksAndRejections (node:internal/process/task_queues:104:5) {

  code: 'ERR_INVALID_ARG_VALUE'

}

###### Gemini said

这个报错是因为 `fs.createWriteStream()` 打开文件是异步的，导致在调用 `spawn` 时 `argoLogStream.fd` 还是 `null`，从而触发了 Node.js 的 `ERR_INVALID_ARG_VALUE` 异常。

解决办法是用同步的 `fs.openSync()` 获取文件描述符（fd）传给 `spawn`。

### 修复后的 `index.js` 对应代码段

请将 `index.js` 中关于启动 `cloudflared` 的那一段代码：



```JavaScript
    // 启动 cloudflared
    if (fs.existsSync(ARGO_LOG)) fs.writeFileSync(ARGO_LOG, '');
    const argoToken = process.env.ARGO_TOKEN;
    const argoDomain = process.env.ARGO_DOMAIN;
    const argoArgs = argoToken ? ['tunnel', '--no-autoupdate', 'run', '--token', argoToken] : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${argoPort}`];

    const argoLogStream = fs.createWriteStream(ARGO_LOG, { flags: 'a' });
    const argoProcess = spawn(path.join(NPM_DIR, 'cloudflared'), argoArgs, { stdio: ['ignore', argoLogStream, argoLogStream] });
    argoProcess.on('error', (err) => console.error('cloudflared error:', err));
```

**修改为：**

```JavaScript
    // 启动 cloudflared
    if (fs.existsSync(ARGO_LOG)) fs.writeFileSync(ARGO_LOG, '');
    const argoToken = process.env.ARGO_TOKEN;
    const argoDomain = process.env.ARGO_DOMAIN;
    const argoArgs = argoToken ? ['tunnel', '--no-autoupdate', 'run', '--token', argoToken] : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${argoPort}`];

    // 使用同步 openSync 替代 createWriteStream，确保获取到有效的 fd
    const argoOutFd = fs.openSync(ARGO_LOG, 'a');
    const argoProcess = spawn(path.join(NPM_DIR, 'cloudflared'), argoArgs, { stdio: ['ignore', argoOutFd, argoOutFd] });
    argoProcess.on('error', (err) => console.error('cloudflared error:', err));
```

修改保存后重新运行 `node index.js` 即可正常启动。

##### You said tuic、hysteria2、anytls节点协议链接打印在终端上，所有节点协议链接存到.npm/links.txt里面

tuic、hysteria2、anytls节点协议链接打印在终端上，所有节点协议链接存到.npm/links.txt里面

###### Gemini said

已更新 `index.js` 文件。脚本现在会自动获取服务器的公网 IP（也可通过环境变量 `SERVER_IP` 或 `DOMAIN` 指定），拼接生成 **Hysteria2**、**TUIC**、**AnyTLS** 以及 **VLESS-WS-Argo** 的标准节点协议链接，在终端打印输出，并全部自动保存在 `.npm/links.txt` 文件中。

### 更新后的 `index.js`

直接替换同目录下的 `index.js`：



```JavaScript
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

// 1. 状态管理（持久化密码、UUID、WS_PATH）
let state = {};
if (fs.existsSync(STATE_FILE)) {
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
}
state.password = process.env.PASSWORD || state.password || crypto.randomBytes(8).toString('hex');
state.uuid = state.uuid || crypto.randomUUID();
state.wsPath = state.wsPath || '/' + crypto.randomBytes(4).toString('hex');
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// 2. 下载二进制文件
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

// 3. 自签证书与 SHA-256 指纹计算
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

// 4. 保存并打印链接
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
```
