# apigitworkspace

短い説明: Git 風のリモート操作をローカルでシミュレートできる VirtualFS と、GitHub/GitLab 向けのアダプタを提供する TypeScript ライブラリ。

**目的**: リモートリポジトリ（GitHub/GitLab）への push/pull フローを抽象化し、ローカルでの変更管理・差分生成・衝突検知を行う軽量ライブラリを提供します。OSS として再利用できるライブラリ向けドキュメントです。

**主な特徴**
- **仮想ファイルシステム (VirtualFS)**: ローカルワークスペースとベーススナップショットを管理し、変更セット（create/update/delete）を生成します。
- **Git アダプタ抽象**: `GitAdapter` インターフェースに準拠するアダプタで GitHub/GitLab API を操作できます（サンプル実装あり）。
- **Idempotent push**: commitKey による冪等処理サポート。
- **衝突検知とマージ補助**: リモート差分取り込み時にローカルの未コミット変更を検出して conflicts を報告します。

**注意（⚠️）**: 実装はユーティリティ/ライブラリ向けで、環境やアクセストークンの管理、エラーハンドリング方針は利用側で制御してください。

**プロジェクト構成（抜粋）**
- **src/virtualfs/virtualfs.ts**: VirtualFS 本体（初期化、read/write、push/pull、差分生成） - [src/virtualfs/virtualfs.ts](src/virtualfs/virtualfs.ts)
- **src/virtualfs/persistence.ts**: ストレージバックエンドの抽象と Node 用実装 - [src/virtualfs/persistence.ts](src/virtualfs/persistence.ts)
- **src/git/adapter.ts**: `GitAdapter` インターフェース定義 - [src/git/adapter.ts](src/git/adapter.ts)
- **src/git/githubAdapter.ts**: GitHub 用アダプタ（blob/tree/commit フロー、再試行ロジック） - [src/git/githubAdapter.ts](src/git/githubAdapter.ts)
- **test/**: ユニット／E2E テスト群（Jest / Playwright） - [test](test)

**技術スタック**
- TypeScript 5.x
- Node.js (ESM, `type: "module"`)
- テスト: Jest（unit） / Playwright（E2E）
- ビルド: `tsc`

--------------------------------------------------
**クイックスタート（開発用）**

1. 依存インストール

```bash
npm ci
```

2. ユニットテスト実行

```bash
npm run test
```

3. E2E テスト（Playwright）

```bash
npm run test:e2e
```

4. ビルド

```bash
npm run build
```

--------------------------------------------------
**ライブラリ利用ガイド（Library Usage）**

下記はライブラリの代表的な使い方（TypeScript）です。詳しい実装は各ファイルを参照してください。

例: `VirtualFS` を初期化してローカル編集を push する

```ts
import VirtualFS from './src/virtualfs/virtualfs'
import GitHubAdapter from './src/git/githubAdapter'

async function example() {
  const vfs = new VirtualFS({ storageDir: '.apigit' })
  await vfs.init()

  // ワークスペース編集
  await vfs.writeWorkspace('foo.txt', 'hello')

  // 変更セット取得
  const changes = await vfs.getChangeSet()

  // GitHub アダプタを使って push
  const gh = new GitHubAdapter({ owner: 'ORG', repo: 'REPO', token: process.env.GH_TOKEN })
  const res = await vfs.push({ parentSha: vfs.getIndex().head, message: 'update', changes }, gh as any)
  console.log('commitSha', res.commitSha)
}
```

API の概略（主要メソッド）
- `new VirtualFS(options?)` - オプション: `{ storageDir?: string, backend?: StorageBackend }`
- `init()` - バックエンド初期化と index 読み込み
- `writeWorkspace(filepath, content)` - ワークスペースにファイルを書き込む
- `deleteWorkspace(filepath)` - ワークスペース上のファイルを削除（トゥームストーン管理）
- `renameWorkspace(from, to)` - rename（内部では delete + create）
- `readWorkspace(filepath)` - ワークスペース/ベースから内容を読み出す
- `applyBaseSnapshot(snapshot, headSha)` - リモートスナップショットを適用
- `getIndex()` - 現在の index を返す
- `listPaths()` - 登録パス一覧
- `getChangeSet()` - create/update/delete の配列を生成
- `pull(remoteHead, baseSnapshot)` - リモート差分取り込み（conflicts を返す）
- `push(input, adapter?)` - 変更をコミットし（adapter があれば）リモートへ反映

GitAdapter インターフェース（`src/git/adapter.ts`）
- `createBlobs(changes, concurrency?)` -> Promise<Record<string,string>>
- `createTree(changes, baseTreeSha?)` -> Promise<string>
- `createCommit(message, parentSha, treeSha)` -> Promise<string>
- `updateRef(ref, commitSha, force?)` -> Promise<void>

実装済みアダプタの注意点:
- `GitHubAdapter` は `blob/tree/commit` フローを実装し、HTTP 再試行ロジックを内蔵しています（5xx, 429 のリトライ等）。実装は [src/git/githubAdapter.ts](src/git/githubAdapter.ts) を参照してください。
- GitLab 用実装はリポジトリ内に存在しますが、環境差異により API の振る舞いが異なるため本番運用前に検証してください。⚠️

--------------------------------------------------
**開発セットアップ**
- Node: 任意の recent Node.js（ESM サポート済み）
- 実行手順

```bash
git clone <repo>
cd APIGitWorkspace01
npm ci
```

- コマンド一覧
  - `npm run test` : ユニットテスト（Jest）
  - `npm run test:e2e` : Playwright E2E
  - `npm run lint` : ESLint
  - `npm run build` : TypeScript ビルド

テスト関連の注意:
- Jest は ESM を扱うため `node --experimental-vm-modules` を使用するスクリプトが package.json に設定されています。

--------------------------------------------------
**現在のステータス**
- 実装済み: `VirtualFS` のコア機能（差分生成、push/pull シミュレーション、index 管理）、`GitHubAdapter` の主要な API 呼び出し。
- テスト: unit テストと一部の E2E テストが含まれています（`test/` 配下）。
- 未確定/要検証: 外部サービス（GitLab）の細かい API 挙動、production 用のエラー・認可ポリシー。

--------------------------------------------------
**ライセンスとメタデータ**
- package name: `apigitworkspace`
- version: `0.0.0`
- module type: ESM (`type: module`)
- License: MITMIT License

--------------------------------------------------
追加で欲しいもの
- サンプルユースケースを示す小さなサンプルリポジトリまたは `examples/` ディレクトリ


--------------------------------------------------
貢献・問い合わせ
- PR/Issue を歓迎します。まず issue を立て、簡単な実装提案（変更点の概要）を添えてください。

