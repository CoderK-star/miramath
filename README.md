# Miramath

Miramath は、個人利用向けの数学学習アプリです。  

## 主な機能

- チャット学習: 数式つき対話（LaTeX）
- カリキュラム: 学習トピックの生成と管理
- 演習: 問題生成・提出・採点
- ノート: 手書きノートと学習メモ
- 資料 RAG: アップロード資料を参照した回答
- 進捗: 学習履歴と進み具合の可視化
- 認証: シングルユーザーログイン

## ローカル起動

### 前提ツール

**Docker Compose を使う場合（推奨）**
- Docker Desktop

**手動起動の場合**
- Python 3.11+
- Node.js 20+
- npm
- PostgreSQL 16 + pgvector 拡張（または SQLite でのフォールバック可）

### 1. リポジトリ取得

```bash
git clone <your-fork-or-repo-url>
cd miramath
```

### 2. 環境変数設定

```bash
cp .env.example .env
```

`.env` を編集して以下を設定してください。

**必須**

| 変数 | 説明 |
|------|------|
| `GEMINI_API_KEY` | Google Gemini API キー（チャット・埋め込み・OCR） |
| `SESSION_SECRET` | Cookie 署名用ランダム文字列（後述の生成コマンド参照） |
| `ADMIN_PASSWORD_HASH` | ログインパスワードの bcrypt ハッシュ（後述参照） |

**データベース（デフォルト: PostgreSQL）**

| 変数 | 説明 |
|------|------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db`（推奨）または `sqlite:///./data/math_teacher.db`（フォールバック） |

SQLite を使う場合は Docker / PostgreSQL 不要ですが、RAG ベクトル検索は Python 側のコサイン類似度計算になります。

**ストレージ（デフォルト: local）**

| 変数 | 説明 |
|------|------|
| `STORAGE_BACKEND` | `local`（デフォルト）または `gcs` |
| `GCS_BUCKET_NAME` | `gcs` 使用時: GCS バケット名 |
| `GCS_CREDENTIALS_FILE` | `gcs` 使用時: サービスアカウント JSON のパス |

**認証情報の生成**

```powershell
# SESSION_SECRET
python -c "import secrets; print(secrets.token_hex(32))"

# ADMIN_PASSWORD_HASH（'your_password' を任意のパスワードに変えて実行）
.\venv\Scripts\python.exe -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('your_password'))"
```

### 3a. Docker Compose で起動（推奨）

```bash
docker compose up --build
```

PostgreSQL（pgvector）・バックエンド・フロントエンドが一括で起動します。

### 3b. 手動起動

**バックエンド:**

```powershell
python -m venv venv
./venv/Scripts/Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt

cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

またはルートで:

```bash
./start_backend.bat
```

**フロントエンド（別ターミナル）:**

```bash
cd frontend
npm install
npm run dev
```

またはルートで:

```bash
./start_frontend.bat
```

### 4. アクセス

- ブラウザで `http://localhost:3000` を開く
- ログイン画面が表示されたらパスワードを入力してログイン

---

## 本番デプロイ（Vercel + Cloud Run）

### アーキテクチャ

```
ブラウザ
  ├─ app.example.com    → Vercel（Next.js frontend）
  └─ api.example.com    → Cloud Run（FastAPI backend）
                              ├─ Cloud SQL（PostgreSQL + pgvector）
                              └─ Cloud Storage（uploads）
```

---

### Vercel デプロイ（frontend）

#### 1. Vercel プロジェクトを作成

1. [vercel.com](https://vercel.com) にログインし、リポジトリをインポート
2. **Root Directory** を `frontend` に設定
3. Framework は `Next.js` が自動検出される

#### 2. 環境変数を設定

Vercel ダッシュボード → Settings → Environment Variables に追加:

| 変数名 | 値 |
|--------|-----|
| `NEXT_PUBLIC_API_BASE` | `https://api.example.com`（Cloud Run の URL） |

#### 3. デプロイ

```bash
# Vercel CLI を使う場合
npm i -g vercel
cd frontend
vercel --prod
```

または GitHub にプッシュすると自動デプロイされます。

---

### Cloud Run デプロイ（backend）
w
#### 前提

- Google Cloud CLI (`gcloud`) がインストール済み
- プロジェクトを選択済み: `gcloud config set project YOUR_PROJECT_ID`

#### 1. Secret Manager に機密情報を登録

```bash
# 各 secret を作成（値は対話入力または echo で渡す）
echo -n "your_gemini_api_key"          | gcloud secrets create GEMINI_API_KEY          --data-file=-
echo -n "$(python -c 'import secrets; print(secrets.token_hex(32))')" \
                                        | gcloud secrets create SESSION_SECRET            --data-file=-
echo -n '$2b$12$...'                   | gcloud secrets create ADMIN_PASSWORD_HASH       --data-file=-
echo -n "postgresql://user:pass@host/db" | gcloud secrets create DATABASE_URL            --data-file=-
echo -n "your-gcs-bucket"              | gcloud secrets create GCS_BUCKET_NAME           --data-file=-
```

#### 2. コンテナをビルドして push

`backend/Dockerfile` がリポジトリに含まれています。

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/miramath-backend ./backend
```

#### 3. Cloud Run にデプロイ

```bash
gcloud run deploy miramath-backend \
  --image gcr.io/YOUR_PROJECT_ID/miramath-backend \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "APP_ENV=production,FRONTEND_ORIGINS=https://app.example.com" \
  --set-env-vars "STORAGE_BACKEND=gcs" \
  --set-secrets \
    "GEMINI_API_KEY=GEMINI_API_KEY:latest,\
SESSION_SECRET=SESSION_SECRET:latest,\
ADMIN_PASSWORD_HASH=ADMIN_PASSWORD_HASH:latest,\
DATABASE_URL=DATABASE_URL:latest,\
GCS_BUCKET_NAME=GCS_BUCKET_NAME:latest"
```

デプロイ完了後に表示される URL（例: `https://miramath-backend-xxxx-an.a.run.app`）を Vercel の `NEXT_PUBLIC_API_BASE` に設定してください。

#### 4. カスタムドメインの設定（推奨）

Cookie セッションを同一親ドメイン配下で動かすため、以下のように設定します。

| サービス | ドメイン例 |
|---------|-----------|
| Vercel（frontend） | `app.example.com` |
| Cloud Run（backend） | `api.example.com` |

- Vercel: ダッシュボード → Domains → `app.example.com` を追加
- Cloud Run: ダッシュボード → カスタムドメインのマッピング → `api.example.com` を追加
- DNS レジストラで両ドメインの CNAME / A レコードを設定

> `FRONTEND_ORIGINS` も `https://app.example.com` に更新し、再デプロイしてください。

---

## 学習フロー

### 初回セットアップ

1. ブラウザでアプリを開くと `/login` にリダイレクトされる
2. `.env` の `ADMIN_PASSWORD_HASH` に対応するパスワードを入力してログイン
3. ログインするとメインアプリが使用可能になる

### 学習開始フロー（推奨）

1. "カリキュラム" で学習トピックを確認
2. "演習" で問題生成・回答提出・採点
3. 弱点を "ノート" に保存して復習メモ化
4. "進捗" で進捗と弱点上位トピックを確認

### 資料活用フロー（RAG）

1. "資料" で PDF/画像をアップロード
2. "チャット" で資料に基づく質問を送信
3. 回答末尾の「参照資料」で根拠を確認

---

## FAQ

Q. Settings 画面で API キーを変更できますか?  
A. できません。API キーは環境変数 `GEMINI_API_KEY` でのみ管理します。Settings 画面では system prompt のみ変更できます。

Q. 複数のデバイスから使えますか?  
A. 本番デプロイ（Vercel + Cloud Run）後は可能です。ローカル起動時は起動しているマシンからのみアクセスできます。

Q. ログインセッションはどのくらい持続しますか?  
A. 30 日間です。ログアウトボタンで任意に終了できます。

Q. API キーなしで使えますか?  
A. 起動は可能ですが、チャット・カリキュラム生成・演習・OCR など AI 依存機能は失敗します。

---

## ロードマップ

- ✅ ローカル起動（SQLite フォールバック対応）
- ✅ Cookie セッション認証（単一ユーザー）
- ✅ Vercel + Cloud Run デプロイ基盤
- ✅ PostgreSQL + pgvector への移行（DB・RAG）
- ✅ Google Cloud Storage へのアップロード移行
- ✅ Dockerfile + CI/CD パイプライン整備

---

## 品質チェック

```bash
# backend
cd backend
pytest -q

# frontend
cd frontend
npm run lint
npm run test
npm run build
```

CI: GitHub Actions の `CI` ワークフローで backend/frontend を自動検証

## リリース運用

- 変更履歴: `CHANGELOG.md`
- リリース手順: `RELEASING.md`
- バージョニング: Semantic Versioning

## コントリビューション

- 参加方法: `CONTRIBUTING.md`
- 行動規範: `CODE_OF_CONDUCT.md`
- セキュリティ報告: `SECURITY.md`

## ライセンス

`LICENSE` を参照してください。
