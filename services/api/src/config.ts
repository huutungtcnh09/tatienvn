import dotenv from "dotenv";

dotenv.config();

const requiredVars = ["DATABASE_URL", "JWT_SECRET"];
const defaultCorsOrigins = "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178";

function parseCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, "").toLowerCase())
    .filter(Boolean);
}

for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL as string,
  jwtSecret: process.env.JWT_SECRET as string,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "30d",
  corsOrigin: parseCorsOrigins(process.env.CORS_ORIGIN || defaultCorsOrigins)
};
