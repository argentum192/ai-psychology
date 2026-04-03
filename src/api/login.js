import bcrypt from 'bcryptjs';
import jwt from '@tsndr/cloudflare-worker-jwt';
import { getJwtSecret, JWT_EXPIRY } from '../config.js';
import { logWarning } from '../utils/logger.js';
import { asyncHandler, validateRequired, authError } from '../utils/errorHandler.js';

/**
 * 用户登录处理
 * @param {Object} context - 请求上下文
 * @param {Request} context.request - HTTP请求对象
 * @param {Object} context.env - 环境变量
 * @returns {Promise<Response>} HTTP响应
 */
async function loginHandler(context) {
  const { request, env } = context;

  // 解析前端发来的 JSON 数据
  const { name, password } = await request.json();

  // 基础验证 - 使用统一验证函数
  validateRequired({ name, password }, ['name', 'password']);

  // --- 数据库查询 ---
  // 根据姓名在 'users' 表中查找用户
  // 我们需要用户的 id (用来生成令牌)、name (用于显示) 和 hashed_password (用来比对密码)
  const userQuery = await env.ai_psychology_db.prepare(
    'SELECT id, name, hashed_password FROM users WHERE name = ?'
  ).bind(name).first();

  // 如果查询结果为空，说明用户不存在
  if (!userQuery) {
    // 出于安全考虑，我们不明确提示“用户不存在”，而是返回一个模糊的错误
    await logWarning(env, 'login', `登录失败: 姓名不存在 ${name}`, {
      endpoint: '/api/login',
      method: 'POST',
      request
    });
    throw authError('姓名或密码错误');
  }

  // --- 密码验证 ---
  // 使用 bcrypt.compareSync 比较用户输入的明文密码和数据库存储的哈希密码
  const isMatch = bcrypt.compareSync(password, userQuery.hashed_password);

  // 如果密码不匹配
  if (!isMatch) {
    await logWarning(env, 'login', `登录失败: 密码错误 (姓名: ${name})`, {
      endpoint: '/api/login',
      method: 'POST',
      request
    });
    throw authError('姓名或密码错误');
  }

  // --- 生成 JWT 令牌 ---
  // 如果代码执行到这里，说明用户身份验证成功！
  // 我们将为用户生成一个 JWT (JSON Web Token)
  // JWT_SECRET 从环境变量获取，用于签名，确保令牌不被伪造
  const jwtSecret = getJwtSecret(env);
  
  const token = await jwt.sign({
    id: userQuery.id,
    name: userQuery.name,
    role: 'user',
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY.USER
  }, jwtSecret);
  
  // 将生成的令牌以 JSON 格式返回给前端
  return new Response(JSON.stringify({ token }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 导出包装后的处理函数
 */
export const onRequestPost = asyncHandler(loginHandler);