# browser-git-ops

軽量なブラウザ向け Git 操作用ライブラリ（VirtualFS + GitHub/GitLab アダプタ）。
ブラウザの永続化レイヤは OPFS と IndexedDB を個別のバックエンド実装として提供し、VirtualFS が抽象化して利用します。

---

**主要ポイント**
- `VirtualFS`：ローカルワークスペースとベーススナップショットを管理し、create/update/delete の変更セットを生成します。
- ストレージ分離：`OpfsStorage`（OPFS 対応）と `IndexedDbStorage`（IndexedDB 対応）を個別実装として提供。
- `GitHubAdapter` / `GitLabAdapter`：各プラットフォーム向けのアダプタ実装（HTTP 再試行や blob/tree/commit フローを含む）。

---

**変更履歴（最近の重要な変更点）**
- ブラウザ永続化を `BrowserStorage` から分離し、`OpfsStorage` と `IndexedDbStorage` を新規追加しました。
- `VirtualFS` の既定バックエンドを `OpfsStorage` に切替え、従来の `canUseOpfs`（インスタンス委譲）は廃止しました。
- ルートエクスポートに `IndexedDbStorage` / `OpfsStorage` を追加し、examples と E2E ヘルパーを OPFS 検出の新 API に合わせて更新しました。
- 単体テストを複数更新・追加し、OPFS / IndexedDB の分岐やトランザクションエラー経路のカバレッジを強化しました。

---

**公開 API（ライブラリエントリ）**
ライブラリはバンドル／パッケージとして次をエクスポートします（`src/index.ts` を参照）：

- `VirtualFS` (default exportと命名エクスポート)
- `OpfsStorage` — OPFS（origin private file system）用バックエンド
- `IndexedDbStorage` — IndexedDB 用バックエンド
- `GitHubAdapter`, `GitLabAdapter` — 各プラットフォーム向けアダプタ

例：基本的な利用

```ts
import { VirtualFS, OpfsStorage, GitHubAdapter } from 'browser-git-ops'

async function example() {
  const vfs = new VirtualFS({ backend: new OpfsStorage() })
  await vfs.init()

  await vfs.writeFile('README.md', 'hello world')
  const changes = await vfs.getChangeSet()

  const gh = new GitHubAdapter({ owner: 'ORG', repo: 'REPO', token: process.env.GH_TOKEN })
  // push の呼び出しは VirtualFS の API に依存（詳細は src/virtualfs/virtualfs.ts）
}
```

---

## プロジェクト構成（抜粋）

- `src/` - ソースコード
  - `virtualfs/virtualfs.ts` - `VirtualFS` 本体
  - `virtualfs/opfsStorage.ts` - OPFS バックエンド
  - `virtualfs/indexedDbStorage.ts` - IndexedDB バックエンド
  - `git/githubAdapter.ts` - GitHub 向けアダプタ
  - `git/gitlabAdapter.ts` - GitLab 向けアダプタ
- `examples/` - ブラウザ実行用のサンプル UI
- `test/` - Jest（unit）および Playwright（e2e）テスト

（詳細はソース内のファイル参照を推奨）

---

## 技術スタック

- TypeScript
- ビルド: `esbuild`（ブラウザ向けバンドル） + `tsc`（型定義出力）
- テスト: Jest（unit） / Playwright（e2e）

---

## 特記事項 / 現在のステータス

- 実装済み
  - `VirtualFS` のコア機能（差分生成・index 管理・ローカル編集）
  - `OpfsStorage` と `IndexedDbStorage` の永続化 API
  - `GitHubAdapter` の主要な push フロー
- テスト
  - unit テストは多数あり、OPFS/IndexedDB 分岐やトランザクションエラー経路をカバー
  - E2E は Playwright ベースのサンプル UI を含む
- 要検証 / ⚠️ 注意
  - GitLab の API 実装は環境差異を考慮した追加検証が必要です。
  - OPFS の利用可否はブラウザ実装に依存します（polyfill でテストは行っていますが、実ブラウザでの動作確認を推奨）。

---

## セットアップ（開発者向け）

1. リポジトリをクローン

```bash
git clone https://github.com/nojaja/browser-git-ops.git
cd APIGitWorkspace01
npm ci
```

2. 開発コマンド

```bash
npm run test        # unit テスト (Jest)
npm run test:e2e    # Playwright E2E
npm run lint        # ESLint
npm run build       # 型定義 + ブラウザバンドル出力 (dist/)
```

実行時のヒント: テストスクリプトは ESM を扱うため、package.json の `test` スクリプトは `node --experimental-vm-modules` を付与して起動します。

---

## ライブラリ利用ガイド（API 概略）

- `new VirtualFS(options?)` — オプション: `{ storageDir?: string, backend?: StorageBackend }`。
- `init()` — バックエンド初期化・index 読み込み。
- `writeFile(path, content)` / `deleteFile(path)` / `renameFile(from,to)` — ローカル編集操作。
- `getChangeSet()` — create/update/delete の変更配列を取得。
- `applyBaseSnapshot(snapshot, headSha)` — リモートスナップショット適用（conflicts を返す）。

詳細は `src/virtualfs/virtualfs.ts` の JSDoc コメントを参照してください。

---

## テストと CI

- ローカルでの unit テスト実行: `npm run test`
- E2E 実行前に `npm run build` を実行する必要があります（`test:e2e` の `pretest:e2e` を参照）。

---

## 貢献

- Issue / PR を歓迎します。まず Issue にて目的・設計方針を共有してください。
- コーディング規約: TypeScript + ESLint。PR ではテスト追加を推奨します。

---

## ライセンス

- MIT — 詳細は `LICENSE` ファイル参照

---

## 連絡先

- 作者: nojaja — https://github.com/nojaja
