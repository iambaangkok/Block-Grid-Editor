import { cloneAssembly } from './workspace'
import { CELL_KINDS, type Assembly, type KeyPiece, type Placement, type UnitCell, type Workspace } from './types'

// JSON export/import. Files are tagged so a single assembly and a whole workspace can be told
// apart on import. Imported assemblies always get fresh ids so they never collide.

export const FORMAT = 'block-grid-editor'
export const FORMAT_VERSION = 1

export interface WorkspaceFile {
  format: typeof FORMAT
  version: number
  kind: 'workspace'
  exportedAt: string
  assemblies: Assembly[]
}

export interface AssemblyFile {
  format: typeof FORMAT
  version: number
  kind: 'assembly'
  exportedAt: string
  assembly: Assembly
}

export function exportWorkspace(ws: Workspace): string {
  const file: WorkspaceFile = {
    format: FORMAT,
    version: FORMAT_VERSION,
    kind: 'workspace',
    exportedAt: new Date().toISOString(),
    assemblies: ws.assemblies,
  }
  return JSON.stringify(file, null, 2)
}

export function exportAssembly(a: Assembly): string {
  const file: AssemblyFile = {
    format: FORMAT,
    version: FORMAT_VERSION,
    kind: 'assembly',
    exportedAt: new Date().toISOString(),
    assembly: a,
  }
  return JSON.stringify(file, null, 2)
}

export class ImportError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function fail(path: string, msg: string): never {
  throw new ImportError(`${path}: ${msg}`)
}

function parseCell(v: unknown, path: string): UnitCell {
  if (!isObj(v)) fail(path, 'expected an object')
  if (!isInt(v.x) || !isInt(v.y)) fail(path, 'x and y must be integers')
  if (!CELL_KINDS.includes(v.kind as never)) fail(path, `unknown kind ${String(v.kind)}`)
  const dir = v.dir ?? 0
  if (!isInt(dir) || dir < 0 || dir > 3) fail(path, 'dir must be 0–3')
  return { x: v.x, y: v.y, kind: v.kind as UnitCell['kind'], dir: dir as UnitCell['dir'] }
}

function parsePiece(v: unknown, path: string): KeyPiece {
  if (!isObj(v)) fail(path, 'expected an object')
  if (!isStr(v.id) || !isStr(v.name)) fail(path, 'id and name must be strings')
  if (!isStr(v.fill) || !isStr(v.border)) fail(path, 'fill and border must be strings')
  if (!Array.isArray(v.cells)) fail(path, 'cells must be an array')
  const seen = new Set<string>()
  const cells = v.cells.map((c, i) => parseCell(c, `${path}.cells[${i}]`))
  for (const c of cells) {
    const k = `${c.x},${c.y}`
    if (seen.has(k)) fail(path, `two cells at ${k}`)
    seen.add(k)
  }
  return { id: v.id, name: v.name, fill: v.fill, border: v.border, cells }
}

function parsePlacement(v: unknown, path: string): Placement {
  if (!isObj(v)) fail(path, 'expected an object')
  if (!isStr(v.id) || !isStr(v.pieceId)) fail(path, 'id and pieceId must be strings')
  if (!isInt(v.x) || !isInt(v.y)) fail(path, 'x and y must be integers')
  const rot = v.rot ?? 0
  if (!isInt(rot) || rot < 0 || rot > 3) fail(path, 'rot must be 0–3')
  return {
    id: v.id,
    pieceId: v.pieceId,
    x: v.x,
    y: v.y,
    rot: rot as Placement['rot'],
    mirror: v.mirror === true,
  }
}

export function parseAssembly(v: unknown, path = 'assembly'): Assembly {
  if (!isObj(v)) fail(path, 'expected an object')
  if (!isStr(v.id) || !isStr(v.name)) fail(path, 'id and name must be strings')
  if (!Array.isArray(v.pieces) || !Array.isArray(v.placements))
    fail(path, 'pieces and placements must be arrays')
  const pieces = v.pieces.map((p, i) => parsePiece(p, `${path}.pieces[${i}]`))
  const ids = new Set(pieces.map((p) => p.id))
  const placements = v.placements
    .map((p, i) => parsePlacement(p, `${path}.placements[${i}]`))
    .filter((p) => ids.has(p.pieceId))
  const now = Date.now()
  return {
    id: v.id,
    name: v.name,
    pieces,
    placements,
    createdAt: isInt(v.createdAt) ? v.createdAt : now,
    updatedAt: isInt(v.updatedAt) ? v.updatedAt : now,
  }
}

/** Parse any export file into a list of assemblies with fresh ids. */
export function parseImport(text: string): Assembly[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportError('Not valid JSON')
  }
  if (!isObj(data) || data.format !== FORMAT) throw new ImportError('Not a block-grid-editor file')
  if (!isInt(data.version) || data.version > FORMAT_VERSION)
    throw new ImportError(`Unsupported file version ${String(data.version)}`)
  if (data.kind === 'assembly') return [cloneAssembly(parseAssembly(data.assembly))]
  if (data.kind === 'workspace') {
    if (!Array.isArray(data.assemblies)) throw new ImportError('assemblies must be an array')
    return data.assemblies.map((a, i) => cloneAssembly(parseAssembly(a, `assemblies[${i}]`)))
  }
  throw new ImportError(`Unknown file kind ${String(data.kind)}`)
}

/** Restore the persisted workspace; returns null if missing or corrupt. */
export function parseStoredWorkspace(text: string | null): Workspace | null {
  if (!text) return null
  try {
    const data: unknown = JSON.parse(text)
    if (!isObj(data) || !Array.isArray(data.assemblies)) return null
    const assemblies = data.assemblies.map((a, i) => parseAssembly(a, `assemblies[${i}]`))
    const active = isStr(data.activeAssemblyId) ? data.activeAssemblyId : null
    return {
      assemblies,
      activeAssemblyId: assemblies.some((a) => a.id === active) ? active : (assemblies[0]?.id ?? null),
    }
  } catch {
    return null
  }
}
