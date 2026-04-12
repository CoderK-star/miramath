# Miramath — OSS Beta Roadmap

## 目的

この文書は、公開向けの内部ロードマップを管理するための計画書です。  
利用者向けの導線は `README.md` に集約し、`PLAN.md` は「実装順序・技術判断・将来拡張」を扱います。

## 公開ポジション

- 初回公開: コントリビューション歓迎のベータ版
- 運用前提: ローカル実行の単一ユーザー
- 非対応: 認証、本格マルチユーザー、本番運用

## マイルストーン

1. Phase 1: 公開基盤
2. Phase 2: 設定とセキュリティ衛生
3. Phase 3: バックエンド品質基盤
4. Phase 4: フロントエンド品質基盤
5. Phase 5: 機能強化（practice中心）
6. Phase 6: 将来のマルチユーザー化境界整備
7. Phase 7: OSS運用自動化
8. Phase 8: インフラ移行（PostgreSQL + GCS + Docker）
9. Phase 9: 公開前レビュー

## 現在フェーズ

### Phase 1: 公開基盤（実装済み）

- ルート README 追加（日本語中心）
- LICENSE / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY 追加
- Issue / PR テンプレート追加

### Phase 2: 設定とセキュリティ衛生（実装中）

- `.env.example` の必須・任意設定を整理
- `backend/app/config.py` の設定値バリデーション導入
- 起動時の不足チェック warning 導入
- アップロード制約（MIME/サイズ）を設定化

### Phase 3: バックエンド品質基盤（実装済み）

- 例外応答フォーマット標準化
- ログ基盤と request_id の導入
- pytest スモークテスト整備

### Phase 4: フロントエンド品質基盤（実装済み）

- lint/build/test の最低ライン固定
- error/loading/empty state の標準化
- API失敗時の再試行導線整備

### Phase 5: 機能強化（進行中）

- practice 弱点可視化と notes 連携
- curriculum/progress への弱点導線追加
- materials/RAG 回答の根拠表示改善

### Phase 7: OSS運用自動化（開始）

- GitHub Actions CI 追加（backend pytest / frontend lint+test+build）
- リリース手順と変更履歴運用を文書化
- サンプルデータとルート起動スクリプトを追加

## 次に着手する内容

### Phase 6

- user_id 導入余地の境界定義を文書化
- 所有権境界（chat/notes/materials/practice/progress）の移行ポイント整理

### Phase 8: インフラ移行（実装済み）

- SQLite → PostgreSQL + pgvector 移行（`database.py`, `models/chunk.py`, `rag_service.py`）
- ChromaDB 廃止、Google GenAI (text-embedding-004) でベクトル生成
- ローカルアップロード → Google Cloud Storage 抽象化（`storage_service.py`）
  - `STORAGE_BACKEND=local|gcs` で切り替え
- `backend/Dockerfile` / `frontend/Dockerfile` 追加
- `docker-compose.yml` (pgvector/pgvector:pg16 + backend + frontend) 追加
- `.github/workflows/ci.yml` に PostgreSQL サービスコンテナ + Docker ビルドジョブ追加

### Phase 9: 公開前レビュー

- README 導線の最終確認
- 新規開発者 30 分起動の受け入れ確認

## 将来拡張の設計メモ

- user_id 導入余地をモデル/サービス/API で確保
- 単一ユーザー前提を維持しつつ移行ポイントだけ先に定義

## 受け入れ条件（ベータ公開前）

1. READMEのみで初回セットアップ可能
2. backend/frontend がローカルで起動し主要画面に到達可能
3. OSS公開物（LICENSE等）とCI土台が揃っている
4. 「単一ユーザー」「ローカル中心」「認証未対応」を明記済み
