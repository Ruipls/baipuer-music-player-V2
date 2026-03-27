# 摆谱儿音乐播放器

一个为线下现场准备的扫码即听网站：

- 观众扫固定二维码后，可直接在手机或电脑上打开前台播放器
- 前台只负责听歌，不暴露后台管理入口
- 管理员通过 `/admin` 登录后台，上传或删除现场曲目
- 生产环境面向 Vercel 部署，音频文件使用 Vercel Blob 存储

## 生产部署

### 1. 准备 Vercel 项目

1. 把当前项目导入 Vercel
2. 在 Vercel 项目中创建并连接一个 Blob Store
3. 在项目环境变量中配置：

```bash
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一段足够长的随机密钥
```

连接 Blob 后，`BLOB_READ_WRITE_TOKEN` 会由 Vercel 自动注入。

### 2. 部署

这个项目会在构建时：

- 从 `wwwroot/` 复制静态页面到 `dist/`
- 打包 `src/admin-client.js` 为浏览器可运行的 `dist/admin.js`
- 由 `api/` 下的 Vercel Functions 提供登录、歌单读取、上传授权和删歌能力

默认部署后可用地址：

- 前台首页：`https://你的域名/`
- 后台入口：`https://你的域名/admin`

## 上传能力说明

- 支持格式：`mp3`、`wav`、`ogg`、`m4a`、`aac`、`flac`
- 单首最大 40MB
- 曲库始终限制为最多 5 首
- 上传成功后，前台歌单会自动刷新为最新内容

## 目录结构

- `wwwroot/`：页面源文件
- `src/admin-client.js`：后台管理客户端源码
- `api/`：Vercel Functions
- `dist/`：构建输出目录

## 本地说明

仓库里保留了早期原型用的 `serve.ps1`，但当前可实际上线的方案以 Vercel 版本为准。
