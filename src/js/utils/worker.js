/**
 * worker.js - 占位模块
 *
 * ⚠️ 此文件已废弃，仅为占位保留。
 * 原内容为 Web Worker 草稿代码，含未定义变量（imageData、updateUI）
 * 且存在循环引用（new Worker('worker.js') 指向自身），
 * 从未被项目实际引用，故替换为安全空模块。
 *
 * 图片压缩功能已由 background-manager.js 中的 compressImage() 方法实现，
 * 无需 Web Worker。
 */

// 安全的空导出模块，避免被意外 import 时抛出 ReferenceError
export default null;
