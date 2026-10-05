<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年报告归档</h2>
        <p class="page-desc">归档动作与列表、详情共用同一台状态机；已归档记录只读，二次写入不能覆盖原值。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/dating">返回送检列表</RouterLink>
      </div>
    </header>

    <h3 class="section-title">待归档（已出结果）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in readyRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="archive(row)">归档报告</button>
            <RouterLink class="link" :to="`/dating/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!readyRows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无已出结果、待归档的测年送检单</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">已归档（只读）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>归档日期</th>
          <th>归档结论</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in archivedRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row['归档日期'] || '—' }}</td>
          <td>{{ row['归档结论'] || '—' }}</td>
        </tr>
        <tr v-if="!archivedRows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无已归档的测年报告</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>已归档记录仅可读取，归档原值不会被二次写入覆盖</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listDatingEntries, runDatingAction } from '@/api/dating-service'
import type { EntryRow } from '@/data/types'
import { resolveDatingStatus } from '@/domain/dating-machine'

const columns = ["送检编号", "样品类型", "采样单位", "送检方法", "送检日期", "预计返回"]

const rows = ref<EntryRow[]>([])
const errorMessage = ref('')
// 待归档 / 已归档的分组也由状态机的当前状态决定，不归档入口自己判断
const readyRows = computed(() => rows.value.filter((row) => resolveDatingStatus(row) === '已出结果'))
const archivedRows = computed(() => rows.value.filter((row) => resolveDatingStatus(row) === '已归档'))

function archive(row: EntryRow) {
  errorMessage.value = ''
  const result = runDatingAction(Number(row.id), '归档报告')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  rows.value = listDatingEntries().items
}

onMounted(reload)
</script>
