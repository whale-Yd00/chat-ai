const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { URL } = require('url'); // Node.js built-in module

// --- 配置 ---
const PORT = process.env.PORT || 3000;

// 创建 express 应用
const app = express();

// --- 文件上传处理 (保持不变) ---
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir + '/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    const fileUrl = `${req.protocol}://${req.get('host')}/${uploadDir}/${req.file.filename}`;
    res.json({ url: fileUrl });
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- 新增：动态API代理中间件 ---
// 所有以 /proxy 开头的请求都将被这个中间件处理
const apiProxy = createProxyMiddleware({
    // 1. 动态设置目标
    router: (req) => {
        const targetUrl = req.headers['x-target-url'];
        // 安全性检查：确保提供了header且是合法的URL
        if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
            try {
                // 返回目标服务器的根地址, e.g., "https://api.openai.com"
                return new URL(targetUrl).origin;
            } catch (e) {
                console.error('[Proxy] Invalid X-Target-URL:', targetUrl);
                return null; // 导致代理错误
            }
        }
        console.warn('[Proxy] X-Target-URL header is missing or invalid.');
        return null; // 导致代理错误
    },
    // 2. 更改源，这对大多数云服务是必需的
    changeOrigin: true,
    // 3. 重写路径，移除 /proxy 前缀
    // 例如：/proxy/v1/chat/completions -> /v1/chat/completions
    pathRewrite: {
        '^/proxy': '',
    },
    // 4. 在转发请求前进行操作
    onProxyReq: (proxyReq, req, res) => {
        const targetUrl = req.headers['x-target-url'];
        // 如果目标URL无效，提前终止请求并返回错误
        if (!targetUrl) {
            res.status(400).send({ error: 'Proxy target URL is missing in X-Target-URL header.' });
            proxyReq.destroy();
            return;
        }
        // 从请求中移除我们的自定义header，避免泄露给目标服务器
        proxyReq.removeHeader('x-target-url');
        console.log(`[Proxy] Forwarding request to: ${targetUrl}${proxyReq.path.replace('/proxy', '')}`);
    },
    // 5. 错误处理
    onError: (err, req, res) => {
        console.error('[Proxy Error]', err);
        res.status(502).send({ error: 'Proxy error. Could not connect to the target API server.' });
    }
});

// 将代理应用到 /proxy 路径
app.use('/proxy', apiProxy);


// --- 静态文件服务 (保持不变) ---
app.use(express.static(path.join(__dirname, '')));

// --- 启动服务器 ---
app.listen(PORT, () => {
    console.log(`\n🎉 通用API代理和文件上传服务器已启动！`);
    console.log(`请在浏览器中打开下面的地址来访问你的应用:`);
    console.log(`=> http://localhost:${PORT}/chat.html`);
    console.log(`\n动态API代理已启用:`);
    console.log(`前端请求路径 /proxy -> 目标由 'X-Target-URL' 请求头决定`);
});
