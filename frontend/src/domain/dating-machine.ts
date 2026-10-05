import type { EntryRow } from '@/data/types'

// 测年送检状态机：列表、详情、归档三个入口共用这一份状态判断，
// 任何入口都不再自己写状态逻辑。冲突时人工归档结论优先于自动推断；
// 历史送检单按记录上原样的送检方法和送检日期解释，不按新规则重算。

export const DATING_STATUSES = ['待送检', '已送检', '检测中', '已出结果', '已归档'] as const
export type DatingStatus = (typeof DATING_STATUSES)[number]

export const DATING_ACTIONS = ['送出检测', '登记结果', '归档报告'] as const
export type DatingAction = (typeof DATING_ACTIONS)[number]

// 合法迁移表：状态只能往前走，已归档没有任何出边，从根上挡住
// 「已出结果回到检测中」「已归档再次送检」这类错位。
const TRANSITIONS: Record<string, { from: readonly DatingStatus[]; to: DatingStatus }> = {
  送出检测: { from: ['待送检'], to: '已送检' },
  登记结果: { from: ['已送检', '检测中'], to: '已出结果' },
  归档报告: { from: ['已出结果'], to: '已归档' },
}

// 各送检方法的常规检测周期（天）：推断预计返回日和检测进度都按记录自身的送检方法取。
const METHOD_TURNAROUND: readonly [RegExp, number][] = [
  [/加速器|AMS/i, 45],
  [/碳十四|14C/i, 60],
  [/树轮/, 30],
  [/光释光/, 90],
  [/热释光/, 90],
  [/铀系/, 120],
]
export const DEFAULT_TURNAROUND_DAYS = 60

export function turnaroundDays(method: string): number {
  for (const [pattern, days] of METHOD_TURNAROUND) {
    if (pattern.test(method)) {
      return days
    }
  }
  return DEFAULT_TURNAROUND_DAYS
}

export function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function parseDateText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return text
}

function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split('-').map(Number)
  const time = Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000
  return new Date(time).toISOString().slice(0, 10)
}

function normalizeStatus(value: unknown): DatingStatus | null {
  const text = String(value ?? '').trim()
  return (DATING_STATUSES as readonly string[]).includes(text) ? (text as DatingStatus) : null
}

function statusRank(status: DatingStatus): number {
  return DATING_STATUSES.indexOf(status)
}

/** 自动推断：只看记录自身的送检日期、预计返回日，不读取也不改动人工结论。 */
export function inferDatingStatus(row: EntryRow, today: string = todayText()): DatingStatus {
  const sendDate = parseDateText(row['送检日期'])
  if (!sendDate) {
    return '待送检'
  }
  if (today < sendDate) {
    return '已送检'
  }
  const expected = parseDateText(row['预计返回'])
  if (!expected) {
    return '检测中'
  }
  return today < expected ? '检测中' : '已出结果'
}

/**
 * 当前状态：人工归档结论优先于自动推断；其余冲突取流程上更靠后的状态，
 * 推断只能把状态往前推进，不能把人工结论往回拉。
 */
export function resolveDatingStatus(row: EntryRow, today: string = todayText()): DatingStatus {
  const manual = normalizeStatus(row.status)
  if (manual === '已归档') {
    return '已归档'
  }
  const inferred = inferDatingStatus(row, today)
  if (!manual) {
    return inferred
  }
  return statusRank(inferred) > statusRank(manual) ? inferred : manual
}

/** 当前状态下状态机允许执行的动作，入口只渲染这些按钮。 */
export function availableDatingActions(row: EntryRow, today: string = todayText()): DatingAction[] {
  const current = resolveDatingStatus(row, today)
  return DATING_ACTIONS.filter((action) => TRANSITIONS[action].from.includes(current))
}

export type DatingTransitionResult =
  | { ok: true; message: string; row: EntryRow }
  | { ok: false; message: string }

/** 执行一次状态迁移：纯函数，不改入参；归档字段只写一次，二次写入只能读取原值。 */
export function applyDatingTransition(
  row: EntryRow,
  action: string,
  today: string = todayText(),
): DatingTransitionResult {
  const rule = TRANSITIONS[action]
  if (!rule) {
    return { ok: false, message: `测年送检单没有登记「${action}」这个动作` }
  }
  const current = resolveDatingStatus(row, today)
  if (current === rule.to) {
    return { ok: false, message: `测年送检单已经是「${rule.to}」，不用重复操作` }
  }
  if (!rule.from.includes(current)) {
    return { ok: false, message: `测年送检单当前状态「${current}」，不能执行「${action}」` }
  }
  const next: EntryRow = {
    ...row,
    status: rule.to,
    pending: rule.to !== '已归档',
    abnormal: false,
  }
  if (action === '送出检测') {
    if (!parseDateText(next['送检日期'])) {
      next['送检日期'] = today
    }
    if (!parseDateText(next['预计返回'])) {
      const base = parseDateText(next['送检日期']) ?? today
      next['预计返回'] = addDays(base, turnaroundDays(String(next['送检方法'] ?? '')))
    }
  }
  if (action === '归档报告') {
    // 归档二次写入只能读取不能覆盖原值：已写入的归档字段原样保留，只补空缺
    next['归档日期'] = parseDateText(row['归档日期']) ?? today
    next['归档结论'] = String(row['归档结论'] ?? '').trim() || '报告已归档'
  }
  return { ok: true, message: `测年送检单已${action}，当前状态「${rule.to}」`, row: next }
}

/**
 * 存量记录回填：按采集顺序（id 升序）逐条处理，缺预计返回日的按
 * 「送检日期 + 该记录原送检方法的常规周期」补齐；自身缺送检日期但已送出的，
 * 沿用上一条采集记录的送检日期（同批送检）；已有预计返回日的保留原值不动。
 */
export function backfillExpectedReturn(rows: EntryRow[]): { rows: EntryRow[]; changed: number } {
  const ordered = [...rows].sort((a, b) => Number(a.id) - Number(b.id))
  let batchSendDate: string | null = null
  let changed = 0
  const nextRows = ordered.map((row) => {
    const ownSendDate = parseDateText(row['送检日期'])
    if (ownSendDate) {
      batchSendDate = ownSendDate
    }
    if (parseDateText(row['预计返回'])) {
      return row
    }
    const manual = normalizeStatus(row.status)
    const sent = ownSendDate !== null || (manual !== null && manual !== '待送检')
    if (!sent) {
      return row
    }
    const base = ownSendDate ?? batchSendDate
    if (!base) {
      return row
    }
    changed += 1
    return { ...row, 预计返回: addDays(base, turnaroundDays(String(row['送检方法'] ?? ''))) }
  })
  return { rows: nextRows, changed }
}
