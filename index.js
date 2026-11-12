/**
 * Host half of the `dsh-media` bundle: a ZLMediaKit-backed streaming media
 * service.
 *
 * The plugin owns three things:
 * - a stream catalog persisted as JSON under `$DSH_HOME/dsh-media`;
 * - the ZLMediaKit HTTP API bridge, including WebRTC offer/answer exchange,
 *   stream proxies, and MP4 recording queries;
 * - the authenticated Fetch routes and agent tools used by the browser page.
 *
 * Secrets never leave the Host: the browser sees only whether a secret is
 * stored, and every ZLMediaKit call carries the secret from the Host process.
 *
 * @module dsh-media
 */

import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Profile entry id, matching `cordis.patch.yml`. */
const ENTRY_ID = 'dsh-media'
/** Shared API prefix owned by this plugin. */
const API = '/api/media'
/** Stable ZLMediaKit names. */
const ZLM_APP = 'live'
const ZLM_VHOST = '__defaultVhost__'
const MAX_NAME = 120
const MAX_APP = 64
const MAX_STREAM = 128
const MAX_URL = 2048
const MAX_DESCRIPTION = 4000
const MAX_PATH = 512
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const NODE_TABLE = 'dsh_media_nodes'
const RECORDING_TABLE = 'dsh_media_recordings'
const RECORDING_PREFIX = 'dsh-media/recordings'
const RECORDING_INDEX_FILE = 'recordings.json'

/**
 * The plugin's editable settings. Marked `volatile` so writes through the
 * settings document take effect without reloading the plugin instance.
 */
export const Config = z.object({
  zlmHost: z.string().default('127.0.0.1').description('ZLMediaKit host used by the Host process and by playback URLs').volatile(),
  zlmHttpPort: z.number().min(1).max(65535).default(80).description('ZLMediaKit HTTP API port').volatile(),
  zlmHttps: z.boolean().default(false).description('Use HTTPS for the API and HTTP playback URLs').volatile(),
  zlmSecret: z.string().role('secret').default('').description('ZLMediaKit API secret').volatile(),
  rtspPort: z.number().min(1).max(65535).default(554).description('RTSP playback port').volatile(),
  rtmpPort: z.number().min(1).max(65535).default(1935).description('RTMP playback port').volatile(),
  rtcPort: z.number().min(1).max(65535).default(8000).description('WebRTC port').volatile(),
  recordEnabled: z.boolean().default(true).description('Record every stream continuously for monitoring replay').volatile(),
  segmentSeconds: z.number().min(5).max(3600).default(60).description('MP4 segment length in seconds').volatile(),
  recordLocalDir: z.string().default('').description('Local recording directory; empty uses $DSH_HOME/dsh-media/recordings').volatile(),
  recordPath: z.string().default('./www').description('ZLMediaKit MP4 save path').volatile(),
  recordApp: z.string().default('record').description('ZLMediaKit recording app name').volatile(),
  manageContainer: z.boolean().default(true).description('Start the ZLMediaKit Docker container when this plugin loads and stop it when the plugin unloads').volatile(),
  containerName: z.string().default('zlmediakit').description('Docker container the plugin starts and stops').volatile(),
  composeFile: z.string().default('').description('Docker Compose file; empty uses the file shipped in the plugin package').volatile(),
})

/** A failure mapped to one HTTP response and one actionable message. */
class MediaError extends Error {
  /**
   * @param code - machine-readable error code.
   * @param message - actionable message shown by the page.
   * @param status - HTTP status for the Fetch route.
   */
  constructor(code, message, status) {
    super(message)
    this.name = 'MediaError'
    this.code = code
    this.status = status
  }
}

/** @returns true for a plain JSON object. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns a trimmed required string, or a 400 error. */
function requiredText(value, field, max) {
  if (typeof value !== 'string') throw new MediaError('invalid-input', `${field} is required`, 400)
  const text = value.trim()
  if (text === '') throw new MediaError('invalid-input', `${field} is required`, 400)
  if (text.length > max) throw new MediaError('invalid-input', `${field} is too long`, 400)
  return text
}

/** @returns a trimmed optional string, or a 400 error when over the limit. */
function optionalText(value, field, max) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new MediaError('invalid-input', `${field} must be text`, 400)
  const text = value.trim()
  if (text.length > max) throw new MediaError('invalid-input', `${field} is too long`, 400)
  return text
}

/** @returns a port number, or a 400 error. */
function requiredPort(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new MediaError('invalid-input', `${field} must be a port from 1 to 65535`, 400)
  }
  return value
}

/** @returns a valid ZLMediaKit app or stream name, or a 400 error. */
function requiredIdentifier(value, field, max) {
  const text = requiredText(value, field, max)
  if (!/^[A-Za-z0-9_.-]+$/.test(text)) {
    throw new MediaError('invalid-input', `${field} may contain only letters, numbers, dot, dash, and underscore`, 400)
  }
  return text
}

/** @returns an optional absolute source URL with a supported scheme. */
function optionalSourceUrl(value) {
  const text = optionalText(value, 'Source URL', MAX_URL)
  if (text === '') return ''
  let parsed
  try {
    parsed = new URL(text)
  } catch (_invalidUrl) {
    throw new MediaError('invalid-input', 'Source URL must be absolute', 400)
  }
  if (!['http:', 'https:', 'rtmp:', 'rtmps:', 'rtsp:'].includes(parsed.protocol)) {
    throw new MediaError('invalid-input', 'Source URL must use http, https, rtmp, or rtsp', 400)
  }
  return text
}

/** @returns the catalog file path, honouring the documented environment override. */
function catalogFile() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return process.env.DSH_MEDIA_CATALOG ?? join(home, 'dsh-media', 'catalog.json')
}

/** @returns the optional database service from the Database connections plugin. */
function databaseOf(ctx) {
  const database = ctx.get('database')
  if (database === undefined || typeof database.query !== 'function') return undefined
  return database
}

/** @returns the base directory for plugin-owned files. */
function mediaHome() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-media')
}

/** @returns the recording index file for local mode. */
function recordingIndexFile() {
  return join(mediaHome(), RECORDING_INDEX_FILE)
}

/** @returns the directory that stores recording files in local mode. */
function localRecordingRoot(settings) {
  return settings.recordLocalDir === '' ? join(mediaHome(), 'recordings') : settings.recordLocalDir
}

/** Project one PostgreSQL catalog row into the node object the page consumes. */
function pgNode(row) {
  return {
    id: String(row.id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    kind: row.kind === 'folder' ? 'folder' : 'stream',
    name: row.name,
    app: row.app ?? ZLM_APP,
    stream: row.stream ?? '',
    sourceUrl: row.source_url ?? '',
    description: row.description ?? '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ''),
  }
}

/** Create the node catalog provider: PostgreSQL when the database plugin is present, otherwise one JSON file. */
function createCatalogProvider(ctx) {
  const database = databaseOf(ctx)
  if (database !== undefined) {
    let tableReady
    const ensureTable = () => {
      if (tableReady === undefined) {
        tableReady = database.query(`
          CREATE TABLE IF NOT EXISTS ${NODE_TABLE} (
            id text PRIMARY KEY,
            parent_id text,
            kind text NOT NULL,
            name text NOT NULL,
            app text NOT NULL DEFAULT '${ZLM_APP}',
            stream text NOT NULL DEFAULT '',
            source_url text NOT NULL DEFAULT '',
            description text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `).catch((error) => { tableReady = undefined; throw error })
      }
      return tableReady
    }
    const tree = async () => {
      await ensureTable()
      const result = await database.query(`SELECT * FROM ${NODE_TABLE}`)
      return result.rows.map(pgNode)
    }
    const insert = async (node) => {
      await ensureTable()
      await database.query(`
        INSERT INTO ${NODE_TABLE} (id, parent_id, kind, name, app, stream, source_url, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [node.id, node.parentId, node.kind, node.name, node.app, node.stream, node.sourceUrl, node.description])
      return { ...node, createdAt: node.createdAt, updatedAt: node.updatedAt }
    }
    return {
      mode: 'postgres',
      tree,
      async createFolder(node) {
        const parent = node.parentId === null ? undefined : (await tree()).find(candidate => candidate.id === node.parentId)
        if (node.parentId !== null && (parent === undefined || parent.kind !== 'folder')) {
          throw new MediaError('not-found', 'The parent folder was not found', 404)
        }
        return insert(node)
      },
      async createStream(node) {
        await ensureTable()
        if (node.parentId !== null) {
          const parent = (await tree()).find(candidate => candidate.id === node.parentId)
          if (parent === undefined || parent.kind !== 'folder') throw new MediaError('not-found', 'The parent folder was not found', 404)
        }
        const duplicate = await database.query(`SELECT id FROM ${NODE_TABLE} WHERE kind = 'stream' AND app = $1 AND stream = $2`, [node.app, node.stream])
        if (duplicate.rows.length > 0) throw new MediaError('duplicate-stream', `Stream ${node.app}/${node.stream} is already in the catalog`, 409)
        return insert(node)
      },
      async updateNode(current, fields) {
        await ensureTable()
        if (fields.app !== undefined || fields.stream !== undefined) {
          const duplicate = await database.query(
            `SELECT id FROM ${NODE_TABLE} WHERE kind = 'stream' AND app = $1 AND stream = $2 AND id <> $3`,
            [fields.app ?? current.app, fields.stream ?? current.stream, current.id],
          )
          if (duplicate.rows.length > 0) throw new MediaError('duplicate-stream', 'That app and stream id are already in the catalog', 409)
        }
        const result = await database.query(`
          UPDATE ${NODE_TABLE} SET
            name = $2, app = $3, stream = $4, source_url = $5, description = $6, updated_at = now()
          WHERE id = $1 RETURNING *
        `, [
          current.id,
          fields.name ?? current.name,
          fields.app ?? current.app,
          fields.stream ?? current.stream,
          fields.sourceUrl ?? current.sourceUrl,
          fields.description ?? current.description,
        ])
        return pgNode(result.rows[0])
      },
      async deleteNode(id) {
        await ensureTable()
        const nodes = await tree()
        const ids = [...subtreeIds(nodes, id)]
        const result = await database.query(`DELETE FROM ${NODE_TABLE} WHERE id = ANY($1::text[]) RETURNING *`, [ids])
        return result.rows.map(pgNode)
      },
    }
  }

  const local = createCatalog()
  return {
    mode: 'local',
    tree: () => local.tree(),
    async createFolder(node) {
      return local.mutate((state) => {
        if (node.parentId !== null) {
          const parent = nodeById(state.nodes, node.parentId)
          if (parent === undefined || parent.kind !== 'folder') throw new MediaError('not-found', 'The parent folder was not found', 404)
        }
        state.nodes.push(node)
        return node
      })
    },
    async createStream(node) {
      return local.mutate((state) => {
        if (node.parentId !== null) {
          const parent = nodeById(state.nodes, node.parentId)
          if (parent === undefined || parent.kind !== 'folder') throw new MediaError('not-found', 'The parent folder was not found', 404)
        }
        const duplicate = state.nodes.find(candidate => candidate.kind === 'stream' && candidate.app === node.app && candidate.stream === node.stream)
        if (duplicate !== undefined) throw new MediaError('duplicate-stream', `Stream ${node.app}/${node.stream} is already in the catalog`, 409)
        state.nodes.push(node)
        return node
      })
    },
    async updateNode(current, fields) {
      return local.mutate((state) => {
        const node = nodeById(state.nodes, current.id)
        if (node === undefined) throw new MediaError('not-found', 'The node was not found', 404)
        if (fields.name !== undefined) node.name = fields.name
        if (fields.description !== undefined) node.description = fields.description
        if (node.kind === 'stream') {
          if (fields.app !== undefined) node.app = fields.app
          if (fields.stream !== undefined) node.stream = fields.stream
          if (fields.sourceUrl !== undefined) node.sourceUrl = fields.sourceUrl
          const duplicate = state.nodes.find(candidate => candidate !== node && candidate.kind === 'stream' && candidate.app === node.app && candidate.stream === node.stream)
          if (duplicate !== undefined) throw new MediaError('duplicate-stream', 'That app and stream id are already in the catalog', 409)
        }
        node.updatedAt = new Date().toISOString()
        return node
      })
    },
    async deleteNode(id) {
      return local.mutate((state) => {
        const node = nodeById(state.nodes, id)
        if (node === undefined) throw new MediaError('not-found', 'The node was not found', 404)
        const ids = subtreeIds(state.nodes, id)
        const removedNodes = state.nodes.filter(candidate => ids.has(String(candidate.id)))
        state.nodes = state.nodes.filter(candidate => !ids.has(String(candidate.id)))
        return removedNodes
      })
    },
  }
}

/** One JSON file holding the flat node list. Reads validate the envelope. */
function createCatalog() {
  let queue = Promise.resolve()

  async function load() {
    let text
    try {
      text = await readFile(catalogFile(), 'utf8')
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { version: 1, nodes: [] }
      }
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (_invalidJson) {
      throw new MediaError('catalog-corrupt', `The stream catalog at ${catalogFile()} is not valid JSON`, 500)
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) {
      throw new MediaError('catalog-corrupt', `The stream catalog at ${catalogFile()} has an unexpected structure`, 500)
    }
    return { version: 1, nodes: parsed.nodes.filter(isRecord) }
  }

  async function persist(state) {
    const file = catalogFile()
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }

  /** Read every node after earlier writes settle. */
  async function tree() {
    await queue.catch(() => {})
    const state = await load()
    return state.nodes
  }

  /**
   * Apply one synchronous change to the catalog and persist it.
   * @param change - receives validated state and returns the result to publish.
   */
  async function mutate(change) {
    const run = queue.then(async () => {
      const state = await load()
      const result = change(state)
      await persist(state)
      return result
    })
    queue = run.then(() => {}, () => {})
    return run
  }

  return { tree, mutate }
}

/** Project one PostgreSQL recording row into the index item the page consumes. */
function pgRecording(row) {
  return {
    id: String(row.id),
    app: row.app,
    stream: row.stream,
    fileName: row.file_name,
    day: String(row.day),
    startTime: row.start_time instanceof Date ? row.start_time.toISOString() : String(row.start_time ?? ''),
    durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined ? 0 : Number(row.duration_seconds),
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? 0 : Number(row.size_bytes),
    storage: row.storage === 'minio' ? 'minio' : 'local',
    objectKey: row.object_key ?? '',
    localPath: row.local_path ?? '',
  }
}

/** Create the recording index provider: PostgreSQL when present, otherwise one JSON file. */
function createRecordingIndex(ctx) {
  const database = databaseOf(ctx)
  if (database !== undefined) {
    let tableReady
    const ensureTable = () => {
      if (tableReady === undefined) {
        tableReady = database.query(`
          CREATE TABLE IF NOT EXISTS ${RECORDING_TABLE} (
            id text PRIMARY KEY,
            app text NOT NULL,
            stream text NOT NULL,
            file_name text NOT NULL,
            day text NOT NULL,
            start_time timestamptz NOT NULL,
            duration_seconds integer NOT NULL DEFAULT 0,
            size_bytes bigint NOT NULL DEFAULT 0,
            storage text NOT NULL DEFAULT 'local',
            object_key text NOT NULL DEFAULT '',
            local_path text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `).catch((error) => { tableReady = undefined; throw error })
      }
      return tableReady
    }
    return {
      mode: 'postgres',
      async list(filter = {}) {
        await ensureTable()
        const clauses = []
        const values = []
        for (const [column, key] of [['app', 'app'], ['stream', 'stream'], ['day', 'day']]) {
          const value = filter[key]
          if (value !== undefined && value !== '') {
            values.push(value)
            clauses.push(`${column} = $${String(values.length)}`)
          }
        }
        const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
        const result = await database.query(`SELECT * FROM ${RECORDING_TABLE} ${where} ORDER BY start_time DESC LIMIT 2000`, values)
        return result.rows.map(pgRecording)
      },
      async get(id) {
        await ensureTable()
        const result = await database.query(`SELECT * FROM ${RECORDING_TABLE} WHERE id = $1`, [id])
        return result.rows.length === 0 ? undefined : pgRecording(result.rows[0])
      },
      async add(item) {
        await ensureTable()
        await database.query(`
          INSERT INTO ${RECORDING_TABLE} (id, app, stream, file_name, day, start_time, duration_seconds, size_bytes, storage, object_key, local_path)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING
        `, [item.id, item.app, item.stream, item.fileName, item.day, item.startTime, item.durationSeconds, item.sizeBytes, item.storage, item.objectKey, item.localPath])
      },
    }
  }

  let queue = Promise.resolve()
  async function load() {
    try {
      const raw = await readFile(recordingIndexFile(), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isRecord) : []
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw new MediaError('recording-index-corrupt', `The recording index at ${recordingIndexFile()} could not be read`, 500)
    }
  }
  async function persist(items) {
    const file = recordingIndexFile()
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }
  return {
    mode: 'local',
    async list(filter = {}) {
      await queue.catch(() => {})
      const items = await load()
      return items
        .filter(item => (filter.app === undefined || filter.app === '' || item.app === filter.app)
          && (filter.stream === undefined || filter.stream === '' || item.stream === filter.stream)
          && (filter.day === undefined || filter.day === '' || item.day === filter.day))
        .sort((left, right) => String(right.startTime).localeCompare(String(left.startTime)))
    },
    async get(id) {
      await queue.catch(() => {})
      return (await load()).find(item => item.id === id)
    },
    async add(item) {
      const run = queue.then(async () => {
        const items = await load()
        if (items.some(candidate => candidate.id === item.id)) return
        items.push(item)
        await persist(items)
      })
      queue = run.then(() => {}, () => {})
      return run
    },
  }
}

/** @returns the id shared by one recording in the index, storage, and routes. */
function recordingId(app, stream, day, file) {
  return `${app}/${stream}/${day}/${file}`
}

/** @returns the recording start time parsed from the ZLMediaKit file name. */
function recordingStart(day, file) {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(file)
  if (match === null) return new Date(`${day}T00:00:00`).toISOString()
  return new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  ).toISOString()
}

/** @returns the byte range requested by a Range header, or undefined for the whole file. */
function rangeOf(request, size) {
  const header = request.headers.get('range')
  if (header === null) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  let start = match[1] === '' ? undefined : Number(match[1])
  let end = match[2] === '' ? undefined : Number(match[2])
  if (start === undefined) {
    const length = end ?? 0
    if (length <= 0) return undefined
    start = Math.max(size - length, 0)
    end = size - 1
  } else if (end === undefined || end >= size) {
    end = size - 1
  }
  if (start >= size || start > end) return { invalid: true }
  return { start, end, length: end - start + 1 }
}

/** Run one docker command; a non-zero exit rejects with its last error lines. */
function runDocker(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        const detail = (stderr || stdout || error.message).trim().split('\n').slice(-3).join(' ')
        const failure = new Error(detail)
        failure.code = typeof error.code === 'number' ? error.code : 1
        reject(failure)
        return
      }
      resolve(stdout.trim())
    })
  })
}

/** @returns whether the managed container exists and runs. */
async function containerState(name) {
  try {
    const output = await runDocker(['inspect', '--format', '{{.State.Running}}', name], 15000)
    return { exists: true, running: output === 'true' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/No such (object|container)/i.test(message)) return { exists: false, running: false }
    throw error
  }
}

/** @returns the compose file shipped beside the plugin package files. */
function defaultComposeFile() {
  return join(PLUGIN_DIR, 'zlm', 'linux', 'docker-compose.yml')
}

/** @returns the managed-container settings captured for one activation. */
function containerSettings(config) {
  const compose = config.composeFile.get().trim()
  return {
    enabled: config.manageContainer.get(),
    name: config.containerName.get().trim(),
    composeFile: compose === '' ? defaultComposeFile() : compose,
  }
}

/** Start the bundled ZLMediaKit container; a failure is reported, not thrown. */
async function startManagedContainer(ctx, container) {
  if (!CONTAINER_NAME_PATTERN.test(container.name)) {
    ctx.logger.warn('dsh-media: refusing to manage container with invalid name %s', container.name)
    return
  }
  try {
    const state = await containerState(container.name)
    if (state.running) {
      ctx.logger.info('dsh-media: container %s is already running', container.name)
      return
    }
    if (state.exists) {
      await runDocker(['start', container.name], 60000)
      ctx.logger.info('dsh-media: started container %s', container.name)
      return
    }
    let compose = container.composeFile
    try {
      await access(compose)
    } catch (_missingComposeFile) {
      compose = ''
    }
    if (compose !== '') {
      await runDocker(['compose', '-f', compose, 'up', '-d'], 300000)
      ctx.logger.info('dsh-media: started container %s from %s', container.name, compose)
      return
    }
    await runDocker(['start', container.name], 60000)
    ctx.logger.info('dsh-media: started container %s', container.name)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn('dsh-media: starting the ZLMediaKit container failed: %s', message)
  }
}

/** Stop the managed ZLMediaKit container; a failure is reported, not thrown. */
async function stopManagedContainer(ctx, container) {
  if (!CONTAINER_NAME_PATTERN.test(container.name)) return
  try {
    const state = await containerState(container.name)
    if (!state.exists || !state.running) return
    await runDocker(['stop', '--time', '10', container.name], 60000)
    ctx.logger.info('dsh-media: stopped container %s', container.name)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn('dsh-media: stopping the ZLMediaKit container failed: %s', message)
  }
}

/** @returns the live settings read from the volatile Config fields. */
function settingsOf(config) {
  return {
    host: config.zlmHost.get().trim(),
    httpPort: config.zlmHttpPort.get(),
    https: config.zlmHttps.get(),
    secret: config.zlmSecret.get(),
    rtspPort: config.rtspPort.get(),
    rtmpPort: config.rtmpPort.get(),
    rtcPort: config.rtcPort.get(),
    recordEnabled: config.recordEnabled.get(),
    segmentSeconds: config.segmentSeconds.get(),
    recordLocalDir: config.recordLocalDir.get().trim(),
    recordPath: config.recordPath.get(),
    recordApp: config.recordApp.get().trim() === '' ? 'record' : config.recordApp.get().trim(),
  }
}

/** @returns the ZLMediaKit HTTP origin. */
function zlmOrigin(settings) {
  return `${settings.https ? 'https' : 'http'}://${settings.host}:${String(settings.httpPort)}`
}

/** @returns the public playback URLs for one stream. */
function playUrls(settings, app, stream) {
  const scheme = settings.https ? 'https' : 'http'
  const httpBase = `${scheme}://${settings.host}:${String(settings.httpPort)}`
  return {
    rtsp: `rtsp://${settings.host}:${String(settings.rtspPort)}/${app}/${stream}`,
    rtmp: `rtmp://${settings.host}:${String(settings.rtmpPort)}/${app}/${stream}`,
    hls: `${httpBase}/${app}/${stream}/hls.m3u8`,
    flv: `${httpBase}/${app}/${stream}.live.flv`,
    webrtc: `webrtc://${settings.host}:${String(settings.rtcPort)}/${app}/${stream}`,
  }
}

/** Fail when the Host cannot build a ZLMediaKit API origin. */
function requireHost(settings) {
  if (settings.host === '') {
    throw new MediaError('media-not-configured', 'Set the ZLMediaKit host in the plugin settings first', 503)
  }
}

/** Fail when the Host cannot authenticate a sensitive ZLMediaKit API call. */
function requireSecret(settings) {
  requireHost(settings)
  if (settings.secret === '') {
    throw new MediaError('media-not-configured', 'Set the ZLMediaKit API secret in the plugin settings first', 503)
  }
}

/**
 * Call one ZLMediaKit HTTP API method.
 * @returns the decoded `data` payload; undefined when the response carries none.
 */
async function zlmCall(settings, method, fields = {}) {
  requireHost(settings)
  const params = { ...fields }
  // ZLMediaKit skips the secret for loopback callers; sending an empty one is a refused login.
  if (settings.secret !== '') params.secret = settings.secret
  const body = new URLSearchParams(params)
  let response
  try {
    response = await fetch(`${zlmOrigin(settings)}/index/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MediaError('media-unavailable', `ZLMediaKit request failed: ${reason}`, 503)
  }
  let payload
  try {
    payload = await response.json()
  } catch (_invalidJson) {
    throw new MediaError('media-unavailable', `ZLMediaKit returned HTTP ${String(response.status)}`, 503)
  }
  if (!isRecord(payload)) throw new MediaError('media-unavailable', 'ZLMediaKit returned an unexpected response', 503)
  if (payload.code === 0) return payload.data
  const message = typeof payload.msg === 'string' && payload.msg !== '' ? payload.msg : `ZLMediaKit ${method} failed`
  throw new MediaError('media-unavailable', message, 503)
}

/** @returns the media entries ZLMediaKit reports for one stream. */
async function mediaEntries(settings, app, stream) {
  const data = await zlmCall(settings, 'getMediaList', { app, stream })
  return Array.isArray(data) ? data.filter(isRecord) : []
}

/** @returns the first media entry, or undefined while the stream is offline. */
async function mediaEntry(settings, app, stream) {
  const entries = await mediaEntries(settings, app, stream)
  return entries.find(entry => entry.schema === 'rtsp') ?? entries.find(entry => entry.schema === 'fmp4') ?? entries[0]
}

/** @returns the ZLMediaKit server config map. */
async function serverConfig(settings) {
  const data = await zlmCall(settings, 'getServerConfig', {})
  const map = Array.isArray(data) ? data[0] : data
  if (!isRecord(map)) throw new MediaError('media-unavailable', 'ZLMediaKit returned an unexpected server config', 503)
  return map
}

/** @returns a JSON response the browser page can consume. */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** @returns the parsed URL of one request. */
function requestUrl(request) {
  return new URL(request.url, 'http://localhost')
}

/** Read and validate one JSON request body. */
async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new MediaError('invalid-input', 'Expected a JSON request', 400)
  }
  let body
  try {
    body = await request.json()
  } catch (_invalidJson) {
    throw new MediaError('invalid-input', 'The request body is not valid JSON', 400)
  }
  if (!isRecord(body)) throw new MediaError('invalid-input', 'The request body must be an object', 400)
  return body
}

/** One stream node as the page consumes it. */
function projectNode(node) {
  return {
    id: String(node.id),
    parentId: node.parentId === null || node.parentId === undefined ? null : String(node.parentId),
    kind: node.kind === 'folder' ? 'folder' : 'stream',
    name: node.name,
    app: node.app ?? ZLM_APP,
    stream: node.stream ?? '',
    sourceUrl: node.sourceUrl ?? '',
    description: node.description ?? '',
    createdAt: node.createdAt ?? '',
    updatedAt: node.updatedAt ?? '',
  }
}

/** Project one node into the bounded tool result fields. */
function toolNode(node) {
  const value = {
    id: String(node.id),
    kind: node.kind === 'folder' ? 'folder' : 'stream',
    name: node.name,
    app: node.app ?? ZLM_APP,
    stream: node.stream ?? '',
    sourceUrl: node.sourceUrl ?? '',
    description: node.description ?? '',
  }
  if (node.parentId !== null && node.parentId !== undefined) value.parentId = String(node.parentId)
  return value
}

/** @returns every node sorted folders-first, then by name. */
function sortedNodes(nodes) {
  return nodes.map(projectNode).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh')
  })
}

/** @returns every descendant id of one node, including the node itself. */
function subtreeIds(nodes, id) {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      const parent = node.parentId === null || node.parentId === undefined ? null : String(node.parentId)
      if (parent !== null && ids.has(parent) && !ids.has(String(node.id))) {
        ids.add(String(node.id))
        grew = true
      }
    }
  }
  return ids
}

/** @returns the node with this id, or undefined. */
function nodeById(nodes, id) {
  return nodes.find(node => String(node.id) === id)
}

/** @returns a default stream name derived from a random id. */
function defaultStreamName() {
  return `media_${randomUUID().replace(/-/g, '').slice(0, 10)}`
}

/** @returns true when the ZLMediaKit error means the object already exists. */
function alreadyExists(error) {
  return error instanceof Error && /already exists|already exist|stream already/i.test(error.message)
}

/** Ensure a pull proxy exists for one node. A push node has no source URL. */
async function ensureProxy(settings, node) {
  if (node.sourceUrl === '') return
  try {
    await zlmCall(settings, 'addStreamProxy', {
      vhost: ZLM_VHOST,
      app: node.app,
      stream: node.stream,
      url: node.sourceUrl,
      retry_count: '-1',
      rtp_type: '0',
      timeout_sec: '10',
      enable_hls: '1',
      enable_rtsp: '1',
      enable_rtmp: '1',
      enable_ts: '1',
      enable_fmp4: '1',
      enable_mp4: '1',
      auto_close: '0',
    })
  } catch (error) {
    if (alreadyExists(error)) return
    throw error
  }
}

/** Drop one pull proxy. A missing proxy is success. */
async function dropProxy(settings, node) {
  try {
    await zlmCall(settings, 'delStreamProxy', { key: `${ZLM_VHOST}/${node.app}/${node.stream}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not found|can not find|no such|不存在/i.test(message)) return
    // A deleted catalog node must not keep the request alive.
  }
}

/** Sleep for a bounded interval. */
function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Register the media service routes and tools.
 * @param ctx - Host context.
 * @param config - Resolved plugin configuration.
 */
export function apply(ctx, config) {
  const container = containerSettings(config)
  if (container.enabled) void startManagedContainer(ctx, container)
  ctx.effect(() => () => { if (container.enabled) void stopManagedContainer(ctx, container) }, 'dsh-media: ZLMediaKit container lifecycle')
  const catalog = createCatalogProvider(ctx)
  const recordingsIndex = createRecordingIndex(ctx)
  ctx.effect(() => {
    if (config.zlmSecret.get() !== '') {
      void applyServerConfig().catch((error) => {
        ctx.logger.warn('dsh-media: applying the initial server configuration failed: %s', error instanceof Error ? error.message : String(error))
      })
    }
    const timer = setInterval(() => {
      void maintainRecordings().catch((error) => {
        ctx.logger.warn('dsh-media: recording maintenance failed: %s', error instanceof Error ? error.message : String(error))
      })
    }, 30000)
    return () => clearInterval(timer)
  }, 'dsh-media: continuous recording maintenance')

  /** @returns the settings service, or a 503 failure when the profile lacks it. */
  function settingsService() {
    const service = ctx.get('settings')
    if (service === undefined) {
      throw new MediaError('settings-unavailable', 'The settings service is not active in this profile', 503)
    }
    return service
  }

  /** Read the live plugin settings. */
  function liveSettings() {
    return settingsOf(config)
  }

  /** Validate a settings patch from the page. */
  function normalizeSettingsPatch(body) {
    const patch = {}
    if (body.zlmHost !== undefined) {
      const host = requiredText(body.zlmHost, 'ZLMediaKit host', 255)
      patch.zlmHost = host
    }
    for (const [key, field] of [
      ['zlmHttpPort', 'HTTP port'],
      ['rtspPort', 'RTSP port'],
      ['rtmpPort', 'RTMP port'],
      ['rtcPort', 'WebRTC port'],
    ]) {
      if (body[key] !== undefined) patch[key] = requiredPort(body[key], field)
    }
    if (body.zlmHttps !== undefined) {
      if (typeof body.zlmHttps !== 'boolean') throw new MediaError('invalid-input', 'HTTPS must be a boolean', 400)
      patch.zlmHttps = body.zlmHttps
    }
    if (body.zlmSecret !== undefined) {
      if (typeof body.zlmSecret !== 'string') throw new MediaError('invalid-input', 'The secret must be text', 400)
      if (body.zlmSecret !== '') patch.zlmSecret = body.zlmSecret
    }
    if (body.clearSecret === true) patch.zlmSecret = ''
    if (body.recordEnabled !== undefined) {
      if (typeof body.recordEnabled !== 'boolean') throw new MediaError('invalid-input', 'Recording must be a boolean', 400)
      patch.recordEnabled = body.recordEnabled
    }
    if (body.segmentSeconds !== undefined) {
      const segment = Number(body.segmentSeconds)
      if (!Number.isInteger(segment) || segment < 5 || segment > 3600) throw new MediaError('invalid-input', 'Segment seconds must be an integer from 5 to 3600', 400)
      patch.segmentSeconds = segment
    }
    if (body.recordLocalDir !== undefined) patch.recordLocalDir = optionalText(body.recordLocalDir, 'Local recording directory', MAX_PATH)
    if (body.recordPath !== undefined) patch.recordPath = requiredText(body.recordPath, 'Record path', MAX_PATH)
    if (body.recordApp !== undefined) patch.recordApp = requiredIdentifier(body.recordApp, 'Record app', MAX_APP)
    return patch
  }

  /** Build the public settings view: the secret value stays in the Host. */
  function settingsView() {
    const current = liveSettings()
    return {
      settings: {
        zlmHost: current.host,
        zlmHttpPort: current.httpPort,
        zlmHttps: current.https,
        rtspPort: current.rtspPort,
        rtmpPort: current.rtmpPort,
        rtcPort: current.rtcPort,
        recordEnabled: current.recordEnabled,
        segmentSeconds: current.segmentSeconds,
        recordLocalDir: current.recordLocalDir,
        recordPath: current.recordPath,
        recordApp: current.recordApp,
      },
      secretSet: current.secret !== '',
      catalogFile: catalog.mode === 'postgres' ? `${NODE_TABLE} (PostgreSQL)` : catalogFile(),
      storage: catalog.mode === 'postgres' ? 'minio' : 'local',
    }
  }

  /** Create one folder. */
  async function createFolder(body) {
    const parentId = body.parentId === null || body.parentId === undefined ? null : String(body.parentId)
    const name = requiredText(body.name, 'Folder name', MAX_NAME)
    const now = new Date().toISOString()
    return catalog.createFolder({
      id: randomUUID(), parentId, kind: 'folder', name, app: '', stream: '', sourceUrl: '', description: '', createdAt: now, updatedAt: now,
    })
  }

  /** Create one stream node. */
  async function createStream(body) {
    const parentId = body.parentId === null || body.parentId === undefined ? null : String(body.parentId)
    const name = requiredText(body.name, 'Stream name', MAX_NAME)
    const app = body.app === undefined || body.app === null || body.app === '' ? ZLM_APP : requiredIdentifier(body.app, 'App', MAX_APP)
    const stream = body.stream === undefined || body.stream === null || body.stream === '' ? defaultStreamName() : requiredIdentifier(body.stream, 'Stream id', MAX_STREAM)
    const sourceUrl = optionalSourceUrl(body.sourceUrl)
    const description = optionalText(body.description, 'Description', MAX_DESCRIPTION)
    const now = new Date().toISOString()
    return catalog.createStream({
      id: randomUUID(), parentId, kind: 'stream', name, app, stream, sourceUrl, description, createdAt: now, updatedAt: now,
    })
  }

  /** Update one node's writable fields. */
  async function updateNode(body) {
    const id = requiredText(body.id, 'Node id', 128)
    const patch = isRecord(body.patch) ? body.patch : {}
    const nodes = await catalog.tree()
    const current = nodes.find(node => node.id === id)
    if (current === undefined) throw new MediaError('not-found', 'The node was not found', 404)
    const fields = {}
    if (patch.name !== undefined) fields.name = requiredText(patch.name, 'Name', MAX_NAME)
    if (patch.description !== undefined) fields.description = optionalText(patch.description, 'Description', MAX_DESCRIPTION)
    if (current.kind === 'stream') {
      if (patch.app !== undefined) fields.app = requiredIdentifier(patch.app, 'App', MAX_APP)
      if (patch.stream !== undefined) fields.stream = requiredIdentifier(patch.stream, 'Stream id', MAX_STREAM)
      if (patch.sourceUrl !== undefined) fields.sourceUrl = optionalSourceUrl(patch.sourceUrl)
    }
    return catalog.updateNode(current, fields)
  }

  /** Delete one node and its descendants, dropping pull proxies best-effort. */
  async function deleteNode(body) {
    const id = requiredText(body.id, 'Node id', 128)
    const settings = liveSettings()
    const removed = await catalog.deleteNode(id)
    for (const node of removed) {
      if (node.kind === 'stream' && node.sourceUrl !== '') await dropProxy(settings, node)
    }
    return removed.map(projectNode)
  }

  /** Resolve one node id to a stream node, or fail with 404. */
  async function requireStreamNode(id) {
    const nodes = await catalog.tree()
    const node = nodeById(nodes, id)
    if (node === undefined) throw new MediaError('not-found', 'The stream was not found', 404)
    if (node.kind !== 'stream') throw new MediaError('invalid-input', 'The selected node is a folder', 400)
    return projectNode(node)
  }

  /** List indexed recordings with playback and download addresses. */
  async function listRecordings(filter) {
    const items = await recordingsIndex.list(filter)
    return items.map(item => ({
      id: item.id,
      app: item.app,
      stream: item.stream,
      fileName: item.fileName,
      day: item.day,
      startTime: item.startTime,
      durationSeconds: item.durationSeconds,
      sizeBytes: item.sizeBytes,
      storage: item.storage,
      playUrl: `api/media/recording/content?id=${encodeURIComponent(item.id)}`,
      downloadUrl: `api/media/recording/download?id=${encodeURIComponent(item.id)}`,
    }))
  }

  /** Download one finalized ZLMediaKit recording into MinIO or the local directory. */
  async function persistRecording(settings, item, url) {
    const database = databaseOf(ctx)
    const key = `${RECORDING_PREFIX}/${item.id}`
    if (database !== undefined) {
      try {
        const bucket = database.minio().bucket
        const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
        if (!response.ok || response.body === null) throw new Error(`ZLMediaKit returned HTTP ${String(response.status)}`)
        const size = Number(response.headers.get('content-length') ?? '0')
        if (size > 0) {
          await database.withMinio(client => client.putObject(bucket, key, Readable.fromWeb(response.body), size, { 'Content-Type': 'video/mp4' }))
        } else {
          const buffer = Buffer.from(await response.arrayBuffer())
          await database.withMinio(client => client.putObject(bucket, key, buffer, buffer.length, { 'Content-Type': 'video/mp4' }))
        }
        return { ...item, storage: 'minio', objectKey: key, localPath: '', sizeBytes: size }
      } catch (error) {
        ctx.logger.warn('dsh-media: MinIO upload failed, keeping the recording locally: %s', error instanceof Error ? error.message : String(error))
      }
    }
    const target = join(localRecordingRoot(settings), item.id)
    await mkdir(dirname(target), { recursive: true })
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
    if (!response.ok || response.body === null) throw new MediaError('recording-fetch-failed', `ZLMediaKit returned HTTP ${String(response.status)}`, 502)
    const size = Number(response.headers.get('content-length') ?? '0')
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
    return { ...item, storage: 'local', objectKey: '', localPath: target, sizeBytes: size }
  }

  /** Ingest finalized recordings for one stream and day. @returns the number added. */
  async function ingestRecordings(node, day) {
    const settings = liveSettings()
    requireHost(settings)
    let data
    try {
      data = await zlmCall(settings, 'getMp4RecordFile', {
        vhost: ZLM_VHOST, app: node.app, stream: node.stream, period: day,
      })
    } catch (error) {
      if (error instanceof MediaError && /not found|no such|不存在/i.test(error.message)) return 0
      throw error
    }
    const paths = isRecord(data) && Array.isArray(data.paths)
      ? data.paths.filter(name => typeof name === 'string' && !name.startsWith('.'))
      : []
    if (paths.length === 0) return 0
    paths.sort()
    const existing = new Set((await recordingsIndex.list({ app: node.app, stream: node.stream, day })).map(item => item.id))
    const base = `${zlmOrigin(settings)}/${encodeURIComponent(settings.recordApp)}/${encodeURIComponent(node.app)}/${encodeURIComponent(node.stream)}/${day}`
    let added = 0
    for (let index = 0; index < paths.length && added < 60; index += 1) {
      const file = paths[index]
      const id = recordingId(node.app, node.stream, day, file)
      if (existing.has(id)) continue
      const start = recordingStart(day, file)
      const next = paths[index + 1] === undefined ? undefined : new Date(recordingStart(day, paths[index + 1])).getTime()
      const durationSeconds = next === undefined
        ? settings.segmentSeconds
        : Math.max(0, Math.round((next - new Date(start).getTime()) / 1000))
      let stored
      try {
        stored = await persistRecording(settings, {
          id, app: node.app, stream: node.stream, fileName: file, day, startTime: start,
          durationSeconds, sizeBytes: 0, storage: 'local', objectKey: '', localPath: '',
        }, `${base}/${file.split('/').map(encodeURIComponent).join('/')}`)
      } catch (error) {
        ctx.logger.warn('dsh-media: recording %s could not be fetched: %s', id, error instanceof Error ? error.message : String(error))
        continue
      }
      await recordingsIndex.add(stored)
      added += 1
    }
    return added
  }

  /** Keep every catalog stream recording and ingest its finalized segments. */
  async function maintainRecordings() {
    const settings = liveSettings()
    if (settings.secret === '') return
    const today = new Date().toISOString().slice(0, 10)
    for (const node of (await catalog.tree()).filter(node => node.kind === 'stream')) {
      if (settings.recordEnabled) {
        try {
          const entry = await mediaEntry(settings, node.app, node.stream)
          if (entry !== undefined) {
            await zlmCall(settings, 'startRecord', { type: '1', vhost: ZLM_VHOST, app: node.app, stream: node.stream })
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error)
                if (!/already|recording|find the stream/i.test(message)) throw error
              })
          }
        } catch (error) {
          ctx.logger.warn('dsh-media: keeping %s/%s recorded failed: %s', node.app, node.stream, error instanceof Error ? error.message : String(error))
        }
      }
      try {
        await ingestRecordings(node, today)
      } catch (error) {
        ctx.logger.warn('dsh-media: ingesting recordings for %s/%s failed: %s', node.app, node.stream, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /** Open one recording, honouring Range requests so the video element can seek. */
  async function recordingResponse(request, download) {
    const id = requestUrl(request).searchParams.get('id') ?? ''
    if (id.trim() === '') throw new MediaError('invalid-input', 'A recording id is required', 400)
    const item = await recordingsIndex.get(id)
    if (item === undefined) throw new MediaError('not-found', 'The recording was not found', 404)
    const filename = `${item.app}-${item.stream}-${item.fileName}`.replace(/[^A-Za-z0-9_.-]/g, '_')
    let stream
    let size
    let range
    if (item.storage === 'minio') {
      const database = databaseOf(ctx)
      if (database === undefined) throw new MediaError('storage-unavailable', 'MinIO is not available; the recording cannot be read', 503)
      const bucket = database.minio().bucket
      await database.withMinio(async (client) => {
        const info = await client.statObject(bucket, item.objectKey)
        size = info.size
        range = rangeOf(request, size)
        if (range !== undefined && range.invalid) throw new MediaError('invalid-range', 'The requested range is not satisfiable', 416)
        stream = range === undefined
          ? await client.getObject(bucket, item.objectKey)
          : await client.getPartialObject(bucket, item.objectKey, range.start, range.length)
      })
    } else {
      const info = await stat(item.localPath)
      size = info.size
      range = rangeOf(request, size)
      if (range !== undefined && range.invalid) throw new MediaError('invalid-range', 'The requested range is not satisfiable', 416)
      stream = createReadStream(item.localPath, range === undefined ? undefined : { start: range.start, end: range.end })
    }
    const headers = {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=300',
    }
    if (range !== undefined) {
      headers['content-length'] = String(range.length)
      headers['content-range'] = `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`
    } else {
      headers['content-length'] = String(size)
    }
    if (download) headers['content-disposition'] = `attachment; filename="${filename}"`
    return new Response(Readable.toWeb(stream), { status: range === undefined ? 200 : 206, headers })
  }

  /** Sync one day of recordings for a node (or every stream) and return the index. */
  async function syncRecordings(body) {
    const nodeId = body.nodeId === undefined || body.nodeId === null ? '' : String(body.nodeId)
    const day = body.day === undefined || body.day === null || body.day === ''
      ? new Date().toISOString().slice(0, 10)
      : requiredText(body.day, 'Date', 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new MediaError('invalid-input', 'Date must use YYYY-MM-DD', 400)
    if (nodeId !== '') {
      const node = await requireStreamNode(nodeId)
      await ingestRecordings(node, day)
      return { recordings: await listRecordings({ app: node.app, stream: node.stream, day }) }
    }
    for (const node of (await catalog.tree()).filter(node => node.kind === 'stream')) {
      await ingestRecordings(node, day)
    }
    return { recordings: await listRecordings({ day }) }
  }

  /** @returns one stream's live status. */
  async function streamStatus(app, stream) {
    const settings = liveSettings()
    requireHost(settings)
    const entry = await mediaEntry(settings, requiredIdentifier(app, 'App', MAX_APP), requiredIdentifier(stream, 'Stream id', MAX_STREAM))
    if (entry === undefined) return { online: false, recording: false, readers: 0, video: null, audio: null }
    const tracks = Array.isArray(entry.tracks) ? entry.tracks : []
    const videoTrack = tracks.find(track => isRecord(track) && track.codec_type === 0)
    const audioTrack = tracks.find(track => isRecord(track) && track.codec_type === 1)
    return {
      online: true,
      recording: entry.isRecordingMP4 === true,
      readers: typeof entry.totalReaderCount === 'number' ? entry.totalReaderCount : 0,
      video: isRecord(videoTrack) ? { width: videoTrack.width, height: videoTrack.height, fps: videoTrack.fps, codec: videoTrack.codec_id_name } : null,
      audio: isRecord(audioTrack) ? { codec: audioTrack.codec_id_name, sampleRate: audioTrack.sample_rate } : null,
    }
  }

  /** @returns the ZLMediaKit status and its effective port/recording configuration. */
  async function serverStatus() {
    const settings = liveSettings()
    requireHost(settings)
    let configMap
    let version
    try {
      ;[configMap, version] = await Promise.all([
        serverConfig(settings),
        zlmCall(settings, 'version', {}),
      ])
    } catch (error) {
      return {
        online: false,
        error: error instanceof Error ? error.message : String(error),
        settings: settingsView().settings,
        secretSet: settings.secret !== '',
      }
    }
    return {
      online: true,
      version: isRecord(version) ? version : null,
      config: {
        httpPort: Number(configMap['http.port'] ?? 0),
        httpsPort: Number(configMap['http.sslport'] ?? 0),
        rtspPort: Number(configMap['rtsp.port'] ?? 0),
        rtmpPort: Number(configMap['rtmp.port'] ?? 0),
        rtcPort: Number(configMap['rtc.port'] ?? 0),
        recordEnabled: configMap['protocol.enable_mp4'] === '1',
        segmentSeconds: Number(configMap['protocol.mp4_max_second'] ?? 0),
        recordPath: String(configMap['protocol.mp4_save_path'] ?? ''),
        recordApp: String(configMap['record.appName'] ?? ''),
        storage: databaseOf(ctx) === undefined ? 'local' : 'minio',
      },
      settings: settingsView().settings,
      secretSet: settings.secret !== '',
    }
  }

  /** Push the plugin's ports and recording settings into ZLMediaKit. */
  async function applyServerConfig() {
    const settings = liveSettings()
    requireSecret(settings)
    const current = await serverConfig(settings)
    const desired = {
      'http.port': String(settings.httpPort),
      'rtsp.port': String(settings.rtspPort),
      'rtmp.port': String(settings.rtmpPort),
      'rtc.port': String(settings.rtcPort),
      'rtc.tcpPort': String(settings.rtcPort),
      'protocol.enable_mp4': settings.recordEnabled ? '1' : '0',
      'protocol.mp4_max_second': String(settings.segmentSeconds),
      'protocol.mp4_save_path': settings.recordPath,
      'record.appName': settings.recordApp,
    }
    const patch = {}
    for (const [key, value] of Object.entries(desired)) {
      if (String(current[key] ?? '') !== value) patch[key] = value
    }
    const changed = Object.keys(patch)
    if (changed.length > 0) {
      try {
        await zlmCall(settings, 'setServerConfig', patch)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new MediaError('media-unavailable', `ZLMediaKit rejected the configuration: ${message}`, 503)
      }
    }
    const portKeys = new Set(['http.port', 'rtsp.port', 'rtmp.port', 'rtc.port', 'rtc.tcpPort'])
    return { changed, restartRequired: changed.some(key => portKeys.has(key)) }
  }

  /** Restart ZLMediaKit and wait until its API answers again. */
  async function restartServer() {
    const settings = liveSettings()
    requireSecret(settings)
    try {
      await zlmCall(settings, 'restartServer', {})
    } catch (error) {
      // ZLMediaKit closes the connection while restarting; the poll below is the authority.
      const message = error instanceof Error ? error.message : String(error)
      if (!/fetch failed|socket|ECONN|network/i.test(message)) throw error
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(1000)
      try {
        const version = await zlmCall(liveSettings(), 'version', {})
        return { online: true, version: isRecord(version) ? version : null }
      } catch (_notYet) {
        // Keep polling until the bounded window closes.
      }
    }
    throw new MediaError('media-unavailable', 'ZLMediaKit did not answer within 30 seconds after the restart', 503)
  }

  /** Start MP4 recording for one online stream. Playback still succeeds if recording cannot start. */
  async function ensureRecording(settings, app, stream) {
    try {
      await zlmCall(settings, 'startRecord', { type: '1', vhost: ZLM_VHOST, app, stream })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (alreadyExists(error) || /already|recording/i.test(message)) return
    }
  }

  /** Ensure one catalog stream is online, then return its playback URLs. */
  async function prepareStream(body) {
    const node = await requireStreamNode(requiredText(body.id, 'Stream id', 128))
    const settings = liveSettings()
    requireHost(settings)
    const status = await streamStatus(node.app, node.stream).catch(() => ({ online: false }))
    if (!status.online && node.sourceUrl !== '') {
      if (settings.secret === '') {
        throw new MediaError('media-not-configured', 'Set the ZLMediaKit API secret before pulling a source URL', 503)
      }
      await ensureProxy(settings, node)
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(500)
        const current = await streamStatus(node.app, node.stream).catch(() => ({ online: false }))
        if (current.online) {
          await ensureRecording(settings, node.app, node.stream)
          const recorded = await streamStatus(node.app, node.stream).catch(() => current)
          return { node, play: playUrls(settings, node.app, node.stream), status: recorded, proxied: true }
        }
      }
      return {
        node,
        play: playUrls(settings, node.app, node.stream),
        status: { online: false, recording: false, readers: 0, video: null, audio: null },
        proxied: true,
        warning: 'The source did not come online within 10 seconds. Check the source URL.',
      }
    }
    if (status.online) await ensureRecording(settings, node.app, node.stream)
    return {
      node,
      play: playUrls(settings, node.app, node.stream),
      status: await streamStatus(node.app, node.stream).catch(() => ({ online: false, recording: false, readers: 0, video: null, audio: null })),
      proxied: false,
    }
  }

  /** Proxy one WebRTC offer to ZLMediaKit and return its answer. */
  async function webrtcExchange(app, stream, offer) {
    const settings = liveSettings()
    requireHost(settings)
    const query = new URLSearchParams({
      app: requiredIdentifier(app, 'App', MAX_APP),
      stream: requiredIdentifier(stream, 'Stream id', MAX_STREAM),
      type: 'play',
    })
    const endpoint = `${zlmOrigin(settings)}/index/api/webrtc?${query.toString()}`
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: offer,
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new MediaError('media-unavailable', `WebRTC negotiation failed: ${reason}`, 503)
    }
    if (!response.ok) {
      throw new MediaError('media-unavailable', `ZLMediaKit returned HTTP ${String(response.status)} for WebRTC`, 503)
    }
    const answer = await response.json().catch(() => undefined)
    if (!isRecord(answer)) throw new MediaError('media-unavailable', 'ZLMediaKit returned an unexpected WebRTC answer', 503)
    return answer
  }

  /** One Fetch route guard mapping failures to JSON responses. */
  async function guarded(handler) {
    try {
      return await handler()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof MediaError) {
        return json({ error: error.code, message }, error.status)
      }
      ctx.logger?.warn?.('dsh-media: request failed: %s', message)
      return json({ error: 'internal', message }, 500)
    }
  }

  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'dsh-media: settings page policy')
  })

  ctx.inject(['connection'], (child) => {
    const routes = [
      {
        path: `${API}/tree`,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => guarded(async () => json({ nodes: sortedNodes(await catalog.tree()) })),
      },
      {
        path: `${API}/nodes`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => {
          const body = await readJsonBody(request)
          if (body.action === 'createFolder') return json({ node: projectNode(await createFolder(body)), nodes: sortedNodes(await catalog.tree()) })
          if (body.action === 'createStream') return json({ node: projectNode(await createStream(body)), nodes: sortedNodes(await catalog.tree()) })
          if (body.action === 'update') return json({ node: projectNode(await updateNode(body)), nodes: sortedNodes(await catalog.tree()) })
          if (body.action === 'delete') return json({ removed: await deleteNode(body), nodes: sortedNodes(await catalog.tree()) })
          throw new MediaError('invalid-input', 'Unknown node action', 400)
        }),
      },
      {
        path: `${API}/settings`,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => {
          if (request.method === 'GET') return json(settingsView())
          const patch = normalizeSettingsPatch(await readJsonBody(request))
          if (Object.keys(patch).length > 0) await settingsService().update(ENTRY_ID, patch)
          return json(settingsView())
        }),
      },
      {
        path: `${API}/server`,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => guarded(async () => json(await serverStatus())),
      },
      {
        path: `${API}/server/apply`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: () => guarded(async () => {
          const result = await applyServerConfig()
          return json(result)
        }),
      },
      {
        path: `${API}/server/restart`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: () => guarded(async () => json(await restartServer())),
      },
      {
        path: `${API}/status`,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => {
          const query = requestUrl(request).searchParams
          return json(await streamStatus(query.get('app') ?? '', query.get('stream') ?? ''))
        }),
      },
      {
        path: `${API}/prepare`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => json(await prepareStream(await readJsonBody(request)))),
      },
      {
        path: `${API}/recordings`,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => {
          const query = requestUrl(request).searchParams
          const nodeId = query.get('nodeId') ?? ''
          if (nodeId !== '') {
            const node = await requireStreamNode(nodeId)
            return json({ recordings: await listRecordings({ app: node.app, stream: node.stream, day: query.get('day') ?? '' }) })
          }
          return json({
            recordings: await listRecordings({
              app: query.get('app') ?? '',
              stream: query.get('stream') ?? '',
              day: query.get('day') ?? '',
            }),
          })
        }),
      },
      {
        path: `${API}/recordings/sync`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => json(await syncRecordings(await readJsonBody(request)))),
      },
      {
        path: `${API}/recording/content`,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => guarded(() => recordingResponse(request, false)),
      },
      {
        path: `${API}/recording/download`,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => guarded(() => recordingResponse(request, true)),
      },
      {
        path: `${API}/record`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => {
          const body = await readJsonBody(request)
          const settings = liveSettings()
          requireSecret(settings)
          const app = requiredIdentifier(body.app, 'App', MAX_APP)
          const stream = requiredIdentifier(body.stream, 'Stream id', MAX_STREAM)
          if (body.action === 'start') {
            try {
              await zlmCall(settings, 'startRecord', { type: '1', vhost: ZLM_VHOST, app, stream })
            } catch (error) {
              if (!alreadyExists(error)) throw error
            }
            return json({ recording: true })
          }
          if (body.action === 'stop') {
            await zlmCall(settings, 'stopRecord', { type: '1', vhost: ZLM_VHOST, app, stream }).catch((error) => {
              const message = error instanceof Error ? error.message : String(error)
              if (!/not recording|no record|未录制/i.test(message)) throw error
            })
            return json({ recording: false })
          }
          throw new MediaError('invalid-input', 'Unknown record action', 400)
        }),
      },
      {
        path: `${API}/webrtc`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: request => guarded(async () => {
          const query = requestUrl(request).searchParams
          const offer = await request.text()
          if (offer.trim() === '') throw new MediaError('invalid-input', 'A WebRTC offer is required', 400)
          const answer = await webrtcExchange(query.get('app') ?? '', query.get('stream') ?? '', offer)
          return new Response(JSON.stringify(answer), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
        }),
      },
    ]
    const disposers = routes.map(route => child.connection.fetch.register(route))
    child.effect(() => () => { for (const dispose of disposers) void dispose() }, 'dsh-media: Fetch routes')
  })

  ctx.inject(['tools'], (child) => {
    const TOOL_NODE_PROPERTIES = {
      id: { type: 'string', required: true },
      parentId: { type: 'string' },
      kind: { type: 'string', required: true },
      name: { type: 'string', required: true },
      app: { type: 'string', required: true },
      stream: { type: 'string', required: true },
      sourceUrl: { type: 'string', required: true },
      description: { type: 'string', required: true },
    }
    child.effect(() => {
      const disposers = [
        child.tools.register(defineTool({
          name: 'list_media_streams',
          description: 'List the streaming-media catalog tree. '
            + 'Returns every folder and stream node with its id, parent id, app, stream id, and source URL. '
            + 'Use the ids with add_media_stream or when the user asks which streams exist.',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                total: { type: 'integer', required: true },
                nodes: {
                  type: 'array',
                  required: true,
                  items: { type: 'object', additionalProperties: false, properties: TOOL_NODE_PROPERTIES },
                },
              },
            },
            render: (_args, value) => [{
              type: 'text',
              text: value.total === 0
                ? 'The media catalog is empty.'
                : value.nodes.map(node => `- ${node.kind} id=${node.id} parent=${node.parentId ?? 'root'} name=${JSON.stringify(node.name)}`
                  + (node.kind === 'stream' ? ` app=${node.app} stream=${node.stream} source=${node.sourceUrl || '(push)'}` : '')).join('\n'),
            }],
          },
          presentCall: () => ({ card: 'generic', kind: 'search', title: 'List media streams' }),
          async execute(_args, exec) {
            exec.signal.throwIfAborted()
            const nodes = sortedNodes(await catalog.tree())
            exec.signal.throwIfAborted()
            return { total: nodes.length, nodes: nodes.map(toolNode) }
          },
        })),

        child.tools.register(defineTool({
          name: 'add_media_stream',
          description: 'Add one stream to the streaming-media catalog tree. '
            + 'The stream appears on the Streaming media page. '
            + 'When sourceUrl is given the server pulls that URL into ZLMediaKit on first playback; '
            + 'leave it empty for a stream that a device publishes with RTMP or RTSP.',
          parameters: {
            name: { type: 'string', required: true, description: 'Display name of the stream.' },
            parentId: { type: 'string', description: 'Folder id from list_media_streams; omit for the root folder.' },
            app: { type: 'string', description: 'ZLMediaKit app name. Defaults to live.' },
            stream: { type: 'string', description: 'ZLMediaKit stream id. Defaults to a generated id.' },
            sourceUrl: { type: 'string', description: 'Optional absolute rtsp, rtmp, http, or https source URL to pull.' },
            description: { type: 'string', description: 'Optional notes about the stream.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { node: { type: 'object', required: true, additionalProperties: false, properties: TOOL_NODE_PROPERTIES } },
            },
            render: (_args, value) => [{ type: 'text', text: `Added media stream "${value.node.name}" (id ${value.node.id}, ${value.node.app}/${value.node.stream}).` }],
          },
          presentCall: args => ({ card: 'generic', kind: 'edit', title: `Add media stream "${args.name}"` }),
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const node = await createStream(args)
            exec.signal.throwIfAborted()
            return { node: toolNode(node) }
          },
        })),

        child.tools.register(defineTool({
          name: 'list_media_recordings',
          description: 'List stored recordings for one stream on one day. '
            + 'Continuous recording stores MP4 segments in MinIO (when the database plugin is present) or the local recording directory. '
            + 'Each recording carries a play URL and a download URL. '
            + 'Calling this also syncs newly finalized ZLMediaKit segments into storage.',
          parameters: {
            app: { type: 'string', required: true, description: 'ZLMediaKit app name, such as live.' },
            stream: { type: 'string', required: true, description: 'ZLMediaKit stream id.' },
            date: { type: 'string', description: 'Day as YYYY-MM-DD; defaults to today.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                date: { type: 'string', required: true },
                recordings: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', required: true },
                      startTime: { type: 'string', required: true },
                      durationSeconds: { type: 'integer', required: true },
                      sizeBytes: { type: 'integer', required: true },
                      storage: { type: 'string', required: true },
                      playUrl: { type: 'string', required: true },
                      downloadUrl: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
            render: (_args, value) => [{
              type: 'text',
              text: value.recordings.length === 0
                ? `No stored recordings on ${value.date}.`
                : `Stored recordings on ${value.date}:\n${value.recordings.map(item => `- ${item.startTime} ${String(item.durationSeconds)}s ${String(item.sizeBytes)}B ${item.storage} play=${item.playUrl} download=${item.downloadUrl}`).join('\n')}`,
            }],
          },
          presentCall: args => ({ card: 'generic', kind: 'search', title: `List recordings for ${args.app}/${args.stream}` }),
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const day = args.date === undefined || args.date === '' ? new Date().toISOString().slice(0, 10) : args.date
            const app = requiredIdentifier(args.app, 'App', MAX_APP)
            const stream = requiredIdentifier(args.stream, 'Stream id', MAX_STREAM)
            await ingestRecordings({ app, stream }, day)
            exec.signal.throwIfAborted()
            const items = await listRecordings({ app, stream, day })
            return {
              date: day,
              recordings: items.map(item => ({
                id: item.id,
                startTime: item.startTime,
                durationSeconds: item.durationSeconds,
                sizeBytes: item.sizeBytes,
                storage: item.storage,
                playUrl: item.playUrl,
                downloadUrl: item.downloadUrl,
              })),
            }
          },
        })),

        child.tools.register(defineTool({
          name: 'update_media_settings',
          description: 'Update the streaming-media plugin settings: ZLMediaKit host, HTTP port, HTTPS, API secret, '
            + 'RTSP/RTMP/WebRTC ports, and MP4 recording storage. Omit a field to keep its current value. '
            + 'Ports and recording changes are only written into ZLMediaKit by the plugin page\'s apply action; '
            + 'this tool updates the stored plugin settings.',
          parameters: {
            zlmHost: { type: 'string', description: 'ZLMediaKit host used by the server and playback URLs.' },
            zlmHttpPort: { type: 'integer', description: 'ZLMediaKit HTTP API port, 1-65535.' },
            zlmHttps: { type: 'boolean', description: 'Use HTTPS for the API and playback URLs.' },
            zlmSecret: { type: 'string', description: 'ZLMediaKit API secret. Leave empty to keep the saved one.' },
            rtspPort: { type: 'integer', description: 'RTSP port, 1-65535.' },
            rtmpPort: { type: 'integer', description: 'RTMP port, 1-65535.' },
            rtcPort: { type: 'integer', description: 'WebRTC port, 1-65535.' },
            recordEnabled: { type: 'boolean', description: 'Record every stream to MP4.' },
            segmentSeconds: { type: 'integer', description: 'MP4 segment length in seconds, 5-3600.' },
            recordLocalDir: { type: 'string', description: 'Local recording directory; empty uses $DSH_HOME/dsh-media/recordings.' },
            recordPath: { type: 'string', description: 'ZLMediaKit MP4 save path.' },
            recordApp: { type: 'string', description: 'ZLMediaKit recording app name.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                settings: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    zlmHost: { type: 'string', required: true },
                    zlmHttpPort: { type: 'integer', required: true },
                    zlmHttps: { type: 'boolean', required: true },
                    rtspPort: { type: 'integer', required: true },
                    rtmpPort: { type: 'integer', required: true },
                    rtcPort: { type: 'integer', required: true },
                    recordEnabled: { type: 'boolean', required: true },
                    segmentSeconds: { type: 'integer', required: true },
                    recordLocalDir: { type: 'string', required: true },
                    recordPath: { type: 'string', required: true },
                    recordApp: { type: 'string', required: true },
                  },
                },
                secretSet: { type: 'boolean', required: true },
              },
            },
            render: (_args, value) => [{
              type: 'text',
              text: `Media settings: host=${value.settings.zlmHost}:${String(value.settings.zlmHttpPort)} https=${String(value.settings.zlmHttps)} `
                + `secret=${value.secretSet ? 'set' : 'missing'} rtsp=${String(value.settings.rtspPort)} rtmp=${String(value.settings.rtmpPort)} `
                + `rtc=${String(value.settings.rtcPort)} record=${String(value.settings.recordEnabled)} segment=${String(value.settings.segmentSeconds)}s app=${value.settings.recordApp} path=${value.settings.recordPath}`,
            }],
          },
          presentCall: () => ({ card: 'generic', kind: 'edit', title: 'Update media settings' }),
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const body = { ...args }
            if (body.zlmSecret === '') delete body.zlmSecret
            const patch = normalizeSettingsPatch(body)
            if (Object.keys(patch).length > 0) await settingsService().update(ENTRY_ID, patch)
            const view = settingsView()
            exec.signal.throwIfAborted()
            return { settings: view.settings, secretSet: view.secretSet }
          },
        })),

        child.tools.register(defineTool({
          name: 'get_media_stream_status',
          description: 'Report whether one ZLMediaKit stream is online, how many readers it has, and whether it is recording. '
            + 'Use app and stream from list_media_streams.',
          parameters: {
            app: { type: 'string', required: true, description: 'ZLMediaKit app name.' },
            stream: { type: 'string', required: true, description: 'ZLMediaKit stream id.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                online: { type: 'boolean', required: true },
                recording: { type: 'boolean', required: true },
                readers: { type: 'integer', required: true },
                width: { type: 'integer' },
                height: { type: 'integer' },
                codec: { type: 'string' },
              },
            },
            render: (_args, value) => [{
              type: 'text',
              text: value.online
                ? `Stream is online. recording=${String(value.recording)} readers=${String(value.readers)}`
                  + (value.width === undefined ? '' : ` video=${String(value.width)}x${String(value.height)} ${value.codec ?? ''}`)
                : 'Stream is offline.',
            }],
          },
          presentCall: () => ({ card: 'generic', kind: 'search', title: 'Check media stream status' }),
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const status = await streamStatus(args.app, args.stream)
            exec.signal.throwIfAborted()
            const result = { online: status.online, recording: status.recording, readers: status.readers }
            if (status.video !== null && status.video !== undefined) {
              if (typeof status.video.width === 'number') result.width = status.video.width
              if (typeof status.video.height === 'number') result.height = status.video.height
              if (typeof status.video.codec === 'string') result.codec = status.video.codec
            }
            return result
          },
        })),

        child.tools.register(defineTool({
          name: 'open_media_stream',
          description: 'Bring one catalog stream online and return its playback addresses. '
            + 'When the stream has a source URL, this starts the ZLMediaKit pull proxy and waits for it. '
            + 'Use the returned hls, flv, rtsp, rtmp, and webrtc addresses for playback or for sharing with the user.',
          parameters: {
            id: { type: 'string', required: true, description: 'Catalog node id from list_media_streams.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                online: { type: 'boolean', required: true },
                warning: { type: 'string' },
                play: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    rtsp: { type: 'string', required: true },
                    rtmp: { type: 'string', required: true },
                    hls: { type: 'string', required: true },
                    flv: { type: 'string', required: true },
                    webrtc: { type: 'string', required: true },
                  },
                },
              },
            },
            render: (_args, value) => [{
              type: 'text',
              text: `${value.online ? 'Stream is online.' : `Stream is offline. ${value.warning ?? ''}`}`
                + ` webrtc=${value.play.webrtc} hls=${value.play.hls} flv=${value.play.flv} rtsp=${value.play.rtsp} rtmp=${value.play.rtmp}`,
            }],
          },
          presentCall: args => ({ card: 'generic', kind: 'search', title: `Open media stream ${args.id}` }),
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const prepared = await prepareStream({ id: args.id })
            exec.signal.throwIfAborted()
            const result = {
              online: prepared.status !== null && prepared.status !== undefined && prepared.status.online === true,
              play: prepared.play,
            }
            if (typeof prepared.warning === 'string') result.warning = prepared.warning
            return result
          },
        })),

        child.tools.register(defineTool({
          name: 'record_media_stream',
          description: 'Start or stop MP4 recording for one online ZLMediaKit stream. '
            + 'Recorded files are listed by list_media_recordings.',
          parameters: {
            action: { type: 'string', required: true, description: 'start or stop.' },
            app: { type: 'string', required: true, description: 'ZLMediaKit app name.' },
            stream: { type: 'string', required: true, description: 'ZLMediaKit stream id.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { recording: { type: 'boolean', required: true } },
            },
            render: (_args, value) => [{ type: 'text', text: value.recording ? 'Recording started.' : 'Recording stopped.' }],
          },
          presentCall: args => ({ card: 'generic', kind: 'edit', title: `${args.action === 'start' ? 'Start' : 'Stop'} recording ${args.app}/${args.stream}` }),
          async execute(args, exec) {
            exec.signal.throwIfAborted()
            const settings = liveSettings()
            requireSecret(settings)
            const app = requiredIdentifier(args.app, 'App', MAX_APP)
            const stream = requiredIdentifier(args.stream, 'Stream id', MAX_STREAM)
            if (args.action === 'start') {
              try {
                await zlmCall(settings, 'startRecord', { type: '1', vhost: ZLM_VHOST, app, stream })
              } catch (error) {
                if (!alreadyExists(error)) throw error
              }
              exec.signal.throwIfAborted()
              return { recording: true }
            }
            if (args.action === 'stop') {
              await zlmCall(settings, 'stopRecord', { type: '1', vhost: ZLM_VHOST, app, stream }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error)
                if (!/not recording|no record|未录制/i.test(message)) throw error
              })
              exec.signal.throwIfAborted()
              return { recording: false }
            }
            throw new MediaError('invalid-input', 'Action must be start or stop', 400)
          },
        })),

        child.tools.register(defineTool({
          name: 'apply_media_server_config',
          description: 'Write the stored plugin ports and MP4 recording settings into ZLMediaKit with setServerConfig. '
            + 'Returns the changed keys and whether a restart is required (port changes need one).',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                changed: { type: 'array', required: true, items: { type: 'string' } },
                restartRequired: { type: 'boolean', required: true },
              },
            },
            render: (_args, value) => [{
              type: 'text',
              text: value.changed.length === 0
                ? 'ZLMediaKit already matches the stored settings.'
                : `Applied to ZLMediaKit: ${value.changed.join(', ')}.${value.restartRequired ? ' Restart required for port changes.' : ''}`,
            }],
          },
          presentCall: () => ({ card: 'generic', kind: 'edit', title: 'Apply media server settings' }),
          async execute(_args, exec) {
            exec.signal.throwIfAborted()
            const result = await applyServerConfig()
            exec.signal.throwIfAborted()
            return result
          },
        })),

        child.tools.register(defineTool({
          name: 'get_media_server_status',
          description: 'Report whether ZLMediaKit is reachable and which ports and recording settings it currently runs. '
            + 'Use this to diagnose playback or recording failures.',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                online: { type: 'boolean', required: true },
                error: { type: 'string' },
              },
            },
            render: (_args, value) => [{ type: 'text', text: value.online ? 'ZLMediaKit is reachable.' : `ZLMediaKit is not reachable: ${value.error ?? 'unknown reason'}` }],
          },
          presentCall: () => ({ card: 'generic', kind: 'search', title: 'Check media server status' }),
          async execute(_args, exec) {
            exec.signal.throwIfAborted()
            const status = await serverStatus()
            exec.signal.throwIfAborted()
            return status.online ? { online: true } : { online: false, error: status.error }
          },
        })),
      ]
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-media: tools')
  })
}
