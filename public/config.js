// @ts-nocheck
/**
 * @fileoverview 前端应用配置文件
 * 集中管理所有前端配置,避免硬编码
 */

/**
 * 应用配置对象
 * @type {Object}
 */
window.APP_CONFIG = {
  /**
   * API配置
   */
  api: {
    /**
     * 获取完整的API URL
     * @param {string} path - API路径 (如 '/api/login')
     * @returns {string} 完整的API URL
     */
    getUrl(path) {
      return `${window.location.origin}${path}`;
    },

    /**
     * 获取WebSocket URL
     * @param {string} path - WebSocket路径 (如 '/api/chat/ws')
     * @param {Object} [params={}] - 查询参数
     * @returns {string} 完整的WebSocket URL
     */
    getWsUrl(path, params = {}) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const queryString = new URLSearchParams(params).toString();
      const url = `${protocol}//${window.location.host}${path}`;
      return queryString ? `${url}?${queryString}` : url;
    }
  },

  /**
   * 认证配置
   */
  auth: {
    /** Token存储的localStorage键名 */
    tokenKey: 'auth_token',

    /**
     * 获取存储的token
     * @returns {string|null} token或null
     */
    getToken() {
      return localStorage.getItem(this.tokenKey);
    },

    /**
     * 保存token
     * @param {string} token - JWT token
     */
    setToken(token) {
      localStorage.setItem(this.tokenKey, token);
    },

    /**
     * 清除token
     */
    clearToken() {
      localStorage.removeItem(this.tokenKey);
    },

    /**
     * 检查是否已登录
     * @returns {boolean} 是否已登录
     */
    isAuthenticated() {
      return !!this.getToken();
    },

    /**
     * 重定向到登录页
     * @param {string} [returnUrl] - 登录后返回的URL
     */
    redirectToLogin(returnUrl) {
      const url = returnUrl 
        ? `/login.html?returnUrl=${encodeURIComponent(returnUrl)}`
        : '/login.html';
      window.location.href = url;
    }
  },

  /**
   * UI配置
   */
  ui: {
    /** 消息最大长度 */
    maxMessageLength: 500,

    /** 自动保存间隔(毫秒) */
    autoSaveInterval: 30000,

    /** 页面标题 */
    pageTitle: 'AI 心理咨询',

    /** 默认头像URL */
    defaultAvatar: '/assets/avatar-default.png'
  },

  /**
   * WebSocket配置
   */
  websocket: {
    /** 重连延迟(毫秒) */
    reconnectDelay: 3000,

    /** 最大重连次数 */
    maxReconnectAttempts: 5,

    /** 心跳间隔(毫秒) */
    heartbeatInterval: 30000,

    /** 连接超时(毫秒) */
    connectionTimeout: 10000
  },

  /**
   * 验证配置
   */
  validation: {
    /** 最小密码长度 */
    minPasswordLength: 6,

    /** 姓名正则表达式（2-4个汉字） */
    namePattern: /^[\u4e00-\u9fa5]{2,4}$/,

    /** 注册码格式 */
    registrationCodePattern: /^[A-Z0-9]{8,16}$/
  },

  /**
   * 请求配置
   */
  request: {
    /** 默认超时时间(毫秒) */
    timeout: 30000,

    /** 默认请求头 */
    defaultHeaders: {
      'Content-Type': 'application/json'
    },

    /**
     * 创建授权请求头
     * @param {string} [token] - JWT token,不提供则从storage获取
     * @returns {Object} 请求头对象
     */
    getAuthHeaders(token) {
      const authToken = token || window.APP_CONFIG.auth.getToken();
      return {
        ...this.defaultHeaders,
        'Authorization': `Bearer ${authToken}`
      };
    }
  },

  /**
   * 环境检测
   */
  env: {
    /** 是否为开发环境 */
    isDevelopment: window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1',

    /** 是否为生产环境 */
    isProduction: window.location.hostname.includes('workers.dev') ||
                   window.location.hostname.includes('pages.dev'),

    /** 是否支持WebSocket */
    supportsWebSocket: 'WebSocket' in window,

    /** 是否支持localStorage */
    supportsLocalStorage: (() => {
      try {
        const test = '__storage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
      } catch (e) {
        return false;
      }
    })()
  },

  /**
   * 调试配置
   */
  debug: {
    /** 是否启用日志 */
    enableLogging: window.location.hostname === 'localhost',

    /**
     * 打印日志
     * @param {string} level - 日志级别 (log, warn, error)
     * @param {string} message - 日志消息
     * @param {*} [data] - 附加数据
     */
    log(level, message, data) {
      if (!this.enableLogging) return;
      
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      
      if (data) {
        console[level](prefix, message, data);
      } else {
        console[level](prefix, message);
      }
    }
  }
};

// 冻结配置对象,防止意外修改
Object.freeze(window.APP_CONFIG.api);
Object.freeze(window.APP_CONFIG.ui);
Object.freeze(window.APP_CONFIG.websocket);
Object.freeze(window.APP_CONFIG.validation);
Object.freeze(window.APP_CONFIG.env);

// 导出配置(用于模块化环境)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.APP_CONFIG;
}
