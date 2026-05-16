import { createHash, createHmac } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { badRequest, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { prisma } from "../../prisma.js";

type FacebookCampaignRequest = {
  appId?: string;
  appSecret?: string;
  accessToken?: string;
  adAccountId?: string;
  limit?: number;
};

const router = Router();
const FACEBOOK_CONFIG_ID = "default";

const updateFacebookConfigSchema = z.object({
  appId: z.string().trim().max(191).optional().nullable(),
  appSecret: z.string().trim().max(5000).optional().nullable(),
  accessToken: z.string().trim().max(10000).optional().nullable(),
  adAccountId: z.string().trim().max(191).optional().nullable()
});

const createCustomAudienceSchema = z.object({
  name: z.string().trim().min(2).max(191),
  description: z.string().trim().max(2000).optional().nullable(),
  facebookAudienceId: z.string().trim().max(191).optional().nullable(),
  adAccountId: z.string().trim().max(191).optional().nullable(),
  details: z
    .array(
      z.object({
        customerId: z.string().trim().min(1)
      })
    )
    .optional()
});

const appendAudienceDetailsSchema = z.object({
  details: z
    .array(
      z.object({
        customerId: z.string().trim().min(1)
      })
    )
    .min(1)
});

function normalizeOptionalText(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function maskSecret(raw: string | null | undefined) {
  const value = String(raw || "");
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function serializeFacebookConfig(config: {
  appId: string | null;
  adAccountId: string | null;
  appSecret: string | null;
  accessToken: string | null;
} | null) {
  return {
    appId: config?.appId || "",
    adAccountId: config?.adAccountId || "",
    hasAppSecret: Boolean(config?.appSecret),
    hasAccessToken: Boolean(config?.accessToken),
    appSecretMasked: maskSecret(config?.appSecret),
    accessTokenMasked: maskSecret(config?.accessToken)
  };
}

async function normalizeDetailInput(input: {
  customerId: string;
}) {
  const customerId = normalizeOptionalText(input.customerId);
  if (!customerId) return null;

  const customer = await prisma.partner.findFirst({
    where: { id: customerId, isCustomer: true },
    select: {
      id: true
    }
  });

  if (!customer) {
    return null;
  }

  return {
    customerId: customer.id
  };
}

router.get("/custom-audiences", requirePermission("dashboard:read"), async (_req, res) => {
  const audiences = await prisma.marketingCustomAudience.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      },
      _count: {
        select: { details: true }
      }
    }
  });

  return ok(
    res,
    audiences.map((audience) => ({
      ...audience,
      detailCount: audience._count.details
    }))
  );
});

router.get("/custom-audiences/:id", requirePermission("dashboard:read"), async (req, res) => {
  const audience = await prisma.marketingCustomAudience.findUnique({
    where: { id: req.params.id },
    include: {
      details: {
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
              email: true,
              phone: true,
              phone2: true,
              phone3: true
            }
          }
        }
      },
      createdBy: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  });

  if (!audience) {
    return badRequest(res, "Không tìm thấy đối tượng tùy chỉnh");
  }

  return ok(res, audience);
});

router.post("/custom-audiences", requirePermission("dashboard:read"), async (req: AuthRequest, res) => {
  const parsed = createCustomAudienceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, "Dữ liệu tạo đối tượng tùy chỉnh không hợp lệ");
  }

  const detailsInput = parsed.data.details || [];
  const normalizedDetailCustomerIds = new Set<string>();

  for (const item of detailsInput) {
    const normalized = await normalizeDetailInput(item);
    if (normalized) {
      normalizedDetailCustomerIds.add(normalized.customerId);
    }
  }

  const audience = await prisma.marketingCustomAudience.create({
    data: {
      name: parsed.data.name,
      description: normalizeOptionalText(parsed.data.description),
      facebookAudienceId: normalizeOptionalText(parsed.data.facebookAudienceId),
      adAccountId: normalizeOptionalText(parsed.data.adAccountId),
      createdByUserId: req.user?.sub || null,
      details: normalizedDetailCustomerIds.size
        ? {
            create: Array.from(normalizedDetailCustomerIds).map((customerId) => ({ customerId }))
          }
        : undefined
    },
    include: {
      details: {
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
              email: true,
              phone: true,
              phone2: true,
              phone3: true
            }
          }
        }
      }
    }
  });

  return ok(res, audience, "Tạo đối tượng tùy chỉnh thành công");
});

router.post("/custom-audiences/:id/details", requirePermission("dashboard:read"), async (req, res) => {
  const parsed = appendAudienceDetailsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, "Dữ liệu chi tiết đối tượng tùy chỉnh không hợp lệ");
  }

  const audience = await prisma.marketingCustomAudience.findUnique({
    where: { id: req.params.id },
    select: { id: true }
  });
  if (!audience) {
    return badRequest(res, "Không tìm thấy đối tượng tùy chỉnh");
  }

  const normalizedDetailCustomerIds = new Set<string>();

  for (const item of parsed.data.details) {
    const normalized = await normalizeDetailInput(item);
    if (normalized) {
      normalizedDetailCustomerIds.add(normalized.customerId);
    }
  }

  if (!normalizedDetailCustomerIds.size) {
    return badRequest(res, "Không có chi tiết hợp lệ để thêm");
  }

  await prisma.marketingCustomAudienceDetail.createMany({
    data: Array.from(normalizedDetailCustomerIds).map((customerId) => ({
      customAudienceId: audience.id,
      customerId
    })),
    skipDuplicates: true
  });

  const updatedAudience = await prisma.marketingCustomAudience.findUnique({
    where: { id: audience.id },
    include: {
      details: {
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
              email: true,
              phone: true,
              phone2: true,
              phone3: true
            }
          }
        }
      }
    }
  });

  return ok(res, updatedAudience, "Thêm chi tiết đối tượng tùy chỉnh thành công");
});

router.delete("/custom-audiences/:id/details/:detailId", requirePermission("dashboard:read"), async (req, res) => {
  const { id: audienceId, detailId } = req.params;

  const detail = await prisma.marketingCustomAudienceDetail.findFirst({
    where: { id: detailId, customAudienceId: audienceId }
  });

  if (!detail) {
    return badRequest(res, "Không tìm thấy chi tiết đối tượng tùy chỉnh");
  }

  await prisma.marketingCustomAudienceDetail.delete({ where: { id: detailId } });

  const updatedAudience = await prisma.marketingCustomAudience.findUnique({
    where: { id: audienceId },
    include: {
      details: {
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: { id: true, code: true, name: true, email: true, phone: true, phone2: true, phone3: true }
          }
        }
      }
    }
  });

  return ok(res, updatedAudience, "Đã xóa khách hàng khỏi đối tượng");
});

router.get("/facebook/config", requirePermission("dashboard:read"), async (_req, res) => {
  const config = await prisma.marketingFacebookConfig.findUnique({
    where: { id: FACEBOOK_CONFIG_ID }
  });

  return ok(res, serializeFacebookConfig(config));
});

router.put("/facebook/config", requirePermission("dashboard:read"), async (req, res) => {
  const parsed = updateFacebookConfigSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, "Dữ liệu cấu hình Facebook không hợp lệ");
  }

  const payload = parsed.data;
  const data: Record<string, string | null> = {};

  if (Object.prototype.hasOwnProperty.call(payload, "appId")) {
    data.appId = normalizeOptionalText(payload.appId);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "adAccountId")) {
    data.adAccountId = normalizeOptionalText(payload.adAccountId);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "appSecret")) {
    data.appSecret = normalizeOptionalText(payload.appSecret);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "accessToken")) {
    data.accessToken = normalizeOptionalText(payload.accessToken);
  }

  const updated = await prisma.marketingFacebookConfig.upsert({
    where: { id: FACEBOOK_CONFIG_ID },
    create: {
      id: FACEBOOK_CONFIG_ID,
      appId: data.appId || null,
      adAccountId: data.adAccountId || null,
      appSecret: data.appSecret || null,
      accessToken: data.accessToken || null
    },
    update: data
  });

  return ok(res, serializeFacebookConfig(updated), "Lưu cấu hình Facebook thành công");
});

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Chuẩn hóa số điện thoại Việt Nam → E.164 không dấu "+" (84XXXXXXXXX)
 * Hỗ trợ: 0XXXXXXXXX, 84XXXXXXXXX, +84XXXXXXXXX
 * Trả về null nếu quá ngắn/không hợp lệ.
 */
function normalizeVietnamesePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let normalized = digits;
  if (normalized.startsWith("84") && normalized.length >= 11) {
    // đã có mã quốc gia
  } else if (normalized.startsWith("0") && normalized.length >= 9) {
    normalized = "84" + normalized.slice(1);
  } else if (!normalized.startsWith("84") && normalized.length >= 9) {
    normalized = "84" + normalized;
  } else {
    return null;
  }
  // Kiểm tra độ dài hợp lý (11-12 chữ số)
  if (normalized.length < 10 || normalized.length > 13) return null;
  return normalized;
}

function normalizeAccountId(rawAccountId: string) {
  const trimmed = rawAccountId.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function createAppSecretProof(accessToken: string, appSecret: string) {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

async function getRequestConfig(body: FacebookCampaignRequest) {
  const stored = await prisma.marketingFacebookConfig.findUnique({
    where: { id: FACEBOOK_CONFIG_ID }
  });

  const appId = String(normalizeOptionalText(body.appId) || stored?.appId || "").trim();
  const appSecret = String(normalizeOptionalText(body.appSecret) || stored?.appSecret || "").trim();
  const accessToken = String(normalizeOptionalText(body.accessToken) || stored?.accessToken || "").trim();
  const adAccountId = String(normalizeOptionalText(body.adAccountId) || stored?.adAccountId || "").trim();
  const limit = Number(body.limit || 200);

  return {
    appId,
    appSecret,
    accessToken,
    adAccountId,
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 200
  };
}

async function fetchFacebookList(
  accountId: string,
  path: string,
  fields: string,
  config: Awaited<ReturnType<typeof getRequestConfig>>
) {
  const params = new URLSearchParams({
    fields,
    limit: String(config.limit),
    access_token: config.accessToken
  });

  if (config.appId) {
    params.set("app_id", config.appId);
  }

  if (config.appSecret) {
    params.set("appsecret_proof", createAppSecretProof(config.accessToken, config.appSecret));
  }

  const response = await fetch(`https://graph.facebook.com/v22.0/${accountId}/${path}?${params.toString()}`);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function readFacebookError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  return String((payload as { error?: { message?: string } }).error?.message || "").trim();
}

function readFacebookErrorDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as {
    error?: {
      message?: string;
      type?: string;
      code?: number;
      error_subcode?: number;
      fbtrace_id?: string;
    };
  }).error;

  if (!error) return null;

  return {
    message: String(error.message || "").trim(),
    type: String(error.type || "").trim(),
    code: typeof error.code === "number" ? error.code : null,
    subcode: typeof error.error_subcode === "number" ? error.error_subcode : null,
    fbtraceId: String(error.fbtrace_id || "").trim()
  };
}

router.post("/facebook/campaigns", requirePermission("dashboard:read"), async (req, res) => {
  const body = (req.body || {}) as FacebookCampaignRequest;
  const config = await getRequestConfig(body);

  if (!config.accessToken) return badRequest(res, "Thiếu Access Token Facebook");
  if (!config.adAccountId) return badRequest(res, "Thiếu ID ad account");

  try {
    const accountId = normalizeAccountId(config.adAccountId);
    const { response, payload } = await fetchFacebookList(
      accountId,
      "campaigns",
      "id,name,status,configured_status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,updated_time",
      config
    );

    if (!response.ok) {
      const fbMessage = readFacebookError(payload);
      return res.status(response.status).json({
        message: fbMessage || "Không tải được danh sách chiến dịch Facebook"
      });
    }

    return ok(res, payload, "Lấy danh sách chiến dịch thành công");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kết nối Facebook thất bại";
    return res.status(500).json({ message });
  }
});

router.post("/facebook/custom-audiences", requirePermission("dashboard:read"), async (req, res) => {
  const body = (req.body || {}) as FacebookCampaignRequest;
  const config = await getRequestConfig(body);

  if (!config.accessToken) return badRequest(res, "Thiếu Access Token Facebook");
  if (!config.adAccountId) return badRequest(res, "Thiếu ID ad account");

  try {
    const accountId = normalizeAccountId(config.adAccountId);
    const { response, payload } = await fetchFacebookList(
      accountId,
      "customaudiences",
      "id,name,subtype,description,size_lower_bound,size_upper_bound,retention_days,time_created,time_updated,delivery_status,operation_status",
      config
    );

    if (!response.ok) {
      const fbMessage = readFacebookError(payload);
      return res.status(response.status).json({
        message: fbMessage || "Không tải được danh sách đối tượng tùy chỉnh"
      });
    }

    return ok(res, payload, "Lấy danh sách đối tượng tùy chỉnh thành công");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kết nối Facebook thất bại";
    return res.status(500).json({ message });
  }
});

router.post("/facebook/custom-audiences/:audienceId/add-users", requirePermission("dashboard:read"), async (req, res) => {
  const body = (req.body || {}) as FacebookCampaignRequest & { users?: unknown[] };
  const config = await getRequestConfig(body);
  const { audienceId } = req.params;
  const users = Array.isArray(body.users) ? body.users : [];

  if (!config.accessToken) return badRequest(res, "Thiếu Access Token Facebook");
  if (!audienceId) return badRequest(res, "Thiếu ID đối tượng tùy chỉnh");
  if (users.length === 0) return badRequest(res, "Danh sách khách hàng không được để trống");

  try {
    const params = new URLSearchParams({
      access_token: config.accessToken
    });

    if (config.appSecret) {
      params.set("appsecret_proof", createAppSecretProof(config.accessToken, config.appSecret));
    }

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${audienceId}?${params.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: {
            add: users
          }
        })
      }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const fbMessage = readFacebookError(payload);
      return res.status(response.status).json({
        message: fbMessage || "Không thêm được khách hàng vào đối tượng"
      });
    }

    return ok(res, payload, "Thêm khách hàng thành công");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kết nối Facebook thất bại";
    return res.status(500).json({ message });
  }
});

router.post("/facebook/custom-audiences/:audienceId/remove-users", requirePermission("dashboard:read"), async (req, res) => {
  const body = (req.body || {}) as FacebookCampaignRequest & { users?: unknown[] };
  const config = await getRequestConfig(body);
  const { audienceId } = req.params;
  const users = Array.isArray(body.users) ? body.users : [];

  if (!config.accessToken) return badRequest(res, "Thiếu Access Token Facebook");
  if (!audienceId) return badRequest(res, "Thiếu ID đối tượng tùy chỉnh");
  if (users.length === 0) return badRequest(res, "Danh sách khách hàng không được để trống");

  try {
    const params = new URLSearchParams({
      access_token: config.accessToken
    });

    if (config.appSecret) {
      params.set("appsecret_proof", createAppSecretProof(config.accessToken, config.appSecret));
    }

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${audienceId}?${params.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: {
            remove: users
          }
        })
      }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const fbMessage = readFacebookError(payload);
      return res.status(response.status).json({
        message: fbMessage || "Không xóa được khách hàng khỏi đối tượng"
      });
    }

    return ok(res, payload, "Xóa khách hàng thành công");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kết nối Facebook thất bại";
    return res.status(500).json({ message });
  }
});

router.post("/facebook/account-info", requirePermission("dashboard:read"), async (req, res) => {
  const body = (req.body || {}) as FacebookCampaignRequest;
  const config = await getRequestConfig(body);

  if (!config.accessToken) return badRequest(res, "Thiếu Access Token Facebook");
  if (!config.adAccountId) return badRequest(res, "Thiếu ID ad account");

  try {
    const accountId = normalizeAccountId(config.adAccountId);

    // Lấy thông tin tài khoản quảng cáo
    const adAccountParams = new URLSearchParams({
      fields: "name,balance,currency,spend_cap,timezone_name,created_time",
      access_token: config.accessToken
    });

    if (config.appSecret) {
      adAccountParams.set("appsecret_proof", createAppSecretProof(config.accessToken, config.appSecret));
    }

    const adAccountResponse = await fetch(
      `https://graph.facebook.com/v22.0/${accountId}?${adAccountParams.toString()}`
    );
    const adAccountPayload = await adAccountResponse.json().catch(() => null);

    if (!adAccountResponse.ok) {
      const fbMessage = readFacebookError(adAccountPayload);
      return res.status(adAccountResponse.status).json({
        message: fbMessage || "Không tải được thông tin tài khoản quảng cáo"
      });
    }

    return ok(res, {
      adAccount: adAccountPayload
    }, "Lấy thông tin tài khoản thành công");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kết nối Facebook thất bại";
    return res.status(500).json({ message });
  }
});

router.post("/custom-audiences/:id/push-to-facebook", requirePermission("dashboard:read"), async (req, res) => {
  const audienceId = req.params.id;
  const body = (req.body || {}) as FacebookCampaignRequest;
  const config = await getRequestConfig(body);

  if (!config.accessToken) return badRequest(res, "Thiếu Access Token Facebook");

  const audience = await prisma.marketingCustomAudience.findUnique({
    where: { id: audienceId },
    include: {
      details: {
        include: {
          customer: {
            select: {
              id: true,
              email: true,
              phone: true,
              phone2: true,
              phone3: true,
              isCustomer: true
            }
          }
        }
      }
    }
  });

  if (!audience) return badRequest(res, "Không tìm thấy đối tượng tùy chỉnh");
  if (!audience.facebookAudienceId) {
    return badRequest(res, "Đối tượng chưa có Facebook Audience ID — cần liên kết trước");
  }

  // Build rows: mỗi số điện thoại hợp lệ tạo 1 dòng [email_hash, phone_hash]
  // Chuẩn: email → lowercase → sha256 | phone → E.164 VN → sha256
  const rows: string[][] = [];
  for (const detail of audience.details) {
    const customer = detail.customer;
    if (!customer?.isCustomer) continue;

    const emailValue = String(customer.email || "").trim().toLowerCase();
    const emailHash = emailValue ? sha256hex(emailValue) : "";

    const rawPhones = [customer.phone, customer.phone2, customer.phone3].filter((p): p is string => Boolean(p?.trim()));
    const validPhones = rawPhones
      .map((p) => normalizeVietnamesePhone(p))
      .filter((p): p is string => Boolean(p));

    if (validPhones.length > 0) {
      for (const phone of validPhones) {
        rows.push([emailHash, sha256hex(phone)]);
      }
    } else if (emailHash) {
      rows.push([emailHash, ""]);
    }
  }

  if (rows.length === 0) {
    return badRequest(res, "Không có dữ liệu hợp lệ (email / số điện thoại) để đẩy lên Facebook");
  }

  try {
    const params = new URLSearchParams({ access_token: config.accessToken });
    if (config.appSecret) {
      params.set("appsecret_proof", createAppSecretProof(config.accessToken, config.appSecret));
    }

    // Facebook Custom Audience Users Replace API
    // POST /{version}/{audience-id}/usersreplace
    const fbBody = {
      session: {
        session_id: Date.now(),
        batch_seq: 1,
        last_batch_flag: true,
        estimated_num_total: rows.length
      },
      payload: {
        schema: ["EMAIL", "PHONE"],
        data: rows
      }
    };

    const fbRes = await fetch(
      `https://graph.facebook.com/v22.0/${audience.facebookAudienceId}/usersreplace?${params.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fbBody)
      }
    );

    const fbPayload = await fbRes.json().catch(() => null);

    if (!fbRes.ok) {
      const fbMessage = readFacebookError(fbPayload);
      const fbDetail = readFacebookErrorDetail(fbPayload);

      if (fbDetail?.code === 2650 && fbDetail?.subcode === 1870145) {
        return res.status(409).json({
          message: "Đối tượng trên Facebook đang cập nhật, vui lòng thử lại sau vài phút",
          facebookError: fbDetail
        });
      }

      return res.status(fbRes.status).json({
        message: fbMessage || "Không đẩy được danh sách lên Facebook Custom Audience",
        facebookError: fbDetail
      });
    }

    return ok(res, { rows: rows.length, facebook: fbPayload }, `Đã thay thế ${rows.length} dòng lên Facebook thành công`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kết nối Facebook thất bại";
    return res.status(500).json({ message });
  }
});

export default router;
