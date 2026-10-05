/**
 * 测年送检的数据服务：列表、详情、归档工作台三处入口的唯一读写出口。
 *
 * - 读取时先执行一次性回填：存量记录缺少「预计返回」时，按采集顺序
 *   （送检编号/编号升序）依次依其原送检方法的常规周期回填，历史送检单的
 *   原送检方法、原送检日期一律保留；
 * - 所有动作都交给同一份状态机校验，已归档终态拒绝再次送检/登记结果，
 *   任何入口都不可能把单据写回更早的状态；
 * - 归档字段首次写入后只允许读取，二次归档只能读取原值、不能覆盖。
 */
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import {
  ACTION_CONCLUSION,
  addISODays,
  allowedActions,
  ARCHIVE_FIELDS,
  type ArchiveField,
  type ArchivePayload,
  type DatingAction,
  EXPECTED_DATE_FIELD,
  isDatingAction,
  MANUAL_CONCLUSION_FIELD,
  parseISODate,
  type ResolvedDatingState,
  resolveDatingState,
  RETURNED_DATE_FIELD,
  SENT_DATE_FIELD,
  METHOD_FIELD,
  todayISO,
  turnaroundDays,
} from '@/data/dating/state-machine'

const MODULE_KEY = 'dating'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 采集顺序：优先送检编号，其次记录 id，均按升序。 */
function collectionOrder(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) => {
    const codeA = String(a['送检编号'] ?? '')
    const codeB = String(b['送检编号'] ?? '')
    if (codeA !== codeB) {
      return codeA.localeCompare(codeB, 'zh-Hans-CN')
    }
    return Number(a.id) - Number(b.id)
  })
}

/**
 * 存量数据回填：预计返回缺失或不是合法日期时，
 * 以该单原送检日期（缺失则沿采集顺序借用上一张已送检测单的送检日期）
 * 加原送检方法的常规周期推算。只补空缺，绝不改动任何已存在的字段值。
 */
function backfillExpectedDates(rows: EntryRow[]): boolean {
  let changed = false
  let lastSentDate: string | null = null

  for (const row of collectionOrder(rows)) {
    const sent = parseISODate(row[SENT_DATE_FIELD]) ?? lastSentDate
    if (!parseISODate(row[EXPECTED_DATE_FIELD]) && sent) {
      row[EXPECTED_DATE_FIELD] = addISODays(sent, turnaroundDays(row[METHOD_FIELD]))
      changed = true
    }
    if (parseISODate(row[SENT_DATE_FIELD])) {
      lastSentDate = parseISODate(row[SENT_DATE_FIELD])
    }
  }
  return changed
}

function persist(rows: EntryRow[]): void {
  saveRows(MODULE_KEY, rows)
}

/**
 * 读取并规整测年数据：补全预计返回，并把通用 status 同步为状态机的权威状态。
 * 每次入口加载都执行，保证列表/详情/归档工作台看到同一结论。
 */
function readRows(): EntryRow[] {
  const rows = clone(listRows(MODULE_KEY))
  const backfilled = backfillExpectedDates(rows)

  let synced = false
  for (const row of rows) {
    const resolved = resolveDatingState(row)
    if (row.status !== resolved.state) {
      row.status = resolved.state
      synced = true
    }
    row.pending = resolved.state !== '已归档'
  }

  if (backfilled || synced) {
    persist(rows)
  }
  return rows
}

export type DatingRow = EntryRow

export type DatingListResult = {
  items: DatingRow[]
  total: number
}

export function listDatingEntries(filters: Record<string, string> = {}): DatingListResult {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const items = readRows().filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
  return { items, total: items.length }
}

export function getDatingEntry(id: number): { row: DatingRow; resolved: ResolvedDatingState } | null {
  const row = readRows().find((item) => Number(item.id) === id)
  if (!row) {
    return null
  }
  return { row, resolved: resolveDatingState(row) }
}

/** 只回写状态机结论及允许的事实字段，列表与详情共用。 */
function writeConclusion(index: number, rows: EntryRow[], action: DatingAction, patch: Partial<Record<string, string>>): void {
  const current = rows[index]
  const today = todayISO()

  if (action === '送出检测') {
    if (!parseISODate(current[SENT_DATE_FIELD])) {
      current[SENT_DATE_FIELD] = patch[SENT_DATE_FIELD] ?? today
    }
    if (!parseISODate(current[EXPECTED_DATE_FIELD])) {
      const sent = parseISODate(current[SENT_DATE_FIELD]) as string
      current[EXPECTED_DATE_FIELD] = addISODays(sent, turnaroundDays(current[METHOD_FIELD]))
    }
  } else if (action === '登记结果') {
    if (!parseISODate(current[RETURNED_DATE_FIELD])) {
      current[RETURNED_DATE_FIELD] = patch[RETURNED_DATE_FIELD] ?? today
    }
  }

  current[MANUAL_CONCLUSION_FIELD] = ACTION_CONCLUSION[action]
  const resolved = resolveDatingState(current)
  current.status = resolved.state
  current.pending = resolved.state !== '已归档'
  rows[index] = current
}

/** 归档写入：已有值的归档字段保持原值，只填补空缺字段。 */
function writeArchiveOnce(current: EntryRow, payload: ArchivePayload): { written: ArchiveField[]; skipped: ArchiveField[] } {
  const written: ArchiveField[] = []
  const skipped: ArchiveField[] = []
  for (const field of ARCHIVE_FIELDS) {
    const existing = String(current[field] ?? '').trim()
    const incoming = String(payload[field] ?? '').trim()
    if (existing) {
      skipped.push(field)
    } else if (incoming) {
      current[field] = incoming
      written.push(field)
    }
  }
  return { written, skipped }
}

/**
 * 三处入口统一调用的动作入口。
 * 返回结果会说明本次是否真正发生写入；归档二次调用只读取，不覆盖。
 */
export function runDatingAction(
  id: number,
  action: string,
  payload: ArchivePayload & Partial<Record<string, string>> = {},
): ActionResult & { readonly?: boolean; skipped?: string[] } {
  if (!isDatingAction(action)) {
    return { ok: false, message: `测年送检单没有登记「${action}」这个动作` }
  }
  const rows = readRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的测年送检单` }
  }

  const current = rows[index]
  const resolved = resolveDatingState(current)

  // 已归档是终态：再次送检等任何写动作一律拒绝。
  if (resolved.state === '已归档') {
    if (action === '归档报告') {
      // 二次归档只能读取：逐字段报告原值已锁定，不执行任何写入、不落盘。
      const skipped = ARCHIVE_FIELDS.filter((field) => String(current[field] ?? '').trim() !== '')
      return {
        ok: true,
        readonly: true,
        skipped,
        message: '该送检单已归档，归档结论以首次写入为准，本次只读取原值、未做任何覆盖',
      }
    }
    return { ok: false, message: `送检单已归档（人工归档结论），不能再执行「${action}」` }
  }

  if (!allowedActions(resolved.state).includes(action)) {
    return {
      ok: false,
      message: `当前状态「${resolved.state}」不允许执行「${action}」，可执行：${allowedActions(resolved.state).join('、') || '无'}`,
    }
  }

  if (action === '归档报告') {
    const { written, skipped } = writeArchiveOnce(current, payload)
    current[MANUAL_CONCLUSION_FIELD] = ACTION_CONCLUSION.归档报告
    const after = resolveDatingState(current)
    current.status = after.state
    current.pending = false
    persist(rows)
    const suffix = skipped.length
      ? `；${skipped.join('、')}已有原值，保持不覆盖`
      : written.length
        ? `，写入字段：${written.join('、')}`
        : ''
    return { ok: true, skipped, message: `送检单已归档${suffix}，人工归档结论优先于自动推断` }
  }

  writeConclusion(index, rows, action, payload)
  persist(rows)
  const target = resolveDatingState(rows[index]).state
  return { ok: true, message: `送检单已${action}，当前状态「${target}」` }
}

export function resetDatingModule(): DatingListResult {
  resetRows(MODULE_KEY)
  return listDatingEntries()
}

export type DatingStats = {
  total: number
  inLab: number
  resultReady: number
  archived: number
  overdue: number
}

/** 看板统计同样以状态机的权威状态为准，不在页面里另写判断。 */
export function datingStats(): DatingStats {
  const rows = readRows()
  return {
    total: rows.length,
    inLab: rows.filter((row) => ['已送检', '检测中'].includes(resolveDatingState(row).state)).length,
    resultReady: rows.filter((row) => resolveDatingState(row).state === '已出结果').length,
    archived: rows.filter((row) => resolveDatingState(row).state === '已归档').length,
    overdue: rows.filter((row) => resolveDatingState(row).overdue).length,
  }
}
