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
const BIN_FILE = path.join(NPM_DIR, 'bot');

// 2. 端口检查
const HY2_PORT = parseInt(process.env.HY2_PORT || 0, 10);
const TUIC_PORT = parseInt(process.env.TUIC_PORT || 0, 10);

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
const password = process.env.PASSWORD || state.password || crypto.randomBytes(16).toString('hex');
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
  const files = fs.readdirSync(NPM_DIR).filter(f => !['state.json', 'links.txt', 'config.json', 'cert.pem', 'private.key', 'bot'].includes(f));
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
fs.writeFileSync(CONFIG_FILE, JSON.stringify({ log: { disabled: true, level: 'info' }, inbounds }, null, 2));

// 7. 获取公网 IP 并写入 links.txt
const getIP = () => new Promise(res => http.get('http://api.ipify.org', r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(d.trim() || '127.0.0.1'));
}).on('error', () => res('127.0.0.1')));

(async () => {
  const ip = await getIP();
  const links = [];

  if (HY2_PORT > 0) {
    links.push(`hysteria2://${password}@${ip}:${HY2_PORT}?insecure=1&pinSHA256=${encodeURIComponent(fingerprint)}&sni=bing.com#Hy2`);
  }
  if (TUIC_PORT > 0) {
    links.push(`tuic://${uuid}:${password}@${ip}:${TUIC_PORT}?congestion_control=bbr&alpn=h3&sni=bing.com&allow_insecure=1&pinSHA256=${encodeURIComponent(fingerprint)}#TUIC`);
  }

  fs.writeFileSync(LINKS_FILE, links.join('\n') + '\n');
  console.log('\n📄 节点链接已保存至 .npm/links.txt:');
  links.forEach(l => console.log(`${l}`));

  // 8. 启动服务
  console.log('\n🚀 正在启动服务...');
  spawn(BIN_FILE, ['run', '-c', CONFIG_FILE], { stdio: 'inherit' });
})();