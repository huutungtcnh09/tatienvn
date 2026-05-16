# APP_KD System

Monorepo bao gom:
- services/api: Backend Node.js + Express + Prisma + MySQL
- apps/head-office: React + Vite cho admin.domain.com
- apps/store-pos: React + Vite cho pos.domain.com
- apps/corporate-web: React + Vite cho domain.com

## Khoi dong nhanh

1. Cai dependency

   npm install

2. Cau hinh bien moi truong

   - Sao chep services/api/.env.example thanh services/api/.env
   - Cap nhat DATABASE_URL, JWT_SECRET

3. Tao database schema

   cd services/api
   npx prisma db push
   npx prisma db seed

4. Chay he thong

   - Backend: npm run dev:api
   - Head Office: npm run dev:head
   - Store POS: npm run dev:store
   - Corporate Web: npm run dev:web

## Ghi chu

Tai lieu dac ta nam trong thu muc docs.

## Guardrail loi chu

Du an co script kiem tra chuoi nghi ngo loi dau/encoding trong cac app va service:

npm run check:text

Nen chay lenh nay truoc khi commit hoac trong CI de phat hien som cac chuoi loi nhu mojibake, ky tu thay the, viet tat khong mong muon.

### Cai pre-commit hook

De tu dong chay check text truoc moi lan commit:

npm run hooks:install

Neu thu muc hien tai chua la Git repository, lenh se bo qua an toan. Hay chay lai sau khi `git init` hoac khi mo dung thu muc goc cua repo.
