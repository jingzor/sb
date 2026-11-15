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



```Plaintext
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
