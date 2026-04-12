# Backend Local Setup Guide (Beta OSS)

このドキュメントは `backend` をローカル起動するための手順です。  
本プロジェクトは **単一ユーザー / ローカル実行前提のベータ版** です。

## 1. 必要なツール

- Python 3.11+
- pip
- venv

確認コマンド:

```powershell
python --version
python -m pip --version
```

## 2. セットアップ

プロジェクトルートで実行:

```powershell
python -m venv venv
./venv/Scripts/Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
```

## 3. 環境変数

ルートの `.env.example` を `.env` にコピーして編集します。

```powershell
Copy-Item .env.example .env
```

### 必須

- `GEMINI_API_KEY`

### 主要な任意設定

- `APP_ENV` (default: `local`)
- `LOCAL_BETA_MODE` (default: `true`)
- `GEMINI_MODEL_NAME` (default: `gemini-2.5-flash`)
- `API_TIMEOUT_SEC` (default: `30`, range: 5-300)
- `API_MAX_RETRIES` (default: `2`, range: 0-5)
- `DATABASE_URL` (default: `sqlite:///./data/math_teacher.db`)
- `CHROMA_PERSIST_DIR` (default: `./data/chroma`)
- `FRONTEND_ORIGINS` (default: `http://localhost:3000,http://127.0.0.1:3000`)
- `MAX_UPLOAD_SIZE_MB` (default: `10`, range: 1-100)
- `ALLOWED_UPLOAD_MIME_TYPES` (comma-separated)

### データ保存場所

- SQLite: `data/math_teacher.db`
- Chroma: `data/chroma`
- Uploads: `data/uploads`

## 4. 起動

```powershell
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

ヘルスチェック:

- `http://127.0.0.1:8000/health`

## 5. セキュリティと制約

- 認証・認可は未対応
- 本番公開環境での利用は非推奨
- `GEMINI_API_KEY` が空でも起動は可能だが、AI依存機能は失敗する
- Upload は MIME とサイズ制限で検証される

## 6. トラブルシュート

- ポート競合時は別プロセス停止後に再起動
- 依存エラー時は仮想環境有効化を再確認
- 環境変数の値不正時は起動ログの warning / error を確認

## 7. テスト（Phase 3 以降）

```powershell
cd backend
pytest -q
```

スモークテストでは `health/chat/curriculum/materials/progress/notes/practice` の
主要正常系と代表的なエラー契約を確認します。
