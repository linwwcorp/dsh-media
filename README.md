# dsh-media

一个 DeepSeek Harness 插件：调用 [ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit) 的流媒体服务。
左侧是流目录树，右侧是播放窗口；插件页面里可以配置常用端口、API 密钥和是否开启录制存储。

A DeepSeek Harness plugin that turns ZLMediaKit into a managed streaming-media service.
The page has a stream directory tree on the left and a player on the right; the plugin settings
configure the common ports, the API secret, and whether MP4 recording storage is enabled.

## 功能 / Features

- **流目录树**：新建目录、添加视频流、重命名、删除。检测到数据库插件时写入 PostgreSQL 表 `dsh_media_nodes`，否则保存在 `$DSH_HOME/dsh-media/catalog.json`。
- **直播播放**：通过 Host 中转 WebRTC offer/answer 播放，浏览器拿不到 ZLM API 密钥；同时提供 HLS、HTTP-FLV、RTSP、RTMP 地址。
- **拉流代理**：给视频流配置 `rtsp://`、`rtmp://` 或 `http(s)://` 源地址后，首次播放时自动调用 `addStreamProxy` 把源拉进 ZLMediaKit。
- **持续录制（监控回拨）**：默认开启，所有目录内的视频流持续录制为 MP4，按 `segmentSeconds`（默认 60 秒）切片；直播页也可手动开始/停止录制。
- **录制存储与回放**：插件把 ZLMediaKit 完成的录像片段搬到存储中——检测到数据库插件时上传到 MinIO（对象前缀 `dsh-media/recordings/`），否则保存到本地录像目录；录像索引写入 PostgreSQL 表 `dsh_media_recordings` 或本地 `recordings.json`。回放页按日期显示时间轴，点击任意时刻即可播放对应片段，并支持下载 MP4；时间轴可缩放（滚轮以光标为中心缩放，或使用「缩小 / 放大 / 全天」和左右平移按钮，最小窗口 1 分钟）。
- **端口配置**：HTTP、RTSP、RTMP、WebRTC 端口在插件界面配置；保存并应用后写入 ZLMediaKit 的 `setServerConfig`，改端口后按提示重启。
- **Agent 工具**：`list_media_streams`、`add_media_stream`、`list_media_recordings`、`get_media_server_status`。

## 前置条件 / Requirements

- **Linux**。插件自带的 ZLMediaKit 运行文件和 `zlm/linux` 编排只在 Linux 上使用。
- **Docker Compose**。媒体服务用 `zlm/linux/docker-compose.yml` 编排；机器上要有 Docker，并且 `docker compose` 可用。

## 安装 / Install

优先从 GitHub 安装：

```sh
dsh plugin install https://github.com/linwwcorp/dsh-media
```

`plugin_manager` 的 `install_bundle` 同样把 `target` 设为 `https://github.com/linwwcorp/dsh-media`。

没有外网、或要装手头这份目录时，再用本地路径。安装前先把两个运行文件下载到插件目录的 `zlm/linux/`，文件名不要改：

```sh
cd /path/to/dsh-media/zlm/linux
curl -fL -o MediaServer https://github.com/linwwcorp/dsh-media/releases/download/v0.1.0/MediaServer
curl -fL -o libjemalloc.so.2 https://github.com/linwwcorp/dsh-media/releases/download/v0.1.0/libjemalloc.so.2
chmod +x MediaServer
```

放好之后再安装：

```sh
dsh plugin install /path/to/dsh-media
```

从 GitHub 安装时不用手动下载，构建镜像会自己从 Release `v0.1.0` 拉取这两个文件。本地目录里如果已经放了 `zlm/linux/MediaServer` 和 `zlm/linux/libjemalloc.so.2`，构建会直接用它们。插件启用后会按编排文件拉起 ZLMediaKit 容器。需要单独启动时：

```sh
cd zlm/linux
docker compose up -d --build
```

## 配置 / Settings

打开「插件 → 流媒体服务」页面，或流媒体服务页右上角的「服务设置」：

| 配置 | 说明 |
| --- | --- |
| ZLMediaKit 地址 / HTTP 端口 | Host 调用 ZLMediaKit API、页面拼装播放地址使用 |
| HTTPS | API 与 HTTP 播放地址使用 HTTPS |
| API 密钥 | ZLMediaKit `api.secret`，只保存在 Host，不回传浏览器 |
| RTSP / RTMP / WebRTC 端口 | 播放地址与 `setServerConfig` 写入的端口 |
| 录制开关 | 开启后 ZLMediaKit 持续录制所有流为 MP4 |
| 分段时长 | MP4 切片长度（秒），默认 60 |
| 本地录像目录 | 没有数据库插件时的录像保存目录；留空使用 `$DSH_HOME/dsh-media/recordings` |
| MP4 保存路径 / 录像应用名 | ZLMediaKit `protocol.mp4_save_path` / `record.appName` |

「保存」只更新插件配置；「保存并应用」还会调用 ZLMediaKit 的 `setServerConfig`；改端口后点「重启服务」。

## 容器生命周期 / Container lifecycle

插件默认自己管理 ZLMediaKit 容器：

- **安装/启用插件**：Host 会检查 Docker 容器 `zlmediakit`。已经在跑就复用；已停止就 `docker start`；不存在则用插件包里的 `zlm/linux/docker-compose.yml` 执行 `docker compose up -d`（首次会构建镜像，构建在后台进行，不阻塞插件安装）。
- **卸载/停用插件**：Host 会 `docker stop --time 10 zlmediakit` 停止容器。
- 相关配置（cordis.patch.yml 或插件配置文档里可改）：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `manageContainer` | `true` | 是否由插件管理容器生命周期；连远程 ZLM 时设为 `false` |
| `containerName` | `zlmediakit` | 插件启动/停止的容器名 |
| `composeFile` | 空 | 空表示使用插件包内 `zlm/linux/docker-compose.yml` |

容器生命周期操作全部通过 `docker` 可执行文件以参数数组调用，不经过 shell；容器名会做字符校验。

## 结构 / Layout

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半边：ZLM API 客户端、目录存储、认证路由、Agent 工具 |
| `client.js` | 浏览器半边：侧边栏入口、目录树页面、WebRTC 直播、MP4 回放、服务设置 |
| `cordis.patch.yml` | 插入 `dsh-media` 插件行 |
| `locale/*.json` | 插件管理器中的标题与说明 |
| `icon.svg` | 插件图标 |
| `zlm/` | ZLMediaKit 服务端运行文件与 Docker 部署 |

## 存储选择 / Storage

- 数据库插件存在时：流目录、录像索引写入 PostgreSQL；录像文件上传 MinIO（使用数据库插件里配置的 bucket）。
- 数据库插件不存在时：流目录保存为 `catalog.json`，录像索引保存为 `recordings.json`，录像文件保存到本地目录。
- 回放与下载都通过插件的认证路由读取（MinIO 对象不会以公开 URL 暴露），支持 HTTP Range 拖动进度。

## 说明 / Notes

- 视频流目录保存在 Host 的 JSON 文件里，删除目录会连带删除子项；已录制的 MP4 文件不会被删除。
- WebRTC 播放依赖浏览器能直连 ZLMediaKit 的 WebRTC 端口（默认 8000/UDP）。跨网段访问时请配置 `rtc.externIP`。
- 本插件调用 ZLMediaKit 的 HTTP API：`getServerConfig`、`setServerConfig`、`restartServer`、`getMediaList`、`addStreamProxy`、`delStreamProxy`、`webrtc`、`startRecord`、`stopRecord`、`getMp4RecordFile`、`version`。
