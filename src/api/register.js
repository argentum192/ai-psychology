import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH, BCRYPT_SALT_ROUNDS } from '../config.js';
import { logWarning } from '../utils/logger.js';
import { asyncHandler, validateRequired, validatePassword, AppError, ErrorType } from '../utils/errorHandler.js';

/**
 * 用户注册处理
 * @param {Object} context - 请求上下文
 * @param {Request} context.request - HTTP请求对象
 * @param {Object} context.env - 环境变量
 * @returns {Promise<Response>} HTTP响应
 */
async function registerHandler(context) {
  const { request, env } = context;

  // 解析前端发送过来的 JSON 数据，获取姓名、密码和注册码
  const { name, password, registration_code } = await request.json();

  // 基础验证：确保姓名、密码和注册码不为空
  validateRequired(
    { name, password, registration_code },
    ['name', 'password', 'registration_code']
  );

  // 姓名格式验证：2-4个汉字
  const nameRegex = /^[\u4e00-\u9fa5]{2,4}$/;
  if (!nameRegex.test(name)) {
    throw new AppError('姓名必须是2-4个汉字', 400, ErrorType.VALIDATION);
  }

  // 密码长度验证
  validatePassword(password, MIN_PASSWORD_LENGTH);

  // --- 验证注册码 ---
  // 查询数据库中是否存在该注册码且处于激活状态
  const codeResult = await env.ai_psychology_db.prepare(
    'SELECT id FROM registration_codes WHERE code = ? AND is_active = 1'
  ).bind(registration_code).first();

  if (!codeResult) {
    throw new AppError('注册码无效或已被禁用', 403, ErrorType.AUTHORIZATION);
  }

  // --- 密码加密 ---
  // 生成一个 "salt"，可以理解为加密用的随机字符串，增加密码破解难度
  // 使用配置的 salt rounds（12），比之前的 10 更安全
  const salt = bcrypt.genSaltSync(BCRYPT_SALT_ROUNDS);
  // 使用 salt 对原始密码进行哈希加密
  const hashedPassword = bcrypt.hashSync(password, salt);

  // --- 数据库操作 ---
  // 准备 SQL 语句，将新用户信息插入到 'users' 表中
  // 注意：我们在这里使用了你之前设置的数据库绑定名 env.ai_psychology_db
  await env.ai_psychology_db.prepare(
    'INSERT INTO users (name, hashed_password) VALUES (?, ?)'
  ).bind(name, hashedPassword).run();
  
  // 如果插入成功，返回 201  Created 状态码和成功消息
  return new Response('注册成功', { status: 201 });
}

/**
 * 导出包装后的处理函数
 */
export const onRequestPost = asyncHandler(registerHandler);