<template>
  <section class="page" data-module="dating-archive">
    <header class="page-head">
      <div>
        <h2>测年归档工作台</h2>
        <p class="page-desc">集中处理「已出结果」的送检单。归档动作与列表、详情走同一状态机：人工归档结论优先于自动推断，归档字段只首次写入，二次归档只能读取、不能覆盖。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/dating">返回送检列表</RouterLink>
      </div>
    </header>

    <h3>待归档（状态机判定为「已出结果」）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>送检编号</th>
          <th>样品类型</th>
          <th>送检方法</th>
          <th>送检日期</th>
          <th>预计返回</th>
          <th>结果返回日</th>
          <th>结论来源</th>
          <th>归档操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in pendingRows" :key="String(row.id)">
          <td>{{ row['送检编号'] }}</td>
          <td>{{ row['样品类型'] }}</td>
          <td>{{ row['送检方法'] }}</td>
          <td>{{ row['送检日期'] ?? '—' }}</td>
          <td>{{ row['预计返回'] ?? '—' }}</td>
          <td>{{ row['结果返回日'] ?? '—' }}</td>
          <td>{{ SOURCE_LABELS[resolveDatingState(row).source] }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="quickArchive(row)">归档报告</button>
            <RouterLink class="link" :to="`/dating/${row.id}`">到详情填写</RouterLink>
          </td>
        </tr>
        <tr v-if="!pendingRows.length">
          <td colspan="8" class="empty-state">暂无待归档送检单</td>
        </tr>
      </tbody>
    </table>

    <h3 style="margin-top: 20px;">已归档（只读，重复归档不覆盖原值）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>送检编号</th>
          <th>样品类型</th>
          <th>归档编号</th>
          <th>归档日期</th>
          <th>归档人</th>
          <th>归档备注</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in archivedRows" :key="String(row.id)">
          <td>{{ row['送检编号'] }}</td>
          <td>{{ row['样品类型'] }}</td>
          <td>{{ row['归档编号'] ?? '—' }}</td>
          <td>{{ row['归档日期'] ?? '—' }}</td>
          <td>{{ row['归档人'] ?? '—' }}</td>
          <td>{{ row['归档备注'] ?? '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="readArchive(row)">再次归档（只读校验）</button>
            <RouterLink class="link" :to="`/dating/${row.id}`">查看详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!archivedRows.length">
          <td colspan="7" class="empty-state">尚无已归档送检单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ archivedRows.length }} 张已归档、{{ pendingRows.length }} 张待归档</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listDatingEntries, runDatingAction } from '@/api/dating-service'
import { resolveDatingState, SOURCE_LABELS, todayISO } from '@/data/dating/state-machine'
import type { EntryRow } from '@/data/types'

const rows = ref<EntryRow[]>([])
const message = ref('')
const messageOk = ref(true)

const pendingRows = computed(() => rows.value.filter((row) => resolveDatingState(row).state === '已出结果'))
const archivedRows = computed(() => rows.value.filter((row) => resolveDatingState(row).state === '已归档'))

function quickArchive(row: EntryRow) {
  const result = runDatingAction(Number(row.id), '归档报告', { 归档日期: todayISO() })
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function readArchive(row: EntryRow) {
  // 二次归档：服务端按只读处理，返回原值且不覆盖。
  const result = runDatingAction(Number(row.id), '归档报告', {
    归档编号: 'OVERRIDE-ATTEMPT',
    归档日期: '1999-01-01',
    归档人: '不应写入',
    归档备注: '试图覆盖首次归档结论',
  })
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function reload() {
  rows.value = listDatingEntries().items
}

onMounted(reload)
</script>
