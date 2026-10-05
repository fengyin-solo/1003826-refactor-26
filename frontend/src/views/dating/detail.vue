<template>
  <section class="page" data-module="dating-detail">
    <header class="page-head">
      <div>
        <h2>测年送检单详情</h2>
        <p class="page-desc">状态结论与列表、归档工作台共用同一份送检状态机；人工归档结论优先，已归档单据不能再送检。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/dating">返回送检列表</RouterLink>
        <RouterLink class="btn" to="/dating/archive">归档工作台</RouterLink>
      </div>
    </header>

    <template v-if="entry">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ entry.resolved.state }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">结论来源</span>
          <strong class="stat-value">{{ SOURCE_LABELS[entry.resolved.source] }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">日期推断结果</span>
          <strong class="stat-value">{{ entry.resolved.inferred }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">是否逾期</span>
          <strong class="stat-value">{{ entry.resolved.overdue ? '已逾期' : '正常' }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in detailFields" :key="field">
            <th>{{ field }}</th>
            <td>{{ entry.row[field] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="archiveFields.length" class="archive-panel">
        <h3>归档结论</h3>
        <table class="data-table detail-table">
          <tbody>
            <tr v-for="field in archiveFields" :key="field">
              <th>{{ field }}</th>
              <td>{{ entry.row[field] ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="action-bar">
        <template v-if="entry.resolved.state !== '已归档'">
          <button
            v-for="action in allowedActions(entry.resolved.state)"
            :key="action"
            class="btn primary"
            type="button"
            @click="onAction(action)"
          >
            {{ action }}
          </button>
        </template>
        <span v-else class="muted-text">该单为终态（人工归档结论），只可查看，不能再送检或改写归档信息。</span>
      </div>

      <form v-if="showArchiveForm" class="archive-form" @submit.prevent="submitArchive">
        <h3>填写归档结论（首次写入后不可覆盖）</h3>
        <label v-for="field in archiveFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="archiveForm[field]" :placeholder="`请填写${field}`" />
        </label>
        <button class="btn primary" type="submit">确认归档</button>
        <button class="btn ghost" type="button" @click="showArchiveForm = false">取消</button>
      </form>
    </template>

    <p v-else class="empty-state">没有找到这张测年送检单，请返回列表重新选择。</p>

    <footer class="page-foot">
      <RouterLink class="link" to="/dating">← 返回测年送检列表</RouterLink>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getDatingEntry, runDatingAction } from '@/api/dating-service'
import {
  allowedActions,
  ARCHIVE_FIELDS,
  type ArchiveField,
  type ArchivePayload,
  type DatingAction,
  SOURCE_LABELS,
  todayISO,
} from '@/data/dating/state-machine'

const route = useRoute()
const entry = ref<ReturnType<typeof getDatingEntry>>(null)
const message = ref('')
const messageOk = ref(true)
const showArchiveForm = ref(false)

const detailFields = ['送检编号', '样品类型', '采样单位', '采样层位', '送检方法', '送检日期', '预计返回', '结果返回日', '送检状态']
const archiveFields = [...ARCHIVE_FIELDS]

const archiveForm = reactive<Record<ArchiveField, string>>({
  归档编号: '',
  归档日期: todayISO(),
  归档人: '',
  归档备注: '',
})

function load() {
  message.value = ''
  entry.value = getDatingEntry(Number(route.params.id))
}

function onAction(action: DatingAction) {
  message.value = ''
  if (action === '归档报告') {
    showArchiveForm.value = true
    return
  }
  const result = runDatingAction(Number(route.params.id), action)
  message.value = result.message
  messageOk.value = result.ok
  load()
}

function submitArchive() {
  const payload: ArchivePayload = {}
  for (const field of ARCHIVE_FIELDS) {
    if (archiveForm[field].trim()) {
      payload[field] = archiveForm[field].trim()
    }
  }
  const result = runDatingAction(Number(route.params.id), '归档报告', payload)
  message.value = result.message
  messageOk.value = result.ok
  showArchiveForm.value = false
  load()
}

onMounted(load)
</script>
