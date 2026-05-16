import rateLimit from "express-rate-limit";

/** Giới hạn đăng nhập: 10 lần / 15 phút / IP — chống brute force */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút." },
  skipSuccessfulRequests: true
});

/** Giới hạn đọc danh sách/chi tiết sản phẩm: 120 req / phút / IP */
export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều yêu cầu, vui lòng thử lại sau." }
});

/** Giới hạn gửi form tư vấn: 5 req / 15 phút / IP — chống spam */
export const consultationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút." }
});
