// 状态机与测年服务的行为校验（node 下运行，mock window.localStorage）。
// 固定「今天」为 2026-10-05，与 currentDate 一致。
function mockStorage(seed) {
  const store = new Map()
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  globalThis.window = { localStorage: ls }
  globalThis.localStorage = ls
  if (seed) {
    ls.setItem('field-archaeology-digital:entries', JSON.stringify(seed))
  }
}
mockStorage()

// 预置一组测年数据：缺预计返回、含不同方法、各状态。
const seedDating = [
  { id: 1, status: '待送检', pending: true, abnormal: false, '送检编号': 'DATI-0001', '样品类型': '炭样', '采样单位': 'H1', '采样层位': '③', '送检方法': '碳十四', '送检日期': '2026-09-01' },
  { id: 2, status: '已送检', pending: true, abnormal: true, '送检编号': 'DATI-0002', '样品类型': '陶片', '采样单位': 'H2', '采样层位': '④', '送检方法': '释光(OSL)', '送检日期': '2026-09-02' },
  { id: 3, status: '检测中', pending: false, abnormal: false, '送检编号': 'DATI-0003', '样品类型': '骨骼', '采样单位': 'M3', '采样层位': '②', '送检方法': '常规', '送检日期': '2026-09-03' },
  { id: 4, status: '待送检', pending: true, abnormal: false, '送检编号': 'DATI-0004', '样品类型': '炭样', '采样单位': 'H4', '采样层位': '①', '送检方法': '碳十四' },
  { id: 5, status: '检测中', pending: true, abnormal: false, '送检编号': 'DATI-0005', '样品类型': '炭样', '采样单位': 'H5', '采样层位': '⑤', '送检方法': '碳十四', '送检日期': '2026-10-01', '人工结论': '已出结果', '结果返回日': '2026-10-04' },
  { id: 6, status: '已归档', pending: false, abnormal: false, '送检编号': 'DATI-0006', '样品类型': '炭样', '采样单位': 'H6', '采样层位': '⑥', '送检方法': '碳十四', '送检日期': '2025-01-01', '人工结论': '已归档', '归档编号': 'ARC-0006', '归档日期': '2025-03-01', '归档人': '张三', '归档备注': '原始结论' },
]
mockStorage({ dating: seedDating })

const sm = require('./src/data/dating/state-machine.ts')
const svc = require('./src/api/dating-service.ts')

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name, extra ?? '') }
}
const TODAY = '2026-10-05'

// ---- 自动推断 ----
check('已送检且过了送检日 -> 检测中(自动)',
  sm.resolveDatingState(seedDating[0], TODAY).state === '检测中' &&
  sm.resolveDatingState(seedDating[0], TODAY).source === 'auto')
check('缺送检日期 -> 待送检(initial)',
  sm.resolveDatingState(seedDating[3], TODAY).state === '待送检' &&
  sm.resolveDatingState(seedDating[3], TODAY).source === 'initial')
check('人工已出结果即使日期仍在检测周期 -> 保持已出结果，不回退',
  sm.resolveDatingState(seedDating[4], TODAY).state === '已出结果' &&
  sm.resolveDatingState(seedDating[4], TODAY).source === 'manual')
check('人工归档结论优先于自动推断（哪怕日期再久）',
  sm.resolveDatingState(seedDating[5], TODAY).state === '已归档' &&
  sm.resolveDatingState(seedDating[5], TODAY).source === 'manual-archive')
check('逾期：预计返回早于今天且无结果日',
  sm.resolveDatingState({ '送检日期': '2026-08-01', '预计返回': '2026-09-15' }, TODAY).overdue === true)
check('周期表：碳十四45天 / 释光60天 / 默认30天',
  sm.turnaroundDays('碳十四 AMS') === 45 && sm.turnaroundDays('光释光') === 60 && sm.turnaroundDays('未知方法') === 30)

// ---- 动作许可（线性、不可回退、终态无动作）----
check('待送检只能送出检测', JSON.stringify(sm.allowedActions('待送检')) === JSON.stringify(['送出检测']))
check('已送检/检测中只能登记结果',
  JSON.stringify(sm.allowedActions('已送检')) === JSON.stringify(['登记结果']) &&
  JSON.stringify(sm.allowedActions('检测中')) === JSON.stringify(['登记结果']))
check('已出结果只能归档报告', JSON.stringify(sm.allowedActions('已出结果')) === JSON.stringify(['归档报告']))
check('已归档无任何动作', sm.allowedActions('已归档').length === 0)

// ---- 服务：回填按采集顺序 ----
const list1 = svc.listDatingEntries().items
const byId = Object.fromEntries(list1.map((r) => [r.id, r]))
check('回填：id1 碳十四 09-01 + 45天 = 10-16', byId[1]['预计返回'] === '2026-10-16', byId[1]['预计返回'])
check('回填：id2 OSL 09-02 + 60天 = 11-01', byId[2]['预计返回'] === '2026-11-01', byId[2]['预计返回'])
check('回填：id3 默认30天 09-03 + 30 = 10-03', byId[3]['预计返回'] === '2026-10-03', byId[3]['预计返回'])
check('回填：id4 缺送检日期，沿采集顺序借上一单(id3) 09-03 + 45 = 10-18',
  byId[4]['预计返回'] === '2026-10-18', byId[4]['预计返回'])
check('回填不改正文：id1 原送检方法/日期保留',
  byId[1]['送检方法'] === '碳十四' && byId[1]['送检日期'] === '2026-09-01')

// ---- 状态同步：读取后通用 status 已被状态机权威结论覆盖 ----
check('同步：id1 status 被纠正为检测中（不再是旧的待送检）', byId[1].status === '检测中')
check('同步：id6 归档单 pending=false', byId[6].pending === false && byId[6].status === '已归档')

// ---- 核心缺陷复现与修复 ----
// id5 已出结果：尝试回退「送出检测」
const back1 = svc.runDatingAction(5, '送出检测')
check('已出结果不能回到检测中（送出检测被拒）', back1.ok === false)
const still5 = svc.getDatingEntry(5).resolved.state
check('拒绝后状态仍为已出结果', still5 === '已出结果', still5)
// id6 已归档：再次送检
const back2 = svc.runDatingAction(6, '送出检测')
check('已归档不能再次送检', back2.ok === false && /人工归档结论/.test(back2.message))
// 已归档还尝试登记结果
const back3 = svc.runDatingAction(6, '登记结果')
check('已归档不能再登记结果', back3.ok === false)

// ---- 正常正向流转 ----
const r1 = svc.runDatingAction(4, '送出检测') // 待送检 -> 写送检日期(今天)
check('送出检测成功：送检日期补今天，状态推进到检测中（自动推断可前进不回退）',
  r1.ok &&
  svc.getDatingEntry(4).row['送检日期'] === '2026-10-05' &&
  svc.getDatingEntry(4).resolved.manual === '已送检' &&
  svc.getDatingEntry(4).resolved.state === '检测中')
// 立即再点送出检测：当前已送检，动作不允许
const r1b = svc.runDatingAction(4, '送出检测')
check('已送检不能重复送出检测', r1b.ok === false)
const r2 = svc.runDatingAction(4, '登记结果')
check('登记结果成功 -> 已出结果', r2.ok && svc.getDatingEntry(4).resolved.state === '已出结果')
const r2b = svc.runDatingAction(4, '送出检测')
check('已出结果不能再送检（核心错位修复）', r2b.ok === false)

// ---- 归档：首次写入，二次只读不覆盖 ----
const a1 = svc.runDatingAction(5, '归档报告', { 归档编号: 'ARC-0005', 归档日期: '2026-10-05', 归档人: '李四', 归档备注: '首次归档' })
check('归档成功', a1.ok && svc.getDatingEntry(5).resolved.state === '已归档')
const original = JSON.stringify({ ...svc.getDatingEntry(5).row })
const a2 = svc.runDatingAction(5, '归档报告', { 归档编号: 'HACK', 归档日期: '1999-01-01', 归档人: '王五', 归档备注: '覆盖尝试' })
check('二次归档被标记为只读', a2.ok === true && a2.readonly === true)
const after = JSON.stringify({ ...svc.getDatingEntry(5).row })
check('二次归档未覆盖任何原值', original === after)
check('首次归档值完好', svc.getDatingEntry(5).row['归档编号'] === 'ARC-0005' && svc.getDatingEntry(5).row['归档人'] === '李四')

// 已归档（id6）二次归档同样只读，原值不变
const a3 = svc.runDatingAction(6, '归档报告', { 归档编号: 'HACK-6', 归档备注: 'x' })
check('历史归档单二次归档只读', a3.readonly === true && svc.getDatingEntry(6).row['归档编号'] === 'ARC-0006' && svc.getDatingEntry(6).row['归档备注'] === '原始结论')

// 非已出结果状态归档被拒（id2 检测中）
const a4 = svc.runDatingAction(2, '归档报告', {})
check('非已出结果状态不能直接归档（id2 检测中）', a4.ok === false)

// ---- 跨入口共用：通用 runAction 对 dating 委托同一服务 ----
const ls = require('./src/api/local-service.ts')
const cross = ls.runAction('dating', 6, '送出检测')
check('跨入口（通用 runAction）归档单再送检同样被拒', cross.ok === false)

// ---- 统计以状态机为准 ----
const st = svc.datingStats()
check('统计总数=6', st.total === 6)
check('已归档数=2 (id5 本流程归档 + id6)', st.archived === 2, JSON.stringify(st))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
