const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');

const DIR = path.join(__dirname, '.npm');
fs.mkdirSync(DIR, { recursive: true });

const BIN = path.join(DIR, 'bot');
const CONF = path.join(DIR, 'config.json');
const PASS_FILE = path.join(DIR, 'password.txt');
const CERT = path.join(DIR, 'cert.pem');
const KEY = path.join(DIR, 'key.pem');
const OUT_FILE = path.join(DIR, 'links.txt');//节点信息
// const VER = '1.11.4';
const SNI = process.env.SNI || 'www.bing.com';
const WEB = Number(process.env.PORT || 0);
const LOG_LEVEL = 'panic'; // trace | debug | info | warn | error | fatal | panic

// 把3000替换为你服务器的端口号
const PORT = Number(process.env.HY_PORT || 3000);

// ---------- 密码：填了就用，没填就生成并落盘复用 ----------
let pass = (process.env.PASSWORD || '').trim();
if (!pass) {
  pass = fs.existsSync(PASS_FILE) ? fs.readFileSync(PASS_FILE, 'utf8').trim() : '';
  if (!pass) pass = crypto.randomBytes(12).toString('base64url');
  fs.writeFileSync(PASS_FILE, pass);
}

// ---------- 下载 bot(基于原版v1.11.4二进制改名重新压缩，可绕过一些限制) ----------
function ensureBin() {
  if (fs.existsSync(BIN)) return;
  console.log('[*]拉取二进制文件中...');
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url = `https://github.com/jingzor/jingzor/raw/refs/heads/main/bot-linux-${arch}.tar.gz`;
  execSync(`curl -fsSL "${url}" | tar -xz -C "${DIR}" -f - --strip-components=1 --wildcards '*/bot'`, { stdio: 'ignore' });
  fs.chmodSync(BIN, 0o755);
}

// ---------- 指纹格式：61:BC:FD:70:... ----------
const colonHex = h => (h.toUpperCase().match(/../g) || []).join(':');

// ---------- selfsigned 自签证书（10 年，RSA-2048/SHA-256） ----------
const CERT_ATTRS = [{ name: 'commonName', value: SNI }];
const CERT_OPTS = {
  days: 3650,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: SNI }] }
  ]
};

async function makeCertSelfSigned() {
  let selfsigned;
  try {
    selfsigned = require('selfsigned');
  } catch {
    throw new Error('openssl 不可用，且未安装 selfsigned：请先执行 npm i selfsigned');
  }
  // 兼容 selfsigned 2.x（同步返回）与 3.x（返回 Promise）
  const pems = await selfsigned.generate(CERT_ATTRS, CERT_OPTS);
  fs.writeFileSync(CERT, pems.cert, { mode: 0o644 });
  fs.writeFileSync(KEY, pems.private, { mode: 0o600 });
  if (!fs.existsSync(CERT) || !fs.existsSync(KEY)) throw new Error('selfsigned 生成证书失败');
}

// ---------- 自签证书（10 年，复用）：优先 openssl，缺失则用 selfsigned ----------
async function makeCert() {
  if (fs.existsSync(CERT) && fs.existsSync(KEY)) return;
  let hasOpenssl = false;
  try { execSync('openssl version', { stdio: 'ignore' }); hasOpenssl = true; } catch { }
  if (hasOpenssl) {
    try {
      execSync(
        `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes ` +
        `-keyout "${KEY}" -out "${CERT}" -days 3650 -subj "/CN=${SNI}" ` +
        `-addext "subjectAltName=DNS:${SNI}"`, { stdio: 'ignore' }
      );
      if (fs.existsSync(CERT) && fs.existsSync(KEY)) return;
    } catch { }
    console.warn('[!] openssl 执行失败，改用 selfsigned');
  }
  await makeCertSelfSigned();
}

async function loadCert() {
  try {
    return new crypto.X509Certificate(fs.readFileSync(CERT));
  } catch {
    fs.rmSync(CERT, { force: true });
    fs.rmSync(KEY, { force: true });
    await makeCertSelfSigned();
    return new crypto.X509Certificate(fs.readFileSync(CERT));
  }
}

// ---------- 取公网 IP ----------
const getIp = url => new Promise(res => {
  const r = https.get(url, { timeout: 8000 }, s => {
    let d = '';
    s.on('data', c => d += c);
    s.on('end', () => res(d.trim() || null));
  });
  r.on('error', () => res(null));
  r.on('timeout', () => { r.destroy(); res(null); });
});

(async () => {
  ensureBin();
  await makeCert();

  const cert = await loadCert();
  // 证书 DER 的 SHA-256：pinSHA256 与展示指纹都用它
  const pinHex = crypto.createHash('sha256').update(cert.raw).digest('hex');
  const pinPretty = colonHex(pinHex);

  const [v6, v4] = await Promise.all([
    getIp('https://v6.ident.me'),
    getIp('https://v4.ident.me'),
  ]);
  const hosts = [...(v6 ? [`[${v6}]`] : []), ...(v4 ? [v4] : [])];

  const cfg = {
    log: { level: LOG_LEVEL, timestamp: true },
    inbounds: [{
      type: 'hysteria2',
      tag: 'hy2',
      listen: '::',
      listen_port: PORT,
      users: [{ password: pass }],
      tls: {
        enabled: true,
        server_name: SNI,
        alpn: ['h3'],
        certificate_path: CERT,
        key_path: KEY
      }
    }],
    outbounds: [{ type: 'direct', tag: 'direct' }]
  };
  fs.writeFileSync(CONF, JSON.stringify(cfg, null, 2));

  const links = hosts.map(h =>
    `hysteria2://${encodeURIComponent(pass)}@${h}:${PORT}/?sni=${SNI}&alpn=h3&insecure=1&pinSHA256=${pinPretty}#HY2-${h.includes(':') ? 'IPv6' : 'IPv4'}`
  );

  const out = [
    '===== 节点信息 =====',
    `端口: ${PORT}  SNI: ${SNI}`,
    `密码: ${pass}`,
    `证书指纹SHA256: ${pinPretty}`,
    ...(links.length ? links : ['未取到公网 IP，请手动拼接域名/IP']),
    '=========================='
  ].join('\n');
  console.log(out);
  fs.writeFileSync(OUT_FILE, out + '\n', { mode: 0o600 });
  console.log(`已写入 ${OUT_FILE}`);

  if (WEB) {
    http.createServer((_, s) => s.end(out + '\n')).listen(WEB);
  }

  const run = () => {
    const p = spawn(BIN, ['run', '-c', CONF], { stdio: 'inherit' });
    p.on('error', e => { console.error(e); setTimeout(run, 3000); });
    p.on('exit', c => { console.log('bot 退出', c); setTimeout(run, 3000); });
  };
  run();
})().catch(e => { console.error(e); process.exit(1); });
