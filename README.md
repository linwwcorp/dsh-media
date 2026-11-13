# dsh-media

中文 | [English](#english)

一个 DeepSeek Harness 插件：调用 [ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit) 的流媒体服务。左侧是流目录树，右侧是播放窗口；插件页面里可以配置常用端口、API 密钥和是否开启录制存储。

## 功能

- **流目录树**：新建目录、添加视频流、重命名、删除。检测到数据库插件时写入 PostgreSQL 表 `dsh_media_nodes`，否则保存在 `$DSH_HOME/dsh-media/catalog.json`。
- **直播播放**：通过 Host 中转 WebRTC offer/answer 播放，浏览器拿不到 ZLM API 密钥；同时提供 HLS、HTTP-FLV、RTSP、RTMP 地址。
- **拉流代理**：给视频流配置 `rtsp://`、`rtmp://` 或 `http(s)://` 源地址后，首次播放时自动调用 `addStreamProxy` 把源拉进 ZLMediaKit。
- **持续录制（监控回拨）**：默认开启，所有目录内的视频流持续录制为 MP4，按 `segmentSeconds`（默认 60 秒）切片。
- **录像保留**：可配置保留时长（小时，默认 168 小时 = 7 天，0 表示永久保留）；超过时长的录像会从 MinIO/本地和索引中自动删除，并清理 ZLMediaKit 容器内对应的原始录像日期目录。
- **录制存储与回放**：插件把 ZLMediaKit 完成的录像片段搬到存储中。检测到数据库插件时上传到 MinIO（对象前缀 `dsh-media/recordings/`），否则保存到本地录像目录；录像索引写入 PostgreSQL 表 `dsh_media_recordings` 或本地 `recordings.json`。回放页按日期显示时间轴，点击任意时刻即可播放对应片段，并支持下载 MP4。时间轴可缩放：滚轮以光标为中心缩放，或使用「缩小 / 放大 / 全天」和左右平移按钮，最小窗口 1 分钟。
- **端口配置**：HTTP、RTSP、RTMP、WebRTC 端口在插件界面配置。保存并应用后写入 ZLMediaKit 的 `setServerConfig`，改端口后按提示重启。
- **Agent 工具**：`list_media_streams`、`add_media_stream`、`list_media_recordings`、`get_media_server_status`。

## 前置条件

- **Linux**。插件自带的 ZLMediaKit 运行文件和 `zlm/linux` 编排只在 Linux 上使用。
- **Docker Compose**。媒体服务用 `zlm/linux/docker-compose.yml` 编排。机器上要有 Docker，并且 `docker compose` 可用。

## 安装

优先从 GitHub 安装：

```sh
dsh plugin install https://github.com/linwwcorp/dsh-media
```

`plugin_manager` 的 `install_bundle` 同样把 `target` 设为 `https://github.com/linwwcorp/dsh-media`。

没有外网、或要装手头这份目录时，再用本地路径。安装前先把两个运行文件下载到插件目录的 `zlm/linux/`，文件名不要改：

```sh
cd /path/to/dsh-media/zlm/linux
curl -fL -o MediaServer https://github.com/linwwcorp/dsh-media/releases/download/v0.1.1/MediaServer
curl -fL -o libjemalloc.so.2 https://github.com/linwwcorp/dsh-media/releases/download/v0.1.1/libjemalloc.so.2
chmod +x MediaServer
```

放好之后再安装：

```sh
dsh plugin install /path/to/dsh-media
```

从 GitHub 安装时不用手动下载，构建镜像会自己从 Release `v0.1.1` 拉取这些文件（`MediaServer`、`libjemalloc.so.2`，以及 `zlm-extra-libs.tar.gz`）。本地目录里如果已经放了 `zlm/linux/MediaServer` 和 `zlm/linux/libjemalloc.so.2`，构建会直接用它们；`zlm/linux/extra-libs/` 存在时也会直接拷贝，不再下载压缩包。插件启用后会按编排文件拉起 ZLMediaKit 容器。需要单独启动时：

```sh
cd zlm/linux
docker compose up -d --build
```

## 配置

打开「插件 → 流媒体服务」页面：

| 配置 | 说明 |
| --- | --- |
| ZLMediaKit 地址 / HTTP 端口 | Host 调用 ZLMediaKit API、页面拼装播放地址使用 |
| HTTPS | API 与 HTTP 播放地址使用 HTTPS |
| API 密钥 | ZLMediaKit `api.secret`，只保存在 Host，不回传浏览器 |
| RTSP / RTMP / WebRTC 端口 | 播放地址与 `setServerConfig` 写入的端口 |
| 录制开关 | 开启后 ZLMediaKit 持续录制所有流为 MP4 |
| 分段时长 | MP4 切片长度（秒），默认 60 |
| 本地录像目录 | 没有数据库插件时的录像保存目录；留空使用 `$DSH_HOME/dsh-media/recordings` |
| 录像保留时长 | 录像保留小时数，默认 168（7 天），0 表示永久保留；超期自动删除 |
| MP4 保存路径 / 录像应用名 | ZLMediaKit `protocol.mp4_save_path` / `record.appName` |

「保存」只更新插件配置；「保存并应用」还会调用 ZLMediaKit 的 `setServerConfig`；改端口后点「重启服务」。

## 容器生命周期

插件默认自己管理 ZLMediaKit 容器：

- **安装或启用插件**：Host 会检查 Docker 容器 `zlmediakit`。已经在跑就复用；已停止就 `docker start`；不存在则用插件包里的 `zlm/linux/docker-compose.yml` 执行 `docker compose up -d`。首次会构建镜像，构建在后台进行，不阻塞插件安装。
- **卸载或停用插件**：Host 会 `docker stop --time 10 zlmediakit` 停止容器。
- 相关配置可在 `cordis.patch.yml` 或插件配置里修改：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `manageContainer` | `true` | 是否由插件管理容器生命周期；连接远程 ZLM 时设为 `false` |
| `containerName` | `zlmediakit` | 插件启动和停止的容器名 |
| `composeFile` | 空 | 空表示使用插件包内 `zlm/linux/docker-compose.yml` |

容器生命周期操作全部通过 `docker` 可执行文件以参数数组调用，不经过 shell。容器名会做字符校验。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半边：ZLM API 客户端、目录存储、认证路由、Agent 工具 |
| `client.js` | 浏览器半边：侧边栏入口、目录树页面、WebRTC 直播、MP4 回放、服务设置 |
| `cordis.patch.yml` | 插入 `dsh-media` 插件行 |
| `locale/*.json` | 插件管理器中的标题与说明 |
| `icon.svg` | 插件图标 |
| `zlm/` | ZLMediaKit 服务端运行文件与 Docker 部署 |

## 存储选择

- 数据库插件存在时：流目录、录像索引写入 PostgreSQL；录像文件上传 MinIO，使用数据库插件里配置的 bucket。
- 数据库插件不存在时：流目录保存为 `catalog.json`，录像索引保存为 `recordings.json`，录像文件保存到本地目录。
- 回放与下载都通过插件的认证路由读取，MinIO 对象不会以公开 URL 暴露，支持 HTTP Range 拖动进度。

## 对外开放能力

插件把全部能力注册为 Cordis Service `mediaServer`，模型工具和其他插件都调用同一套实现。

### 其他插件调用

```js
export const inject = ['mediaServer']

export function apply(ctx) {
  const nodes = await ctx.mediaServer.tree()
  const prepared = await ctx.mediaServer.prepareStream({ id: nodes[0].id })
  const media = await ctx.mediaServer.zlm('getMediaList', { app: 'live' }) // {code,msg,data}
}
```

| 方法 | 说明 |
| --- | --- |
| `tree()` | 目录树 |
| `settings()` / `updateSettings(patch)` | 读取/更新插件设置 |
| `createFolder(body)` / `createStream(body)` | 新建目录/视频流 |
| `updateNode(body)` / `deleteNode(body)` | 更新/删除节点 |
| `exportCanvas(body)` / `listExports()` / `stopExport(nodeId)` | 画布合成导出 |
| `serverStatus()` / `serverConfig()` | ZLMediaKit 状态/上游配置 |
| `applyServerConfig()` / `restartServer()` | 应用端口与录制配置/重启 |
| `streamStatus(app, stream)` | 单流在线与录制状态 |
| `prepareStream({ id })` | 确保在线并返回播放地址 |
| `webrtcExchange(app, stream, offer)` | WebRTC offer/answer 交换 |
| `listRecordings(filter)` / `syncRecordings(body)` / `pruneRecordings(options)` | 录像查询/同步/保留清理 |
| `record(action, app, stream)` | 开始/停止录制 |
| `callZlm(method, fields)` | 直接调用任意 ZLMediaKit HTTP API，返回 `data`，非 0 返回码抛错 |
| `zlm(method, params)` | 直接调用任意 ZLMediaKit HTTP API，返回完整 `{code,msg,data}` 包络（推荐） |

### 模型工具（18 个）

`list_media_streams`、`add_media_stream`、`manage_media_node`、`list_media_recordings`、`prune_media_recordings`、`get_media_settings`、`update_media_settings`、`get_media_stream_status`、`open_media_stream`、`record_media_stream`、`get_media_server_status`、`apply_media_server_config`、`restart_media_server`、`export_media_canvas`、`stop_media_export`、`list_media_exports`、`call_zlm_api`、`zlm_api`。

## 说明

- 视频流目录保存在 Host 的 JSON 文件里。删除目录会连带删除子项；已录制的 MP4 文件不会被删除。
- WebRTC 播放依赖浏览器能直连 ZLMediaKit 的 WebRTC 端口（默认 8000/UDP）。跨网段访问时请配置 `rtc.externIP`。
- 本插件调用 ZLMediaKit 的 HTTP API：`getServerConfig`、`setServerConfig`、`restartServer`、`getMediaList`、`addStreamProxy`、`delStreamProxy`、`webrtc`、`startRecord`、`stopRecord`、`getMp4RecordFile`、`version`。

---

<a id="english"></a>

# dsh-media

[中文](#dsh-media) | English

A DeepSeek Harness plugin that calls [ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit). The page has a stream directory tree on the left and a player on the right. Plugin settings cover the common ports, the API secret, and whether MP4 recording storage is enabled.

## Features

- **Stream tree**: create folders, add streams, rename, and delete. With the database plugin, nodes are stored in the PostgreSQL table `dsh_media_nodes`; otherwise they are stored in `$DSH_HOME/dsh-media/catalog.json`.
- **Live playback**: the Host relays the WebRTC offer and answer, so the browser never receives the ZLM API secret. HLS, HTTP-FLV, RTSP, and RTMP URLs are also shown.
- **Pull proxy**: after a stream is given an `rtsp://`, `rtmp://`, or `http(s)://` source, the first playback calls `addStreamProxy` and pulls that source into ZLMediaKit.
- **Continuous recording**: enabled by default. Every stream in the catalog is recorded to MP4 in slices of `segmentSeconds` (60 seconds by default).
- **Recording storage and replay**: finished ZLMediaKit segments are moved into storage. With the database plugin they are uploaded to MinIO under the prefix `dsh-media/recordings/`; otherwise they stay in the local recording directory. The index is stored in the PostgreSQL table `dsh_media_recordings` or in `recordings.json`. Replay shows a timeline for the selected day. Choosing a time plays that segment, and the MP4 can be downloaded. The timeline zooms with the wheel around the cursor, or with zoom out, zoom in, full day, and pan controls. The smallest window is one minute.
- **Ports**: HTTP, RTSP, RTMP, and WebRTC ports are set in the plugin UI. Apply writes them with ZLMediaKit `setServerConfig`. Restart the service after a port change.
- **Agent tools**: `list_media_streams`, `add_media_stream`, `list_media_recordings`, `get_media_server_status`.

## Requirements

- **Linux**. The bundled ZLMediaKit runtime files and the `zlm/linux` Compose file are for Linux.
- **Docker Compose**. The media service is defined in `zlm/linux/docker-compose.yml`. Docker must be installed, and `docker compose` must work.

## Install

Install from GitHub first:

```sh
dsh plugin install https://github.com/linwwcorp/dsh-media
```

For `plugin_manager` `install_bundle`, set `target` to `https://github.com/linwwcorp/dsh-media`.

Use a local directory when the machine has no outbound network, or when you already have a checkout. Download these two runtime files into `zlm/linux/` inside that directory and keep the file names:

```sh
cd /path/to/dsh-media/zlm/linux
curl -fL -o MediaServer https://github.com/linwwcorp/dsh-media/releases/download/v0.1.1/MediaServer
curl -fL -o libjemalloc.so.2 https://github.com/linwwcorp/dsh-media/releases/download/v0.1.1/libjemalloc.so.2
chmod +x MediaServer
```

Then install:

```sh
dsh plugin install /path/to/dsh-media
```

A GitHub install does not need this manual download. The image build fetches `MediaServer`, `libjemalloc.so.2`, and the extra shared libraries (`zlm-extra-libs.tar.gz`) from Release `v0.1.1`. If `zlm/linux/MediaServer` and `zlm/linux/libjemalloc.so.2` are already present, the build uses those files, and a local `zlm/linux/extra-libs/` directory is copied instead of downloading the archive. Enabling the plugin starts the ZLMediaKit container from the Compose file. To start it yourself:

```sh
cd zlm/linux
docker compose up -d --build
```

## Settings

Open Plugins, then the streaming media service page.

| Setting | Purpose |
| --- | --- |
| ZLMediaKit host / HTTP port | Host calls the ZLMediaKit API and the page builds playback URLs |
| HTTPS | Use HTTPS for the API and HTTP playback URLs |
| API secret | ZLMediaKit `api.secret`. Stored on the Host and not sent to the browser |
| RTSP / RTMP / WebRTC ports | Playback URLs and the ports written by `setServerConfig` |
| Recording | When on, ZLMediaKit records every stream to MP4 |
| Segment length | MP4 slice length in seconds. Default 60 |
| Local recording directory | Used when the database plugin is absent. Empty means `$DSH_HOME/dsh-media/recordings` |
| MP4 save path / recording app | ZLMediaKit `protocol.mp4_save_path` / `record.appName` |

Save updates the plugin configuration only. Save and apply also calls ZLMediaKit `setServerConfig`. After a port change, restart the service.

## Container lifecycle

The plugin manages the ZLMediaKit container by default.

- **Install or enable**: the Host checks the Docker container `zlmediakit`. A running container is reused. A stopped container is started with `docker start`. If it does not exist, the Host runs `docker compose up -d` with `zlm/linux/docker-compose.yml` from the plugin package. The first build runs in the background and does not block installation.
- **Uninstall or disable**: the Host runs `docker stop --time 10 zlmediakit`.
- These settings can be changed in `cordis.patch.yml` or in the plugin configuration:

| Setting | Default | Purpose |
| --- | --- | --- |
| `manageContainer` | `true` | Whether the plugin manages the container. Set to `false` for a remote ZLM |
| `containerName` | `zlmediakit` | Container the plugin starts and stops |
| `composeFile` | empty | Empty uses `zlm/linux/docker-compose.yml` from the plugin package |

Lifecycle commands call the `docker` executable with an argument array and do not go through a shell. The container name is checked for allowed characters.

## Layout

| File | Role |
| --- | --- |
| `index.js` | Host side: ZLM API client, catalog storage, authenticated routes, Agent tools |
| `client.js` | Browser side: sidebar entry, stream tree, WebRTC live view, MP4 replay, server settings |
| `cordis.patch.yml` | Inserts the `dsh-media` plugin row |
| `locale/*.json` | Title and description in the plugin manager |
| `icon.svg` | Plugin icon |
| `zlm/` | ZLMediaKit runtime files and the Docker deployment |

## Storage

- With the database plugin, the stream catalog and recording index go to PostgreSQL. Recording files are uploaded to MinIO, using the bucket configured in that plugin.
- Without the database plugin, the catalog is `catalog.json`, the recording index is `recordings.json`, and recording files stay in the local directory.
- Replay and download go through the plugin's authenticated routes. MinIO objects are not exposed as public URLs. HTTP Range requests can seek inside a file.

## Notes

- The stream catalog is stored in the Host JSON file. Deleting a folder also deletes its children. Recorded MP4 files are kept.
- WebRTC playback needs a direct path from the browser to the ZLMediaKit WebRTC port (8000/UDP by default). Set `rtc.externIP` when clients are on another network.
- This plugin calls the ZLMediaKit HTTP API: `getServerConfig`, `setServerConfig`, `restartServer`, `getMediaList`, `addStreamProxy`, `delStreamProxy`, `webrtc`, `startRecord`, `stopRecord`, `getMp4RecordFile`, `version`.
