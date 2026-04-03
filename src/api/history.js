import { asyncHandler } from '../utils/errorHandler.js';

/**
 * 获取用户聊天历史记录
 * @param {Object} context - 请求上下文
 * @param {Request} context.request - HTTP请求对象
 * @param {Object} context.env - 环境变量
 * @param {Object} context.data - 中间件传递的数据
 * @returns {Promise<Response>} HTTP响应
 */
async function getHistoryHandler(context) {
  const { env, data } = context;

  // 从 data 对象中安全地获取用户 ID
  // 这个 ID 是在 _middleware.js 中通过验证 JWT 令牌后放入的
  const userId = data.user.id;

  // --- 数据库查询 ---
  // 准备 SQL 语句，从 'chat_logs' 表中查询所有与该 userId 相关的记录
  // 我们需要知道：谁发的(sender)、发了什么(message)以及发送时间(timestamp)
  // 使用 ORDER BY timestamp ASC 确保聊天记录按时间从早到晚排序
  const historyQuery = await env.ai_psychology_db.prepare(
    "SELECT sender, message, timestamp FROM chat_logs WHERE user_id = ? ORDER BY timestamp ASC"
  ).bind(userId).all();

  // D1 的 .all() 方法返回的对象包含一个 results 数组
  // 我们将这个数组直接以 JSON 格式返回给前端
  return new Response(JSON.stringify(historyQuery.results), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 导出包装后的处理函数
 */
export const onRequestGet = asyncHandler(getHistoryHandler);