# Conversation with Gemini

##### You said 编写nodejs代码index.js， curl下载sing-box 1.11.4, tar解压 部署在nodejs主机上，只考虑Linux系统，arm64或amd64架构 部署hysteria2…

编写nodejs代码index.js，

curl下载sing-box 1.11.4, tar解压 部署在nodejs主机上，只考虑Linux系统，arm64或amd64架构

部署hysteria2或tuic节点，端口默认都是0，HY2_PORT填写了端口就启用hysteria2节点，TUIC_PORT填写了端口就启用tuic节点，两个都填写的话不能同一个端口，共用密码(用户填写或随机生成)，UUID随机生成

openssl自签证书，计算证书sha-256，节点协议链接带上SHA-256，证书指纹格式要这种61:BC:FD:70:...，

节点链接存到links.txt，密码、UUID存到state.json里面，重启可复用。

index.js同目录下创建.npm文件夹，二进制、证书等文件、links.txt等文件统一放进去，

简洁代码。

###### Gemini said

这是一个为您编写的简洁高效的 Node.js 部署脚本 `index.js`。脚本自动适配 Linux `amd64` / `arm64` 架构，使用 `curl` 下载并解压 sing-box 1.11.4，自动生成自签名证书及 SHA-256 指纹，支持持久化复用状态（`state.json`），并输出标准节点链接至 `links.txt`。

### 📁 目录结构说明

运行后会在同目录下自动创建 `.npm` 文件夹，所有二进制文件、证书、配置文件及链接均存放于其中：



```
your-project/
├── index.js
└── .npm/
    ├── sing-box        # sing-box 二进制
    ├── cert.pem        # 自签证书
    ├── private.key     # 密钥
    ├── config.json     # sing-box 配置文件
    ├── state.json      # 保存 UUID 和 密码 (重启可复用)
    └── links.txt       # 节点分享链接
```

### 📝 `index.js` 源码



```JavaScript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

// 1. 基础配置与目录
const NPM_DIR = path.join(__dirname, '.npm');
if (!fs.existsSync(NPM_DIR)) fs.mkdirSync(NPM_DIR, { recursive: true });

const STATE_FILE = path.join(NPM_DIR, 'state.json');
const LINKS_FILE = path.join(NPM_DIR, 'links.txt');
const CONFIG_FILE = path.join(NPM_DIR, 'config.json');
const CERT_FILE = path.join(NPM_DIR, 'cert.pem');
const KEY_FILE = path.join(NPM_DIR, 'private.key');
const BIN_FILE = path.join(NPM_DIR, 'sing-box');

// 2. 检查端口配置
const HY2_PORT = parseInt(process.env.HY2_PORT || '0', 10);
const TUIC_PORT = parseInt(process.env.TUIC_PORT || '0', 10);

if (HY2_PORT === 0 && TUIC_PORT === 0) {
  console.error('❌ 错误: 请至少通过环境变量指定一个端口 (HY2_PORT 或 TUIC_PORT)');
  process.exit(1);
}
if (HY2_PORT > 0 && TUIC_PORT > 0 && HY2_PORT === TUIC_PORT) {
  console.error('❌ 错误: Hysteria2 和 TUIC 不能使用相同的端口！');
  process.exit(1);
}

// 3. 状态恢复或初始化 (UUID & 密码)
let state = {};
if (fs.existsSync(STATE_FILE)) {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
}

const password = process.env.PASSWORD || state.password || crypto.randomBytes(12).toString('hex');
const uuid = state.uuid || crypto.randomUUID();

state.password = password;
state.uuid = uuid;
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// 4. 下载并解压 sing-box 1.11.4 (仅考虑 Linux amd64/arm64)
if (!fs.existsSync(BIN_FILE)) {
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const arch = archMap[process.arch];
  if (!arch) {
    console.error(`❌ 错误: 不支持的架构 ${process.arch}，仅支持 amd64 或 arm64`);
    process.exit(1);
  }

  const url = `https://github.com/SagerNet/sing-box/releases/download/v1.11.4/sing-box-1.11.4-linux-${arch}.tar.gz`;
  console.log(`📥 正在下载 sing-box v1.11.4 (${arch})...`);
  
  execSync(`curl -L -o ${path.join(NPM_DIR, 'sing-box.tar.gz')} "${url}"`, { stdio: 'inherit' });
  execSync(`tar -xzf ${path.join(NPM_DIR, 'sing-box.tar.gz')} -C ${NPM_DIR}`, { stdio: 'inherit' });
  
  // 移动二进制文件并清理
  const extractedDir = path.join(NPM_DIR, 'sing-box-1.11.4-linux-' + arch);
  fs.renameSync(path.join(extractedDir, 'sing-box'), BIN_FILE);
  fs.rmSync(extractedDir, { recursive: true, force: true });
  fs.rmSync(path.join(NPM_DIR, 'sing-box.tar.gz'), { force: true });
  fs.chmodSync(BIN_FILE, '755');
  console.log('✅ sing-box 安装完成');
}

// 5. 生成自签证书与 SHA-256 指纹
if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
  console.log('🔑 正在生成自签名 TLS 证书...');
  execSync(`openssl ecparam -genkey -name prime256v1 -noout -out ${KEY_FILE}`, { stdio: 'ignore' });
  execSync(`openssl req -x509 -new -key ${KEY_FILE} -days 3650 -out ${CERT_FILE} -subj "/CN=bing.com"`, { stdio: 'ignore' });
}

// 计算证书 SHA-256 指纹格式 (形如 61:BC:FD:70:...)
const derBuffer = execSync(`openssl x509 -in ${CERT_FILE} -outform DER`);
const sha256Hex = crypto.createHash('sha256').update(derBuffer).digest('hex').toUpperCase();
const sha256Fingerprint = sha256Hex.match(/.{2}/g).join(':');

// 6. 构造 sing-box 配置文件
const inbounds = [];
if (HY2_PORT > 0) {
  inbounds.push({
    type: 'hysteria2',
    tag: 'hy2-in',
    listen: '::',
    listen_port: HY2_PORT,
    users: [{ password }],
    tls: { enabled: true, certificate_path: CERT_FILE, key_path: KEY_FILE }
  });
}
if (TUIC_PORT > 0) {
  inbounds.push({
    type: 'tuic',
    tag: 'tuic-in',
    listen: '::',
    listen_port: TUIC_PORT,
    users: [{ uuid, password }],
    tls: { enabled: true, certificate_path: CERT_FILE, key_path: KEY_FILE, alpn: ['h3'] },
    congestion_control: 'bbr'
  });
}

const config = {
  log: { level: 'info' },
  inbounds
};
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

// 7. 获取公网 IP 并生成节点链接
async function getPublicIP() {
  return new Promise((resolve) => {
    http.get('http://api.ipify.org', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim() || '127.0.0.1'));
    }).on('error', () => resolve('127.0.0.1'));
  });
}

(async () => {
  const ip = await getPublicIP();
  const links = [];

  if (HY2_PORT > 0) {
    const hy2Link = `hysteria2://${password}@${ip}:${HY2_PORT}?insecure=1&pinSHA256=${encodeURIComponent(sha256Fingerprint)}&sni=bing.com#Hysteria2`;
    links.push(hy2Link);
  }

  if (TUIC_PORT > 0) {
    const tuicLink = `tuic://${uuid}:${password}@${ip}:${TUIC_PORT}?congestion_control=bbr&alpn=h3&sni=bing.com&allow_insecure=1&pinSHA256=${encodeURIComponent(sha256Fingerprint)}#TUIC`;
    links.push(tuicLink);
  }

  fs.writeFileSync(LINKS_FILE, links.join('\n') + '\n');
  console.log('\n📄 节点链接已保存至 .npm/links.txt:');
  links.forEach(l => console.log(` - ${l}`));

  // 8. 启动 sing-box
  console.log('\n🚀 正在启动 sing-box 服务...');
  const { spawn } = require('child_process');
  const sbProcess = spawn(BIN_FILE, ['run', '-c', CONFIG_FILE], { stdio: 'inherit' });

  sbProcess.on('close', (code) => {
    console.log(`sing-box 进程退出，代码 ${code}`);
  });
})();
```

### 🚀 使用与运行指南

1. 将代码保存为 `index.js`。

2. 运行前可通过环境变量指定端口与密码（可选，不填则自动生成随机密码）：


   ```Bash
   export HY2_PORT=8443
   export TUIC_PORT=8444
   export PASSWORD="your_secure_password"
   ```

3. 启动脚本：

   ```Bash
   node index.js
   ```

##### You said 二进制压缩包下载解压部分简化一下，我仓库存了arm64和amd64架构的tar.gz文件，我要换成我自己的https://github.com/jingzor/jingzor/raw/refs/hea…

二进制压缩包下载解压部分简化一下，我仓库存了arm64和amd64架构的tar.gz文件，我要换成我自己的https://github.com/jingzor/jingzor/raw/refs/heads/main/bot-linux-${arch}.tar.gz

###### Gemini said

已为您将二进制下载与解压部分进行了简化，去除了中间临时 tar.gz 文件的落盘，改用 `curl` 管道直接解压至 `.npm` 目录，并更新为了您指定的自定义仓库下载链接。

### 📝 简化后的 `index.js` 源码



```JavaScript
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');

// 1. 基础目录与文件定义
const NPM_DIR = path.join(__dirname, '.npm');
if (!fs.existsSync(NPM_DIR)) fs.mkdirSync(NPM_DIR, { recursive: true });

const STATE_FILE = path.join(NPM_DIR, 'state.json');
const LINKS_FILE = path.join(NPM_DIR, 'links.txt');
const CONFIG_FILE = path.join(NPM_DIR, 'config.json');
const CERT_FILE = path.join(NPM_DIR, 'cert.pem');
const KEY_FILE = path.join(NPM_DIR, 'private.key');
const BIN_FILE = path.join(NPM_DIR, 'sing-box');

// 2. 端口检查
const HY2_PORT = parseInt(process.env.HY2_PORT || '0', 10);
const TUIC_PORT = parseInt(process.env.TUIC_PORT || '0', 10);

if (HY2_PORT === 0 && TUIC_PORT === 0) {
  console.error('❌ 错误: 请至少指定一个端口 (HY2_PORT 或 TUIC_PORT)');
  process.exit(1);
}
if (HY2_PORT > 0 && TUIC_PORT > 0 && HY2_PORT === TUIC_PORT) {
  console.error('❌ 错误: Hysteria2 和 TUIC 不能使用相同端口！');
  process.exit(1);
}

// 3. 状态恢复或持久化 (UUID & 密码重启复用)
let state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const password = process.env.PASSWORD || state.password || crypto.randomBytes(12).toString('hex');
const uuid = state.uuid || crypto.randomUUID();
fs.writeFileSync(STATE_FILE, JSON.stringify({ password, uuid }, null, 2));

// 4. 下载并解压二进制 (管道流式下载解压，自动适配架构与目录结构)
if (!fs.existsSync(BIN_FILE)) {
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!arch) { console.error(`❌ 不支持的架构: ${process.arch}`); process.exit(1); }

  const url = `https://github.com/jingzor/jingzor/raw/refs/heads/main/bot-linux-${arch}.tar.gz`;
  console.log(`📥 正在下载并解压核心程序 (${arch})...`);
  
  execSync(`curl -L "${url}" | tar -xz -C "${NPM_DIR}"`, { stdio: 'inherit' });

  // 适配压缩包解压后的结构（无论是直接解压出二进制还是带有一层文件夹）
  const files = fs.readdirSync(NPM_DIR).filter(f => !['state.json', 'links.txt', 'config.json', 'cert.pem', 'private.key', 'sing-box'].includes(f));
  for (const f of files) {
    const fullPath = path.join(NPM_DIR, f);
    if (fs.statSync(fullPath).isDirectory()) {
      const subFiles = fs.readdirSync(fullPath);
      if (subFiles.length > 0) fs.renameSync(path.join(fullPath, subFiles[0]), BIN_FILE);
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.renameSync(fullPath, BIN_FILE);
    }
  }
  fs.chmodSync(BIN_FILE, '755');
  console.log('✅ 二进制部署完成');
}

// 5. 自签证书与 SHA-256 指纹
if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
  execSync(`openssl ecparam -genkey -name prime256v1 -noout -out ${KEY_FILE}`, { stdio: 'ignore' });
  execSync(`openssl req -x509 -new -key ${KEY_FILE} -days 3650 -out ${CERT_FILE} -subj "/CN=bing.com"`, { stdio: 'ignore' });
}

const der = execSync(`openssl x509 -in ${CERT_FILE} -outform DER`);
const fingerprint = crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g).join(':');

// 6. 生成配置文件
const inbounds = [];
if (HY2_PORT > 0) {
  inbounds.push({
    type: 'hysteria2', tag: 'hy2', listen: '::', listen_port: HY2_PORT,
    users: [{ password }],
    tls: { enabled: true, certificate_path: CERT_FILE, key_path: KEY_FILE }
  });
}
if (TUIC_PORT > 0) {
  inbounds.push({
    type: 'tuic', tag: 'tuic', listen: '::', listen_port: TUIC_PORT,
    users: [{ uuid, password }],
    tls: { enabled: true, certificate_path: CERT_FILE, key_path: KEY_FILE, alpn: ['h3'] },
    congestion_control: 'bbr'
  });
}
fs.writeFileSync(CONFIG_FILE, JSON.stringify({ log: { level: 'info' }, inbounds }, null, 2));

// 7. 获取公网 IP 并写入 links.txt
const getIP = () => new Promise(res => http.get('http://api.ipify.org', r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(d.trim() || '127.0.0.1'));
}).on('error', () => res('127.0.0.1')));

(async () => {
  const ip = await getIP();
  const links = [];

  if (HY2_PORT > 0) {
    links.push(`hysteria2://${password}@${ip}:${HY2_PORT}?insecure=1&pinSHA256=${encodeURIComponent(fingerprint)}&sni=bing.com#Hysteria2`);
  }
  if (TUIC_PORT > 0) {
    links.push(`tuic://${uuid}:${password}@${ip}:${TUIC_PORT}?congestion_control=bbr&alpn=h3&sni=bing.com&allow_insecure=1&pinSHA256=${encodeURIComponent(fingerprint)}#TUIC`);
  }

  fs.writeFileSync(LINKS_FILE, links.join('\n') + '\n');
  console.log('\n📄 节点链接已保存至 .npm/links.txt:');
  links.forEach(l => console.log(` - ${l}`));

  // 8. 启动服务
  console.log('\n🚀 正在启动服务...');
  spawn(BIN_FILE, ['run', '-c', CONFIG_FILE], { stdio: 'inherit' });
})();
```

##### You said (node:22) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated. (Use \`node --trace-depre…

(node:22) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.

(Use \`node --trace-deprecation ...\` to show where the warning was created)

###### Gemini said

这个警告 `[DEP0180] DeprecationWarning: fs.Stats constructor is deprecated` 是 Node.js 22 中的一个常见提示。它表示代码中（或某些较旧的第三方依赖库、内部模块）直接调用了 `new fs.Stats()` 构造函数，而这个用法在现代 Node.js 中已被废弃。

虽然这**不会影响程序的正常运行**，但如果你想消除这个烦人的警告，可以通过以下两种方式解决：

### 方法一：通过环境变量启动（推荐，最快）

在运行脚本时，通过 `NODE_OPTIONS` 忽略该废弃警告：



```Bash
NODE_OPTIONS="--no-deprecation" node index.js
```

### 方法二：优化代码文件清理逻辑

如果你希望在代码层面彻底避开任何可能引发检查的旧式写法，可以将解压后的文件处理部分改用更现代的 `fs.rmSync` 和更安全的判断。以下是更新后的完整 `index.js`：



```JavaScript
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');

// 1. 基础目录与文件定义
const NPM_DIR = path.join(__dirname, '.npm');
if (!fs.existsSync(NPM_DIR)) fs.mkdirSync(NPM_DIR, { recursive: true });

const STATE_FILE = path.join(NPM_DIR, 'state.json');
const LINKS_FILE = path.join(NPM_DIR, 'links.txt');
const CONFIG_FILE = path.join(NPM_DIR, 'config.json');
const CERT_FILE = path.join(NPM_DIR, 'cert.pem');
const KEY_FILE = path.join(NPM_DIR, 'private.key');
const BIN_FILE = path.join(NPM_DIR, 'sing-box');

// 2. 端口检查
const HY2_PORT = parseInt(process.env.HY2_PORT || '0', 10);
const TUIC_PORT = parseInt(process.env.TUIC_PORT || '0', 10);

if (HY2_PORT === 0 && TUIC_PORT === 0) {
  console.error('❌ 错误: 请至少指定一个端口 (HY2_PORT 或 TUIC_PORT)');
  process.exit(1);
}
if (HY2_PORT > 0 && TUIC_PORT > 0 && HY2_PORT === TUIC_PORT) {
  console.error('❌ 错误: Hysteria2 和 TUIC 不能使用相同端口！');
  process.exit(1);
}

// 3. 状态恢复或持久化 (UUID & 密码重启复用)
let state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const password = process.env.PASSWORD || state.password || crypto.randomBytes(12).toString('hex');
const uuid = state.uuid || crypto.randomUUID();
fs.writeFileSync(STATE_FILE, JSON.stringify({ password, uuid }, null, 2));

// 4. 下载并解压二进制
if (!fs.existsSync(BIN_FILE)) {
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!arch) { console.error(`❌ 不支持的架构: ${process.arch}`); process.exit(1); }

  const url = `https://github.com/jingzor/jingzor/raw/refs/heads/main/bot-linux-${arch}.tar.gz`;
  console.log(`📥 正在下载并解压核心程序 (${arch})...`);
  
  execSync(`curl -L "${url}" | tar -xz -C "${NPM_DIR}"`, { stdio: 'inherit' });

  // 适配压缩包解压后的结构
  const reserved = ['state.json', 'links.txt', 'config.json', 'cert.pem', 'private.key', 'sing-box'];
  const files = fs.readdirSync(NPM_DIR).filter(f => !reserved.includes(f));
  
  for (const f of files) {
    const fullPath = path.join(NPM_DIR, f);
    try {
      const stats = fs.lstatSync(fullPath); // 使用 lstat 替代
      if (stats.isDirectory()) {
        const subFiles = fs.readdirSync(fullPath);
        if (subFiles.length > 0) {
          const targetSub = path.join(fullPath, subFiles[0]);
          if (fs.lstatSync(targetSub).isFile()) {
            fs.renameSync(targetSub, BIN_FILE);
          }
        }
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.renameSync(fullPath, BIN_FILE);
      }
    } catch (e) {}
  }
  
  if (fs.existsSync(BIN_FILE)) fs.chmodSync(BIN_FILE, '755');
  console.log('✅ 二进制部署完成');
}

// 5. 自签证书与 SHA-256 指纹
if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
  execSync(`openssl ecparam -genkey -name prime256v1 -noout -out ${KEY_FILE}`, { stdio: 'ignore' });
  execSync(`openssl req -x509 -new -key ${KEY_FILE} -days 3650 -out ${CERT_FILE} -subj "/CN=bing.com"`, { stdio: 'ignore' });
}

const der = execSync(`openssl x509 -in ${CERT_FILE} -outform DER`);
const fingerprint = crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g).join(':');

// 6. 生成配置文件
const inbounds = [];
if (HY2_PORT > 0) {
  inbounds.push({
    type: 'hysteria2', tag: 'hy2', listen: '::', listen_port: HY2_PORT,
    users: [{ password }],
    tls: { enabled: true, certificate_path: CERT_FILE, key_path: KEY_FILE }
  });
}
if (TUIC_PORT > 0) {
  inbounds.push({
    type: 'tuic', tag: 'tuic', listen: '::', listen_port: TUIC_PORT,
    users: [{ uuid, password }],
    tls: { enabled: true, certificate_path: CERT_FILE, key_path: KEY_FILE, alpn: ['h3'] },
    congestion_control: 'bbr'
  });
}
fs.writeFileSync(CONFIG_FILE, JSON.stringify({ log: { level: 'info' }, inbounds }, null, 2));

// 7. 获取公网 IP 并写入 links.txt
const getIP = () => new Promise(res => http.get('http://api.ipify.org', r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(d.trim() || '127.0.0.1'));
}).on('error', () => res('127.0.0.1')));

(async () => {
  const ip = await getIP();
  const links = [];

  if (HY2_PORT > 0) {
    links.push(`hysteria2://${password}@${ip}:${HY2_PORT}?insecure=1&pinSHA256=${encodeURIComponent(fingerprint)}&sni=bing.com#Hysteria2`);
  }
  if (TUIC_PORT > 0) {
    links.push(`tuic://${uuid}:${password}@${ip}:${TUIC_PORT}?congestion_control=bbr&alpn=h3&sni=bing.com&allow_insecure=1&pinSHA256=${encodeURIComponent(fingerprint)}#TUIC`);
  }

  fs.writeFileSync(LINKS_FILE, links.join('\n') + '\n');
  console.log('\n📄 节点链接已保存至 .npm/links.txt:');
  links.forEach(l => console.log(` - ${l}`));

  // 8. 启动服务
  console.log('\n🚀 正在启动服务...');
  spawn(BIN_FILE, ['run', '-c', CONFIG_FILE], { stdio: 'inherit' });
})();
```
