import { apiSuccess } from '#server/utils/response'
import type { BoundaryMetadata } from '~~/types/boundary'

const JULIA_BACKEND_URL = 'http://localhost:8080/api/boundary/load'

/**
 * 从 TS 库加载边界转换数据
 * 请求体:
 * - boundaries: Array<{layerId, relatedComponent, meaning}>
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  try {
    const response = await $fetch<{
      success: boolean
      message?: string
      data?: {
        allFound: boolean
        boundaries: Array<{
          boundaryId?: string
          layerId: string
          found: boolean
          values?: number[]
          timestamps?: string[]
          config?: BoundaryMetadata
        }>
      }
    }>(JULIA_BACKEND_URL, {
      method: 'POST',
      body
    })

    if (response.success && response.data) {
      return apiSuccess(response.data)
    }
    else {
      throw createError({
        statusCode: 400,
        message: response.message || '加载失败'
      })
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw createError({
      statusCode: 500,
      message: `Julia backend error: ${message}`
    })
  }
})
