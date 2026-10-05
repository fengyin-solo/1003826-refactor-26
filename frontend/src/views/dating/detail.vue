<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年送检详情</h2>
        <p class="page-desc">与列表、归档入口共用同一台状态机：冲突时人工归档结论优先于自动推断。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/dating">返回列表</RouterLink>
        <RouterLink class="btn" to="/dating/archive">归档入口</RouterLink>
      </div>
    </header>

    <div v-if="row" class="detail-grid">
      <dl class="detail-card">
        <template v-for="field in columns" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] || '—' }}</dd>
        </template>
        <template v-if="row['归档日期']">
          <dt>归档日期</dt>
          <dd>{{ row['归档日期'] }}</dd>
          <dt>归档结论</dt>
          <dd>{{ row['归档结论'] || '—' }}</dd>
        </template>
      </dl>

      <div class="detail-card">
        <h3>状态判定</h3>
        <p>人工结论：{{ manualStatus }}</p>
        <p>自动推断：{{ inferredStatus }}</p>
        <p>当前状态：<strong>{{ currentStatus }}</strong></p>
        <p class="page-desc">
          历史送检单按原送检方法和日期解释；人工归档结论一旦写入，自动推断不再改动它。
        </p>
        <div class="row-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            type="button"
            @click="runAction(action)"
          >
            {{ action }}
          </button>
          <span v-if="!actions.length" class="page-desc">当前状态下没有可执行动作</span>
        </div>
      </div>
    </div>
    <p v-else class="empty-state">没有找到这张测年送检单</p>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getDatingEntry, runDatingAction } from '@/api/dating-service'
import type { EntryRow } from '@/data/types'
import { availableDatingActions, inferDatingStatus, resolveDatingStatus } from '@/domain/dating-machine'

const columns = ["送检编号", "样品类型", "采样单位", "采样层位", "送检方法", "送检日期", "预计返回", "送检状态"]

const route = useRoute()
const row = ref<EntryRow | null>(null)
const errorMessage = ref('')

const manualStatus = computed(() => (row.value ? String(row.value.status) : '—'))
const inferredStatus = computed(() => (row.value ? inferDatingStatus(row.value) : '—'))
const currentStatus = computed(() => (row.value ? resolveDatingStatus(row.value) : '—'))
const actions = computed(() => (row.value ? availableDatingActions(row.value) : []))

function load() {
  errorMessage.value = ''
  row.value = getDatingEntry(Number(route.params.id))
}

function runAction(action: string) {
  if (!row.value) {
    return
  }
  errorMessage.value = ''
  const result = runDatingAction(Number(row.value.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  load()
}

onMounted(load)
</script>
