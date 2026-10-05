import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'
import { applyDatingTransition, backfillExpectedReturn } from '@/domain/dating-machine'

// 测年送检的统一出入口：列表、详情、归档三个入口都走这里，
// 状态判断只有 dating-machine 一份，入口之间不会再各写一套。
const KEY = 'dating'

function loadRows(): EntryRow[] {
  const rows = listRows(KEY)
  const { rows: migrated, changed } = backfillExpectedReturn(rows)
  if (changed > 0) {
    // 存量记录缺预计返回日的按采集顺序回填后落盘，只补缺失值，不改原有字段
    saveRows(KEY, migrated)
  }
  return migrated
}

export function listDatingEntries(filters: Record<string, string> = {}): PageResult {
  const rows = loadRows()
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched =
    pairs.length === 0
      ? rows
      : rows.filter((row) =>
          pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
        )
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getDatingEntry(id: number): EntryRow | null {
  return loadRows().find((row) => Number(row.id) === id) ?? null
}

export function runDatingAction(id: number, action: string): ActionResult {
  const rows = loadRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的测年送检单` }
  }
  const result = applyDatingTransition(rows[index], action)
  if (!result.ok) {
    return { ok: false, message: result.message }
  }
  const next = [...rows]
  next[index] = result.row
  saveRows(KEY, next)
  return { ok: true, message: result.message }
}
