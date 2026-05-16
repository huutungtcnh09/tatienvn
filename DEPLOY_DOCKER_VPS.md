# Deploy Production Bang Docker Tren VPS

Tai lieu nay ap dung cho domain `tatien.vn`, `admin.tatien.vn`, `pos.tatien.vn`, `api.tatien.vn`.

## 1) Yeu cau

- VPS Ubuntu co mo cong `80`, `443`.
- DNS A record tro ve `27.71.26.161`:
  - `tatien.vn`
  - `www.tatien.vn`
  - `admin.tatien.vn`
  - `pos.tatien.vn`
  - `api.tatien.vn`
- May VPS truy cap duoc DB `10.1.1.108:3306`.

## 2) Cai Docker tren VPS

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
```

## 3) Dua source len VPS

```bash
sudo mkdir -p /opt/app-kd
sudo chown -R $USER:$USER /opt/app-kd
cd /opt/app-kd
git clone <GIT_REPO_URL> .
```

## 4) Tao file env production

```bash
cd /opt/app-kd/deploy
cp .env.prod.example .env.prod
```

Cap nhat `JWT_SECRET` trong `deploy/.env.prod` bang chuoi manh, vi du:

```bash
JWT_SECRET=$(openssl rand -base64 48)
```

## 5) Build va chay

```bash
cd /opt/app-kd
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Kiem tra:

```bash
docker compose -f deploy/docker-compose.prod.yml ps
curl -I https://tatien.vn
curl -I https://admin.tatien.vn
curl -I https://pos.tatien.vn
curl -I https://api.tatien.vn/health
```

## 6) Cap nhat ban moi

```bash
cd /opt/app-kd
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

## 7) GitHub Actions tu dong deploy (tuy chon)

Workflow da tao tai `.github/workflows/deploy-vps-docker.yml`.
Can them secrets trong GitHub repo:

- `VPS_HOST` = `27.71.26.161`
- `VPS_PORT` = `22`
- `VPS_USER` = user SSH tren VPS
- `VPS_SSH_KEY` = private key deploy (khong dung password)

Sau khi setup key SSH, moi lan push `main` se tu deploy.

## 8) Luu y van hanh

- Khong commit `deploy/.env.prod` len git.
- Lan dau nen chay backup DB truoc khi `RUN_MIGRATIONS=true`.
- Neu khong muon migrate tu dong khi start API: dat `RUN_MIGRATIONS=false`.
