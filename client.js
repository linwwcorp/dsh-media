/**
 * Browser half of the `dsh-media` bundle: the streaming-media page reached from
 * the sidebar panel row.
 *
 * The page keeps the stream catalog tree on the left and a player on the right.
 * Live playback negotiates WebRTC through the Host route so the ZLMediaKit
 * secret never reaches the browser; replay plays the MP4 files ZLMediaKit
 * records and serves over HTTP.
 */
window.__ModuleLoader__.load({
  id: 'dsh-media',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-media'
    const PANEL_ID = 'dsh-media'
    const API = 'api/media'
    const PLAYBACK_MEMORY_KEY = 'dsh-media-playback'

    /** @returns the last selected stream and each stream's live or replay tab. */
    function readPlaybackMemory() {
      try {
        const raw = window.localStorage.getItem(PLAYBACK_MEMORY_KEY)
        const data = raw === null ? null : JSON.parse(raw)
        if (data === null || typeof data !== 'object') return { selectedId: null, tabs: {} }
        const tabs = data.tabs !== null && typeof data.tabs === 'object' ? data.tabs : {}
        return {
          selectedId: typeof data.selectedId === 'string' ? data.selectedId : null,
          tabs,
        }
      } catch (_unavailable) {
        return { selectedId: null, tabs: {} }
      }
    }

    const COPY = {
      en: {
        panel: 'Streaming media',
        'page.title': 'Streaming media',
        'page.subtitle': 'Live streams, recording storage, and replay',
        'action.refresh': 'Refresh',
        'action.newFolder': 'New folder',
        'action.addStream': 'Add stream',
        'action.rename': 'Rename',
        'action.delete': 'Delete',
        'action.settings': 'Server settings',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.cancel': 'Cancel',
        'action.close': 'Close',
        'action.apply': 'Save and apply',
        'action.applying': 'Applying…',
        'action.restart': 'Restart server',
        'action.restarting': 'Restarting…',
        'action.retry': 'Retry',
        'action.copy': 'Copy',
        'action.copied': 'Copied',
        'action.play': 'Play',
        'action.stop': 'Stop',
        'action.reconnect': 'Reconnect',
        'status.online': 'ZLMediaKit online',
        'status.offline': 'ZLMediaKit offline',
        'status.unknown': 'Server unknown',
        'tree.title': 'Stream tree',
        'tree.empty': 'No folders or streams yet.',
        'tree.emptyHint': 'Create a folder, then add a stream to start.',
        'tree.loading': 'Loading stream tree…',
        'tree.failed': 'The stream tree could not be loaded.',
        'tree.root': 'Root',
        'tree.count': '{count}',
        'tree.renameHint': 'Double-click to rename',
        'player.emptyTitle': 'Select a stream',
        'player.emptyBody': 'Pick a stream in the tree on the left. Live video opens here, and the Replay tab plays recorded MP4 files.',
        'player.folderTitle': 'Folder',
        'player.folderEmpty': 'This folder is empty.',
        'player.folderChildren': '{count} direct items',
        'tabs.live': 'Live',
        'tabs.replay': 'Replay',
        'live.connecting': 'Connecting to the stream…',
        'live.pulling': 'Pulling the source into ZLMediaKit…',
        'live.playing': 'Live',
        'live.offline': 'The stream is offline',
        'live.offlineHint': 'Publish the stream to ZLMediaKit or set a source URL, then retry.',
        'live.error': 'Live playback failed',
        'live.source': 'Source URL',
        'live.sourcePush': 'Device push (no source URL)',
        'live.recording': 'Recording',
        'live.notRecording': 'Not recording',
        'live.recordStart': 'Start recording',
        'live.recordStop': 'Stop recording',
        'live.storageOff': 'Recording storage is off. Turn it on in Server settings to keep MP4 files.',
        'live.info': 'Playback addresses',
        'live.webrtcHint': 'Live preview uses WebRTC through this server.',
        'replay.title': 'Recordings',
        'replay.date': 'Date',
        'replay.refresh': 'Refresh list',
        'replay.empty': 'No recordings on this day.',
        'replay.loading': 'Loading recordings…',
        'replay.failed': 'Recordings could not be loaded.',
        'replay.selectHint': 'Drag the timeline to watch the recording for that time.',
        'replay.gap': 'Nothing was recorded at this time.',
        'replay.zoomIn': 'Zoom in',
        'replay.zoomOut': 'Zoom out',
        'replay.fit': 'Full day',
        'replay.storageOff': 'Recording storage is off, so no MP4 files are kept.',
        'replay.file': 'Recording',
        'replay.sync': 'Sync segments',
        'replay.syncing': 'Syncing…',
        'replay.download': 'Download',
        'replay.duration': 'Duration',
        'replay.size': 'Size',
        'replay.storage': 'Storage',
        'replay.storageMinio': 'MinIO',
        'replay.storageLocal': 'Local disk',
        'node.app': 'App',
        'node.stream': 'Stream id',
        'node.description': 'Description',
        'node.source': 'Source',
        'dialog.folderTitle': 'New folder',
        'dialog.streamTitle': 'Add stream',
        'dialog.editTitle': 'Edit node',
        'dialog.parent': 'Parent folder',
        'dialog.name': 'Name',
        'dialog.namePlaceholder': 'Front gate',
        'dialog.sourcePlaceholder': 'rtsp://192.168.1.10:554/stream1',
        'dialog.appPlaceholder': 'live',
        'dialog.streamPlaceholder': 'Leave blank to generate',
        'dialog.descriptionPlaceholder': 'Optional notes about this stream',
        'dialog.save': 'Save',
        'dialog.saving': 'Saving…',
        'validation.nameRequired': 'A name is required.',
        'validation.appInvalid': 'The app may contain only letters, numbers, dot, dash, and underscore.',
        'validation.streamInvalid': 'The stream id may contain only letters, numbers, dot, dash, and underscore.',
        'validation.sourceInvalid': 'Use an absolute http, https, rtmp, or rtsp URL.',
        'delete.title': 'Delete this node?',
        'delete.body': '“{name}” and everything inside it are removed from the catalog. Pull proxies are dropped; recorded files stay on the server.',
        'delete.failed': 'The node could not be deleted.',
        'folder.addStream': 'Add stream here',
        'folder.newSubfolder': 'New subfolder',
        'settings.title': 'Server settings',
        'settings.subtitle': 'Connection, ports, and recording storage for ZLMediaKit.',
        'settings.connection': 'Connection',
        'settings.ports': 'Ports',
        'settings.storage': 'Storage',
        'settings.host': 'ZLMediaKit host',
        'settings.httpPort': 'HTTP port',
        'settings.https': 'HTTPS',
        'settings.secret': 'API secret',
        'settings.secretKept': 'A secret is saved. Leave blank to keep it.',
        'settings.secretRequired': 'The API secret is not set yet.',
        'settings.rtspPort': 'RTSP port',
        'settings.rtmpPort': 'RTMP port',
        'settings.rtcPort': 'WebRTC port',
        'settings.recordEnabled': 'Record every stream to MP4',
        'settings.recordEnabledHint': 'When on, ZLMediaKit writes MP4 recordings that the Replay tab can play.',
        'settings.segmentSeconds': 'Segment length (seconds)',
        'settings.segmentHint': 'Continuous recording splits MP4 files into segments of this length.',
        'settings.recordLocalDir': 'Local recording directory',
        'settings.recordLocalDirHint': 'Empty uses $DSH_HOME/dsh-media/recordings',
        'settings.storageMode': 'Recording storage',
        'settings.storageMinio': 'MinIO (database plugin)',
        'settings.storageLocal': 'Local disk',
        'settings.recordPath': 'MP4 save path',
        'settings.recordApp': 'Recording app name',
        'settings.saved': 'Settings saved.',
        'settings.failed': 'The settings could not be saved.',
        'settings.applied': 'Applied to ZLMediaKit.',
        'settings.appliedRestart': 'Applied to ZLMediaKit. Port changes take effect after a restart.',
        'settings.applyFailed': 'ZLMediaKit rejected the settings.',
        'settings.restarted': 'ZLMediaKit restarted and is online.',
        'settings.restartFailed': 'ZLMediaKit did not come back after the restart.',
        'settings.current': 'Effective ZLMediaKit configuration',
        'settings.currentHint': 'Read from the running server.',
        'settings.version': 'Version',
        'settings.recordOn': 'Recording on',
        'settings.recordOff': 'Recording off',
        'settings.clearSecret': 'Clear saved secret',
        'settings.secretCleared': 'The saved secret was cleared.',
        'settings.online': 'Online',
        'settings.offline': 'Offline',
        'settings.restartHint': 'Saving ports into ZLMediaKit requires a restart before they take effect.',
        'error.request': 'The request failed. Please try again.',
        'error.generic': 'Something went wrong.',
      },
      zh: {
        panel: '流媒体服务',
        'page.title': '流媒体服务',
        'page.subtitle': '直播、录制存储与回放',
        'action.refresh': '刷新',
        'action.newFolder': '新建目录',
        'action.addStream': '添加流',
        'action.rename': '重命名',
        'action.delete': '删除',
        'action.settings': '服务设置',
        'action.save': '保存',
        'action.saving': '正在保存…',
        'action.cancel': '取消',
        'action.close': '关闭',
        'action.apply': '保存并应用',
        'action.applying': '正在应用…',
        'action.restart': '重启服务',
        'action.restarting': '正在重启…',
        'action.retry': '重试',
        'action.copy': '复制',
        'action.copied': '已复制',
        'action.play': '播放',
        'action.stop': '停止',
        'action.reconnect': '重连',
        'status.online': 'ZLMediaKit 在线',
        'status.offline': 'ZLMediaKit 离线',
        'status.unknown': '服务状态未知',
        'tree.title': '流目录',
        'tree.empty': '还没有目录或视频流',
        'tree.emptyHint': '先新建目录，再添加视频流。',
        'tree.loading': '正在读取目录…',
        'tree.failed': '目录加载失败。',
        'tree.root': '根目录',
        'tree.count': '{count}',
        'tree.renameHint': '双击可重命名',
        'player.emptyTitle': '选择一个视频流',
        'player.emptyBody': '在左侧目录树里选择视频流，右侧显示直播画面；切换到「回放」可查看录像。',
        'player.folderTitle': '目录',
        'player.folderEmpty': '这个目录是空的。',
        'player.folderChildren': '{count} 个直接子项',
        'tabs.live': '直播',
        'tabs.replay': '回放',
        'live.connecting': '正在连接视频流…',
        'live.pulling': '正在把源地址拉入 ZLMediaKit…',
        'live.playing': '直播中',
        'live.offline': '视频流不在线',
        'live.offlineHint': '请先向 ZLMediaKit 推流，或给这条流配置源地址后重试。',
        'live.error': '直播播放失败',
        'live.source': '源地址',
        'live.sourcePush': '设备推流（无源地址）',
        'live.recording': '录制中',
        'live.notRecording': '未录制',
        'live.recordStart': '开始录制',
        'live.recordStop': '停止录制',
        'live.storageOff': '录制存储未开启。到「服务设置」开启后可保留 MP4 文件。',
        'live.info': '播放地址',
        'live.webrtcHint': '实时预览通过本服务中转 WebRTC。',
        'replay.title': '录像',
        'replay.date': '日期',
        'replay.refresh': '刷新列表',
        'replay.empty': '这一天没有录像。',
        'replay.loading': '正在读取录像…',
        'replay.failed': '录像加载失败。',
        'replay.selectHint': '拖动时间轴，查看对应时间的录像。',
        'replay.gap': '这个时间没有录像。',
        'replay.zoomIn': '放大',
        'replay.zoomOut': '缩小',
        'replay.fit': '全天',
        'replay.storageOff': '录制存储未开启，没有保留 MP4 文件。',
        'replay.file': '录像',
        'replay.sync': '同步最新录像',
        'replay.syncing': '正在同步…',
        'replay.download': '下载',
        'replay.duration': '时长',
        'replay.size': '大小',
        'replay.storage': '存储',
        'replay.storageMinio': 'MinIO',
        'replay.storageLocal': '本地磁盘',
        'node.app': '应用名',
        'node.stream': '流 ID',
        'node.description': '描述',
        'node.source': '源',
        'dialog.folderTitle': '新建目录',
        'dialog.streamTitle': '添加视频流',
        'dialog.editTitle': '编辑节点',
        'dialog.parent': '上级目录',
        'dialog.name': '名称',
        'dialog.namePlaceholder': '前门',
        'dialog.sourcePlaceholder': 'rtsp://192.168.1.10:554/stream1',
        'dialog.appPlaceholder': 'live',
        'dialog.streamPlaceholder': '留空自动生成',
        'dialog.descriptionPlaceholder': '可选的备注信息',
        'dialog.save': '保存',
        'dialog.saving': '正在保存…',
        'validation.nameRequired': '请输入名称。',
        'validation.appInvalid': '应用名只能包含字母、数字、点、短横线和下划线。',
        'validation.streamInvalid': '流 ID 只能包含字母、数字、点、短横线和下划线。',
        'validation.sourceInvalid': '请使用 http、https、rtmp 或 rtsp 绝对地址。',
        'delete.title': '删除这个节点？',
        'delete.body': '“{name}”及其所有子项都会从目录中移除。拉流代理会被删除，已录制的文件仍保留在服务器上。',
        'delete.failed': '删除失败。',
        'folder.addStream': '在这里添加流',
        'folder.newSubfolder': '新建子目录',
        'settings.title': '服务设置',
        'settings.subtitle': 'ZLMediaKit 的连接、端口与录制存储。',
        'settings.connection': '连接',
        'settings.ports': '端口',
        'settings.storage': '存储',
        'settings.host': 'ZLMediaKit 地址',
        'settings.httpPort': 'HTTP 端口',
        'settings.https': 'HTTPS',
        'settings.secret': 'API 密钥',
        'settings.secretKept': '已保存密钥，留空保持不变。',
        'settings.secretRequired': '尚未设置 API 密钥。',
        'settings.rtspPort': 'RTSP 端口',
        'settings.rtmpPort': 'RTMP 端口',
        'settings.rtcPort': 'WebRTC 端口',
        'settings.recordEnabled': '把所有流录制为 MP4',
        'settings.recordEnabledHint': '开启后 ZLMediaKit 会写入 MP4 录像，「回放」页可播放。',
        'settings.segmentSeconds': '分段时长（秒）',
        'settings.segmentHint': '持续录制会按这个时长切分 MP4 文件。',
        'settings.recordLocalDir': '本地录像目录',
        'settings.recordLocalDirHint': '留空使用 $DSH_HOME/dsh-media/recordings',
        'settings.storageMode': '录像存储位置',
        'settings.storageMinio': 'MinIO（数据库插件）',
        'settings.storageLocal': '本地磁盘',
        'settings.recordPath': 'MP4 保存路径',
        'settings.recordApp': '录像应用名',
        'settings.saved': '设置已保存。',
        'settings.failed': '设置保存失败。',
        'settings.applied': '已应用到 ZLMediaKit。',
        'settings.appliedRestart': '已保存到 ZLMediaKit；端口修改需要重启后生效。',
        'settings.applyFailed': 'ZLMediaKit 拒绝了这些设置。',
        'settings.restarted': 'ZLMediaKit 已重启并恢复在线。',
        'settings.restartFailed': '重启后 ZLMediaKit 没有恢复。',
        'settings.current': 'ZLMediaKit 当前生效配置',
        'settings.currentHint': '来自正在运行的服务。',
        'settings.version': '版本',
        'settings.recordOn': '录制已开启',
        'settings.recordOff': '录制已关闭',
        'settings.clearSecret': '清除已保存密钥',
        'settings.secretCleared': '已清除保存的密钥。',
        'settings.online': '在线',
        'settings.offline': '离线',
        'settings.restartHint': '端口写入 ZLMediaKit 后需要重启才会生效。',
        'error.request': '请求失败，请重试。',
        'error.generic': '操作失败。',
      },
    }

    const CSS = `
.dsh-media-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.55;
}
.dsh-media-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: none;
  box-sizing: border-box;
  padding: 22px 24px 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
[data-platform='darwin'] .dsh-media-header { padding-top: calc(22px + var(--dsh-frame-top-clearance, 0px)); }
.dsh-media-heading { display: grid; gap: 3px; min-width: 0; }
.dsh-media-heading h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
.dsh-media-subtitle { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-media-header-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dsh-media-badge {
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 9px;
  border-radius: 12px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px; white-space: nowrap;
}
.dsh-media-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dsh-media-badge-online { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsh-media-badge-offline { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsh-media-body { display: flex; flex: 1; min-height: 0; min-width: 0; }
.dsh-media-sidebar {
  display: flex; flex-direction: column;
  flex: none; width: 296px; min-width: 0; min-height: 0;
  border-right: 0.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.dsh-media-sidebar-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px 8px; }
.dsh-media-sidebar-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-media-sidebar-tools { display: flex; align-items: center; gap: 6px; padding: 0 14px 10px; }
.dsh-media-icon-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-media-icon-button:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dsh-media-tree { flex: 1; min-height: 0; overflow: auto; padding: 2px 8px 20px; scrollbar-gutter: stable; }
.dsh-media-tree-row {
  display: flex; align-items: center; gap: 6px;
  box-sizing: border-box;
  height: 32px; padding: 0 6px;
  border-radius: 7px;
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-primary);
}
.dsh-media-tree-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-media-tree-row-selected,
.dsh-media-tree-row-selected:hover { background: #e7f1ff; box-shadow: none; }
.dsh-media-tree-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; flex: none;
  border: none; background: transparent; padding: 0; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-media-tree-chevron svg { transition: transform .12s ease; }
.dsh-media-chevron-closed { transform: rotate(-90deg); }
.dsh-media-stream { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.dsh-media-stream > .dsh-media-player-head { padding: 18px 22px 0; }
.dsh-media-tree-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary); }
.dsh-media-tree-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dsh-media-tree-actions { display: none; align-items: center; gap: 2px; flex: none; }
.dsh-media-tree-row:hover .dsh-media-tree-actions,
.dsh-media-tree-row:focus-within .dsh-media-tree-actions { display: inline-flex; }
.dsh-media-tree-action {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border: none; border-radius: 5px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-media-tree-action:hover { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dsh-media-tree-action-danger:hover { color: var(--dsw-alias-state-error-primary); }
.dsh-media-tree-count { color: var(--dsw-alias-label-secondary); font-size: 11px; flex: none; }
.dsh-media-tree-spacer { width: 16px; flex: none; }
.dsh-media-tree-empty { padding: 24px 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
.dsh-media-tree-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-media-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.dsh-media-empty {
  display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 40px 24px; text-align: center; color: var(--dsw-alias-label-secondary);
}
.dsh-media-empty h2 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 500; }
.dsh-media-empty p { margin: 0; max-width: 420px; font-size: 13px; }
.dsh-media-player { display: flex; flex-direction: column; gap: 14px; box-sizing: border-box; padding: 18px 22px 28px; }
.dsh-media-player-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dsh-media-stream > .dsh-media-player-head { align-items: center; }
.dsh-media-player-title { display: grid; gap: 4px; min-width: 0; justify-items: start; text-align: left; }
.dsh-media-player-title h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; overflow-wrap: anywhere; text-align: left; }
.dsh-media-player-note { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; text-align: left; overflow-wrap: anywhere; }
.dsh-media-mono { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-media-tabs {
  display: inline-flex; align-items: center; gap: 2px; padding: 4px;
  border-radius: 10px; background: #eef0f4;
}
.dsh-media-tab {
  height: 32px; padding: 0 16px; border: none; border-radius: 8px;
  background: transparent; color: #8b909a;
  font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
}
.dsh-media-tab-active {
  background: #fff; color: #1f2329;
  box-shadow: 0 1px 2px rgba(31, 35, 41, .08), 0 0 0 0.5px rgba(31, 35, 41, .06);
}
.dsh-media-video-shell {
  position: relative; width: 100%; aspect-ratio: 16 / 9; max-height: 62vh;
  border-radius: 12px; overflow: hidden;
  background: #0b1020;
  border: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-media-video { width: 100%; height: 100%; display: block; background: #0b1020; }
.dsh-media-video-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 20px; text-align: center;
  color: rgba(255,255,255,.82); font-size: 13px;
  background: rgba(8, 12, 24, .55);
}
.dsh-media-video-overlay strong { color: #fff; font-weight: 500; font-size: 14px; }
.dsh-media-video-overlay-error { color: #ffb4a8; }
.dsh-media-spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.24); border-top-color: #fff;
  animation: dsh-media-spin .8s linear infinite;
}
@keyframes dsh-media-spin { to { transform: rotate(360deg); } }
.dsh-media-toolbar-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dsh-media-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
}
.dsh-media-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-media-button:disabled { cursor: default; opacity: .5; }
.dsh-media-button-primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsh-media-button-soft { border-color: #4f8df5; background: #5b93f5; color: #fff; }
.dsh-media-button-soft:hover:not(:disabled) { background: #4a84ee; filter: none; }
.dsh-media-button-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.05); }
.dsh-media-button-danger { color: var(--dsw-alias-state-error-primary); }
.dsh-media-button-small { height: 26px; padding: 0 8px; font-size: 11px; border-radius: 6px; }
.dsh-media-button-ghost { border-color: transparent; }
.dsh-media-card {
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.dsh-media-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); }
.dsh-media-card-title { font-size: 13px; font-weight: 600; }
.dsh-media-card-body { padding: 12px 14px; display: grid; gap: 10px; }
.dsh-media-dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; font-size: 12px; }
.dsh-media-dl dt { color: var(--dsw-alias-label-secondary); }
.dsh-media-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.dsh-media-url-list { display: grid; gap: 6px; }
.dsh-media-url-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dsh-media-url-kind { flex: none; width: 52px; color: var(--dsw-alias-label-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
.dsh-media-url-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-media-tag {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 8px; border-radius: 11px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-size: 11px; white-space: nowrap;
}
.dsh-media-tag-on { color: var(--dsw-alias-state-success-primary); }
.dsh-media-tag-rec { color: var(--dsw-alias-state-error-primary); }
.dsh-media-notice {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px;
}
.dsh-media-notice-error { color: var(--dsw-alias-state-error-primary); }
.dsh-media-notice-success { color: var(--dsw-alias-state-success-primary); }
.dsh-media-replay-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.dsh-media-timeline { display: grid; gap: 6px; }
.dsh-media-timeline-track {
  position: relative; height: 36px; border-radius: 8px;
  background: #eef0f4; cursor: pointer; touch-action: none; user-select: none;
}
.dsh-media-timeline-segment { position: absolute; top: 7px; bottom: 7px; border-radius: 4px; background: #5b93f5; }
.dsh-media-timeline-head {
  position: absolute; top: 2px; bottom: 2px; width: 2px; margin-left: -1px;
  background: #1f2329; pointer-events: none;
}
.dsh-media-timeline-scale { display: flex; justify-content: space-between; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-media-timeline-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.dsh-media-timeline-controls .dsh-media-mono { margin-right: auto; }
.dsh-media-timeline-track.dsh-media-timeline-zoomed { cursor: crosshair; }
.dsh-media-input, .dsh-media-select {
  box-sizing: border-box; height: 32px; min-width: 0;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px;
}
.dsh-media-input:focus, .dsh-media-select:focus { outline: none; border-color: #5b93f5; box-shadow: 0 0 0 2px rgba(91, 147, 245, .28); }
.dsh-media-file-list { display: grid; gap: 4px; max-height: 190px; overflow: auto; }
.dsh-media-file-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 7px; cursor: pointer;
  font-size: 12px;
}
.dsh-media-file-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-media-file-row-active { background: var(--dsw-alias-bg-layer-2); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dsh-media-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-media-field { display: grid; gap: 5px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-media-field > span { color: var(--dsw-alias-label-secondary); }
.dsh-media-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dsh-media-form-section { display: grid; gap: 10px; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.dsh-media-form-section h3 { margin: 0; font-size: 13px; font-weight: 600; }
.dsh-media-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-media-switch-copy { display: grid; gap: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-media-switch-copy strong { color: var(--dsw-alias-label-primary); font-weight: 500; font-size: 13px; }
.dsh-media-switch {
  position: relative; flex: none; width: 38px; height: 22px; padding: 0;
  border: none; border-radius: 11px; background: var(--dsw-alias-border-l2); cursor: pointer;
}
.dsh-media-switch::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-bg-base); transition: transform .15s ease;
}
.dsh-media-switch-on { background: var(--dsw-alias-brand-primary); }
.dsh-media-switch-on::after { transform: translateX(16px); }
.dsh-media-overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: rgba(6, 10, 20, .48);
}
.dsh-media-dialog {
  box-sizing: border-box; width: min(460px, 100%); max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 16px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 16px 48px rgba(4, 8, 18, .32);
}
.dsh-media-dialog-wide { width: min(640px, 100%); }
.dsh-media-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 10px; }
.dsh-media-dialog-head h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.dsh-media-dialog-body { display: grid; gap: 12px; padding: 4px 18px 16px; overflow: auto; }
.dsh-media-dialog-foot { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 12px 18px 16px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.dsh-media-icon-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: 0.5px solid transparent; border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-media-icon-button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-media-settings-page { display: grid; gap: 14px; padding: 4px 2px 8px; }
.dsh-media-settings-title { display: grid; gap: 3px; }
.dsh-media-settings-title h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.dsh-media-settings-title p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-media-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-media-settings-notice { min-height: 0; }
.dsh-media-spin-icon { animation: dsh-media-spin 1s linear infinite; }
@media (max-width: 860px) {
  .dsh-media-body { flex-direction: column; overflow: auto; }
  .dsh-media-sidebar { width: 100%; border-right: none; border-bottom: 0.5px solid var(--dsw-alias-border-l1); max-height: 42vh; }
  .dsh-media-main { overflow: visible; }
  .dsh-media-video-shell { max-height: 50vh; }
  .dsh-media-field-row { grid-template-columns: 1fr; }
}
`

    function installStyle() {
      const existing = document.getElementById('dsh-media-style')
      if (existing !== null) {
        existing.textContent = CSS
        return () => {}
      }
      const element = document.createElement('style')
      element.id = 'dsh-media-style'
      element.textContent = CSS
      document.head.append(element)
      return () => { element.remove() }
    }

    /** One authenticated JSON request against this plugin's Host routes. */
    async function requestJson(method, path, body, contentType) {
      let response
      try {
        response = await fetch(`${API}/${path}`, {
          method,
          credentials: 'same-origin',
          headers: body === undefined ? undefined : { 'content-type': contentType ?? 'application/json' },
          body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        })
      } catch (_networkFailure) {
        throw new Error('network')
      }
      let data = null
      try { data = await response.json() } catch (_nonJson) { /* the status still carries the failure */ }
      if (!response.ok) {
        const error = new Error(data !== null && typeof data.message === 'string' ? data.message : 'request')
        error.code = data !== null && typeof data.error === 'string' ? data.error : 'http-error'
        error.status = response.status
        throw error
      }
      return data
    }

    /** @returns a copy of today's local date as YYYY-MM-DD. */
    function todayString() {
      const now = new Date()
      const pad = value => String(value).padStart(2, '0')
      return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    }

    /** @returns the error message to show for one failure. */
    function failureText(error, t) {
      if (error !== null && typeof error === 'object' && typeof error.message === 'string'
        && error.message !== 'network' && error.message !== 'request') return error.message
      if (error !== null && typeof error === 'object' && error.message === 'network') return t('error.request')
      return t('error.generic')
    }

    /** Copy text through the clipboard API, falling back to a hidden selection. */
    async function copyText(value) {
      try {
        await navigator.clipboard.writeText(value)
        return true
      } catch (_clipboardDenied) {
        return false
      }
    }

    const ICON_PATHS = {
      folder: 'M1.75 4.25c0-.55.45-1 1-1h3.1c.3 0 .58.13.77.36l.63.79h5c.55 0 1 .45 1 1v6.35c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1V4.25Z',
      stream: 'M2 4.25c0-.55.45-1 1-1h10c.55 0 1 .45 1 1v7.5c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1v-7.5Zm4 1.5v4.5l3.8-2.25L6 5.75Z',
      chevron: 'M6 4l4 4-4 4',
      plus: 'M8 3.25v9.5M3.25 8h9.5',
      minus: 'M3.25 8h9.5',
      refresh: 'M13.3 8a5.3 5.3 0 1 1-1.55-3.75M13.3 2.6v3h-3',
      settings: 'M8 5.4A2.6 2.6 0 1 0 8 10.6 2.6 2.6 0 0 0 8 5.4Zm5.3 2.6c0 .3-.03.58-.08.86l1.3 1.02-1.2 2.08-1.55-.62c-.45.38-.97.68-1.55.88L10 13.9H8l-.22-1.67a5.4 5.4 0 0 1-1.55-.88l-1.55.62-1.2-2.08 1.3-1.02a5.3 5.3 0 0 1 0-1.72L3.48 6.13l1.2-2.08 1.55.62c.45-.38.97-.68 1.55-.88L8 2.1h2l.22 1.67c.58.2 1.1.5 1.55.88l1.55-.62 1.2 2.08-1.3 1.02c.05.28.08.57.08.86Z',
      edit: 'M10.9 2.6l2.5 2.5-7.6 7.6-3.2.7.7-3.2 7.6-7.6Z',
      trash: 'M3.5 4.5h9M6 4.5V3.2c0-.4.32-.7.7-.7h2.6c.38 0 .7.3.7.7v1.3M4.4 4.5l.55 8.1c.03.48.43.85.9.85h4.3c.47 0 .87-.37.9-.85l.55-8.1',
      close: 'M4 4l8 8M12 4l-8 8',
      copy: 'M5.5 5.5V3.2c0-.4.32-.7.7-.7h6.6c.38 0 .7.3.7.7v6.6c0 .38-.32.7-.7.7H10.5M3.2 5.5h6.6c.38 0 .7.32.7.7v6.6c0 .38-.32.7-.7.7H3.2a.7.7 0 0 1-.7-.7V6.2c0-.38.32-.7.7-.7Z',
      play: 'M5 3.5l7 4.5-7 4.5v-9Z',
      stop: 'M4.5 4.5h7v7h-7v-7Z',
      record: 'M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z',
      camera: 'M2 5.2c0-.55.45-1 1-1h6c.55 0 1 .45 1 1v1.1l2.6-1.5c.4-.23.9.06.9.52v3.36c0 .46-.5.75-.9.52L10 7.7v1.1c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V5.2Z',
      check: 'M3.5 8.5l3 3 6-7',
    }

    function Icon({ name, size = 16, strokeWidth = 1.5, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', className,
      }, h('path', {
        d: ICON_PATHS[name] ?? ICON_PATHS.stream,
        stroke: 'currentColor',
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        fill: name === 'play' || name === 'folder' || name === 'stream' || name === 'record' || name === 'camera' || name === 'stop' ? 'none' : 'none',
      }))
    }

    function PanelIcon({ size = 16, active = false }) {
      const strokeWidth = active ? 1.6 : 1.35
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none', 'aria-hidden': 'true', focusable: 'false',
      },
      h('rect', { x: 1.5, y: 4.75, width: 9.5, height: 6.5, rx: 1.6, stroke: 'currentColor', strokeWidth }),
      h('path', { d: 'M11.3 6.2 14.2 8l-2.9 1.8V6.2Z', fill: 'currentColor' }),
      h('path', { d: 'M3.4 7.1c.9.55.9 1.25 0 1.8', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', opacity: '.6' }))
    }

    function Spinner() {
      return h('span', { className: 'dsh-media-spinner', 'aria-hidden': 'true' })
    }

    function Badge({ tone, children }) {
      const className = tone === 'online'
        ? 'dsh-media-badge dsh-media-badge-online'
        : tone === 'offline'
          ? 'dsh-media-badge dsh-media-badge-offline'
          : 'dsh-media-badge'
      return h('span', { className }, h('span', { className: 'dsh-media-badge-dot' }), children)
    }

    function buildChildren(nodes) {
      const byParent = new Map()
      for (const node of nodes) {
        const key = node.parentId === null ? '' : String(node.parentId)
        const list = byParent.get(key)
        if (list === undefined) byParent.set(key, [node])
        else list.push(node)
      }
      return byParent
    }

    function nodePath(nodes, node) {
      const parts = [node.name]
      let current = node
      let guard = 0
      while (current.parentId !== null && guard < 64) {
        const parent = nodes.find(candidate => candidate.id === current.parentId)
        if (parent === undefined) break
        parts.unshift(parent.name)
        current = parent
        guard += 1
      }
      return parts.join(' / ')
    }

    function normalizeSettings(data) {
      const settings = data !== null && typeof data === 'object' && data.settings !== null && typeof data.settings === 'object' ? data.settings : {}
      const text = (key, fallback) => settings[key] === undefined || settings[key] === null ? fallback : String(settings[key])
      return {
        zlmHost: text('zlmHost', '127.0.0.1'),
        zlmHttpPort: text('zlmHttpPort', '80'),
        zlmHttps: settings.zlmHttps === true,
        zlmSecret: '',
        rtspPort: text('rtspPort', '554'),
        rtmpPort: text('rtmpPort', '1935'),
        rtcPort: text('rtcPort', '8000'),
        recordEnabled: settings.recordEnabled === true,
        segmentSeconds: text('segmentSeconds', '60'),
        recordLocalDir: text('recordLocalDir', ''),
        recordPath: text('recordPath', './www'),
        recordApp: text('recordApp', 'record'),
      }
    }

    function portOk(value) {
      const number = Number(value)
      return Number.isInteger(number) && number >= 1 && number <= 65535
    }

    const DAY_SECONDS = 86400
    const RECORD_SLICE_SECONDS = 3600
    const MIN_TIMELINE_SPAN = 60

    /** @returns seconds from local midnight encoded in a ZLMediaKit MP4 name. */
    function fileStartSeconds(name) {
      const base = String(name).split('/').pop() ?? ''
      const match = base.match(/^\d{4}-\d{2}-\d{2}-(\d{2})-(\d{2})-(\d{2})/)
      if (match === null) return null
      const hours = Number(match[1])
      const minutes = Number(match[2])
      const seconds = Number(match[3])
      if (hours > 23 || minutes > 59 || seconds > 59) return null
      return hours * 3600 + minutes * 60 + seconds
    }

    /** @returns one day's recording spans, capped by the next file and the one-hour slice. */
    function buildSegments(files, date) {
      const parsed = files
        .map(file => ({ ...file, start: fileStartSeconds(file.name) }))
        .filter(file => file.start !== null)
        .sort((left, right) => left.start - right.start)
      const now = new Date()
      const isToday = date === todayString()
      const nowSeconds = isToday ? now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() : DAY_SECONDS
      return parsed.map((file, index) => {
        const next = parsed[index + 1]
        let end = next === undefined ? file.start + RECORD_SLICE_SECONDS : Math.min(next.start, file.start + RECORD_SLICE_SECONDS)
        if (isToday) end = Math.min(end, Math.max(file.start + 1, nowSeconds))
        if (end <= file.start) end = file.start + 1
        return { url: file.url, downloadUrl: file.downloadUrl, name: file.name, start: file.start, end }
      })
    }

    /** @returns HH:MM:SS for a second within a day. */
    function formatClock(total) {
      const value = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(total)))
      const pad = part => String(part).padStart(2, '0')
      return `${pad(Math.floor(value / 3600))}:${pad(Math.floor(value / 60) % 60)}:${pad(value % 60)}`
    }

    function identifierOk(value) {
      return value === '' || /^[A-Za-z0-9_.-]+$/.test(value)
    }

    /** @returns a stream id that satisfies the catalog identifier rules. */
    function newStreamId() {
      const raw = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
        : String(Date.now())
      return `media_${raw}`
    }

    /** One labeled control row. */
    function Field({ label, children }) {
      return h('label', { className: 'dsh-media-field' }, h('span', null, label), children)
    }

    function Switch({ checked, onChange, label, hint }) {
      return h('div', { className: 'dsh-media-switch-row' },
        h('div', { className: 'dsh-media-switch-copy' },
          h('strong', null, label),
          hint === undefined ? null : h('span', null, hint)),
        h('button', {
          type: 'button',
          className: checked ? 'dsh-media-switch dsh-media-switch-on' : 'dsh-media-switch',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          onClick: () => onChange(!checked),
        }))
    }

    /** Settings form shared by the plugin page card and the in-page dialog. */
    function SettingsForm({ t, server, onChanged, compact, onClose }) {
      const [draft, setDraft] = useState(() => normalizeSettings(null))
      const [secretSet, setSecretSet] = useState(false)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(null)
      const [notice, setNotice] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [reloadToken, setReloadToken] = useState(0)

      useEffect(() => {
        let cancelled = false
        setLoading(true)
        requestJson('GET', 'settings').then((data) => {
          if (cancelled) return
          setDraft(normalizeSettings(data))
          setSecretSet(data !== null && typeof data === 'object' && data.secretSet === true)
          setDirty(false)
          setLoading(false)
        }).catch((error) => {
          if (cancelled) return
          setNotice({ tone: 'error', text: failureText(error, t) })
          setLoading(false)
        })
        return () => { cancelled = true }
      }, [reloadToken, t])

      const set = (key, value) => {
        setDraft(current => ({ ...current, [key]: value }))
        setDirty(true)
        setNotice(null)
      }
      const invalid = draft.zlmHost.trim() === ''
        || !portOk(draft.zlmHttpPort) || !portOk(draft.rtspPort) || !portOk(draft.rtmpPort) || !portOk(draft.rtcPort)
        || draft.recordPath.trim() === ''
        || !identifierOk(draft.recordApp.trim())
        || !Number.isInteger(Number(draft.segmentSeconds)) || Number(draft.segmentSeconds) < 5 || Number(draft.segmentSeconds) > 3600
      const payload = () => {
        const body = {
          zlmHost: draft.zlmHost.trim(),
          zlmHttpPort: Number(draft.zlmHttpPort),
          zlmHttps: draft.zlmHttps,
          rtspPort: Number(draft.rtspPort),
          rtmpPort: Number(draft.rtmpPort),
          rtcPort: Number(draft.rtcPort),
          recordEnabled: draft.recordEnabled,
          segmentSeconds: Number(draft.segmentSeconds),
          recordLocalDir: draft.recordLocalDir.trim(),
          recordPath: draft.recordPath.trim(),
          recordApp: draft.recordApp.trim(),
        }
        if (draft.zlmSecret !== '') body.zlmSecret = draft.zlmSecret
        return body
      }
      const save = async () => {
        if (invalid) return false
        setBusy('save')
        setNotice(null)
        try {
          const data = await requestJson('POST', 'settings', payload())
          setDraft(normalizeSettings(data))
          setSecretSet(data !== null && typeof data === 'object' && data.secretSet === true)
          setDirty(false)
          setNotice({ tone: 'success', text: t('settings.saved') })
          if (onChanged !== undefined) onChanged()
          return true
        } catch (error) {
          setNotice({ tone: 'error', text: `${t('settings.failed')} ${failureText(error, t)}` })
          return false
        } finally {
          setBusy(null)
        }
      }
      const apply = async () => {
        setBusy('apply')
        setNotice(null)
        try {
          if (dirty || draft.zlmSecret !== '') {
            const saved = await save()
            if (!saved) return
          }
          setBusy('apply')
          const result = await requestJson('POST', 'server/apply')
          setNotice({
            tone: 'success',
            text: result !== null && result.restartRequired === true ? t('settings.appliedRestart') : t('settings.applied'),
          })
          if (onChanged !== undefined) onChanged()
        } catch (error) {
          setNotice({ tone: 'error', text: `${t('settings.applyFailed')} ${failureText(error, t)}` })
        } finally {
          setBusy(null)
        }
      }
      const restart = async () => {
        setBusy('restart')
        setNotice(null)
        try {
          await requestJson('POST', 'server/restart')
          setNotice({ tone: 'success', text: t('settings.restarted') })
          if (onChanged !== undefined) onChanged()
        } catch (error) {
          setNotice({ tone: 'error', text: `${t('settings.restartFailed')} ${failureText(error, t)}` })
        } finally {
          setBusy(null)
        }
      }
      const clearSecret = async () => {
        setBusy('secret')
        setNotice(null)
        try {
          await requestJson('POST', 'settings', { clearSecret: true })
          setSecretSet(false)
          setNotice({ tone: 'success', text: t('settings.secretCleared') })
          if (onChanged !== undefined) onChanged()
        } catch (error) {
          setNotice({ tone: 'error', text: `${t('settings.failed')} ${failureText(error, t)}` })
        } finally {
          setBusy(null)
        }
      }

      const current = server !== null && server !== undefined && server.online === true ? server : null
      const version = current !== null && current.version !== null && typeof current.version === 'object'
        ? `git ${String(current.version.commitHash ?? '').slice(0, 8)} · ${String(current.version.buildTime ?? '').slice(0, 19).replace('T', ' ')}`
        : ''

      return h('div', { className: 'dsh-media-settings-page' },
        compact ? null : h('div', { className: 'dsh-media-settings-title' },
          h('h2', null, t('settings.title')),
          h('p', null, t('settings.subtitle'))),
        h('div', { className: 'dsh-media-form-section' },
          h('h3', null, t('settings.connection')),
          h('div', { className: 'dsh-media-field-row' },
            h(Field, { label: t('settings.host') },
              h('input', {
                className: 'dsh-media-input',
                value: draft.zlmHost,
                placeholder: '127.0.0.1',
                onChange: event => set('zlmHost', event.target.value),
              })),
            h(Field, { label: t('settings.httpPort') },
              h('input', {
                className: 'dsh-media-input',
                inputMode: 'numeric',
                value: draft.zlmHttpPort,
                onChange: event => set('zlmHttpPort', event.target.value),
              }))),
          h('div', { className: 'dsh-media-field-row' },
            h(Field, { label: t('settings.secret') },
              h('input', {
                className: 'dsh-media-input',
                type: 'password',
                autoComplete: 'new-password',
                value: draft.zlmSecret,
                placeholder: secretSet ? t('settings.secretKept') : t('settings.secretRequired'),
                onChange: event => set('zlmSecret', event.target.value),
              })),
            h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '8px', flexWrap: 'wrap' } },
              h(Switch, {
                checked: draft.zlmHttps,
                onChange: value => set('zlmHttps', value),
                label: t('settings.https'),
              }),
              secretSet
                ? h('button', {
                  type: 'button',
                  className: 'dsh-media-button dsh-media-button-small dsh-media-button-ghost',
                  disabled: busy !== null,
                  onClick: () => { void clearSecret() },
                }, t('settings.clearSecret'))
                : null))),
        h('div', { className: 'dsh-media-form-section' },
          h('h3', null, t('settings.ports')),
          h('div', { className: 'dsh-media-field-row' },
            h(Field, { label: t('settings.rtspPort') },
              h('input', {
                className: 'dsh-media-input', inputMode: 'numeric', value: draft.rtspPort,
                onChange: event => set('rtspPort', event.target.value),
              })),
            h(Field, { label: t('settings.rtmpPort') },
              h('input', {
                className: 'dsh-media-input', inputMode: 'numeric', value: draft.rtmpPort,
                onChange: event => set('rtmpPort', event.target.value),
              }))),
          h(Field, { label: t('settings.rtcPort') },
            h('input', {
              className: 'dsh-media-input', inputMode: 'numeric', value: draft.rtcPort,
              onChange: event => set('rtcPort', event.target.value),
            }))),
        h('div', { className: 'dsh-media-form-section' },
          h('h3', null, t('settings.storage')),
          h(Switch, {
            checked: draft.recordEnabled,
            onChange: value => set('recordEnabled', value),
            label: t('settings.recordEnabled'),
            hint: t('settings.recordEnabledHint'),
          }),
          h('div', { className: 'dsh-media-field-row' },
            h(Field, { label: t('settings.segmentSeconds') },
              h('input', {
                className: 'dsh-media-input', inputMode: 'numeric', value: draft.segmentSeconds,
                onChange: event => set('segmentSeconds', event.target.value),
              })),
            h(Field, { label: t('settings.recordLocalDir') },
              h('input', {
                className: 'dsh-media-input', value: draft.recordLocalDir,
                placeholder: t('settings.recordLocalDirHint'),
                onChange: event => set('recordLocalDir', event.target.value),
              }))),
          h('div', { className: 'dsh-media-field-row' },
            h(Field, { label: t('settings.recordPath') },
              h('input', {
                className: 'dsh-media-input', value: draft.recordPath,
                onChange: event => set('recordPath', event.target.value),
              })),
            h(Field, { label: t('settings.recordApp') },
              h('input', {
                className: 'dsh-media-input', value: draft.recordApp,
                onChange: event => set('recordApp', event.target.value),
              })))),
        dirty ? h('div', { className: 'dsh-media-notice' }, t('settings.restartHint')) : null,
        notice === null ? null : h('div', {
          className: notice.tone === 'error'
            ? 'dsh-media-notice dsh-media-notice-error'
            : notice.tone === 'success'
              ? 'dsh-media-notice dsh-media-notice-success'
              : 'dsh-media-notice',
          role: 'status',
        }, notice.text),
        h('div', { className: 'dsh-media-settings-actions' },
          h('button', {
            type: 'button', className: 'dsh-media-button dsh-media-button-primary',
            disabled: busy !== null || invalid || loading,
            onClick: () => { void save() },
          }, busy === 'save' ? t('action.saving') : t('action.save')),
          h('button', {
            type: 'button', className: 'dsh-media-button',
            disabled: busy !== null || invalid || loading,
            onClick: () => { void apply() },
          }, busy === 'apply' ? t('action.applying') : t('action.apply')),
          h('button', {
            type: 'button', className: 'dsh-media-button',
            disabled: busy !== null || loading,
            onClick: () => { void restart() },
          }, busy === 'restart'
            ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, h(Spinner), t('action.restarting'))
            : t('action.restart'))),
        h('div', { className: 'dsh-media-card' },
          h('div', { className: 'dsh-media-card-head' },
            h('span', { className: 'dsh-media-card-title' }, t('settings.current')),
            current === null
              ? h(Badge, { tone: 'offline' }, t('settings.offline'))
              : h(Badge, { tone: 'online' }, t('settings.online'))),
          h('div', { className: 'dsh-media-card-body' },
            current === null
              ? h('div', { className: 'dsh-media-tree-hint' }, server !== null && server !== undefined && typeof server.error === 'string' ? server.error : t('settings.currentHint'))
              : h(React.Fragment, null,
                h('div', { className: 'dsh-media-dl' },
                  h('dt', null, t('settings.version')), h('dd', null, version === '' ? '—' : version),
                  h('dt', null, t('settings.httpPort')), h('dd', null, String(current.config?.httpPort ?? '—')),
                  h('dt', null, t('settings.rtspPort')), h('dd', null, String(current.config?.rtspPort ?? '—')),
                  h('dt', null, t('settings.rtmpPort')), h('dd', null, String(current.config?.rtmpPort ?? '—')),
                  h('dt', null, t('settings.rtcPort')), h('dd', null, String(current.config?.rtcPort ?? '—')),
                  h('dt', null, t('settings.recordEnabled')), h('dd', null, current.config?.recordEnabled === true ? t('settings.recordOn') : t('settings.recordOff')),
                  h('dt', null, t('settings.recordPath')), h('dd', null, String(current.config?.recordPath ?? '—')),
                  h('dt', null, t('settings.storageMode')), h('dd', null, String(current.config?.storage ?? '—') === 'minio' ? t('settings.storageMinio') : t('settings.storageLocal')))))),
        onClose === undefined ? null : h('div', { className: 'dsh-media-dialog-foot' },
          h('button', { type: 'button', className: 'dsh-media-button', onClick: onClose }, t('action.close'))))
    }

    /** Modal wrapper used by the page. */
    function SettingsDialog({ t, server, onChanged, onClose }) {
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      return h('div', {
        className: 'dsh-media-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
      },
      h('div', {
        className: 'dsh-media-dialog dsh-media-dialog-wide',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('settings.title'),
      },
      h('div', { className: 'dsh-media-dialog-head' },
        h('h2', null, t('settings.title')),
        h('button', { type: 'button', className: 'dsh-media-icon-button', onClick: onClose, 'aria-label': t('action.close') },
          h(Icon, { name: 'close' }))),
      h('div', { className: 'dsh-media-dialog-body' },
        h(SettingsForm, { t, server, onChanged, compact: true })),
      h('div', { className: 'dsh-media-dialog-foot' },
        h('button', { type: 'button', className: 'dsh-media-button', onClick: onClose }, t('action.close')))))
    }

    /** One node editor for folders and streams. */
    function NodeDialog({ t, mode, nodes, target, parentId, onClose, onSaved }) {
      const isFolder = mode === 'folder' || (mode === 'edit' && target !== undefined && target.kind === 'folder')
      const [draft, setDraft] = useState(() => ({
        name: target !== undefined && target !== null ? target.name : '',
        app: target !== undefined && target !== null && target.kind === 'stream' ? target.app : 'live',
        stream: target !== undefined && target !== null && target.kind === 'stream' ? target.stream : (mode === 'stream' ? newStreamId() : ''),
        sourceUrl: target !== undefined && target !== null && target.kind === 'stream' ? target.sourceUrl : '',
        description: target !== undefined && target !== null ? target.description : '',
        parentId: parentId ?? null,
      }))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const nameRef = useRef(null)
      useEffect(() => { if (nameRef.current !== null) nameRef.current.focus() }, [])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [busy, onClose])
      const set = (key, value) => {
        setDraft(current => ({ ...current, [key]: value }))
        setError(null)
      }
      const invalid = draft.name.trim() === ''
        || (!isFolder && (!identifierOk(draft.app.trim()) || !identifierOk(draft.stream.trim())))
      const submit = async (event) => {
        event.preventDefault()
        if (busy || invalid) return
        setBusy(true)
        setError(null)
        try {
          if (mode === 'edit') {
            const patch = isFolder
              ? { name: draft.name.trim(), description: draft.description.trim() }
              : {
                name: draft.name.trim(),
                description: draft.description.trim(),
                app: draft.app.trim() === '' ? 'live' : draft.app.trim(),
                stream: draft.stream.trim(),
                sourceUrl: draft.sourceUrl.trim(),
              }
            await requestJson('POST', 'nodes', { action: 'update', id: target.id, patch })
          } else if (isFolder) {
            await requestJson('POST', 'nodes', { action: 'createFolder', parentId: draft.parentId, name: draft.name.trim() })
          } else {
            await requestJson('POST', 'nodes', {
              action: 'createStream',
              parentId: draft.parentId,
              name: draft.name.trim(),
              app: draft.app.trim() === '' ? 'live' : draft.app.trim(),
              stream: draft.stream.trim(),
              sourceUrl: draft.sourceUrl.trim(),
              description: draft.description.trim(),
            })
          }
          onSaved()
        } catch (failure) {
          setError(failureText(failure, t))
          setBusy(false)
        }
      }
      const folders = nodes.filter(node => node.kind === 'folder' && (mode !== 'edit' || node.id !== target.id))
      const title = mode === 'edit' ? t('dialog.editTitle') : isFolder ? t('dialog.folderTitle') : t('dialog.streamTitle')
      return h('div', {
        className: 'dsh-media-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onClose() },
      },
      h('form', {
        className: 'dsh-media-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        onSubmit: submit,
      },
      h('div', { className: 'dsh-media-dialog-head' },
        h('h2', null, title),
        h('button', { type: 'button', className: 'dsh-media-icon-button', onClick: onClose, 'aria-label': t('action.close') }, h(Icon, { name: 'close' }))),
      h('div', { className: 'dsh-media-dialog-body' },
        h(Field, { label: t('dialog.name') },
          h('input', {
            ref: nameRef,
            className: 'dsh-media-input',
            value: draft.name,
            maxLength: 120,
            placeholder: t('dialog.namePlaceholder'),
            onChange: event => set('name', event.target.value),
          })),
        mode === 'edit' ? null : h(Field, { label: t('dialog.parent') },
          h('select', {
            className: 'dsh-media-select',
            value: draft.parentId ?? '',
            onChange: event => set('parentId', event.target.value === '' ? null : event.target.value),
          },
          h('option', { value: '' }, t('tree.root')),
          folders.map(folder => h('option', { key: folder.id, value: folder.id }, nodePath(nodes, folder))))),
        isFolder ? null : h(React.Fragment, null,
          h('div', { className: 'dsh-media-field-row' },
            h(Field, { label: t('node.app') },
              h('input', {
                className: 'dsh-media-input',
                value: draft.app,
                placeholder: t('dialog.appPlaceholder'),
                maxLength: 64,
                onChange: event => set('app', event.target.value),
              })),
            h(Field, { label: t('node.stream') },
              h('input', {
                className: 'dsh-media-input',
                value: draft.stream,
                placeholder: t('dialog.streamPlaceholder'),
                maxLength: 128,
                onChange: event => set('stream', event.target.value),
              }))),
          h(Field, { label: t('live.source') },
            h('input', {
              className: 'dsh-media-input',
              value: draft.sourceUrl,
              placeholder: t('dialog.sourcePlaceholder'),
              onChange: event => set('sourceUrl', event.target.value),
            }))),
        h(Field, { label: t('node.description') },
          h('textarea', {
            className: 'dsh-media-input',
            style: { height: '64px', paddingTop: '7px', paddingBottom: '7px', resize: 'vertical' },
            value: draft.description,
            maxLength: 4000,
            placeholder: t('dialog.descriptionPlaceholder'),
            onChange: event => set('description', event.target.value),
          })),
        error === null ? null : h('div', { className: 'dsh-media-notice dsh-media-notice-error', role: 'alert' }, error)),
      h('div', { className: 'dsh-media-dialog-foot' },
        h('button', { type: 'button', className: 'dsh-media-button', disabled: busy, onClick: onClose }, t('action.cancel')),
        h('button', {
          type: 'submit',
          className: mode !== 'edit'
            ? 'dsh-media-button dsh-media-button-soft'
            : 'dsh-media-button dsh-media-button-primary',
          disabled: busy || invalid,
        }, busy ? t('dialog.saving') : t('dialog.save')))))
    }

    function ConfirmDialog({ t, title, body, busy, error, onCancel, onConfirm }) {
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [busy, onCancel])
      return h('div', {
        className: 'dsh-media-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onCancel() },
      },
      h('div', { className: 'dsh-media-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { className: 'dsh-media-dialog-head' }, h('h2', null, title)),
        h('div', { className: 'dsh-media-dialog-body' },
          h('p', { style: { margin: 0, fontSize: '13px' } }, body),
          error === null ? null : h('div', { className: 'dsh-media-notice dsh-media-notice-error', role: 'alert' }, error)),
        h('div', { className: 'dsh-media-dialog-foot' },
          h('button', { type: 'button', className: 'dsh-media-button', disabled: busy, onClick: onCancel }, t('action.cancel')),
          h('button', { type: 'button', className: 'dsh-media-button dsh-media-button-danger', disabled: busy, onClick: onConfirm },
            h(Icon, { name: 'trash' }), t('action.delete')))))
    }

    /** Copy control for one playback address. */
    function CopyableUrl({ t, label, value }) {
      const [copied, setCopied] = useState(false)
      return h('div', { className: 'dsh-media-url-row' },
        h('span', { className: 'dsh-media-url-kind' }, label),
        h('code', { className: 'dsh-media-mono dsh-media-url-value', title: value }, value),
        h('button', {
          type: 'button',
          className: 'dsh-media-button dsh-media-button-small dsh-media-button-ghost',
          onClick: () => {
            void copyText(value).then((ok) => {
              if (!ok) return
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            })
          },
        }, h(Icon, { name: copied ? 'check' : 'copy', size: 13 }), copied ? t('action.copied') : t('action.copy')))
    }

    /** Live tab: WebRTC player plus recording controls and addresses. */
    function LivePane({ t, node, server, onOpenSettings }) {
      const videoRef = useRef(null)
      const pcRef = useRef(null)
      const streamRef = useRef(null)
      const [prepare, setPrepare] = useState(null)
      const [phase, setPhase] = useState('idle')
      const [error, setError] = useState(null)
      const [status, setStatus] = useState(null)
      const [reloadToken, setReloadToken] = useState(0)
      const nodeId = node.id

      const stopPlayback = useCallback(() => {
        if (pcRef.current !== null) {
          try { pcRef.current.close() } catch (_alreadyClosed) { /* closing twice is harmless */ }
          pcRef.current = null
        }
        if (videoRef.current !== null) {
          try { videoRef.current.srcObject = null } catch (_noStream) { /* element already detached */ }
        }
        if (streamRef.current !== null) {
          for (const track of streamRef.current.getTracks()) track.stop()
          streamRef.current = null
        }
        setPhase('idle')
      }, [])

      const refreshStatus = useCallback(async () => {
        try {
          const data = await requestJson('GET', `status?app=${encodeURIComponent(node.app)}&stream=${encodeURIComponent(node.stream)}`)
          setStatus(data)
          return data
        } catch (_statusFailure) {
          setStatus(null)
          return null
        }
      }, [node.app, node.stream])

      const startPlayback = useCallback(async () => {
        stopPlayback()
        setError(null)
        setPhase('preparing')
        let prepared
        try {
          prepared = await requestJson('POST', 'prepare', { id: nodeId })
          setPrepare(prepared)
          setStatus(prepared.status ?? null)
        } catch (failure) {
          setPhase('error')
          setError(failureText(failure, t))
          return
        }
        if (prepared.status === null || prepared.status === undefined || prepared.status.online !== true) {
          setPhase('offline')
          return
        }
        setPhase('connecting')
        try {
          const PC = window.RTCPeerConnection
          if (typeof PC !== 'function') throw new Error('WebRTC is not available in this browser')
          const pc = new PC({ iceServers: [] })
          pcRef.current = pc
          const remote = new MediaStream()
          streamRef.current = remote
          pc.ontrack = (event) => {
            setPhase(current => current === 'connecting' ? 'playing' : current)
            if (event.streams !== undefined && event.streams.length > 0) {
              if (videoRef.current !== null) {
                videoRef.current.srcObject = event.streams[0]
                void videoRef.current.play().catch(() => {})
              }
              return
            }
            remote.addTrack(event.track)
            if (videoRef.current !== null) videoRef.current.srcObject = remote
            if (videoRef.current !== null) void videoRef.current.play().catch(() => {})
          }
          pc.onconnectionstatechange = () => {
            if (pc !== pcRef.current) return
            if (pc.connectionState === 'connected') setPhase('playing')
            if (pc.connectionState === 'failed') {
              setPhase('error')
              setError(t('live.error'))
            }
          }
          pc.addTransceiver('video', { direction: 'recvonly' })
          pc.addTransceiver('audio', { direction: 'recvonly' })
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          let response
          try {
            response = await fetch(`${API}/webrtc?app=${encodeURIComponent(node.app)}&stream=${encodeURIComponent(node.stream)}`, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'text/plain;charset=utf-8' },
              body: offer.sdp,
            })
          } catch (_networkFailure) {
            throw new Error('network')
          }
          let answer = null
          try { answer = await response.json() } catch (_nonJson) { /* handled below */ }
          if (!response.ok) {
            throw new Error(answer !== null && typeof answer.message === 'string' ? answer.message : t('live.error'))
          }
          if (answer === null || typeof answer !== 'object' || typeof answer.sdp !== 'string') {
            throw new Error(answer !== null && typeof answer.msg === 'string' ? answer.msg : t('live.error'))
          }
          if (answer.code !== undefined && answer.code !== 0) {
            throw new Error(typeof answer.msg === 'string' ? answer.msg : t('live.error'))
          }
          await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
        } catch (failure) {
          setPhase('error')
          setError(failureText(failure, t))
        }
      }, [node.app, node.stream, nodeId, stopPlayback, t])

      useEffect(() => {
        setPrepare(null)
        setStatus(null)
        setError(null)
        setPhase('idle')
        void refreshStatus()
        void startPlayback()
        return () => { stopPlayback() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [nodeId, reloadToken])

      useEffect(() => {
        const timer = window.setInterval(() => { void refreshStatus() }, 6000)
        return () => window.clearInterval(timer)
      }, [refreshStatus])

      const play = prepare !== null && prepare !== undefined && prepare.play !== undefined ? prepare.play : null
      const online = status !== null && status.online === true
      const overlay = phase === 'preparing' || phase === 'connecting'
        ? h('div', { className: 'dsh-media-video-overlay' },
          h(Spinner),
          h('strong', null, phase === 'preparing' ? t('live.pulling') : t('live.connecting')))
        : phase === 'offline'
          ? h('div', { className: 'dsh-media-video-overlay' },
            h('strong', null, t('live.offline')),
            h('span', null, t('live.offlineHint')),
            h('button', { type: 'button', className: 'dsh-media-button dsh-media-button-small', onClick: () => setReloadToken(value => value + 1) },
              h(Icon, { name: 'refresh', size: 13 }), t('action.retry')))
          : phase === 'error'
            ? h('div', { className: 'dsh-media-video-overlay dsh-media-video-overlay-error' },
              h('strong', null, t('live.error')),
              h('span', null, error ?? ''),
              h('button', { type: 'button', className: 'dsh-media-button dsh-media-button-small', onClick: () => setReloadToken(value => value + 1) },
                h(Icon, { name: 'refresh', size: 13 }), t('action.retry')))
            : phase === 'idle' && online
              ? h('div', { className: 'dsh-media-video-overlay' },
                h('button', { type: 'button', className: 'dsh-media-button dsh-media-button-primary', onClick: () => { void startPlayback() } },
                  h(Icon, { name: 'play', size: 14 }), t('action.play')))
              : null

      return h('div', { className: 'dsh-media-player' },
        h('div', { className: 'dsh-media-video-shell' },
          h('video', {
            ref: videoRef,
            className: 'dsh-media-video',
            controls: true,
            autoPlay: true,
            muted: true,
            playsInline: true,
          }),
          overlay),
        h('div', { className: 'dsh-media-toolbar-row' },
          h('button', {
            type: 'button', className: 'dsh-media-button',
            disabled: phase === 'preparing' || phase === 'connecting',
            onClick: () => setReloadToken(value => value + 1),
          }, h(Icon, { name: 'refresh', size: 13 }), t('action.reconnect')),
          h('button', {
            type: 'button',
            className: 'dsh-media-button',
            disabled: phase === 'idle' && !online,
            onClick: () => { stopPlayback(); setPhase('idle') },
          }, h(Icon, { name: 'stop', size: 13 }), t('action.stop')),
          h('span', { className: 'dsh-media-tag' },
            h(Icon, { name: 'camera', size: 13 }), online ? t('live.playing') : t('live.offline')),
          status !== null && status.recording === true
            ? h('span', { className: 'dsh-media-tag dsh-media-tag-rec' }, h(Icon, { name: 'record', size: 12 }), t('live.recording'))
            : h('span', { className: 'dsh-media-tag' }, t('live.notRecording'))),
        error !== null && phase !== 'error' ? h('div', { className: 'dsh-media-notice dsh-media-notice-error', role: 'alert' }, error) : null,
        h('div', { className: 'dsh-media-card' },
          h('div', { className: 'dsh-media-card-head' },
            h('span', { className: 'dsh-media-card-title' }, t('live.info')),
            status !== null && status.video !== null && status.video !== undefined
              ? h('span', { className: 'dsh-media-mono' }, `${String(status.video.width ?? '?')}×${String(status.video.height ?? '?')} · ${String(status.video.codec ?? '')}`)
              : null),
          h('div', { className: 'dsh-media-card-body' },
            h('div', { className: 'dsh-media-dl' },
              h('dt', null, t('live.source')),
              h('dd', null, node.sourceUrl === '' ? t('live.sourcePush') : node.sourceUrl)),
            play === null
              ? h('div', { className: 'dsh-media-tree-hint' }, t('live.webrtcHint'))
              : h('div', { className: 'dsh-media-url-list' },
                h(CopyableUrl, { t, label: 'WebRTC', value: play.webrtc }),
                h(CopyableUrl, { t, label: 'HLS', value: play.hls }),
                h(CopyableUrl, { t, label: 'FLV', value: play.flv }),
                h(CopyableUrl, { t, label: 'RTSP', value: play.rtsp }),
                h(CopyableUrl, { t, label: 'RTMP', value: play.rtmp })))))
    }

    /** Replay tab: one day's recordings on a scrubbable timeline. */
    function ReplayPane({ t, node }) {
      const [date, setDate] = useState(() => todayString())
      const [files, setFiles] = useState([])
      const [clip, setClip] = useState(null)
      const [playhead, setPlayhead] = useState(null)
      const [gap, setGap] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)
      const [reloadToken, setReloadToken] = useState(0)
      const [span, setSpan] = useState(DAY_SECONDS)
      const [viewStart, setViewStart] = useState(0)
      const trackRef = useRef(null)
      const videoRef = useRef(null)
      const dragRef = useRef(false)
      const spanRef = useRef(DAY_SECONDS)
      const viewStartRef = useRef(0)

      useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        setClip(null)
        setPlayhead(null)
        setGap(null)
        requestJson('POST', 'recordings/sync', { nodeId: node.id, day: date })
          .then((data) => {
            if (cancelled) return
            const items = Array.isArray(data.recordings) ? data.recordings : []
            setFiles(items.map(item => ({
              name: item.fileName,
              url: item.playUrl,
              downloadUrl: item.downloadUrl,
              storage: item.storage,
              sizeBytes: item.sizeBytes,
            })))
            setLoading(false)
          })
          .catch((failure) => {
            if (cancelled) return
            setFiles([])
            setError(failureText(failure, t))
            setLoading(false)
          })
        return () => { cancelled = true }
      }, [date, node.app, node.stream, reloadToken, t])

      const segments = useMemo(() => buildSegments(files, date), [files, date])

      /** Clamp a window start so the visible window stays inside the day. */
      const clampView = (start, size) => Math.max(0, Math.min(start, DAY_SECONDS - size))

      /** Replace the visible window and keep the refs used by native listeners in sync. */
      const applyView = (nextSpan, nextStart) => {
        const clampedSpan = Math.min(DAY_SECONDS, Math.max(MIN_TIMELINE_SPAN, nextSpan))
        const clampedStart = clampView(nextStart, clampedSpan)
        spanRef.current = clampedSpan
        viewStartRef.current = clampedStart
        setSpan(clampedSpan)
        setViewStart(clampedStart)
      }

      /** Zoom around a 0-1 position inside the visible window. */
      const zoomAt = (factor, ratio) => {
        const currentSpan = spanRef.current
        const nextSpan = Math.min(DAY_SECONDS, Math.max(MIN_TIMELINE_SPAN, currentSpan * factor))
        if (nextSpan === currentSpan) return
        const anchor = viewStartRef.current + ratio * currentSpan
        applyView(nextSpan, anchor - ratio * nextSpan)
      }

      /** Move the visible window by a fraction of its width. */
      const panBy = (fraction) => {
        applyView(spanRef.current, viewStartRef.current + spanRef.current * fraction)
      }

      useEffect(() => {
        applyView(DAY_SECONDS, 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [date, node.id])

      useEffect(() => {
        const track = trackRef.current
        if (track === null) return
        const onWheel = (event) => {
          const rect = track.getBoundingClientRect()
          if (rect.width <= 0) return
          event.preventDefault()
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
          zoomAt(event.deltaY < 0 ? 0.5 : 2, ratio)
        }
        track.addEventListener('wheel', onWheel, { passive: false })
        return () => track.removeEventListener('wheel', onWheel)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const seekTo = (second) => {
        const segment = segments.find(item => second >= item.start && second < item.end)
        if (segment === undefined) {
          setGap(second)
          return
        }
        setGap(null)
        setPlayhead(second)
        setClip(current => {
          if (current !== null && current.url === segment.url) {
            if (videoRef.current !== null) videoRef.current.currentTime = second - segment.start
            return { ...current, offset: second - segment.start }
          }
          return { url: segment.url, downloadUrl: segment.downloadUrl, start: segment.start, offset: second - segment.start }
        })
      }

      const seekFromPointer = (event) => {
        const track = trackRef.current
        if (track === null) return
        const rect = track.getBoundingClientRect()
        if (rect.width <= 0) return
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
        seekTo(viewStartRef.current + ratio * spanRef.current)
      }

      useEffect(() => {
        const endDrag = () => { dragRef.current = false }
        const move = (event) => { if (dragRef.current) seekFromPointer(event) }
        window.addEventListener('pointerup', endDrag)
        window.addEventListener('pointermove', move)
        return () => {
          window.removeEventListener('pointerup', endDrag)
          window.removeEventListener('pointermove', move)
        }
      })

      const video = h('div', { className: 'dsh-media-video-shell' },
        clip === null
          ? null
          : h('video', {
            ref: videoRef,
            key: clip.url,
            className: 'dsh-media-video',
            src: clip.url,
            controls: true,
            autoPlay: true,
            playsInline: true,
            onLoadedMetadata: (event) => { event.currentTarget.currentTime = clip.offset },
            onTimeUpdate: (event) => {
              const second = clip.start + event.currentTarget.currentTime
              setPlayhead(second)
              const visibleSpan = spanRef.current
              const visibleStart = viewStartRef.current
              if (second < visibleStart || second > visibleStart + visibleSpan) {
                applyView(visibleSpan, second - visibleSpan / 2)
              }
            },
            onEnded: () => {
              const index = segments.findIndex(item => item.url === clip.url)
              const next = index < 0 ? undefined : segments[index + 1]
              if (next === undefined) return
              setPlayhead(next.start)
              setClip({ url: next.url, start: next.start, offset: 0 })
            },
          }),
        clip !== null ? null : h('div', { className: 'dsh-media-video-overlay' },
          h(Icon, { name: 'camera', size: 22 }),
          h('span', null, loading ? t('replay.loading') : t('replay.selectHint'))))

      const rangeEnd = Math.min(DAY_SECONDS, viewStart + span)
      const marks = Array.from({ length: 5 }, (_, index) => viewStart + (span * index) / 4)
      const formatMark = (second) => span < 600 ? formatClock(second) : formatClock(second).slice(0, 5)
      const visibleSegments = segments.filter(segment => segment.end > viewStart && segment.start < rangeEnd)
      const headLeft = playhead === null || playhead < viewStart || playhead > rangeEnd
        ? null
        : `${String(((playhead - viewStart) / span) * 100)}%`
      const timeline = h('div', { className: 'dsh-media-timeline' },
        h('div', {
          ref: trackRef,
          className: span < DAY_SECONDS ? 'dsh-media-timeline-track dsh-media-timeline-zoomed' : 'dsh-media-timeline-track',
          title: t('replay.zoomIn'),
          onPointerDown: (event) => {
            dragRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
            seekFromPointer(event)
          },
        },
        visibleSegments.map(segment => h('span', {
          key: segment.url,
          className: 'dsh-media-timeline-segment',
          style: {
            left: `${String(Math.max(0, ((segment.start - viewStart) / span) * 100))}%`,
            width: `${String(Math.min(100, ((Math.min(segment.end, rangeEnd) - Math.max(segment.start, viewStart)) / span) * 100))}%`,
          },
        })),
        headLeft === null ? null : h('span', { className: 'dsh-media-timeline-head', style: { left: headLeft } })),
        h('div', { className: 'dsh-media-timeline-scale' }, marks.map(mark => h('span', { key: String(mark) }, formatMark(mark)))),
        h('div', { className: 'dsh-media-timeline-controls' },
          h('span', { className: 'dsh-media-mono' }, `${formatClock(viewStart)} – ${formatClock(rangeEnd)}`),
          h('button', {
            type: 'button', className: 'dsh-media-button dsh-media-button-small',
            disabled: span >= DAY_SECONDS, onClick: () => zoomAt(2, 0.5),
          }, h(Icon, { name: 'minus', size: 12 }), t('replay.zoomOut')),
          h('button', {
            type: 'button', className: 'dsh-media-button dsh-media-button-small',
            disabled: span <= MIN_TIMELINE_SPAN, onClick: () => zoomAt(0.5, 0.5),
          }, h(Icon, { name: 'plus', size: 12 }), t('replay.zoomIn')),
          h('button', {
            type: 'button', className: 'dsh-media-button dsh-media-button-small',
            disabled: span >= DAY_SECONDS && viewStart === 0, onClick: () => applyView(DAY_SECONDS, 0),
          }, t('replay.fit')),
          h('button', { type: 'button', className: 'dsh-media-button dsh-media-button-small', disabled: viewStart === 0, onClick: () => panBy(-0.5) },
            h(Icon, { name: 'chevron', size: 12, className: 'dsh-media-chevron-closed' })),
          h('button', { type: 'button', className: 'dsh-media-button dsh-media-button-small', disabled: rangeEnd >= DAY_SECONDS, onClick: () => panBy(0.5) },
            h(Icon, { name: 'chevron', size: 12 }))),
        h('div', { className: 'dsh-media-replay-bar' },
          h('span', { className: 'dsh-media-mono' }, playhead === null ? date : `${date} ${formatClock(playhead)}`),
          gap === null ? null : h('span', { className: 'dsh-media-mono' }, `${formatClock(gap)} · ${t('replay.gap')}`),
          clip === null || clip.downloadUrl === undefined
            ? null
            : h('a', {
              className: 'dsh-media-button dsh-media-button-small',
              href: clip.downloadUrl,
              download: '',
              style: { textDecoration: 'none' },
            }, h(Icon, { name: 'copy', size: 12 }), t('replay.download'))))

      const replayBar = h('div', { className: 'dsh-media-replay-bar' },
        h('label', { className: 'dsh-media-field', style: { gridAutoFlow: 'column', alignItems: 'center', gap: '8px' } },
          h('span', null, t('replay.date')),
          h('input', {
            className: 'dsh-media-input', type: 'date', value: date,
            onChange: event => setDate(event.target.value === '' ? todayString() : event.target.value),
          })),
        h('button', { type: 'button', className: 'dsh-media-button', onClick: () => setReloadToken(value => value + 1) },
          h(Icon, { name: 'refresh', size: 13 }), t('replay.refresh')))

      const notice = error !== null
        ? h('div', { className: 'dsh-media-notice dsh-media-notice-error', role: 'alert' }, `${t('replay.failed')} ${error}`)
        : !loading && files.length === 0
          ? h('div', { className: 'dsh-media-tree-hint' }, t('replay.empty'))
          : null

      return h('div', { className: 'dsh-media-player' }, video, replayBar, notice, timeline)
    }

    /** Folder summary with direct children. */
    function FolderPane({ t, node, nodes, onSelect, onAddStream, onAddFolder }) {
      const children = nodes.filter(candidate => candidate.parentId === node.id)
      return h('div', { className: 'dsh-media-player' },
        h('div', { className: 'dsh-media-player-head' },
          h('div', { className: 'dsh-media-player-title' },
            h('h2', null, node.name),
            h('span', { className: 'dsh-media-mono' }, nodePath(nodes, node))),
          h('div', { className: 'dsh-media-toolbar-row' },
            h('button', { type: 'button', className: 'dsh-media-button', onClick: () => onAddStream(node.id) },
              h(Icon, { name: 'plus', size: 13 }), t('folder.addStream')),
            h('button', { type: 'button', className: 'dsh-media-button', onClick: () => onAddFolder(node.id) },
              h(Icon, { name: 'folder', size: 13 }), t('folder.newSubfolder')))),
        h('div', { className: 'dsh-media-card' },
          h('div', { className: 'dsh-media-card-head' },
            h('span', { className: 'dsh-media-card-title' }, t('player.folderTitle')),
            h('span', { className: 'dsh-media-mono' }, t('player.folderChildren', { count: String(children.length) }))),
          h('div', { className: 'dsh-media-card-body' },
            children.length === 0
              ? h('div', { className: 'dsh-media-tree-hint' }, t('player.folderEmpty'))
              : h('div', { className: 'dsh-media-file-list' },
                children.map(child => h('div', {
                  key: child.id,
                  className: 'dsh-media-file-row',
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => onSelect(child.id),
                  onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(child.id) } },
                },
                h(Icon, { name: child.kind === 'folder' ? 'folder' : 'stream', size: 13 }),
                h('span', { className: 'dsh-media-file-name' }, child.name),
                child.kind === 'stream'
                  ? h('span', { className: 'dsh-media-mono' }, `${child.app}/${child.stream}`)
                  : h('span', { className: 'dsh-media-mono' }, t('player.folderTitle'))))))))
    }

    /** The page's central panel. */
    function MediaPage({ t }) {
      const [nodes, setNodes] = useState([])
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [selectedId, setSelectedId] = useState(() => readPlaybackMemory().selectedId)
      const [streamTabs, setStreamTabs] = useState(() => readPlaybackMemory().tabs)
      const [expanded, setExpanded] = useState(null)
      const [server, setServer] = useState(null)
      const [dialog, setDialog] = useState(null)
      const [deleting, setDeleting] = useState(null)
      const [deleteBusy, setDeleteBusy] = useState(false)
      const [deleteError, setDeleteError] = useState(null)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [notice, setNotice] = useState(null)

      const loadTree = useCallback(async () => {
        try {
          const data = await requestJson('GET', 'tree')
          setNodes(Array.isArray(data.nodes) ? data.nodes : [])
          setError(null)
        } catch (failure) {
          setError(failureText(failure, t))
        } finally {
          setLoading(false)
        }
      }, [t])

      const loadServer = useCallback(async () => {
        try {
          const data = await requestJson('GET', 'server')
          setServer(data)
        } catch (_serverFailure) {
          setServer({ online: false })
        }
      }, [])

      useEffect(() => {
        void loadTree()
        void loadServer()
        const timer = window.setInterval(() => { void loadServer() }, 15000)
        return () => window.clearInterval(timer)
      }, [loadTree, loadServer])

      const byParent = useMemo(() => buildChildren(nodes), [nodes])
      useEffect(() => {
        try {
          window.localStorage.setItem(PLAYBACK_MEMORY_KEY, JSON.stringify({ selectedId, tabs: streamTabs }))
        } catch (_unavailable) { /* private mode can reject storage */ }
      }, [selectedId, streamTabs])

      const selected = selectedId === null ? null : nodes.find(node => node.id === selectedId) ?? null
      useEffect(() => {
        if (selectedId !== null && selected === null && !loading) setSelectedId(null)
      }, [selectedId, selected, loading])

      const allFolderIds = useMemo(() => nodes.filter(node => node.kind === 'folder').map(node => node.id), [nodes])
      const expandedSet = expanded === null ? new Set(allFolderIds) : expanded
      const toggleFolder = (id) => {
        const next = new Set(expandedSet)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setExpanded(next)
      }

      const refresh = () => {
        setNotice(null)
        void loadTree()
        void loadServer()
      }
      const parentForNew = () => {
        if (selected === null) return null
        if (selected.kind === 'folder') return selected.id
        return selected.parentId
      }
      const openCreate = (kind, parentId) => {
        setDialog({ mode: kind, parentId: parentId ?? null })
      }
      const confirmDelete = async () => {
        if (deleting === null) return
        setDeleteBusy(true)
        setDeleteError(null)
        try {
          await requestJson('POST', 'nodes', { action: 'delete', id: deleting.id })
          setDeleting(null)
          if (selectedId === deleting.id) setSelectedId(null)
          await loadTree()
        } catch (failure) {
          setDeleteError(failureText(failure, t))
        } finally {
          setDeleteBusy(false)
        }
      }

      const renderTreeRows = (parentId, depth) => {
        const children = byParent.get(parentId) ?? []
        return children.map((node) => {
          const isFolder = node.kind === 'folder'
          const hasChildren = isFolder && (byParent.get(node.id)?.length ?? 0) > 0
          const isExpanded = hasChildren && expandedSet.has(node.id)
          const row = h('div', {
            key: node.id,
            className: node.id === selectedId ? 'dsh-media-tree-row dsh-media-tree-row-selected' : 'dsh-media-tree-row',
            style: { paddingLeft: `${String(6 + depth * 14)}px` },
            role: 'treeitem',
            'aria-selected': node.id === selectedId,
            'aria-expanded': hasChildren ? isExpanded : undefined,
            tabIndex: 0,
            onClick: () => setSelectedId(node.id),
            onDoubleClick: () => { setSelectedId(node.id); setDialog({ mode: 'edit', target: node }) },
            onKeyDown: (event) => { if (event.key === 'Enter') setSelectedId(node.id) },
          },
          isFolder
            ? h('button', {
              type: 'button',
              className: 'dsh-media-tree-chevron',
              'aria-label': isExpanded ? 'collapse' : 'expand',
              onClick: (event) => { event.stopPropagation(); if (hasChildren) toggleFolder(node.id) },
              style: { visibility: hasChildren ? 'visible' : 'hidden' },
            }, h(Icon, { name: 'chevron', size: 13, className: isExpanded ? undefined : 'dsh-media-chevron-closed' }))
            : h('span', { className: 'dsh-media-tree-spacer' }),
          h('span', { className: 'dsh-media-tree-icon' },
            h(Icon, { name: isFolder ? 'folder' : 'stream', size: 15 })),
          h('span', { className: 'dsh-media-tree-label', title: node.name }, node.name),
          h('span', { className: 'dsh-media-tree-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-media-tree-action',
              title: t('action.rename'),
              'aria-label': t('action.rename'),
              onClick: (event) => {
                event.stopPropagation()
                setSelectedId(node.id)
                setDialog({ mode: 'edit', target: node })
              },
            }, h(Icon, { name: 'edit', size: 12 })),
            h('button', {
              type: 'button',
              className: 'dsh-media-tree-action dsh-media-tree-action-danger',
              title: t('action.delete'),
              'aria-label': t('action.delete'),
              onClick: (event) => {
                event.stopPropagation()
                setSelectedId(node.id)
                setDeleteError(null)
                setDeleting(node)
              },
            }, h(Icon, { name: 'trash', size: 12 }))))
          const nested = isFolder && isExpanded ? renderTreeRows(node.id, depth + 1) : null
          return h(React.Fragment, { key: node.id }, row, nested)
        })
      }

      const header = h('div', { className: 'dsh-media-header' },
        h('div', { className: 'dsh-media-heading' },
          h('h1', null, t('page.title'))),
        h('div', { className: 'dsh-media-header-actions' },
          server === null
            ? h(Badge, { tone: 'unknown' }, t('status.unknown'))
            : h(Badge, { tone: server.online === true ? 'online' : 'offline' }, server.online === true ? t('status.online') : t('status.offline')),
          h('button', { type: 'button', className: 'dsh-media-button', onClick: refresh },
            h(Icon, { name: 'refresh', size: 13 }), t('action.refresh'))))

      const treePane = h('aside', { className: 'dsh-media-sidebar' },
        h('div', { className: 'dsh-media-sidebar-head' },
          h('span', { className: 'dsh-media-sidebar-title' }, t('tree.title'))),
        h('div', { className: 'dsh-media-sidebar-tools' },
          h('button', {
            type: 'button',
            className: 'dsh-media-icon-button',
            title: t('action.newFolder'),
            'aria-label': t('action.newFolder'),
            onClick: () => openCreate('folder', parentForNew()),
          }, h(Icon, { name: 'folder', size: 14 })),
          h('button', {
            type: 'button',
            className: 'dsh-media-icon-button',
            title: t('action.addStream'),
            'aria-label': t('action.addStream'),
            onClick: () => openCreate('stream', parentForNew()),
          }, h(Icon, { name: 'plus', size: 14 }))),
        h('div', { className: 'dsh-media-tree', role: 'tree' },
          loading
            ? h('div', { className: 'dsh-media-tree-empty' }, t('tree.loading'))
            : error !== null
              ? h('div', { className: 'dsh-media-tree-empty' }, t('tree.failed'))
              : nodes.length === 0
                ? h('div', { className: 'dsh-media-tree-empty' },
                  h('div', null, t('tree.empty')),
                  h('div', null, t('tree.emptyHint')))
                : renderTreeRows('', 0)))

      const detailPane = h('main', { className: 'dsh-media-main' },
        notice === null ? null : h('div', { className: 'dsh-media-notice', style: { margin: '12px 22px 0' } }, notice),
        selected === null
          ? h('div', { className: 'dsh-media-empty' },
            h(Icon, { name: 'stream', size: 30 }),
            h('h2', null, t('player.emptyTitle')),
            h('p', null, t('player.emptyBody')))
          : selected.kind === 'folder'
            ? h(FolderPane, {
              t, node: selected, nodes,
              onSelect: setSelectedId,
              onAddStream: (parentId) => openCreate('stream', parentId),
              onAddFolder: (parentId) => openCreate('folder', parentId),
            })
            : h(StreamPane, {
              key: selected.id,
              t, node: selected, server,
              tab: streamTabs[selected.id] === 'replay' ? 'replay' : 'live',
              onTab: (next) => setStreamTabs(current => ({ ...current, [selected.id]: next })),
              onOpenSettings: () => setSettingsOpen(true),
            }))

      const body = h('div', { className: 'dsh-media-body' }, treePane, detailPane)

      const dialogNode = dialog === null ? null : h(NodeDialog, {
        t,
        mode: dialog.mode,
        nodes,
        target: dialog.target,
        parentId: dialog.parentId,
        onClose: () => setDialog(null),
        onSaved: () => { setDialog(null); refresh() },
      })

      const deleteNode = deleting === null ? null : h(ConfirmDialog, {
        t,
        title: t('delete.title'),
        body: t('delete.body', { name: deleting.name }),
        busy: deleteBusy,
        error: deleteError,
        onCancel: () => { if (!deleteBusy) setDeleting(null) },
        onConfirm: () => { void confirmDelete() },
      })

      const settingsNode = settingsOpen ? h(SettingsDialog, {
        t,
        server,
        onChanged: () => { void loadServer() },
        onClose: () => setSettingsOpen(false),
      }) : null

      return h('div', { className: 'dsh-media-page' }, header, body, dialogNode, deleteNode, settingsNode)
    }

    /** Stream detail: tabs around the live and replay panes. */
    function StreamPane({ t, node, server, onOpenSettings, tab, onTab }) {
      return h('div', { className: 'dsh-media-stream' },
        h('div', { className: 'dsh-media-player-head' },
          h('div', { className: 'dsh-media-player-title' },
            h('h2', null, node.name),
            h('span', { className: 'dsh-media-mono' }, `${node.app}/${node.stream}`),
            node.description === '' ? null : h('p', { className: 'dsh-media-player-note' }, node.description)),
          h('div', { className: 'dsh-media-tabs', role: 'tablist' },
            h('button', {
              type: 'button', role: 'tab', 'aria-selected': tab === 'live',
              className: tab === 'live' ? 'dsh-media-tab dsh-media-tab-active' : 'dsh-media-tab',
              onClick: () => onTab('live'),
            }, t('tabs.live')),
            h('button', {
              type: 'button', role: 'tab', 'aria-selected': tab === 'replay',
              className: tab === 'replay' ? 'dsh-media-tab dsh-media-tab-active' : 'dsh-media-tab',
              onClick: () => onTab('replay'),
            }, t('tabs.replay')))),
        tab === 'live'
          ? h(LivePane, { t, node, server, onOpenSettings })
          : h(ReplayPane, { t, node, server, onOpenSettings }))
    }

    /** Settings card on the plugin's own manager page. */
    function MediaSettingsCard({ t }) {
      const [server, setServer] = useState(null)
      const loadServer = useCallback(async () => {
        try {
          const data = await requestJson('GET', 'server')
          setServer(data)
        } catch (_serverFailure) {
          setServer({ online: false })
        }
      }, [])
      useEffect(() => { void loadServer() }, [loadServer])
      return h('div', { className: 'dsh-media-settings-page' },
        h(SettingsForm, { t, server, onChanged: () => { void loadServer() } }))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, COPY), 'dsh-media: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => installStyle(), 'dsh-media: styles')
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        locale: NS,
        label: () => t('panel'),
      }, PanelIcon))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, MediaPage))
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-media',
        locale: NS,
      }, MediaSettingsCard))
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
