/**
 * 测年送检的唯一状态机（纯逻辑，不碰存储与界面）。
 *
 * 测年送检列表、送检单详情、归档工作台三处入口的状态判断一律走这里，
 * 任何视图都不得再自行编写状态流转或归档判定。
 *
 * 状态链（只能单向前进，不允许回退）：
 *   待送检 → 已送检 → 检测中 → 已出结果 → 已归档
 *
 * 状态来源分两类：
 *   - 自动推断：依据送检日期、预计返回日、结果返回日与当前日期推断；
 *   - 人工结论：人工动作（送出检测/登记结果/归档报告）写下的明确结论。
 * 冲突时人工归档结论永远优先；其余人工结论与自动推断按状态链取更靠前者
 * （时间自然推移可把「已送检」推进到「检测中」，但任何推断都不能把
 * 「已出结果」拉回「检测中」，也不能动摇「已归档」）。
 *
 * 历史送检单仍按其原送检方法与原送检日期解释，推断与回填都不改动这两个原值。
 */
import type { EntryRow } from '../types'

export const DATING_STATES = ['待送检', '已送检', '检测中', '已出结果', '已归档'] as const
export type DatingState = (typeof DATING_STATES)[number]

export const DATING_ACTIONS = ['送出检测', '登记结果', '归档报告'] as const
export type DatingAction = (typeof DATING_ACTIONS)[number]

/** 三个人工动作分别落定的人工结论态。 */
export const ACTION_CONCLUSION: Record<DatingAction, DatingState> = {
  送出检测: '已送检',
  登记结果: '已出结果',
  归档报告: '已归档',
}

const STATE_RANK: Record<DatingState, number> = {
  待送检: 0,
  已送检: 1,
  检测中: 2,
  已出结果: 3,
  已归档: 4,
}

/** 归档结论字段：首次归档写入后只能读取，二次归档不得覆盖原值。 */
export const ARCHIVE_FIELDS = ['归档编号', '归档日期', '归档人', '归档备注'] as const
export type ArchiveField = (typeof ARCHIVE_FIELDS)[number]

export type ArchivePayload = Partial<Record<ArchiveField, string>>

/** 结论来源：人工归档结论 / 人工结论 / 日期自动推断 / 初始登记。 */
export type StateSource = 'manual-archive' | 'manual' | 'auto' | 'initial'

export type ResolvedDatingState = {
  state: DatingState
  source: StateSource
  /** 记录在案的人工结论态，没有则为 null。 */
  manual: DatingState | null
  /** 仅凭日期推断出的状态。 */
  inferred: DatingState
  /** 已过预计返回日但仍没有结果返回日。 */
  overdue: boolean
}

export const SENT_DATE_FIELD = '送检日期'
export const EXPECTED_DATE_FIELD = '预计返回'
export const RETURNED_DATE_FIELD = '结果返回日'
export const METHOD_FIELD = '送检方法'
/** 人工动作落定的结论态，独立于通用 status 字段，避免被旧值干扰。 */
export const MANUAL_CONCLUSION_FIELD = '人工结论'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDatingState(value: unknown): value is DatingState {
  return typeof value === 'string' && (DATING_STATES as readonly string[]).includes(value)
}

export function isDatingAction(value: unknown): value is DatingAction {
  return typeof value === 'string' && (DATING_ACTIONS as readonly string[]).includes(value)
}

export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

/** 仅接受 YYYY-MM-DD 且日历上真实存在的日期。 */
export function parseISODate(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
    return null
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return value
}

export function addISODays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return toISODate(new Date(year, month - 1, day + days))
}

/**
 * 不同测年方法的实验室常规周期（天）。历史送检单按其原送检方法取对应周期，
 * 方法缺省或无法辨认时按通用 30 天解释。
 */
const METHOD_TURNAROUND_DAYS: ReadonlyArray<{ match: RegExp; days: number }> = [
  { match: /碳[-—\s]?14|碳十四|^14?C$|C14|AMS|加速器/i, days: 45 },
  { match: /光释光|释光|OSL|热释光|TL/i, days: 60 },
  { match: /树轮|年轮/i, days: 30 },
  { match: /古地磁/i, days: 40 },
]
const DEFAULT_TURNAROUND_DAYS = 30

export function turnaroundDays(method: unknown): number {
  const text = String(method ?? '').trim()
  if (!text) {
    return DEFAULT_TURNAROUND_DAYS
  }
  const hit = METHOD_TURNAROUND_DAYS.find((item) => item.match.test(text))
  return hit ? hit.days : DEFAULT_TURNAROUND_DAYS
}

function readManualConclusion(record: EntryRow): DatingState | null {
  const value = record[MANUAL_CONCLUSION_FIELD]
  return isDatingState(value) ? value : null
}

type Inferred = { state: DatingState; overdue: boolean }

/**
 * 自动推断：只依据送检日期、结果返回日、预计返回日与今天。
 * 推断结果一律不超前于「已出结果」，归档只能来自人工结论。
 */
export function inferDatingState(record: EntryRow, today: string = todayISO()): Inferred {
  const sent = parseISODate(record[SENT_DATE_FIELD])
  const expected = parseISODate(record[EXPECTED_DATE_FIELD])
  const returned = parseISODate(record[RETURNED_DATE_FIELD])

  if (returned && returned <= today) {
    return { state: '已出结果', overdue: false }
  }
  if (sent && sent <= today) {
    return { state: '检测中', overdue: Boolean(expected && expected < today && !returned) }
  }
  // 未登记送检日期，或送检日期还在未来：仍处待送检。
  return { state: '待送检', overdue: false }
}

/**
 * 合并人工结论与自动推断，得到唯一权威状态。人工归档结论绝对优先；
 * 其余情形按状态链单向取更靠前者，杜绝任何状态回退。
 */
export function resolveDatingState(record: EntryRow, today: string = todayISO()): ResolvedDatingState {
  const inferred = inferDatingState(record, today)
  const manual = readManualConclusion(record)

  if (manual === '已归档') {
    return { state: '已归档', source: 'manual-archive', manual, inferred: inferred.state, overdue: false }
  }
  if (manual) {
    const useManual = STATE_RANK[manual] >= STATE_RANK[inferred.state]
    return {
      state: useManual ? manual : inferred.state,
      source: useManual ? 'manual' : 'auto',
      manual,
      inferred: inferred.state,
      overdue: useManual ? false : inferred.overdue,
    }
  }
  return {
    state: inferred.state,
    source: inferred.state === '待送检' ? 'initial' : 'auto',
    manual: null,
    inferred: inferred.state,
    overdue: inferred.overdue,
  }
}

/** 当前状态下允许执行的人工动作（严格沿状态链前进，已归档终态无动作）。 */
export function allowedActions(state: DatingState): DatingAction[] {
  switch (state) {
    case '待送检':
      return ['送出检测']
    case '已送检':
    case '检测中':
      return ['登记结果']
    case '已出结果':
      return ['归档报告']
    case '已归档':
      return []
  }
}

export function canRunAction(action: DatingAction, state: DatingState): boolean {
  return allowedActions(state).includes(action)
}

export function isTerminal(state: DatingState): boolean {
  return state === '已归档'
}

export const SOURCE_LABELS: Record<StateSource, string> = {
  'manual-archive': '人工归档结论',
  manual: '人工结论',
  auto: '日期自动推断',
  initial: '初始登记',
}
