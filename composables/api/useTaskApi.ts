import type {
  ComputeTask,
  ComputeTaskListResponse,
  CreateTaskRequest,
  EconomyEvaluationResult,
  TaskDataResponse,
  TaskTraceDataResponse,
  TaskTraceStepsResponse
} from '~~/types/api'
import { useApiClient } from './useApiClient'

/**
 * 计算任务 API 封装
 * 文档：docs/compute-task-architecture.md
 *
 * REST 部分：透传到 Julia 后端
 * WebSocket：直接连 Julia（不走 BFF），URL 在 useTaskWebSocket 中配置
 */
export const useTaskApi = () => {
  const apiClient = useApiClient()

  return {
    createTask: (payload: CreateTaskRequest) =>
      apiClient.mutate<ComputeTask>(`/task/create`, {
        method: 'POST',
        body: payload
      }),

    listTasks: (params?: { projectId?: string; status?: string }) => {
      const q = new URLSearchParams()
      if (params?.projectId) q.set('projectId', params.projectId)
      if (params?.status) q.set('status', params.status)
      const qs = q.toString()
      return apiClient.get<ComputeTaskListResponse>(
        `/task/list${qs ? `?${qs}` : ''}`
      )
    },

    getState: (taskId: string) =>
      apiClient.get<ComputeTask>(`/task/${taskId}/state`),

    getConnection: (taskId: string) =>
      apiClient.get<Array<{ busLabel: string; busCode: string; variables: string[] }>>(
        `/task/${taskId}/connection`
      ),

    pause: (taskId: string) =>
      apiClient.mutate<Record<string, unknown>>(`/task/${taskId}/pause`, {
        method: 'POST'
      }),

    resume: (taskId: string) =>
      apiClient.mutate<Record<string, unknown>>(`/task/${taskId}/resume`, {
        method: 'POST'
      }),

    cancel: (taskId: string) =>
      apiClient.mutate<Record<string, unknown>>(`/task/${taskId}/cancel`, {
        method: 'POST'
      }),

    cleanup: (taskId: string) =>
      apiClient.mutate<Record<string, unknown>>(`/task/${taskId}`, {
        method: 'DELETE'
      }),

    getData: (taskId: string, params?: {
      layerId?: string
      varName?: string
      sourceId?: string
      remark?: string
      /** 按显示窗口读取；已运行任务的变化点应使用 afterId，包含对旧时刻的修正。 */
      minMinutes?: number
      maxMinutes?: number
      /** 上次返回的已提交 rowid；不要使用 max(ts) 作为增量水位。 */
      afterId?: number
      limit?: number
      boundaryOnly?: boolean
      /** 增量时跳过边界序列 b_* */
      skipBoundary?: boolean
    }) => {
      const q = new URLSearchParams()
      if (params?.layerId) q.set('layerId', params.layerId)
      if (params?.varName) q.set('varName', params.varName)
      if (params?.sourceId) q.set('sourceId', params.sourceId)
      if (params?.remark) q.set('remark', params.remark)
      if (typeof params?.minMinutes === 'number' && params.minMinutes > 0) {
        q.set('minMinutes', String(params.minMinutes))
      }
      if (params?.skipBoundary) q.set('skipBoundary', '1')
      if (params?.boundaryOnly) q.set('boundaryOnly', '1')
      for (const key of ['maxMinutes', 'afterId', 'limit'] as const) {
        if (params?.[key] !== undefined) q.set(key, String(params[key]))
      }
      const qs = q.toString()
      return apiClient.get<TaskDataResponse>(
        `/task/${taskId}/data${qs ? `?${qs}` : ''}`
      )
    },

    getEconomy: (taskId: string) =>
      apiClient.get<EconomyEvaluationResult>(`/task/${taskId}/economy`)
  }
}
