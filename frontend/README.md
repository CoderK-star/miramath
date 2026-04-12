# Frontend Local Setup Guide (Beta OSS)

このドキュメントは frontend をローカル実行するための手順です。

## 1. 前提

- Node.js 20+
- npm

## 2. セットアップ

```bash
cd frontend
npm install
```

## 3. 起動

```bash
npm run dev
```

ブラウザで http://127.0.0.1:3000 を開いてください。

## 4. 品質チェック（Phase 4）

```bash
npm run lint
npm run build
npm run test
```

## 5. 実装済みの品質基盤

- app error boundary: `src/app/error.tsx`
- app loading UI: `src/app/loading.tsx`
- API障害時の再試行導線（主要画面）
- Chat入力のフォーム検証とアクセシビリティ改善
