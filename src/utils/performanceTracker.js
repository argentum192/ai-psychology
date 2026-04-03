/**
 * Performance Tracker Utility
 * 用于记录和查询系统性能指标
 */

import { debugLog } from './logger.js';

/**
 * 性能指标类型
 */
export const MetricType = {
  API_RESPONSE: 'api_response',
  WEBSOCKET_CONNECTION: 'websocket_connection',
  AI_API_CALL: 'ai_api_call',
  TOKEN_USAGE: 'token_usage'
};

/**
 * 记录 API 响应时间
 * @param {Object} env - Cloudflare Workers 环境
 * @param {string} endpoint - API 端点
 * @param {number} durationMs - 响应时间（毫秒）
 * @param {number} statusCode - HTTP 状态码
 * @param {number} userId - 可选的用户ID
 */
export async function trackApiResponse(env, endpoint, durationMs, statusCode, userId = null) {
  try {
    await env.ai_psychology_db.prepare(
      `INSERT INTO performance_metrics (metric_type, endpoint, duration_ms, status_code, user_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      MetricType.API_RESPONSE,
      endpoint,
      Math.round(durationMs),
      statusCode,
      userId
    ).run();
    
    debugLog(env, `✓ API 响应时间已记录: ${endpoint} - ${Math.round(durationMs)}ms (状态码: ${statusCode})`);
  } catch (error) {
    // 静默失败，避免影响主流程
    // 仅在开发环境输出详细错误信息
    debugLog(env, '❌ 记录 API 响应时间失败:', error.message || error);
    debugLog(env, '错误详情:', error);
  }
}

/**
 * 记录 WebSocket 连接时长
 * @param {Object} env - Cloudflare Workers 环境
 * @param {number} durationMs - 连接时长（毫秒）
 * @param {number} userId - 用户ID
 */
export async function trackWebSocketConnection(env, durationMs, userId) {
  try {
    await env.ai_psychology_db.prepare(
      `INSERT INTO performance_metrics (metric_type, duration_ms, user_id)
       VALUES (?, ?, ?)`
    ).bind(
      MetricType.WEBSOCKET_CONNECTION,
      Math.round(durationMs),
      userId
    ).run();
    
    debugLog(env, `✓ WebSocket 连接时长已记录: ${Math.round(durationMs)}ms (用户: ${userId})`);
  } catch (error) {
    // 静默失败，避免影响主流程
    // 仅在开发环境输出详细错误信息
    debugLog(env, '❌ 记录 WebSocket 连接时长失败:', error.message || error);
    debugLog(env, '错误详情:', error);
  }
}

/**
 * 记录 AI API 调用延迟
 * @param {Object} env - Cloudflare Workers 环境
 * @param {number} durationMs - 调用延迟（毫秒）
 * @param {number} userId - 用户ID
 */
export async function trackAiApiCall(env, durationMs, userId) {
  try {
    await env.ai_psychology_db.prepare(
      `INSERT INTO performance_metrics (metric_type, duration_ms, user_id)
       VALUES (?, ?, ?)`
    ).bind(
      MetricType.AI_API_CALL,
      Math.round(durationMs),
      userId
    ).run();
    
    debugLog(env, `✓ AI API 调用延迟已记录: ${Math.round(durationMs)}ms (用户: ${userId})`);
  } catch (error) {
    // 静默失败，避免影响主流程
    // 仅在开发环境输出详细错误信息
    debugLog(env, '❌ 记录 AI API 调用延迟失败:', error.message || error);
    debugLog(env, '错误详情:', error);
  }
}

/**
 * 记录 Token 使用量
 * @param {Object} env - Cloudflare Workers 环境
 * @param {number} tokensUsed - 总 Token 数
 * @param {number} tokensPrompt - 提示词 Token 数
 * @param {number} tokensCompletion - 生成的 Token 数
 * @param {number} userId - 用户ID
 */
export async function trackTokenUsage(env, tokensUsed, tokensPrompt, tokensCompletion, userId) {
  try {
    await env.ai_psychology_db.prepare(
      `INSERT INTO performance_metrics (metric_type, tokens_used, tokens_prompt, tokens_completion, user_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      MetricType.TOKEN_USAGE,
      tokensUsed,
      tokensPrompt,
      tokensCompletion,
      userId
    ).run();
    
    debugLog(env, `✓ Token 使用量已记录: ${tokensUsed} (提示词: ${tokensPrompt}, 生成: ${tokensCompletion}) [用户: ${userId}]`);
  } catch (error) {
    // 静默失败，避免影响主流程
    // 仅在开发环境输出详细错误信息
    debugLog(env, '❌ 记录 Token 使用量失败:', error.message || error);
    debugLog(env, '错误详情:', error);
  }
}

/**
 * 获取性能统计信息
 * @param {Object} db - 数据库连接
 * @param {string} timeRange - 时间范围 ('24h', '7d', '30d')
 * @returns {Promise<Object>} 统计信息
 */
export async function getPerformanceStats(db, timeRange = '24h') {
  const timeRangeMap = {
    '24h': '-24 hours',
    '7d': '-7 days',
    '30d': '-30 days'
  };
  
  const sqlTimeRange = timeRangeMap[timeRange] || '-24 hours';
  
  try {
    // API 响应时间统计
    const apiStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        COALESCE(AVG(duration_ms), 0) as avg_duration,
        COALESCE(MIN(duration_ms), 0) as min_duration,
        COALESCE(MAX(duration_ms), 0) as max_duration,
        endpoint,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count
      FROM performance_metrics
      WHERE metric_type = ? 
        AND created_at >= datetime('now', ?)
      GROUP BY endpoint
      ORDER BY total_requests DESC
      LIMIT 20
    `).bind(MetricType.API_RESPONSE, sqlTimeRange).all();

    // API 响应时间整体统计
    const apiOverall = await db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        COALESCE(AVG(duration_ms), 0) as avg_duration,
        COALESCE(MIN(duration_ms), 0) as min_duration,
        COALESCE(MAX(duration_ms), 0) as max_duration
      FROM performance_metrics
      WHERE metric_type = ? 
        AND created_at >= datetime('now', ?)
    `).bind(MetricType.API_RESPONSE, sqlTimeRange).first();

    // WebSocket 连接统计
    const websocketStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_connections,
        COALESCE(AVG(duration_ms), 0) as avg_duration,
        COALESCE(MIN(duration_ms), 0) as min_duration,
        COALESCE(MAX(duration_ms), 0) as max_duration,
        COALESCE(SUM(duration_ms), 0) as total_duration
      FROM performance_metrics
      WHERE metric_type = ? 
        AND created_at >= datetime('now', ?)
    `).bind(MetricType.WEBSOCKET_CONNECTION, sqlTimeRange).first();

    // AI API 调用统计
    const aiApiStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        COALESCE(AVG(duration_ms), 0) as avg_duration,
        COALESCE(MIN(duration_ms), 0) as min_duration,
        COALESCE(MAX(duration_ms), 0) as max_duration
      FROM performance_metrics
      WHERE metric_type = ? 
        AND created_at >= datetime('now', ?)
    `).bind(MetricType.AI_API_CALL, sqlTimeRange).first();

    // Token 使用统计
    const tokenStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        COALESCE(SUM(tokens_used), 0) as total_tokens,
        COALESCE(SUM(tokens_prompt), 0) as total_prompt_tokens,
        COALESCE(SUM(tokens_completion), 0) as total_completion_tokens,
        COALESCE(AVG(tokens_used), 0) as avg_tokens,
        COALESCE(MAX(tokens_used), 0) as max_tokens
      FROM performance_metrics
      WHERE metric_type = ? 
        AND created_at >= datetime('now', ?)
    `).bind(MetricType.TOKEN_USAGE, sqlTimeRange).first();

    // 按小时统计（最近24小时）
    const hourlyStats = await db.prepare(`
      SELECT 
        strftime('%Y-%m-%d %H:00:00', created_at) as hour,
        metric_type,
        COUNT(*) as count,
        AVG(duration_ms) as avg_duration
      FROM performance_metrics
      WHERE created_at >= datetime('now', '-24 hours')
        AND metric_type IN (?, ?, ?)
      GROUP BY hour, metric_type
      ORDER BY hour DESC
    `).bind(
      MetricType.API_RESPONSE,
      MetricType.WEBSOCKET_CONNECTION,
      MetricType.AI_API_CALL
    ).all();

    // 按用户统计 Token 使用（Top 10）
    const topTokenUsers = await db.prepare(`
      SELECT 
        user_id,
        SUM(tokens_used) as total_tokens,
        COUNT(*) as request_count
      FROM performance_metrics
      WHERE metric_type = ? 
        AND created_at >= datetime('now', ?)
        AND user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY total_tokens DESC
      LIMIT 10
    `).bind(MetricType.TOKEN_USAGE, sqlTimeRange).all();

    return {
      timeRange,
      api: {
        overall: apiOverall || {},
        byEndpoint: apiStats.results || []
      },
      websocket: websocketStats || {},
      aiApi: aiApiStats || {},
      tokens: {
        ...tokenStats || {},
        topUsers: topTokenUsers.results || []
      },
      hourly: hourlyStats.results || []
    };
  } catch (error) {
    // 错误将由调用者处理和记录，这里只是重新抛出
    throw error;
  }
}

/**
 * 清理旧的性能指标数据
 * @param {Object} db - 数据库连接
 * @param {number} retentionDays - 保留天数
 * @returns {Promise<number>} 删除的记录数
 */
export async function cleanupOldMetrics(db, retentionDays = 30) {
  try {
    const result = await db.prepare(`
      DELETE FROM performance_metrics
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).bind(retentionDays).run();

    return result?.meta?.changes ?? 0;
  } catch (error) {
    // 错误将由调用者处理和记录，这里只是重新抛出
    throw error;
  }
}
