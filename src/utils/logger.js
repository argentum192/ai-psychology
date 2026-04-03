/**
 * @fileoverview 日志工具模块
 * 用于记录应用程序运行时的错误和重要信息
 * 
 * 使用建议：
 * - 优先使用 logInfo() 和 logWarning() 记录一般信息和警告
 * - 仅在真正的错误情况下使用 logError() 的 error 级别
 * - 尽量使用内部日志函数（logInfo, logWarning, logError）而不是直接使用 console.*
 * - 避免在生产环境中使用 console.log/debug 等调试日志，会产生额外费用
 * - 日志会自动记录到数据库，便于后续分析和监控
 */

/**
 * 日志选项配置
 * @typedef {Object} LogOptions
 * @property {('error'|'warning'|'info')} level - 日志级别
 * @property {string} category - 错误类别 (如: 'auth', 'database', 'api', 'validation')
 * @property {string} message - 错误消息
 * @property {Error} [error] - 错误对象
 * @property {number} [userId] - 用户ID
 * @property {string} [endpoint] - API端点
 * @property {string} [method] - HTTP方法
 * @property {Request} [request] - 请求对象
 * @property {string} [stack] - 错误堆栈跟踪
 */

/**
 * 记录错误日志到数据库
 * @param {Object} env - Cloudflare环境对象,包含数据库绑定
 * @param {LogOptions} options - 日志选项
 * @returns {Promise<void>}
 */
export async function logError(env, options) {
  try {
    const {
      level = 'error',
      category,
      message,
      error,
      userId,
      endpoint,
      method,
      request
    } = options;

    // 提取堆栈信息
    const stack = error?.stack || null;

    // 从请求中提取信息
    let ipAddress = null;
    let userAgent = null;

    if (request) {
      ipAddress = request.headers.get('CF-Connecting-IP') || 
                  request.headers.get('X-Forwarded-For') || 
                  null;
      userAgent = request.headers.get('User-Agent') || null;
    }

    // 根据日志级别选择合适的 console 方法，减少调试日志费用
    const consoleMethod = level === 'error' ? console.error : 
                          level === 'warning' ? console.warn : 
                          console.log;
    
    // 仅记录关键信息到控制台
    const emoji = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : 'ℹ️';
    consoleMethod(`${emoji} [${level.toUpperCase()}] [${category}] ${message}`);

    // 记录到数据库
    await env.ai_psychology_db.prepare(`
      INSERT INTO error_logs (level, category, message, stack, user_id, endpoint, method, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      level,
      category,
      message,
      stack,
      userId || null,
      endpoint || null,
      method || null,
      ipAddress,
      userAgent
    ).run();
    
    // 在开发环境输出更多信息
    debugLog(env, `✓ 日志已保存到数据库 [${level}/${category}]`);

  } catch (logError) {
    // 如果日志记录失败，仅简单输出到控制台，避免额外的调试日志费用
    console.warn('⚠️ 日志记录失败:', logError.message);
  }
}

/**
 * 记录信息日志
 * @param {Object} env - Cloudflare环境对象
 * @param {string} category - 日志类别
 * @param {string} message - 日志消息
 * @param {Object} [options={}] - 额外的日志选项
 * @returns {Promise<void>}
 */
export async function logInfo(env, category, message, options = {}) {
  return logError(env, {
    level: 'info',
    category,
    message,
    ...options
  });
}

/**
 * 记录警告日志
 * @param {Object} env - Cloudflare环境对象
 * @param {string} category - 日志类别
 * @param {string} message - 日志消息
 * @param {Object} [options={}] - 额外的日志选项
 * @returns {Promise<void>}
 */
export async function logWarning(env, category, message, options = {}) {
  return logError(env, {
    level: 'warning',
    category,
    message,
    ...options
  });
}

/**
 * 包装API处理函数，自动捕获和记录错误
 * @param {Function} handler - API处理函数
 * @param {string} category - 错误类别
 * @returns {Function} 包装后的处理函数
 */
export function withErrorLogging(handler, category) {
  return async (context, ...args) => {
    try {
      return await handler(context, ...args);
    } catch (error) {
      const { request, env } = context;
      const url = new URL(request.url);
      
      await logError(env, {
        level: 'error',
        category,
        message: error.message || '未知错误',
        error,
        userId: context.data?.user?.id,
        endpoint: url.pathname,
        method: request.method,
        request
      });

      // 重新抛出错误或返回通用错误响应
      return new Response('服务器内部错误', { status: 500 });
    }
  };
}

/**
 * 开发环境调试日志（生产环境下不输出，避免额外费用）
 * @param {Object} env - Cloudflare环境对象
 * @param {...any} args - 要输出的参数
 */
export function debugLog(env, ...args) {
  // 仅在明确设置了开发环境标志时才输出调试日志
  // 在 wrangler.jsonc 中可以设置 vars: { ENVIRONMENT: "development" }
  if (env?.ENVIRONMENT === 'development') {
    console.log('[DEBUG]', ...args);
  }
}
