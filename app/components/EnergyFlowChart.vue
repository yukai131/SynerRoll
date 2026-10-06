<script setup lang="ts">
import * as echarts from 'echarts'
import {
  timeLabelToMinutes
} from '~~/utils/timeLabel'
import { formatCalendarMinute } from '~~/utils/calendarTime'
import { getEnergyFlowColor } from '~~/config/device-colors'

interface Point {
  ts: string
  value: number
}

type EnergyFlowDisplayMode = 'balance' | 'loadTracking'
const SOLID_LINE_LEGEND_ICON = 'path://M0 4H30V6H0Z'

const props = withDefaults(
  defineProps<{
    /** 总线名称 */
    busLabel: string
    /** 该总线关联的变量名列表，如 ["E_WT_out_7e8a", "E_ES_in_7e77"] */
    variables: string[]
    /** 全量时序数据: { "WT_7e8a|E_WT_out_7e8a": { "1": [{ts, value}] } } */
    liveData: Record<string, Record<string, Point[]>>
    /** 当前选中的时层 ID */
    layerId: string
    /** 节点 code → 设备名称映射，如 { "7e8a": "风机1" } */
    codeToLabel: Record<string, string>
    /** 图表显示模式 */
    displayMode?: EnergyFlowDisplayMode
    /** 当前时层步长（分钟），用于将功率积分为累计电量 */
    timeStepMinutes?: number
    simStartTime?: string
    simEndTime?: string | null
    simStartDate?: string | null
  }>(),
  {
    displayMode: 'balance',
    timeStepMinutes: 60
  }
)

// ───── 变量解析辅助 ─────

/** 从变量名提取设备 code（最后一段），如 E_WT_out_7e8a → 7e8a */
function extractCode(varName: string): string {
  const parts = varName.split('_')
  return parts[parts.length - 1] ?? ''
}

/** 判断变量是源（正）还是荷（负）: _out_ → +1, _in_ → -1 */
function getSign(varName: string): number {
  if (varName.includes('SHORTAGE')) return -1
  if (varName.includes('EXCESS')) return 1
  if (varName.includes('_out_')) return 1
  if (varName.includes('_in_')) return -1
  return 0
}

/** 分时电负荷变量；实例 code 和端口方向可能出现在后缀中 */
function isElectricLoadVariable(varName: string): boolean {
  return varName === 'E_ELOAD' || varName.startsWith('E_ELOAD_')
}

/** 获取设备显示名称 */
function getDeviceName(varName: string): string {
  const code = extractCode(varName)
  return props.codeToLabel[code] ?? code
}

/** 补充双向设备的功率方向，避免同一设备在图例中出现同名系列 */
function getSeriesName(varName: string): string {
  const deviceName = getDeviceName(varName)
  if (/^E_GRID_in(?:_|$)/.test(varName)) return `${deviceName}（售电）`
  if (/^E_GRID_out(?:_|$)/.test(varName)) return `${deviceName}（购电）`
  if (/^E_(?:ES|PS|FS|CS)_in(?:_|$)/.test(varName)) return `${deviceName}（充电）`
  if (/^E_(?:ES|PS|FS|CS)_out(?:_|$)/.test(varName)) return `${deviceName}（放电）`
  return deviceName
}

/** 在 liveData 中查找匹配的 key */
function findDataKey(varName: string): string | null {
  for (const key of Object.keys(props.liveData)) {
    if (key.endsWith(`|${varName}`)) return key
  }
  for (const key of Object.keys(props.liveData)) {
    if (key.includes(varName)) return key
  }
  const normalized = varName.replace(/_out_|_in_/g, '_')
  if (normalized !== varName) {
    for (const key of Object.keys(props.liveData)) {
      if (key.endsWith(`|${normalized}`)) return key
    }
    for (const key of Object.keys(props.liveData)) {
      if (key.includes(normalized)) return key
    }
  }
  return null
}

/** 获取指定变量在当前时层的时序数据 */
function getVarData(varName: string): Point[] {
  const key = findDataKey(varName)
  if (!key) return []
  return props.liveData[key]?.[props.layerId] ?? []
}

// ───── 分类变量 ─────

const sourceVars = computed(() => props.variables.filter(v => getSign(v) > 0))
const sinkVars = computed(() => props.variables.filter(v => getSign(v) < 0))
const electricLoadVars = computed(() => props.variables.filter(isElectricLoadVariable))
const displayedSinkVars = computed(() => (
  props.displayMode === 'loadTracking'
    ? sinkVars.value.filter(v => !isElectricLoadVariable(v))
    : sinkVars.value
))

const DAY_MINUTES = 24 * 60
const simStartMinutes = computed(() => timeLabelToMinutes(props.simStartTime ?? '0:00'))
const simEndMinutes = computed(() => props.simEndTime ? timeLabelToMinutes(props.simEndTime) : null)
const timelineMinutes = computed(() => [...new Set(
  props.variables
    .flatMap(varName => getVarData(varName))
    .map(point => timeLabelToMinutes(point.ts))
    .filter(Number.isFinite)
)].sort((left, right) => left - right))
const sliderStepMinutes = computed(() => {
  const timeline = timelineMinutes.value
  const steps = timeline.slice(1)
    .map((minute, index) => minute - timeline[index]!)
    .filter(step => step > 0)
  return Math.min(...steps, props.timeStepMinutes, 60)
})
const sliderMax = computed(() => {
  const timeline = timelineMinutes.value
  const dataEnd = timeline.length
    ? timeline[timeline.length - 1]! + sliderStepMinutes.value
    : DAY_MINUTES
  return Math.max(
    simStartMinutes.value + sliderStepMinutes.value,
    simEndMinutes.value ?? dataEnd
  )
})
const dateRangeStartMinutes = ref(0)
const dateRangeEndMinutes = ref(DAY_MINUTES)
const rangeStartMinutes = ref(0)
const rangeEndMinutes = ref(DAY_MINUTES)
const formatTimelineLabel = (minute: number): string => formatCalendarMinute(props.simStartDate, minute)
const updateRangeStart = (value: number): void => { rangeStartMinutes.value = value }
const updateRangeEnd = (value: number): void => { rangeEndMinutes.value = value }
const updateDateRangeStart = (value: number): void => {
  dateRangeStartMinutes.value = value
  rangeStartMinutes.value = value
  rangeEndMinutes.value = dateRangeEndMinutes.value
}
const updateDateRangeEnd = (value: number): void => {
  dateRangeEndMinutes.value = value
  rangeStartMinutes.value = dateRangeStartMinutes.value
  rangeEndMinutes.value = value
}

// ───── 累计电量贡献度：源/荷分别计算 ─────

interface ContributionItem {
  name: string
  value: number
  color: string
}

function getSeriesColor(varName: string): string {
  return getEnergyFlowColor(varName)
}

function calcContribution(vars: string[]): ContributionItem[] {
  const startMin = rangeStartMinutes.value
  const endMin = rangeEndMinutes.value
  const deviceMap = new Map<string, { name: string; value: number; color: string }>()
  for (const varName of vars) {
    const code = extractCode(varName)
    const data = getVarData(varName).filter(p => {
      const m = timeLabelToMinutes(p.ts)
      return m >= startMin && m < endMin
    })
    const stepHours = props.timeStepMinutes / 60
    const totalEnergy = data.reduce((sum, p) => sum + Math.abs(p.value) * stepHours, 0)
    const current = deviceMap.get(code)
    deviceMap.set(code, {
      name: current?.name ?? getSeriesName(varName),
      value: (current?.value ?? 0) + totalEnergy,
      color: current?.color ?? getSeriesColor(varName)
    })
  }
  const items: ContributionItem[] = []
  for (const { name, value, color } of deviceMap.values()) {
    items.push({
      name,
      value,
      color
    })
  }
  items.sort((a, b) => b.value - a.value)
  return items
}

const sourceContribution = computed(() => calcContribution(sourceVars.value))
const sinkContribution = computed(() => calcContribution(sinkVars.value))

const sourceTotal = computed(() => sourceContribution.value.reduce((s, d) => s + d.value, 0))
const sinkTotal = computed(() => sinkContribution.value.reduce((s, d) => s + d.value, 0))

// ───── 明细：源/荷环形图与设备电量构成 ─────

const showDetails = ref(false)
const sourceDonutRef = ref<HTMLDivElement | null>(null)
const sinkDonutRef = ref<HTMLDivElement | null>(null)
let sourceDonutChart: echarts.ECharts | null = null
let sinkDonutChart: echarts.ECharts | null = null

function formatEnergy(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function formatContributionPercentage(value: number, total: number): string {
  return total > 0 ? (value / total * 100).toFixed(2) : '0.00'
}

function donutOption(centerLabel: '源' | '荷', items: ContributionItem[]): echarts.EChartsOption {
  const hasData = items.some(item => item.value > 0)
  const center: [string, string] = ['38%', '50%']
  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: hasData ? '{b}<br/>{c} kWh（{d}%）' : '暂无数据'
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 14,
      top: 'middle',
      data: hasData ? items.map(item => item.name) : [],
      itemWidth: 12,
      itemHeight: 10,
      width: 150,
      textStyle: { fontSize: 16, color: '#475467' }
    },
    series: [
      {
        type: 'pie',
        bottom: '0%',
        radius: ['38%', '72%'],
        center,
        minAngle: 2,
        avoidLabelOverlap: true,
        label: {
          show: hasData,
          fontSize: 14,
          formatter: '{b}'
        },
        data: hasData
          ? items.map(item => ({
              name: item.name,
              value: Number(item.value.toFixed(2)),
              itemStyle: { color: item.color }
            }))
          : [{ name: '暂无数据', value: 1, itemStyle: { color: '#E4E7EC' } }]
      },
      {
        type: 'pie',
        radius: [0, 0],
        center,
        silent: true,
        tooltip: { show: false },
        label: {
          show: true,
          position: 'center',
          formatter: centerLabel,
          color: centerLabel === '源' ? '#DC2626' : '#2563EB',
          fontSize: 24,
          fontWeight: 600
        },
        labelLine: { show: false },
        data: [{ value: 1, itemStyle: { color: 'transparent' } }]
      }
    ]
  }
}

function renderDetailCharts(): void {
  if (!showDetails.value || !sourceDonutRef.value || !sinkDonutRef.value) return
  sourceDonutChart ??= echarts.init(sourceDonutRef.value)
  sinkDonutChart ??= echarts.init(sinkDonutRef.value)
  sourceDonutChart.setOption(donutOption('源', sourceContribution.value), true)
  sinkDonutChart.setOption(donutOption('荷', sinkContribution.value), true)
  sourceDonutChart.resize()
  sinkDonutChart.resize()
}

async function toggleDetails(): Promise<void> {
  showDetails.value = !showDetails.value
  if (showDetails.value) {
    await nextTick()
    renderDetailCharts()
  }
}

// ───── 堆叠条形图（echarts） ─────

const CHART_GRID_TOP = 34
const CHART_GRID_BOTTOM = 30
const containerRef = ref<HTMLDivElement | null>(null)
const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

const renderChart = () => {
  if (!chartRef.value) return
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
  }

  const startMin = rangeStartMinutes.value
  const endMin = rangeEndMinutes.value

  // 收集所有时间戳
  const allTsSet = new Set<number>()
  for (const varName of props.variables) {
    const data = getVarData(varName).filter(p => {
      const m = timeLabelToMinutes(p.ts)
      return m >= startMin && m < endMin
    })
    data.forEach(p => allTsSet.add(timeLabelToMinutes(p.ts)))
  }
  const allTs = Array.from(allTsSet).sort((a, b) => a - b)
  const xLabels = allTs.map(m => formatCalendarMinute(props.simStartDate, m))

  const series: echarts.SeriesOption[] = []
  // 源和荷共用一个 stack，正数自然向上、负数自然向下，保证同时刻对齐

  for (const varName of sourceVars.value) {
    const data = getVarData(varName).filter(p => {
      const m = timeLabelToMinutes(p.ts)
      return m >= startMin && m < endMin
    })
    const dataMap = new Map(data.map(p => [timeLabelToMinutes(p.ts), p.value]))
    const barData = allTs.map(m => dataMap.get(m) ?? 0)

    series.push({
      type: 'bar',
      name: getSeriesName(varName),
      data: barData,
      stack: 'balance',
      barWidth: '60%',
      itemStyle: { color: getSeriesColor(varName) },
    })
  }

  for (const varName of displayedSinkVars.value) {
    const data = getVarData(varName).filter(p => {
      const m = timeLabelToMinutes(p.ts)
      return m >= startMin && m < endMin
    })
    const dataMap = new Map(data.map(p => [timeLabelToMinutes(p.ts), -Math.abs(p.value)]))
    const barData = allTs.map(m => dataMap.get(m) ?? 0)

    series.push({
      type: 'bar',
      name: getSeriesName(varName),
      data: barData,
      stack: 'balance',
      barWidth: '60%',
      itemStyle: { color: getSeriesColor(varName) },
    })
  }

  if (props.displayMode === 'loadTracking' && electricLoadVars.value.length > 0) {
    const totalLoadByTime = new Map<number, number>()
    for (const varName of electricLoadVars.value) {
      const data = getVarData(varName).filter(p => {
        const m = timeLabelToMinutes(p.ts)
        return m >= startMin && m < endMin
      })
      for (const point of data) {
        const minute = timeLabelToMinutes(point.ts)
        totalLoadByTime.set(minute, (totalLoadByTime.get(minute) ?? 0) + Math.abs(point.value))
      }
    }

    series.push({
      type: 'line',
      name: '电负荷',
      data: allTs.map(minute => totalLoadByTime.has(minute) ? totalLoadByTime.get(minute)! : null),
      smooth: false,
      symbol: 'none',
      connectNulls: false,
      lineStyle: { color: '#1d2129', width: 2 },
      itemStyle: { color: '#1d2129' },
      z: 10
    })
  }

  chartInstance.setOption({
    legend: {
      show: true,
      type: 'scroll',
      top: 4,
      left: 'center',
      data: [...new Set(series.map(item => String(item.name ?? '')))].map(name =>
        name === '电负荷' && props.displayMode === 'loadTracking'
          ? { name, icon: SOLID_LINE_LEGEND_ICON }
          : name
      ),
      itemWidth: 20,
      itemHeight: 10,
      textStyle: { fontSize: 14, color: '#475467' }
    },
    grid: { left: 82, right: 22, top: CHART_GRID_TOP + 8, bottom: CHART_GRID_BOTTOM + 10, containLabel: false },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: {
        onZero: true,
        lineStyle: { color: '#4e5969', width: 1.5 }
      },
      axisLabel: {
        fontSize: 11,
        color: '#475467',
        rotate: 45,
        interval: Math.max(0, Math.floor(xLabels.length / 12))
      },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      name: '功率（kW）',
      nameLocation: 'end',
      nameGap: 12,
      nameTextStyle: { fontSize: 12, color: '#344054' },
      axisLabel: {
        fontSize: 12,
        formatter: (value: number) => {
          const label = value === 0 ? '0 kW' : Math.abs(value).toLocaleString('zh-CN')
          if (value > 0) return `{source|${label}}`
          if (value < 0) return `{sink|-${label}}`
          return `{zero|${label}}`
        },
        rich: {
          source: { color: '#DC2626', fontSize: 12, fontWeight: 600 },
          sink: { color: '#2563EB', fontSize: 12, fontWeight: 600 },
          zero: { color: '#667085', fontSize: 12 }
        }
      },
      splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
    },
    series,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const arr = Array.isArray(params) ? params as { data?: number; seriesName?: string; color?: string; axisValue?: string }[] : []
        if (!arr.length) return ''
        let html = `<b>${arr[0]?.axisValue ?? ''}</b>`
        for (const p of arr) {
          const val = typeof p.data === 'number' ? p.data : 0
          if (Math.abs(val) < 0.01) continue
          html += `<br/><span style="color:${p.color ?? ''}">●</span> ${p.seriesName ?? ''}: ${val.toFixed(1)} kW`
        }
        return html
      }
    },
    animation: false
  }, true)
}

watch(sliderMax, (maximum, previousMaximum) => {
  const previous = previousMaximum ?? 0
  if (maximum > previous && dateRangeEndMinutes.value >= previous) dateRangeEndMinutes.value = maximum
  else if (dateRangeEndMinutes.value > maximum) dateRangeEndMinutes.value = maximum
  if (rangeEndMinutes.value > dateRangeEndMinutes.value) rangeEndMinutes.value = dateRangeEndMinutes.value
  if (rangeStartMinutes.value >= maximum) rangeStartMinutes.value = simStartMinutes.value
})

watch(
  [() => props.simStartTime, () => props.simEndTime],
  () => {
    dateRangeStartMinutes.value = simStartMinutes.value
    dateRangeEndMinutes.value = sliderMax.value
    rangeStartMinutes.value = simStartMinutes.value
    rangeEndMinutes.value = sliderMax.value
  },
  { immediate: true }
)

watch(() => JSON.stringify(props.liveData) + props.layerId + JSON.stringify(props.variables) + props.displayMode + props.simStartTime + props.simEndTime + props.simStartDate + rangeStartMinutes.value + rangeEndMinutes.value, () => {
  renderChart()
  renderDetailCharts()
})

onMounted(() => {
  renderChart()
  resizeObserver = new ResizeObserver(() => {
    chartInstance?.resize()
    sourceDonutChart?.resize()
    sinkDonutChart?.resize()
  })
  if (containerRef.value) resizeObserver.observe(containerRef.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chartInstance?.dispose()
  sourceDonutChart?.dispose()
  sinkDonutChart?.dispose()
  chartInstance = null
  sourceDonutChart = null
  sinkDonutChart = null
})
</script>

<template>
  <div ref="containerRef" class="space-y-3">
    <div class="flex items-center justify-between gap-4 px-1">
      <h3 class="text-base font-medium text-app-text">{{ busLabel }} · 功率</h3>
      <AppButton
        :label="showDetails ? '收起明细' : '查看明细'"
        tone="primary"
        size="md"
        @click="toggleDetails"
      />
    </div>

    <div ref="chartRef" class="h-96 w-full min-w-0" />

    <div class="px-5">
      <CalendarRangeInputs
        v-if="simStartDate"
        :base-date="simStartDate"
        :start="dateRangeStartMinutes"
        :end="dateRangeEndMinutes"
        :min="simStartMinutes"
        :max="sliderMax"
        @update:start="updateDateRangeStart"
        @update:end="updateDateRangeEnd"
      />
      <PrimaryDualRangeSlider
        :start="rangeStartMinutes"
        :end="rangeEndMinutes"
        :min="dateRangeStartMinutes"
        :max="dateRangeEndMinutes"
        :step="sliderStepMinutes"
        :format-label="formatTimelineLabel"
        @update:start="updateRangeStart"
        @update:end="updateRangeEnd"
      />
    </div>

    <div v-show="showDetails" class="space-y-4 border-t border-app-border pt-4">
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div ref="sourceDonutRef" class="h-[320px] rounded-[8px] bg-white" />
        <div ref="sinkDonutRef" class="h-[320px] rounded-[8px] bg-white" />
      </div>

      <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div class="overflow-hidden rounded-[8px] border border-app-border bg-white">
          <div class="overflow-x-auto">
            <table class="w-full table-fixed text-sm">
              <colgroup>
                <col class="w-1/3">
                <col class="w-1/3">
                <col class="w-1/3">
              </colgroup>
              <thead class="bg-app-panel-soft text-left text-app-muted">
                <tr class="border-b border-app-border">
                  <th class="px-4 py-3 font-medium text-red-700">源侧设备名称</th>
                  <th class="px-4 py-3 text-right font-medium text-red-700">累计电量(kWh)</th>
                  <th class="px-4 py-3 text-right font-medium text-red-700">电量占比(%)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in sourceContribution" :key="`source-${item.name}`" class="border-b border-app-border last:border-b-0">
                  <td class="px-4 py-3 text-app-text">
                    <span class="inline-flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: item.color }" />
                      {{ item.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right font-medium text-app-text">
                    {{ formatEnergy(item.value) }}
                  </td>
                  <td class="px-4 py-3 text-right text-app-text">{{ formatContributionPercentage(item.value, sourceTotal) }}</td>
                </tr>
                <tr v-if="sourceContribution.length === 0">
                  <td colspan="3" class="px-4 py-3 text-center text-app-muted">暂无源侧设备数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="overflow-hidden rounded-[8px] border border-app-border bg-white">
          <div class="overflow-x-auto">
            <table class="w-full table-fixed text-sm">
              <colgroup>
                <col class="w-1/3">
                <col class="w-1/3">
                <col class="w-1/3">
              </colgroup>
              <thead class="bg-app-panel-soft text-left text-app-muted">
                <tr class="border-b border-app-border">
                  <th class="px-4 py-3 font-medium text-blue-700">荷侧设备名称</th>
                  <th class="px-4 py-3 text-right font-medium text-blue-700">累计电量(kWh)</th>
                  <th class="px-4 py-3 text-right font-medium text-blue-700">电量占比(%)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in sinkContribution" :key="`sink-${item.name}`" class="border-b border-app-border last:border-b-0">
                  <td class="px-4 py-3 text-app-text">
                    <span class="inline-flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: item.color }" />
                      {{ item.name }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right font-medium text-app-text">
                    {{ formatEnergy(item.value) }}
                  </td>
                  <td class="px-4 py-3 text-right text-app-text">{{ formatContributionPercentage(item.value, sinkTotal) }}</td>
                </tr>
                <tr v-if="sinkContribution.length === 0">
                  <td colspan="3" class="px-4 py-3 text-center text-app-muted">暂无荷侧设备数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
