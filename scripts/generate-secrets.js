#!/usr/bin/env node
/**
 * In ra JWT_SECRET và SESSION_SECRET ngẫu nhiên (64 hex chars).
 * Dùng khi tạo .env.production trên server hoặc đổi secret định kỳ.
 *
 * Chạy: node scripts/generate-secrets.js
 */
const crypto = require("crypto");

const jwt = crypto.randomBytes(32).toString("hex");
const session = crypto.randomBytes(32).toString("hex");

console.log("# Thêm vào .env hoặc .env.production (không commit):\n");
console.log(`JWT_SECRET=${jwt}`);
console.log(`SESSION_SECRET=${session}`);
