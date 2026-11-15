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
const HY2_PORT = parseInt(process.env.HY2_PORT || 0, 10);
const TUIC_PORT = parseInt(process.env.TUIC_PORT || 0, 10);

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

const password = process.env.PASSWORD || state.password || crypto.randomBytes(16).toString('hex');
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